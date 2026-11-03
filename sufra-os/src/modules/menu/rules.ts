/**
 * Menu rules every selling surface shares (POS, waiter, QR table menu, online ordering): price per channel/branch,
 * availability windows (breakfast hours), channel visibility and the 86 flag. Pure.
 */
import type { AvailabilityWindow, MenuItem, OrderMode, OrderSource, SalesChannel } from "@/data/types";
import type { Units } from "@/lib/money";

export const CHANNELS: { id: SalesChannel; ar: string; en: string }[] = [
  { id: "dine_in", ar: "صالة", en: "Dine-in" },
  { id: "takeaway", ar: "تيك أواي", en: "Takeaway" },
  { id: "delivery", ar: "دليفري", en: "Delivery" },
  { id: "qr", ar: "منيو QR", en: "QR menu" },
  { id: "online", ar: "أونلاين", en: "Online" },
  { id: "aggregator", ar: "تطبيقات التوصيل", en: "Delivery apps" },
];

/** Which price list an order uses. */
export function channelOf(mode: OrderMode, source: OrderSource): SalesChannel {
  if (source === "aggregator") return "aggregator";
  if (source === "qr") return "qr";
  if (source === "online") return "online";
  return mode;
}

/** Channel price wins, then branch price, then the base price. */
export function priceFor(item: Pick<MenuItem, "price" | "channelPrices" | "branchPrices">, channel: SalesChannel | null, branchId?: string | null): Units {
  const c = channel ? item.channelPrices?.[channel] : undefined;
  if (c != null && c > 0) return c;
  const b = branchId ? item.branchPrices?.[branchId] : undefined;
  if (b != null && b > 0) return b;
  return item.price;
}

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Inside one window? Windows may wrap past midnight (22:00–02:00 belongs to the day it starts). */
export function inWindow(w: AvailabilityWindow, at: Date): boolean {
  const from = mins(w.from);
  const to = mins(w.to);
  const now = at.getHours() * 60 + at.getMinutes();
  const day = at.getDay();
  const yesterday = (day + 6) % 7;
  const dayOk = (d: number) => !w.days.length || w.days.includes(d);
  if (from === to) return dayOk(day);
  if (from < to) return dayOk(day) && now >= from && now < to;
  return (dayOk(day) && now >= from) || (dayOk(yesterday) && now < to);
}

export function onSchedule(item: Pick<MenuItem, "schedule">, at: Date = new Date()): boolean {
  return !item.schedule?.length || item.schedule.some((w) => inWindow(w, at));
}

export type Sellable = { ok: true } | { ok: false; why: "86" | "inactive" | "hours" | "channel" };
/** Can this item be sold now on this channel? */
export function sellable(item: Pick<MenuItem, "available" | "active" | "schedule" | "hiddenOn">, channel: SalesChannel | null, at: Date = new Date()): Sellable {
  if (!item.active) return { ok: false, why: "inactive" };
  if (channel && item.hiddenOn?.includes(channel)) return { ok: false, why: "channel" };
  if (!item.available) return { ok: false, why: "86" };
  if (!onSchedule(item, at)) return { ok: false, why: "hours" };
  return { ok: true };
}

/** "السبت والجمعة ٩:٠٠–١٣:٠٠" */
export function scheduleLabel(ws: AvailabilityWindow[] | undefined, lang: "ar" | "en"): string {
  if (!ws?.length) return lang === "ar" ? "طول وقت الفتح" : "All opening hours";
  const D = lang === "ar" ? ["أحد", "اتنين", "تلات", "أربع", "خميس", "جمعة", "سبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return ws.map((w) => `${w.days.length && w.days.length < 7 ? w.days.map((d) => D[d]).join(lang === "ar" ? "، " : ", ") + " " : ""}${w.from}–${w.to}`).join(" · ");
}

/** Bulk price change: +x% or +x EGP, rounded to a step (5 EGP by default). */
export function bulkPrice(price: Units, change: { kind: "percent" | "amount"; value: number }, roundTo: Units): Units {
  const raw = change.kind === "percent" ? price * (1 + change.value / 100) : price + change.value;
  const step = Math.max(1, roundTo);
  return Math.max(0, Math.round(raw / step) * step);
}
