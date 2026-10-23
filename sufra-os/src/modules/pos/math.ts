/**
 * Pure POS arithmetic (no React, no data layer) — unit-tested in math.test.ts.
 * Money is Units (0.00001 EGP); everything a guest pays is on whole piastres (1 000 units).
 */
import { allocate } from "@finance/money";
import { fromAmount, major, toAmount, UNITS_PER_MINOR, type Units } from "@/lib/money";
import { lineUnitPrice } from "@/data/pricing";
import type { Discount, OrderItem, PaymentMethod } from "@/data/types";

export const PIASTRE = UNITS_PER_MINOR;

/** Round to whole piastres, half away from zero. */
export const toPiastre = (u: Units): Units => {
  const s = Math.sign(u);
  return s * Math.floor((Math.abs(u) + PIASTRE / 2) / PIASTRE) * PIASTRE;
};

/** Split a (piastre-aligned) total into n shares that add up exactly (largest remainder, earlier shares get the extra piastre). */
export function splitEvenly(total: Units, n: number): Units[] {
  if (!Number.isInteger(n) || n < 1) throw new Error("n must be a positive integer");
  const t = toPiastre(total);
  return allocate(toAmount(t), Array.from({ length: n }, () => 1n), 2).map(fromAmount);
}

/** Shares by amount: the last share takes whatever is left; throws when the amounts exceed the total. */
export function splitByAmounts(total: Units, amounts: Units[]): Units[] {
  const t = toPiastre(total);
  const given = amounts.map(toPiastre);
  const sum = given.reduce((a, b) => a + b, 0);
  if (sum > t) throw new Error("shares exceed the total");
  if (given.some((a) => a <= 0)) throw new Error("shares must be positive");
  return sum === t ? given : [...given, t - sum];
}

export const sumUnits = (xs: Units[]) => xs.reduce((a, b) => a + b, 0);

/** Still to pay on a check. Tips are on top, so they never reduce what is due. */
export const remaining = (total: Units, payments: { amount: Units; status?: string }[]) =>
  Math.max(0, total - sumUnits(payments.filter((p) => (p.status ?? "captured") === "captured").map((p) => p.amount)));

/** Exact amount plus the next sensible notes above it (EGP notes: 5, 10, 20, 50, 100, 200). */
export function quickTenders(due: Units): Units[] {
  if (due <= 0) return [];
  const out = new Set<Units>([toPiastre(due)]);
  for (const step of [5, 10, 50, 100, 200, 500, 1000].map((x) => major(x))) {
    const v = Math.ceil(due / step) * step;
    if (v > due) out.add(v);
    if (out.size >= 5) break;
  }
  return [...out].sort((a, b) => a - b).slice(0, 5);
}

export function changeDue(due: Units, tendered: Units): Units {
  return Math.max(0, toPiastre(tendered) - toPiastre(due));
}

/** A discount expressed as a percentage of the base (for the approval rule "above N% needs a manager"). */
export function discountPct(d: Discount | null, base: Units): number {
  if (!d) return 0;
  if (d.kind === "percent") return d.rate / 100;
  return base > 0 ? (d.value / base) * 100 : 100;
}

/** Item-level discount in Units from a % or an amount, clamped to the line value. */
export function lineDiscountUnits(it: Pick<OrderItem, "qty" | "unitPrice" | "modifiers">, d: Discount): Units {
  const gross = lineUnitPrice(it) * it.qty;
  const v = d.kind === "percent" ? Math.round((gross * d.rate) / 10_000) : d.value;
  return Math.max(0, Math.min(gross, toPiastre(v)));
}

/* ───────── courses: hold & fire ───────── */

export interface CourseState {
  course: number;
  items: OrderItem[];
  /** something in this course already went to the kitchen */
  fired: boolean;
  /** unsent items waiting */
  waiting: number;
}

/**
 * Course 1 goes with "Send". Later courses are held until the cashier fires them; once a course has been fired, items
 * added to it later go with the next "Send" too.
 */
export function courseStates(items: OrderItem[]): CourseState[] {
  const by = new Map<number, OrderItem[]>();
  for (const i of items) if (i.status !== "void") by.set(i.course, [...(by.get(i.course) ?? []), i]);
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([course, list]) => ({ course, items: list, fired: list.some((i) => i.status !== "new"), waiting: list.filter((i) => i.status === "new").length }));
}

export function sendableItems(items: OrderItem[]): OrderItem[] {
  const fired = new Set(courseStates(items).filter((c) => c.fired).map((c) => c.course));
  return items.filter((i) => i.status === "new" && (i.course <= 1 || fired.has(i.course)));
}

export const heldItems = (items: OrderItem[]) => {
  const send = new Set(sendableItems(items).map((i) => i.id));
  return items.filter((i) => i.status === "new" && !send.has(i.id));
};

/* ───────── splitting checks ───────── */

/** Lines grouped by seat (null seat → "shared", seat 0). */
export function seatGroups(items: OrderItem[]): Map<number, OrderItem[]> {
  const m = new Map<number, OrderItem[]>();
  for (const i of items) if (i.status !== "void") m.set(i.seat ?? 0, [...(m.get(i.seat ?? 0) ?? []), i]);
  return new Map([...m.entries()].sort(([a], [b]) => a - b));
}

/** Two lines can be merged (qty +1) when nothing about them differs and neither has gone to the kitchen. */
export function sameLine(a: Pick<OrderItem, "itemId" | "modifiers" | "notes" | "seat" | "course" | "status" | "discount">, b: typeof a) {
  return (
    a.itemId === b.itemId &&
    a.status === "new" &&
    b.status === "new" &&
    a.notes === b.notes &&
    a.seat === b.seat &&
    a.course === b.course &&
    !a.discount &&
    !b.discount &&
    a.modifiers.map((m) => m.modifierId).sort().join() === b.modifiers.map((m) => m.modifierId).sort().join()
  );
}

/** Tender buttons shown in the payment sheet. */
export const TENDERS: PaymentMethod[] = ["cash", "card", "wallet", "instapay", "online"];
