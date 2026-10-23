/**
 * React hooks over the service-call core.
 *
 *   const now = useNow(1000);
 *   const sla = useSla();
 *   const calls = useTodayCalls();
 *   useEscalationStamper(calls, sla);           // stamps escalatedAt once a call crosses the manager threshold
 *   useArrivals(calls, (c) => playCue("call")); // fires for rows that appear after the first load
 */
import { useEffect, useRef, useState } from "react";
import { useDb, useLive } from "@/data/hooks";
import { startOfDay } from "@/lib/time";
import type { ServiceCall } from "@/data/types";
import { slaFrom, toEscalate, type Sla } from "./core";
import { markEscalated } from "./ops";

/** Re-renders every `ms` (timers, aging colours). Pauses while the tab is hidden. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => document.visibilityState !== "hidden" && setNow(Date.now());
    const id = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
  return now;
}

export function useSla(): Sla {
  const settings = useLive("settings").data[0];
  return slaFrom(settings);
}

/** Today's calls (all statuses), newest first. */
export function useTodayCalls(enabled = true) {
  return useLive("serviceCalls", { gte: { createdAt: startOfDay().toISOString() }, orderBy: [{ field: "createdAt", dir: "desc" }] }, { enabled }).data;
}

/** Writes `escalatedAt` on calls that crossed the escalation threshold (once per call per client). */
export function useEscalationStamper(calls: ServiceCall[], sla: Sla, enabled = true) {
  const db = useDb();
  const now = useNow(5000);
  const done = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled) return;
    const due = toEscalate(calls, now, sla).filter((c) => !done.current.has(c.id));
    if (!due.length) return;
    due.forEach((c) => done.current.add(c.id));
    void markEscalated(db, due).catch(() => due.forEach((c) => done.current.delete(c.id)));
  }, [calls, now, sla, enabled, db]);
}

/**
 * Calls `onNew` for rows whose id appears after the first non-empty render (new tickets, new calls).
 * `ready` lets the caller wait until the first load finished so the seed doesn't "arrive".
 */
export function useArrivals<T extends { id: string }>(rows: T[], onNew: (fresh: T[]) => void, ready = true) {
  const seen = useRef<Set<string> | null>(null);
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    if (!ready) return;
    if (!seen.current) {
      seen.current = new Set(rows.map((r) => r.id));
      return;
    }
    const fresh = rows.filter((r) => !seen.current!.has(r.id));
    rows.forEach((r) => seen.current!.add(r.id));
    if (fresh.length) cb.current(fresh);
  }, [rows, ready]);
}
