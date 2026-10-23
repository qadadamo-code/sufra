import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBranch } from "@/auth/session";
import { useDb, useLive, type Db } from "@/data/hooks";
import type { DiningTable, FloorDecor, Units, Zone } from "@/data/types";
import { formatMoney } from "@/lib/money";
import { startOfDay } from "@/lib/time";
import { useT } from "@/i18n/i18n";
import { deriveFloor } from "./model";

/** Re-render every `ms` (timers on the floor). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Everything the floor needs, live from every device. */
export function useFloorData() {
  const branch = useBranch();
  const bq = branch ? { branchId: branch.id } : {};
  const since = useMemo(() => startOfDay().toISOString(), []);
  const resSince = useMemo(() => new Date(Date.now() - 6 * 3600_000).toISOString(), []);
  const zones = useLive("zones", { where: bq, orderBy: [{ field: "sort" }] }).data;
  const tablesAll = useLive("tables", { where: bq, orderBy: [{ field: "label" }] });
  const decorAll = useLive("floorDecor").data;
  const links = useLive("tableLinks").data;
  const checks = useLive("checks", { where: { ...bq, status: ["open", "bill_requested"] } }).data;
  const paidToday = useLive("checks", { where: { ...bq, status: "paid" }, gte: { closedAt: since } }).data;
  const orders = useLive("orders", { where: { ...bq, status: ["open", "sent", "ready", "served"] } }).data;
  const reservations = useLive("reservations", { where: { ...bq, status: ["pending", "confirmed", "seated"] }, gte: { startsAt: resSince }, orderBy: [{ field: "startsAt" }] }).data;
  const calls = useLive("serviceCalls", { where: { ...bq, status: ["open", "ack"] }, orderBy: [{ field: "createdAt" }] }).data;
  const members = useLive("memberships", { where: { active: true } }).data;
  const now = useNow(20_000);
  const zoneIds = useMemo(() => new Set(zones.map((z) => z.id)), [zones]);
  const tables = useMemo(() => tablesAll.data.filter((t) => t.active && zoneIds.has(t.zoneId)), [tablesAll.data, zoneIds]);
  const decor = useMemo(() => decorAll.filter((d) => zoneIds.has(d.zoneId)), [decorAll, zoneIds]);
  const view = useMemo(() => deriveFloor({ zones, tables, decor, links, checks, orders, reservations, calls, members, now }), [zones, tables, decor, links, checks, orders, reservations, calls, members, now]);
  return { branch, zones, tables, allTables: tablesAll.data, decor, links, checks, paidToday, orders, reservations, calls, members, now, view, loading: tablesAll.loading };
}

export function useFormatters() {
  const { lang } = useT();
  const fmtMoney = useCallback((u: Units) => formatMoney(u, { lang, whole: true, bare: true }), [lang]);
  const fmtElapsed = useCallback((m: number) => (m < 60 ? (lang === "ar" ? `${m}د` : `${m}m`) : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`), [lang]);
  const fmtTime = useCallback((iso: string) => new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", hour12: lang === "ar" }), [lang]);
  return { fmtMoney, fmtElapsed, fmtTime };
}

/* ───────────── undo / redo for layout edits ───────────── */

type Row = DiningTable | FloorDecor | Zone;
export type LayoutOp =
  | { type: "update"; c: "tables" | "floorDecor" | "zones"; id: string; patch: Record<string, unknown> }
  | { type: "insert"; c: "tables" | "floorDecor" | "zones"; row: Row }
  | { type: "remove"; c: "tables" | "floorDecor" | "zones"; id: string };

export interface Step {
  redo: LayoutOp[];
  undo: LayoutOp[];
}

async function run(db: Db, ops: LayoutOp[]) {
  for (const op of ops) {
    if (op.type === "update") await db.update(op.c, op.id, op.patch as never);
    else if (op.type === "insert") {
      const { restaurantId: _r, ...rest } = op.row as Row & { restaurantId: string };
      void _r;
      await db.insert(op.c, rest as never);
    } else await db.remove(op.c, op.id);
  }
}

/** Layout history. Each step stores the writes to redo and their inverse. */
export function useLayoutHistory() {
  const db = useDb();
  const [past, setPast] = useState<Step[]>([]);
  const [future, setFuture] = useState<Step[]>([]);
  const busy = useRef(false);
  const push = useCallback(
    async (step: Step) => {
      await run(db, step.redo);
      setPast((p) => [...p.slice(-80), step]);
      setFuture([]);
    },
    [db],
  );
  const undo = useCallback(async () => {
    if (busy.current) return;
    const step = past[past.length - 1];
    if (!step) return;
    busy.current = true;
    try {
      await run(db, step.undo);
      setPast((p) => p.slice(0, -1));
      setFuture((f) => [...f, step]);
    } finally {
      busy.current = false;
    }
  }, [db, past]);
  const redo = useCallback(async () => {
    if (busy.current) return;
    const step = future[future.length - 1];
    if (!step) return;
    busy.current = true;
    try {
      await run(db, step.redo);
      setFuture((f) => f.slice(0, -1));
      setPast((p) => [...p, step]);
    } finally {
      busy.current = false;
    }
  }, [db, future]);
  return { push, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}

/** Inverse patch: the current values of the keys being changed. */
export function inverse<T extends object>(row: T, patch: Partial<T>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(patch)) out[k] = (row as Record<string, unknown>)[k];
  return out;
}
