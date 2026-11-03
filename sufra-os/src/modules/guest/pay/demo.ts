/**
 * DemoProvider — a simulated hosted checkout so pay-at-table, online-order prepay and pay-by-link can be tried with no
 * merchant account. The "hosted page" is /r/:slug/pay/:intentId (CheckoutPage), which completes the intent and sends
 * the guest back to `returnUrl?pi=<id>`.
 *
 * Storage: when a local repo is attached (`attachDemoRepo`, done by the pay pages / POS in local mode) intents are
 * rows of the `paymentIntents` collection — staff screens (Payments, POS pay-link) see them live across tabs — and
 * `complete()` plays the verified webhook: it records the payment exactly once (src/modules/payments/record.ts).
 * Without a repo (unit tests) intents live in localStorage. Never used when a real provider is configured in the cloud.
 */
import { uuid } from "@/lib/id";
import { loadJSON, saveJSON } from "@/lib/storage";
import type { Repo } from "@/data/repo";
import { recordIntentLocal } from "@/modules/payments/record";
import { intentFromRow, rowFromIntent } from "./rows";
import type { PaymentIntent, PaymentProvider, PaymentRequest } from "./types";

const KEY = (id: string) => `sufra-guest.pi.${id}`;
const mem = new Map<string, PaymentIntent>();
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/app/";

let repo: Repo | null = null;
/** local backend only: keep demo intents in the shared `paymentIntents` collection */
export function attachDemoRepo(r: Repo | null) {
  repo = r && r.kind === "local" ? r : null;
}

async function save(pi: PaymentIntent, ctx?: { restaurantId: string; branchId: string | null; createdBy?: string | null }) {
  mem.set(pi.id, pi);
  saveJSON(KEY(pi.id), pi);
  if (!repo) return;
  const existing = await repo.get("paymentIntents", pi.id);
  if (existing) await repo.update("paymentIntents", pi.id, { status: pi.status, providerRef: pi.reference, failureReason: pi.failureReason, redirectUrl: pi.redirectUrl });
  else if (ctx) await repo.insert("paymentIntents", rowFromIntent(pi, ctx));
}
export function loadDemoIntent(id: string): PaymentIntent | null {
  return loadJSON<PaymentIntent | null>(KEY(id), null) ?? mem.get(id) ?? null;
}
async function load(id: string): Promise<PaymentIntent | null> {
  if (repo) {
    const row = await repo.get("paymentIntents", id);
    if (row) return intentFromRow(row);
  }
  return loadDemoIntent(id);
}

async function contextFor(req: PaymentRequest) {
  if (!repo) return undefined;
  let restaurantId = req.restaurantId ?? null;
  if (!restaurantId) restaurantId = (await repo.list("restaurants", { where: { slug: req.restaurantSlug } }))[0]?.id ?? null;
  if (!restaurantId) return undefined;
  let branchId: string | null = null;
  if (req.checkId) branchId = (await repo.get("checks", req.checkId))?.branchId ?? null;
  else if (req.orderId) branchId = (await repo.get("orders", req.orderId))?.branchId ?? null;
  return { restaurantId, branchId, createdBy: (req as PaymentRequest & { createdBy?: string | null }).createdBy ?? null };
}

export type DemoOutcome = "succeeded" | "failed" | "cancelled";

export const demoProvider: PaymentProvider & {
  complete(id: string, outcome: DemoOutcome): Promise<PaymentIntent | null>;
} = {
  id: "demo",
  label: { ar: "دفع تجريبي", en: "Demo payment" },
  methods: ["card", "wallet", "meeza", "applepay", "mada", "stcpay", "kiosk"],
  available: () => true,

  async createIntent(req: PaymentRequest) {
    if (!Number.isSafeInteger(req.amount) || req.amount <= 0 || req.amount % 1000) throw new Error("bad_amount");
    if (req.tip < 0 || req.tip % 1000) throw new Error("bad_tip");
    const id = `pi_demo_${uuid().replace(/-/g, "").slice(0, 20)}`;
    const now = Date.now();
    const minutes = req.kind === "link" || req.kind === "deposit" ? Math.min(7 * 24 * 60, Math.max(5, req.expiresInMin ?? 60)) : 15;
    const pi: PaymentIntent = {
      id,
      provider: "demo",
      kind: req.kind ?? (req.purpose === "order" ? "online_order" : "guest"),
      method: req.method ?? null,
      status: "requires_action",
      charge: req.amount + req.tip,
      amount: req.amount,
      tip: req.tip,
      currency: req.currency,
      redirectUrl: `${BASE}r/${encodeURIComponent(req.restaurantSlug)}/pay/${id}`,
      reference: null,
      failureReason: null,
      note: req.note ?? "",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + minutes * 60_000).toISOString(),
      request: { ...req, returnUrl: req.returnUrl.replace(/%7Bpi%7D|\{pi\}/gi, id) },
    };
    await save(pi, await contextFor(req));
    return pi;
  },

  async retrieve(id) {
    const pi = await load(id);
    if (pi && pi.status === "requires_action" && Date.parse(pi.expiresAt) < Date.now()) {
      const exp = { ...pi, status: "expired" as const, redirectUrl: null };
      await save(exp);
      return exp;
    }
    return pi;
  },

  async cancel(id) {
    const pi = await load(id);
    if (pi && pi.status === "requires_action") await save({ ...pi, status: "cancelled", redirectUrl: null });
  },

  /** what the provider's hosted page + verified webhook would do */
  async complete(id, outcome) {
    const pi = await this.retrieve(id);
    if (!pi || pi.status !== "requires_action") return pi;
    const done: PaymentIntent = {
      ...pi,
      status: outcome,
      redirectUrl: null,
      reference: outcome === "succeeded" ? `DEMO-${Math.floor(100000 + Math.random() * 899999)}` : null,
      failureReason: outcome === "failed" ? "card_declined" : null,
    };
    mem.set(id, done);
    saveJSON(KEY(id), done);
    if (repo && (await repo.get("paymentIntents", id))) await recordIntentLocal(repo, id, outcome, done.reference);
    else await save(done);
    return done;
  },
};
