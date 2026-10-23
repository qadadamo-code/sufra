/**
 * Frozen bills: the exact @finance/tax Bill a receipt was issued from, stored as JSON (Units) on the receipt row so
 * Z reports, reprints, returns and the ETA document never re-price anything.
 */
import type { Bill, BillLine } from "@finance/tax";
import type { Payment as FinPayment, PaymentMethod as FinMethod } from "@finance/posting";
import { fromAmount, toAmount, type Units } from "@/lib/money";
import type { OrderItem, PaymentMethod, ReceiptBill, ReceiptBillLine } from "@/data/types";

export function freezeBill(bill: Bill, items: (Pick<OrderItem, "id" | "name" | "modifiers" | "notes"> & { itemId: string | null })[]): ReceiptBill {
  const byId = new Map(items.map((i) => [i.id, i]));
  return {
    mode: bill.mode,
    lines: bill.lines.map((l): ReceiptBillLine => {
      const it = byId.get(l.id);
      return {
        id: l.id,
        itemId: it?.itemId ?? null,
        name: it?.name ?? { ar: l.id, en: l.id },
        modifiers: it?.modifiers.map((m) => m.name) ?? [],
        notes: it?.notes ?? "",
        qty: l.qty,
        unitPrice: fromAmount(l.unitPrice),
        category: l.category,
        vatExempt: !!l.vatExempt,
        gross: fromAmount(l.gross),
        discountTotal: fromAmount(l.discountTotal),
        net: fromAmount(l.net),
        service: fromAmount(l.service),
        vat: fromAmount(l.vat),
        total: fromAmount(l.total),
      };
    }),
    gross: fromAmount(bill.gross),
    discount: fromAmount(bill.discount),
    net: fromAmount(bill.net),
    service: fromAmount(bill.service),
    vat: fromAmount(bill.vat),
    deliveryFee: fromAmount(bill.deliveryFee),
    deliveryVat: fromAmount(bill.deliveryVat),
    total: fromAmount(bill.total),
    payable: fromAmount(bill.payable),
    rounding: fromAmount(bill.rounding),
  };
}

export function toFinanceBill(b: ReceiptBill): Bill {
  const A = toAmount;
  return {
    mode: b.mode,
    lines: b.lines.map(
      (l): BillLine => ({
        id: l.id,
        qty: l.qty,
        unitPrice: A(l.unitPrice),
        category: l.category,
        vatExempt: l.vatExempt,
        gross: A(l.gross),
        discountTotal: A(l.discountTotal),
        net: A(l.net),
        service: A(l.service),
        vat: A(l.vat),
        total: A(l.total),
      }),
    ),
    gross: A(b.gross),
    discount: A(b.discount),
    net: A(b.net),
    service: A(b.service),
    vat: A(b.vat),
    deliveryFee: A(b.deliveryFee),
    deliveryVat: A(b.deliveryVat),
    total: A(b.total),
    payable: A(b.payable),
    rounding: A(b.rounding),
  };
}

/** Sufra tender → sufra-finance tender. "online" (pay link) settles through the card/gateway clearing account. */
export const finMethod = (m: PaymentMethod): FinMethod => (m === "online" ? "card" : m);

/** Sufra payments keep the tip outside `amount`; finance counts it inside. */
export const toFinancePayments = (ps: { method: PaymentMethod; amount: Units; tip: Units }[]): FinPayment[] =>
  ps.map((p) => ({ method: finMethod(p.method), amount: toAmount(p.amount + p.tip), ...(p.tip ? { tip: toAmount(p.tip) } : {}) }));
