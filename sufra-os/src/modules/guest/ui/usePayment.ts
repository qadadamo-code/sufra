import { startTransition, useCallback, useEffect, useReducer, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { GuestService } from "../api/service";
import { payReducer, pickProvider, providerFor, type PaymentIntent, type PaymentRequest } from "../pay";

const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/app/";

/**
 * Drives the payment state machine: create intent → hosted checkout → back with ?pi= → poll → record → done.
 * Works the same for the DemoProvider (internal route) and real providers (full-page redirect).
 */
export function usePayment(svc: GuestService, slug: string) {
  const [state, dispatch] = useReducer(payReducer, { s: "idle" });
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const provider = pickProvider(svc.local ? "local" : "supabase");
  const recorded = useRef(new Set<string>());

  // returning from the provider
  const pi = params.get("pi");
  useEffect(() => {
    if (!pi) return;
    dispatch({ t: "RETURNED", intentId: pi });
  }, [pi]);

  // poll while verifying
  useEffect(() => {
    if (state.s !== "verifying") return;
    let alive = true;
    const p = providerFor(state.intentId);
    const tick = async () => {
      try {
        const intent = (await p.retrieve(state.intentId)) ?? (await svc.paymentStatus(state.intentId));
        if (alive && intent) dispatch({ t: "STATUS", intent });
        else if (alive) dispatch({ t: "TIMEOUT" });
      } catch {
        /* next tick */
      }
    };
    const id = setTimeout(tick, state.polls === 0 ? 150 : 2000);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [state, svc]);

  // record once
  useEffect(() => {
    if (state.s !== "succeeded" || recorded.current.has(state.intent.id)) return;
    recorded.current.add(state.intent.id);
    svc.recordPayment(slug, state.intent).then(
      () => dispatch({ t: "RECORDED" }),
      () => dispatch({ t: "RECORDED" }), // already recorded server-side / idempotent
    );
  }, [state, svc, slug]);

  const start = useCallback(
    async (req: Omit<PaymentRequest, "returnUrl" | "restaurantSlug">) => {
      if (!provider) return;
      dispatch({ t: "START" });
      try {
        const here = new URL(window.location.href);
        here.searchParams.delete("pi");
        const intent: PaymentIntent = await provider.createIntent({ ...req, restaurantSlug: slug, returnUrl: here.toString() });
        dispatch({ t: "CREATED", intent });
        if (!intent.redirectUrl) return;
        if (intent.redirectUrl.startsWith(BASE)) startTransition(() => navigate(intent.redirectUrl!.slice(BASE.length - 1)));
        else window.location.assign(intent.redirectUrl);
      } catch (e) {
        dispatch({ t: "FAILED", error: (e as Error).message });
      }
    },
    [provider, slug, navigate],
  );

  const reset = useCallback(() => {
    dispatch({ t: "RETRY" });
    if (params.has("pi")) {
      params.delete("pi");
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  return { state, start, reset, provider, available: !!provider };
}
