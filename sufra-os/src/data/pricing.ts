/**
 * Bridge between Sufra OS rows (Units as number) and @finance/tax (bigint Amount).
 * Check totals are always computed here, never by hand.
 */
import { priceBill, type Bill, type TaxProfile } from "@finance/tax";
import { fromAmount, toAmount, type Units } from "@/lib/money";
import type { Discount, OrderItem, OrderMode, TaxSettings } from "./types";

export const financeMode = (m: OrderMode) => (m === "dine_in" ? "dine-in" : m) as "dine-in" | "takeaway" | "delivery";

export function toTaxProfile(t: TaxSettings): TaxProfile {
  return {
    vatRegistered: t.vatRegistered,
    vatRate: t.vatRate,
    vatCode: t.vatCode,
    serviceRate: t.serviceRate,
    serviceModes: t.serviceModes.map(financeMode),
    vatOnService: t.vatOnService,
    serviceCode: t.serviceCode,
    priceMode: t.priceMode,
    vatOnDelivery: t.vatOnDelivery,
    taxDecimals: t.taxDecimals,
  };
}

/** Unit price of a line including its modifiers. */
export const lineUnitPrice = (it: Pick<OrderItem, "unitPrice" | "modifiers">): Units => it.unitPrice + it.modifiers.reduce((a, m) => a + m.price, 0);

export interface CheckTotals {
  subtotal: Units;
  discountTotal: Units;
  service: Units;
  vat: Units;
  deliveryFee: Units;
  /** what the guest pays (rounded to piastres) */
  total: Units;
}

export const EMPTY_TOTALS: CheckTotals = { subtotal: 0, discountTotal: 0, service: 0, vat: 0, deliveryFee: 0, total: 0 };

export function priceItems(items: OrderItem[], opts: { mode: OrderMode; tax: TaxSettings; discount?: Discount | null; deliveryFee?: Units; vatExemptItemIds?: Set<string> }): { totals: CheckTotals; bill: Bill | null } {
  const live = items.filter((i) => i.status !== "void");
  if (!live.length) return { totals: EMPTY_TOTALS, bill: null };
  const bill = priceBill(
    {
      mode: financeMode(opts.mode),
      lines: live.map((i) => ({
        id: i.id,
        qty: i.qty,
        unitPrice: toAmount(lineUnitPrice(i)),
        category: i.stationId ?? "food",
        discount: i.discount ? toAmount(i.discount) : undefined,
        vatExempt: opts.vatExemptItemIds?.has(i.itemId) ?? false,
      })),
      discount: opts.discount ? (opts.discount.kind === "percent" ? { kind: "percent", rate: opts.discount.rate } : { kind: "amount", value: toAmount(opts.discount.value) }) : undefined,
      deliveryFee: opts.deliveryFee ? toAmount(opts.deliveryFee) : undefined,
    },
    toTaxProfile(opts.tax),
  );
  return {
    bill,
    totals: {
      subtotal: fromAmount(bill.gross),
      discountTotal: fromAmount(bill.discount),
      service: fromAmount(bill.service),
      vat: fromAmount(bill.vat),
      deliveryFee: fromAmount(bill.deliveryFee),
      total: fromAmount(bill.payable),
    },
  };
}
