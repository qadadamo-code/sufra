/**
 * Shared client for the payment server functions (see ./DESIGN.md). Real providers (Paymob, Kashier)
 * talk to OUR endpoints only; those endpoints hold the merchant secrets and create/verify the
 * provider payment. Configure with VITE_PAY_API (e.g. "/api/pay") — unset = online payment hidden.
 */
import type { PaymentIntent, PaymentRequest, ProviderId } from "./types";
import { PaymentConfigError } from "./types";

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
export const PAY_API = env.VITE_PAY_API?.trim() || null;
/** which real provider the deployment uses (per-tenant choice lives server-side in payment_accounts) */
export const PAY_PROVIDER = (env.VITE_PAY_PROVIDER?.trim() || null) as ProviderId | null;

async function call<T>(provider: ProviderId, path: string, init: RequestInit): Promise<T> {
  if (!PAY_API) throw new PaymentConfigError(provider, "VITE_PAY_API is not set");
  const res = await fetch(`${PAY_API}/${provider}/${path}`, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`pay_api_${res.status}`);
  return (await res.json()) as T;
}

export const payServer = {
  createIntent: (provider: ProviderId, req: PaymentRequest) => call<PaymentIntent>(provider, "intent", { method: "POST", body: JSON.stringify(req) }),
  retrieve: (provider: ProviderId, id: string) => call<PaymentIntent | null>(provider, `intent/${encodeURIComponent(id)}`, { method: "GET" }),
  cancel: (provider: ProviderId, id: string) => call<void>(provider, `intent/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
};
