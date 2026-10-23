import { describe, expect, it } from "vitest";
import type { ServiceCall } from "@/data/types";
import { DEFAULT_SLA, callLevel, callStats, findDuplicate, fmtWait, isForWaiter, needsManager, secondsToNextLevel, slaFor, slaFrom, sortInbox, tableOwners, toEscalate, waitingSec } from "./core";

const T0 = Date.parse("2026-10-23T18:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
let n = 0;
const call = (p: Partial<ServiceCall> & { ago?: number } = {}): ServiceCall => {
  const { ago = 0, ...rest } = p;
  return {
    id: `c${++n}`, restaurantId: "r", branchId: "b", tableId: "t1", type: "water", text: "", status: "open", source: "qr",
    ackBy: null, ackAt: null, doneAt: null, createdAt: at(-ago), updatedAt: at(-ago), ...rest,
  };
};

describe("SLA settings", () => {
  it("defaults and sanitises thresholds", () => {
    expect(slaFrom(null)).toEqual(DEFAULT_SLA);
    expect(slaFrom({ serviceCalls: { warnSec: 30, escalateSec: 20, criticalSec: -1 } })).toEqual({ warnSec: 30, escalateSec: 30, criticalSec: 300 });
  });
  it("scales by priority", () => {
    expect(slaFor("water")).toEqual(DEFAULT_SLA);
    expect(slaFor("complaint")).toEqual({ warnSec: 30, escalateSec: 60, criticalSec: 150 });
    expect(slaFor("napkins").escalateSec).toBe(180);
  });
});

describe("escalation timing", () => {
  it("climbs fresh → warn → escalated → critical for an open call", () => {
    const c = call({ createdAt: at(0) });
    expect(callLevel(c, T0 + 59_000)).toBe("fresh");
    expect(callLevel(c, T0 + 60_000)).toBe("warn");
    expect(callLevel(c, T0 + 119_000)).toBe("warn");
    expect(callLevel(c, T0 + 120_000)).toBe("escalated");
    expect(needsManager(c, T0 + 120_000)).toBe(true);
    expect(callLevel(c, T0 + 300_000)).toBe("critical");
  });
  it("a complaint escalates twice as fast", () => {
    const c = call({ type: "complaint", createdAt: at(0) });
    expect(callLevel(c, T0 + 60_000)).toBe("escalated");
    expect(callLevel(c, T0 + 150_000)).toBe("critical");
  });
  it("acknowledged / closed calls stop escalating", () => {
    expect(callLevel(call({ status: "ack", ackAt: at(10), createdAt: at(0) }), T0 + 999_000)).toBe("ack");
    expect(callLevel(call({ status: "done", createdAt: at(0) }), T0 + 999_000)).toBe("closed");
    expect(callLevel(call({ status: "cancelled", createdAt: at(0) }), T0 + 999_000)).toBe("closed");
  });
  it("custom thresholds from settings", () => {
    const sla = slaFrom({ serviceCalls: { warnSec: 10, escalateSec: 20, criticalSec: 40 } });
    const c = call({ createdAt: at(0) });
    expect(callLevel(c, T0 + 25_000, sla)).toBe("escalated");
    expect(callLevel(c, T0 + 40_000, sla)).toBe("critical");
  });
  it("seconds to the next level", () => {
    const c = call({ createdAt: at(0) });
    expect(secondsToNextLevel(c, T0 + 30_000)).toBe(30);
    expect(secondsToNextLevel(c, T0 + 90_000)).toBe(30);
    expect(secondsToNextLevel(c, T0 + 200_000)).toBe(100);
    expect(secondsToNextLevel(c, T0 + 400_000)).toBeNull();
  });
  it("toEscalate picks calls past the threshold not yet stamped", () => {
    const a = call({ createdAt: at(0) });
    const b = call({ createdAt: at(0), escalatedAt: at(120) });
    const c = call({ createdAt: at(100) });
    expect(toEscalate([a, b, c], T0 + 130_000).map((x) => x.id)).toEqual([a.id]);
  });
  it("waiting time stops at the acknowledgement", () => {
    expect(waitingSec(call({ createdAt: at(0), ackAt: at(42), status: "ack" }), T0 + 999_000)).toBe(42);
    expect(waitingSec(call({ createdAt: at(0) }), T0 + 7_000)).toBe(7);
  });
});

describe("inbox order and routing", () => {
  it("sorts by level, then priority, then age", () => {
    const now = T0 + 400_000;
    const old = call({ createdAt: at(0) }); // critical
    const bill = call({ type: "bill", createdAt: at(350) }); // 50s, high → fresh (warn at 45s → warn)
    const water = call({ createdAt: at(380) }); // 20s fresh
    const napkins = call({ type: "napkins", createdAt: at(370) }); // 30s fresh, low
    const acked = call({ status: "ack", ackAt: at(10), createdAt: at(0) });
    expect(sortInbox([acked, napkins, water, bill, old], now).map((c) => c.id)).toEqual([old.id, bill.id, water.id, napkins.id, acked.id]);
  });
  it("routes to the section waiter, then the order's waiter; escalated calls go to everyone", () => {
    const owners = tableOwners(
      [{ id: "t1", waiterId: "w1" }, { id: "t2", waiterId: null }, { id: "t3" }],
      [
        { tableIds: ["t2"], waiterId: "w2", status: "sent", openedAt: at(0) },
        { tableIds: ["t1"], waiterId: "w3", status: "sent", openedAt: at(0) },
        { tableIds: ["t3"], waiterId: "w3", status: "closed", openedAt: at(0) },
      ],
    );
    expect(owners.get("t1")).toBe("w1");
    expect(owners.get("t2")).toBe("w2");
    expect(owners.get("t3")).toBeUndefined();
    const c1 = call({ tableId: "t1", createdAt: at(0) });
    expect(isForWaiter(c1, "w1", owners, T0)).toBe(true);
    expect(isForWaiter(c1, "w2", owners, T0)).toBe(false);
    expect(isForWaiter(c1, "w2", owners, T0 + 130_000)).toBe(true); // escalated → all hands
    expect(isForWaiter(call({ tableId: "t3" }), "w2", owners, T0)).toBe(true); // unassigned
  });
});

describe("de-duplication", () => {
  it("merges the same request from the same table within 2 minutes", () => {
    const existing = [call({ tableId: "t1", type: "water", createdAt: at(-60) })];
    expect(findDuplicate(existing, "t1", "water", T0)?.id).toBe(existing[0].id);
    expect(findDuplicate(existing, "t1", "water", T0 + 61_000)).toBeNull();
    expect(findDuplicate(existing, "t2", "water", T0)).toBeNull();
    expect(findDuplicate([call({ type: "other", createdAt: at(0) })], "t1", "other", T0)).toBeNull();
  });
});

describe("response KPIs", () => {
  it("averages per waiter / table and counts late calls; pickups excluded", () => {
    const calls = [
      call({ tableId: "t1", createdAt: at(0), ackAt: at(30), ackBy: "w1", status: "done" }),
      call({ tableId: "t1", createdAt: at(0), ackAt: at(90), ackBy: "w1", status: "ack" }),
      call({ tableId: "t2", createdAt: at(0), ackAt: at(200), ackBy: "w2", status: "done" }),
      call({ tableId: "t2", createdAt: at(0) }), // still open
      call({ tableId: "t2", type: "pickup", source: "kitchen", createdAt: at(0) }),
      call({ tableId: "t2", status: "cancelled", createdAt: at(0) }),
    ];
    const s = callStats(calls, { now: T0 + 400_000 });
    expect(s.count).toBe(4);
    expect(s.answered).toBe(3);
    expect(s.avgSec).toBe(Math.round((30 + 90 + 200) / 3));
    expect(s.late).toBe(2); // 200s answer + the open one at 400s
    expect(s.open).toBe(1);
    expect(s.byWaiter.map((w) => [w.waiterId, w.avgSec])).toEqual([["w1", 60], ["w2", 200]]);
    expect(s.byTable.find((t) => t.tableId === "t2")?.count).toBe(2);
    expect(s.p90Sec).toBe(200);
  });
  it("formats waits", () => {
    expect(fmtWait(45)).toBe("45s");
    expect(fmtWait(185)).toBe("3:05");
    expect(fmtWait(3840)).toBe("1h 04");
  });
});
