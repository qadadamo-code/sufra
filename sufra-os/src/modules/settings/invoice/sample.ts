/** Sample check for live previews (invoice designer, tax settings). Prices from the demo menu. */
import { major } from "@/lib/money";
import { priceItems } from "@/data/pricing";
import { freezeBill } from "@/lib/receipt/bill";
import type { OrderItem, OrderMode, TaxSettings } from "@/data/types";

let n = 0;
const line = (ar: string, en: string, price: number, qty: number, station: string, mods: [string, string, number][] = [], notes = ""): OrderItem => ({
  id: `sample-${++n}`, restaurantId: "", createdAt: "", updatedAt: "", orderId: "sample", itemId: `sample-item-${n}`, name: { ar, en }, qty, unitPrice: major(price),
  modifiers: mods.map(([mar, men, p], i) => ({ groupId: `g${i}`, modifierId: `m${i}`, name: { ar: mar, en: men }, price: major(p) })), notes, seat: null, course: 1,
  status: "served", stationId: station, originTableId: null, discount: 0, firedAt: null, readyAt: null, servedAt: null, voidReason: null, voidedBy: null, createdBy: null,
});

export const SAMPLE_ITEMS: OrderItem[] = [
  line("كفتة مشوية", "Grilled kofta", 345, 2, "grill", [["نص كيلو", "½ kg", 330], ["بطاطس محمرة", "Fries", 0]]),
  line("حمص", "Hummus", 95, 1, "cold"),
  line("ملوخية بالفراخ", "Molokhia with chicken", 340, 1, "hot", [], "الطشة زيادة"),
  line("ليمون بالنعناع", "Lemon & mint", 75, 3, "bar", [["كبير", "Large", 30]]),
];

export function sampleBill(tax: TaxSettings, mode: OrderMode = "dine_in", deliveryFee = 0) {
  const { bill, totals } = priceItems(SAMPLE_ITEMS, { mode, tax, deliveryFee: major(deliveryFee) });
  return { bill: bill ? freezeBill(bill, SAMPLE_ITEMS) : null, totals };
}

export const SAMPLE_UUID = "4d1c0b0e9b2f43f7a8f1d6c3e2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3";
