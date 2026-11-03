/**
 *   const provider = pickProvider(repo.kind, config?.provider);   // demo in local mode; the restaurant's gateway in the cloud
 *   const intent = await provider.createIntent(req);               // → redirect the guest to intent.redirectUrl
 *   ...back on ?pi=<id>: poll provider.retrieve(id) through payReducer until succeeded/failed.
 *
 * Which gateway a restaurant uses is Settings → Payments (settings.payments.provider); guests read it through the
 * public `guest_pay_config` RPC (no keys). The server re-checks it — the browser choice is only a hint.
 */
import { demoProvider } from "./demo";
import { kashierProvider } from "./kashier";
import { moyasarProvider } from "./moyasar";
import { paymobProvider } from "./paymob";
import { PAY_PROVIDER } from "./server";
import type { PaymentProvider, ProviderId } from "./types";

export * from "./types";
export * from "./machine";
export { demoProvider, loadDemoIntent, attachDemoRepo, type DemoOutcome } from "./demo";
export { intentFromRow, rowFromIntent } from "./rows";
export { PAY_API, PayApiError, payFetch, staffToken } from "./server";

export const PROVIDERS: Record<ProviderId, PaymentProvider> = { demo: demoProvider, paymob: paymobProvider, kashier: kashierProvider, moyasar: moyasarProvider };
export const isBrowserProvider = (p: string | null | undefined): p is ProviderId => !!p && p in PROVIDERS;

/** The provider guests use: demo on the local backend, else the restaurant's configured gateway (null = online pay off). */
export function pickProvider(backend: "local" | "supabase", configured?: string | null): PaymentProvider | null {
  if (backend === "local") return demoProvider;
  const id = isBrowserProvider(configured) ? configured : PAY_PROVIDER;
  const real = id && id !== "demo" ? PROVIDERS[id] : null;
  return real?.available() ? real : null;
}

/** All real providers retrieve through the same /api/pay-intent, so any of them can poll any non-demo intent. */
export const providerFor = (intentId: string): PaymentProvider => (intentId.startsWith("pi_demo_") ? demoProvider : paymobProvider);
