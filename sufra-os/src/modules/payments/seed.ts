/**
 * Demo online-payment rows for the seed restaurant (src/data/seed.ts calls this). Deterministic, fictional.
 * Not written to supabase/seed.sql: in the cloud, payment_intents are created by the payment server functions only.
 */
import { major, type Units } from "@/lib/money";
import type { Check, Payment, PaymentIntentRow, PaymentPayout, PaymentRefund } from "@/data/types";

interface Ctx {
  restaurantId: string;
  branchId: string;
  checks: Check[];
  payments: Payment[];
  /** minutes ago → ISO */
  T: (minutesAgo: number) => string;
  checkId: (key: string) => string;
  paymentId: (key: string) => string;
  staffId: (key: string) => string;
}

export function demoPaymentRows(c: Ctx): { paymentIntents: PaymentIntentRow[]; paymentRefunds: PaymentRefund[]; paymentPayouts: PaymentPayout[] } {
  const check = (k: string) => c.checks.find((x) => x.id === c.checkId(k)) ?? null;
  const row = (k: string, minutesAgo: number, p: Partial<PaymentIntentRow> & Pick<PaymentIntentRow, "kind" | "status" | "amount">): PaymentIntentRow => ({
    id: `pi_seed_${k}`, restaurantId: c.restaurantId, createdAt: c.T(minutesAgo), updatedAt: c.T(Math.max(0, minutesAgo - 2)),
    branchId: c.branchId, checkId: null, orderId: null, provider: "paymob", mode: "test", method: "card", tip: 0, currency: "EGP", fee: null, refunded: 0,
    splitLabel: null, redirectUrl: null, providerRef: null, providerOrderId: null, failureReason: null, request: {}, paymentId: null, purposeRef: null, note: "",
    customer: null, createdBy: null, expiresAt: c.T(minutesAgo - 30), payoutId: null, ...p,
  });
  const fee = (u: Units) => Math.round((u * 275) / 10_000 / 1000) * 1000 + major(3); // ≈2.75% + 3 EGP, whole piastres
  const out: PaymentIntentRow[] = [];

  // the delivery order d2 was paid by link (the seed's "online" tender) — matched
  const d2 = check("d2");
  const d2pay = c.payments.find((p) => p.id === c.paymentId("pay:d2"));
  if (d2 && d2pay) {
    const pi = row("d2", 9, { kind: "link", status: "succeeded", amount: d2.total, checkId: d2.id, method: "wallet", providerRef: "TXN-4471902", providerOrderId: "int_8f3a91", paymentId: d2pay.id, fee: fee(d2.total), createdBy: c.staffId("cashier1"), note: "طلب دليفري — أسامة", customer: { name: "أسامة جلال", phone: "01005551208" } });
    out.push(pi);
    d2pay.reference = pi.id;
  }
  // table 7 asked for the bill: one guest tried pay-at-table, the card was declined
  const t7 = check("t7");
  if (t7) out.push(row("t7a", 6, { kind: "guest", status: "failed", amount: Math.round(t7.total / 2 / 1000) * 1000, checkId: t7.id, splitLabel: "1 / 2", failureReason: "card_declined", providerRef: "TXN-4471955" }));
  // a link sent to table 11 over WhatsApp, still waiting
  const t11 = check("t11");
  if (t11) out.push(row("t11", 3, { kind: "link", status: "requires_action", amount: t11.total, checkId: t11.id, provider: "paymob", method: null, createdBy: c.staffId("cashier1"), note: "", customer: { name: "رنا عزت", phone: "01005551209" }, expiresAt: c.T(-57), redirectUrl: null }));
  // an expired link for table 3
  const t3 = check("t3");
  if (t3) out.push(row("t3", 95, { kind: "link", status: "expired", amount: t3.total, checkId: t3.id, method: null, createdBy: c.staffId("cashier2"), expiresAt: c.T(35) }));
  // a gift card bought online (no check — CRM owns the gift card)
  out.push(row("gc1", 140, { kind: "gift_card", status: "succeeded", amount: major(500), method: "card", providerRef: "TXN-4470188", fee: fee(major(500)), purposeRef: "GC-7Q4K", customer: { name: "دينا الشافعي", phone: "01005551201" } }));
  // reconciliation demo: the provider says paid, but no POS payment was recorded (webhook arrived after the check was closed in cash)
  const t15 = check("t15");
  if (t15) out.push(row("t15", 14, { kind: "guest", status: "succeeded", amount: major(185), checkId: t15.id, method: "applepay", providerRef: "TXN-4471777", fee: fee(major(185)), splitLabel: "1 / 3" }));
  // yesterday: settled, with a partial refund
  out.push(row("y1", 60 * 22, { kind: "online_order", status: "succeeded", amount: major(642.5), method: "card", providerRef: "TXN-4468001", fee: fee(major(642.5)), refunded: major(80), payoutId: "seed-payout-1" }));
  out.push(row("y2", 60 * 21, { kind: "online_order", status: "succeeded", amount: major(318), method: "wallet", provider: "paymob", providerRef: "TXN-4468044", fee: fee(major(318)), payoutId: "seed-payout-1" }));

  const y1 = out.find((p) => p.id === "pi_seed_y1")!;
  const y2 = out.find((p) => p.id === "pi_seed_y2")!;
  const refunds: PaymentRefund[] = [
    { id: "seed-refund-1", restaurantId: c.restaurantId, createdAt: c.T(60 * 20), updatedAt: c.T(60 * 20), intentId: y1.id, paymentId: null, amount: major(80), reason: "صنف ناقص في الطلب", status: "succeeded", providerRef: "RF-99102", error: null, requestedBy: c.staffId("cashier1"), approvedBy: c.staffId("manager") },
  ];
  const gross = y1.amount + y2.amount;
  const fees = (y1.fee ?? 0) + (y2.fee ?? 0);
  const payouts: PaymentPayout[] = [
    { id: "seed-payout-1", restaurantId: c.restaurantId, createdAt: c.T(60 * 2), updatedAt: c.T(60 * 2), provider: "paymob", periodStart: y1.createdAt.slice(0, 10), periodEnd: y2.createdAt.slice(0, 10), gross, fees, net: gross - fees - y1.refunded, reference: "PAYOUT-20931", paidAt: c.T(60 * 2), note: "" },
  ];
  return { paymentIntents: out, paymentRefunds: refunds, paymentPayouts: payouts };
}
