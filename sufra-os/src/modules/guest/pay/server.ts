/**
 * Browser client for OUR payment functions (/api/pay-intent …, see /home/user/api and ./DESIGN.md). Real providers
 * (Paymob, Kashier, Moyasar) talk to these endpoints only; the endpoints hold the merchant secrets, re-validate the
 * amount against the check and create/verify the provider payment.
 *
 * VITE_PAY_API — base of the functions, default "/api" (same Vercel project). Set "off" to hide online payment.
 */
import type { PaymentIntent, PaymentRequest, ProviderId } from "./types";
import { PaymentConfigError } from "./types";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const raw = env.VITE_PAY_API?.trim();
export const PAY_API: string | null = raw === "off" ? null : (raw || "/api").replace(/\/$/, "");
/** optional deployment-wide default; per restaurant it is Settings → Payments (settings.payments.provider) */
export const PAY_PROVIDER = (env.VITE_PAY_PROVIDER?.trim() || null) as ProviderId | null;

/** Error with the server's bilingual message (501 not configured, 422 amount, 502 gateway) */
export class PayApiError extends Error {
  constructor(public status: number, public code: string, public text: { ar: string; en: string } | null) {
    super(code);
  }
}

/** Supabase user token (persisted by supabase-js) so staff-only calls (links, refunds) can be authorised server-side. */
export function staffToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!/^sb-.+-auth-token$/.test(k)) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? "null");
      const t = v?.access_token ?? v?.currentSession?.access_token;
      if (typeof t === "string") return t;
    }
  } catch {
    /* private mode */
  }
  return null;
}

export async function payFetch<T>(path: string, init: RequestInit = {}, provider: ProviderId = "paymob"): Promise<T> {
  if (!PAY_API) throw new PaymentConfigError(provider, "VITE_PAY_API is off");
  const token = staffToken();
  const res = await fetch(`${PAY_API}/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...((init.headers as Record<string, string>) ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayApiError(res.status, String(body?.error ?? `pay_api_${res.status}`), body?.message ?? null);
  return body as T;
}

export const payServer = {
  createIntent: (provider: ProviderId, req: PaymentRequest) =>
    payFetch<PaymentIntent>("pay-intent", { method: "POST", body: JSON.stringify({ ...req, provider, request: { restaurantSlug: req.restaurantSlug, tableCode: req.tableCode } }) }, provider),
  retrieve: (provider: ProviderId, id: string) => payFetch<PaymentIntent | null>(`pay-intent?id=${encodeURIComponent(id)}`, { method: "GET" }, provider),
  cancel: (provider: ProviderId, id: string) => payFetch<void>("pay-intent", { method: "POST", body: JSON.stringify({ action: "cancel", id }) }, provider),
};
