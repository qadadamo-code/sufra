/**
 *   const provider = pickProvider(repo.kind);          // demo in local mode, Paymob/Kashier when configured
 *   const intent = await provider.createIntent(req);   // → redirect the guest to intent.redirectUrl
 *   ...back on ?pi=<id>: poll provider.retrieve(id) through payReducer until succeeded/failed.
 */
import { demoProvider } from "./demo";
import { kashierProvider } from "./kashier";
import { paymobProvider } from "./paymob";
import { PAY_PROVIDER } from "./server";
import type { PaymentProvider, ProviderId } from "./types";

export * from "./types";
export * from "./machine";
export { demoProvider, loadDemoIntent, type DemoOutcome } from "./demo";

export const PROVIDERS: Record<ProviderId, PaymentProvider> = { demo: demoProvider, paymob: paymobProvider, kashier: kashierProvider };

/** The provider guests use: the configured real one, else the demo while running on the local backend. */
export function pickProvider(backend: "local" | "supabase"): PaymentProvider | null {
  const real = PAY_PROVIDER ? PROVIDERS[PAY_PROVIDER] : [paymobProvider, kashierProvider].find((p) => p.available());
  if (real?.available()) return real;
  return backend === "local" ? demoProvider : null;
}

export const providerFor = (intentId: string): PaymentProvider => (intentId.startsWith("pi_demo_") ? demoProvider : PAY_PROVIDER ? PROVIDERS[PAY_PROVIDER] : paymobProvider);
