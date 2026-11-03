/**
 * Local-mode twin of `guest_record_payment` (0008_payments.sql): what the verified webhook does, for the DemoProvider.
 * Idempotent — a final intent is never changed again and the payment is inserted at most once
 * (payments.reference = intent id). Check-less kinds (gift cards, top-ups, deposits) only flip the intent and call
 * the handlers other modules registered (CRM: issue the gift card / credit the wallet).
 */
import type { Repo } from "@/data/repo";
import type { PaymentIntentKind, PaymentIntentRow, PaymentIntentStatus } from "@/data/types";

const FINAL: PaymentIntentStatus[] = ["succeeded", "failed", "cancelled", "expired"];

type Handler = (intent: PaymentIntentRow) => void | Promise<void>;
const handlers = new Map<PaymentIntentKind, Set<Handler>>();
/**
 * Run code when an intent of this kind succeeds (local mode: right away; cloud: subscribe to `paymentIntents`
 * where kind = … and status = 'succeeded' — the webhook already flipped it). Returns an unsubscribe.
 *   onIntentSucceeded("gift_card", (pi) => issueGiftCard(pi.purposeRef, pi.amount))
 */
export function onIntentSucceeded(kind: PaymentIntentKind, fn: Handler): () => void {
  if (!handlers.has(kind)) handlers.set(kind, new Set());
  handlers.get(kind)!.add(fn);
  return () => handlers.get(kind)?.delete(fn);
}

export interface RecordResult {
  status: PaymentIntentStatus;
  paymentId: string | null;
  duplicate: boolean;
}

/** Mark a (demo) intent succeeded and record its payment once. */
export async function recordIntentLocal(repo: Repo, intentId: string, outcome: PaymentIntentStatus = "succeeded", providerRef: string | null = null): Promise<RecordResult> {
  const pi = await repo.get("paymentIntents", intentId);
  if (!pi) throw new Error("not_found");
  if (FINAL.includes(pi.status)) return { status: pi.status, paymentId: pi.paymentId, duplicate: true };
  if (outcome !== "succeeded") {
    await repo.update("paymentIntents", pi.id, { status: outcome, redirectUrl: null, providerRef: providerRef ?? pi.providerRef, failureReason: outcome === "failed" ? "card_declined" : outcome === "processing" ? null : outcome });
    return { status: outcome, paymentId: null, duplicate: false };
  }
  let paymentId: string | null = null;
  if (pi.checkId) {
    const check = await repo.get("checks", pi.checkId);
    if (check) {
      const dup = (await repo.list("payments", { where: { checkId: check.id, reference: pi.id } }))[0];
      if (dup) paymentId = dup.id;
      else {
        const row = await repo.insert("payments", {
          restaurantId: check.restaurantId, branchId: check.branchId, checkId: check.id, method: "online", amount: pi.amount, tip: pi.tip, tendered: null, change: null,
          reference: pi.id, splitLabel: pi.splitLabel, status: "captured", takenBy: null, refundOf: null,
        });
        paymentId = row.id;
        const paid = (await repo.list("payments", { where: { checkId: check.id, status: "captured" } })).reduce((a, p) => a + p.amount, 0);
        await repo.update("checks", check.id, { paid });
        const code = (pi.request as { tableCode?: string | null; restaurantSlug?: string }).tableCode;
        const slug = (pi.request as { restaurantSlug?: string }).restaurantSlug;
        if (code && slug) {
          const text = `✓ ${pi.splitLabel ?? ""} دفع أونلاين ${(pi.amount / 100000).toFixed(2)} · ${pi.id.slice(-6)}`;
          await repo.guest.callWaiter(slug, code, "bill", text).catch(() => undefined);
        }
      }
    }
  }
  const updated = await repo.update("paymentIntents", pi.id, { status: "succeeded", paymentId, redirectUrl: null, providerRef: providerRef ?? pi.providerRef });
  for (const h of handlers.get(pi.kind) ?? []) await Promise.resolve(h(updated)).catch(() => undefined);
  return { status: "succeeded", paymentId, duplicate: false };
}
