import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceCallType } from "@/data/types";
import { loadJSON, saveJSON } from "@/lib/storage";
import type { CallState, GuestService } from "../api/service";

/** a repeat of the same request inside this window shows the existing call instead of sending again */
export const REPEAT_WINDOW_MS = 90_000;
/** flood guard per phone: at most this many calls per 10 minutes (the server has its own limit) */
export const MAX_CALLS_10MIN = 8;

interface Sent {
  id: string;
  type: ServiceCallType;
  at: number;
  text: string;
}

export type SendResult = { ok: true; id: string; repeat: boolean } | { ok: false; reason: "rate_limited" | "error" };

/** Calls this phone sent from this table, with live status (change feed + polling for the cloud backend). */
export function useTableCalls(svc: GuestService, slug: string, tableCode: string | null, restaurantId: string) {
  const key = `sufra-guest.calls.${slug}.${tableCode ?? ""}`;
  const [sent, setSent] = useState<Sent[]>(() => loadJSON<Sent[]>(key, []).filter((c) => Date.now() - c.at < 3 * 3600_000));
  const [states, setStates] = useState<Record<string, CallState>>({});
  const ids = sent.map((c) => c.id).join(",");
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!tableCode || !ids || busy.current) return;
    busy.current = true;
    try {
      const rows = await svc.callStates(slug, tableCode, ids.split(","));
      setStates(Object.fromEntries(rows.map((r) => [r.id, r])));
    } catch {
      /* keep last */
    } finally {
      busy.current = false;
    }
  }, [svc, slug, tableCode, ids]);

  useEffect(() => {
    void refresh();
    const off = svc.watch(restaurantId, () => void refresh());
    const poll = setInterval(() => void refresh(), svc.local ? 15_000 : 4_000);
    return () => {
      off();
      clearInterval(poll);
    };
  }, [svc, restaurantId, refresh]);

  useEffect(() => saveJSON(key, sent.slice(0, 20)), [key, sent]);

  const send = useCallback(
    async (type: ServiceCallType, text = ""): Promise<SendResult> => {
      if (!tableCode) return { ok: false, reason: "error" };
      const now = Date.now();
      const same = type !== "other" && type !== "complaint" ? sent.find((c) => c.type === type && now - c.at < REPEAT_WINDOW_MS && (states[c.id]?.status ?? "open") !== "done") : undefined;
      if (same) return { ok: true, id: same.id, repeat: true };
      if (sent.filter((c) => now - c.at < 600_000).length >= MAX_CALLS_10MIN) return { ok: false, reason: "rate_limited" };
      try {
        const { id } = await svc.callWaiter(slug, tableCode, type, text);
        setSent((s) => [{ id, type, at: now, text }, ...s.filter((c) => c.id !== id)]);
        setStates((st) => ({ ...st, [id]: st[id] ?? { id, type, status: "open", createdAt: new Date(now).toISOString(), ackAt: null, doneAt: null } }));
        return { ok: true, id, repeat: false };
      } catch (e) {
        return { ok: false, reason: String((e as Error).message).includes("too_many") ? "rate_limited" : "error" };
      }
    },
    [svc, slug, tableCode, sent, states],
  );

  const active = sent.filter((c) => (states[c.id]?.status ?? "open") !== "done" && states[c.id]?.status !== "cancelled" && Date.now() - c.at < 30 * 60_000);
  return { sent, states, active, send, refresh };
}
