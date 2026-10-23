/**
 * DemoProvider — a simulated hosted checkout so the whole pay-at-table / online-order flow can be tried
 * with no merchant account. Intents live in localStorage (shared by tabs, like the LocalAdapter);
 * the "hosted page" is /r/:slug/pay/:intentId (CheckoutPage), which completes the intent and sends
 * the guest back to `returnUrl?pi=<id>`. Never available in production builds with a real provider.
 */
import { uuid } from "@/lib/id";
import { loadJSON, saveJSON } from "@/lib/storage";
import type { PaymentIntent, PaymentProvider, PaymentRequest } from "./types";

const KEY = (id: string) => `sufra-guest.pi.${id}`;
const mem = new Map<string, PaymentIntent>();
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/app/";

function save(pi: PaymentIntent) {
  mem.set(pi.id, pi);
  saveJSON(KEY(pi.id), pi);
}
export function loadDemoIntent(id: string): PaymentIntent | null {
  return loadJSON<PaymentIntent | null>(KEY(id), null) ?? mem.get(id) ?? null;
}

export type DemoOutcome = "succeeded" | "failed" | "cancelled";

export const demoProvider: PaymentProvider & {
  complete(id: string, outcome: DemoOutcome): Promise<PaymentIntent | null>;
} = {
  id: "demo",
  label: { ar: "دفع تجريبي", en: "Demo payment" },
  methods: ["card", "wallet", "meeza", "apple_pay"],
  available: () => true,

  async createIntent(req: PaymentRequest) {
    if (req.amount <= 0) throw new Error("bad_amount");
    if (req.tip < 0) throw new Error("bad_tip");
    const id = `pi_demo_${uuid().replace(/-/g, "").slice(0, 20)}`;
    const now = Date.now();
    const pi: PaymentIntent = {
      id,
      provider: "demo",
      status: "requires_action",
      charge: req.amount + req.tip,
      amount: req.amount,
      tip: req.tip,
      currency: req.currency,
      redirectUrl: `${BASE}r/${encodeURIComponent(req.restaurantSlug)}/pay/${id}`,
      reference: null,
      failureReason: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 15 * 60_000).toISOString(),
      request: req,
    };
    save(pi);
    return pi;
  },

  async retrieve(id) {
    const pi = loadDemoIntent(id);
    if (pi && pi.status === "requires_action" && Date.parse(pi.expiresAt) < Date.now()) {
      const exp = { ...pi, status: "expired" as const, redirectUrl: null };
      save(exp);
      return exp;
    }
    return pi;
  },

  async cancel(id) {
    const pi = loadDemoIntent(id);
    if (pi && pi.status === "requires_action") save({ ...pi, status: "cancelled", redirectUrl: null });
  },

  /** what the provider's hosted page + webhook would do */
  async complete(id, outcome) {
    const pi = loadDemoIntent(id);
    if (!pi || pi.status !== "requires_action") return pi;
    const done: PaymentIntent = {
      ...pi,
      status: outcome,
      redirectUrl: null,
      reference: outcome === "succeeded" ? `DEMO-${Math.floor(100000 + Math.random() * 899999)}` : null,
      failureReason: outcome === "failed" ? "card_declined" : null,
    };
    save(done);
    return done;
  },
};
