/**
 * Rider cash: what a rider collected on a shift, and settling it at the till.
 *
 * Money flow (same finance rules as the POS):
 *   - each delivered order's check is paid + closed on the cashier's POS device (`takePayment` + `closeCheck`):
 *     receipt + ETA e-receipt + `postSale` with the cash going into that drawer — exactly like a counter sale;
 *   - a short or over between what the rider should hand in and what they did is posted with finance `postCashMove`
 *     against "cash over/short" (6901) and logged as a drawer movement, so the Z report reconciles.
 */
import { Ledger, ACCOUNTS } from "@finance/ledger";
import { postCashMove } from "@finance/posting";
import type { Db } from "@/data/hooks";
import type { DriverShift, Order, Shift } from "@/data/types";
import { fromAmount, toAmount, type Units } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { businessDate, closeCheck, takePayment } from "@/modules/pos/sale";
import { toPiastre } from "@/modules/pos/math";
import { dispatchOf } from "./settings";

export interface ShiftCash {
  /** delivered orders on the shift */
  orders: number;
  cash: Units;
  card: Units;
  prepaid: number;
  /** cash the rider should hand in */
  expected: Units;
}

/** Sum what the rider collected (pure). */
export function shiftCash(orders: Pick<Order, "dispatch" | "deliveryStatus" | "driverId" | "mode" | "source" | "status" | "openedAt" | "number">[]): ShiftCash {
  let cash = 0;
  let card = 0;
  let prepaid = 0;
  let n = 0;
  for (const o of orders) {
    const d = dispatchOf(o as Order);
    if (d.stage !== "delivered") continue;
    n++;
    const c = d.collected;
    if (!c || c.method === "prepaid") prepaid++;
    else if (c.method === "cash") cash += c.amount;
    else card += c.amount;
  }
  return { orders: n, cash, card, prepaid, expected: cash };
}

export type SettleState = "exact" | "short" | "over";

/** handedIn − expected, rounded to piastres. */
export function settlementDiff(expected: Units, handedIn: Units): { difference: Units; state: SettleState } {
  const difference = toPiastre(handedIn) - toPiastre(expected);
  return { difference, state: difference === 0 ? "exact" : difference < 0 ? "short" : "over" };
}

/** Orders delivered on a rider shift that still need their check closed at the till. */
export async function shiftOrders(db: Db, shift: DriverShift): Promise<Order[]> {
  const all = await db.list("orders", { where: { driverId: shift.driverId, mode: "delivery" }, gte: { openedAt: new Date(Date.parse(shift.startedAt) - 6 * 3600_000).toISOString() } });
  return all.filter((o) => {
    const d = dispatchOf(o);
    return d.driverShiftId === shift.id || (!d.driverShiftId && d.deliveredAt && d.deliveredAt >= shift.startedAt && (!shift.endedAt || d.deliveredAt <= shift.endedAt));
  });
}

export interface SettleResult {
  closed: number;
  difference: Units;
  state: SettleState;
  errors: string[];
}

/**
 * Settle a rider shift on this POS: close every delivered check (cash/card collected at the door, or already paid online),
 * then post the short/over. Needs an open POS shift (cash goes into that drawer).
 */
export async function settleShift(db: Db, shift: DriverShift, handedIn: Units, pos: { shift: Shift; device: string }, note = ""): Promise<SettleResult> {
  if (shift.status === "settled") throw new Error("already settled");
  const orders = await shiftOrders(db, shift);
  const totals = shiftCash(orders);
  const errors: string[] = [];
  let closed = 0;
  for (const o of orders) {
    const d = dispatchOf(o);
    if (d.stage !== "delivered" || !o.checkId) continue;
    const check = await db.get("checks", o.checkId);
    if (!check || check.status === "paid" || check.status === "void") continue;
    try {
      const due = Math.max(0, check.total - check.paid);
      if (due > 0) {
        const method = d.collected?.method === "card" ? "card" : "cash";
        await takePayment(db, check, { method, amount: due, tip: 0, tendered: method === "cash" ? due : null, reference: `rider:${shift.id.slice(0, 8)}`, splitLabel: null });
      }
      await closeCheck(db, check.id, pos);
      closed++;
    } catch (e) {
      errors.push(`#${o.number}: ${String((e as Error).message ?? e)}`);
    }
  }
  const { difference, state } = settlementDiff(totals.expected, handedIn);
  if (difference !== 0) {
    const kind = difference > 0 ? "in" : "out";
    const amount = Math.abs(difference);
    const reason = `${state === "short" ? "عجز طيار / rider short" : "زيادة طيار / rider over"} · ${shift.id.slice(0, 8)}`;
    const m = await db.insert("cashMovements", { branchId: pos.shift.branchId, shiftId: pos.shift.id, kind, amount, reason, actorId: db.actorId, approvedBy: null });
    try {
      const e = postCashMove(new Ledger(), { kind, amount: toAmount(amount), reason, account: ACCOUNTS.cashOverShort }, { date: businessDate(), id: m.id, branch: pos.shift.branchId, drawer: pos.device });
      await db.insert("ledgerEntries", {
        branchId: pos.shift.branchId, date: e.date, sourceType: e.source.type, sourceId: e.source.id, memo: e.memo,
        lines: e.lines.map((l) => ({ account: l.account, debit: fromAmount(l.debit), credit: fromAmount(l.credit), ...(l.dims ? { dims: l.dims } : {}) })),
      });
    } catch (err) {
      errors.push(String((err as Error).message ?? err));
    }
  }
  const t = nowIso();
  await db.update("driverShifts", shift.id, {
    status: "settled", endedAt: shift.endedAt ?? t,
    settlement: { expected: totals.expected, handedIn: toPiastre(handedIn), difference, orders: totals.orders, settledBy: db.actorId, settledAt: t, posShiftId: pos.shift.id, note: note.trim() },
  });
  await db.audit("delivery.settle", "driverShifts", shift.id, { driver: shift.driverId, expected: totals.expected, handedIn, difference, closed });
  return { closed, difference, state, errors };
}
