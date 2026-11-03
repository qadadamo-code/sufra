/**
 * Shell-level delivery watcher, mounted through the nav badge hook (the shell renders badges on every screen):
 *   - badge = orders waiting in the inbox (dispatch roles) / my assigned orders (riders)
 *   - chime when a new order lands in the inbox (settings.delivery.sound)
 *   - auto-reject unanswered orders past their deadline, stamp `readyAt` when the kitchen finishes an order
 * Writes are idempotent and guarded per order, so several open tabs/devices agree.
 */
import { useEffect, useMemo, useRef } from "react";
import { useDb, useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import type { Order, OrderItem } from "@/data/types";
import { deliverySettings, dispatchOf } from "./settings";
import { allReady, markReady, rejectOrder, TERMINAL } from "./stages";

const inflight = new Set<string>();
let lastCount = -1;
let lastChime = 0;

/** Short two-note chime (no asset). Silently does nothing until the page had a user gesture. */
export function chime() {
  if (Date.now() - lastChime < 1500) return;
  lastChime = Date.now();
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const tone = (f: number, at: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.4);
    };
    tone(880, 0);
    tone(1318.5, 0.16);
    setTimeout(() => void ctx.close().catch(() => undefined), 900);
  } catch {
    /* no audio */
  }
}

const once = async (key: string, fn: () => Promise<unknown>) => {
  if (inflight.has(key)) return;
  inflight.add(key);
  try {
    await fn();
  } catch {
    /* another device got there first (StageError) — fine */
  } finally {
    setTimeout(() => inflight.delete(key), 4000);
  }
};

/** Pending inbox orders (not dine-in, stage received). */
export const isPending = (o: Order) => o.source !== "qr" && o.mode !== "dine_in" && o.status !== "void" && dispatchOf(o).stage === "received";

export function useDeliveryBadge(): number | null {
  const { can, staff } = useSession();
  const dispatcher = can("delivery.dispatch");
  const db = useDb();
  const orders = useLive("orders", { where: { status: ["open", "sent", "ready", "served"] } });
  const watched = useMemo(() => orders.data.filter((o) => o.mode !== "dine_in" && o.source !== "qr" && o.dispatch && !TERMINAL.includes(o.dispatch.stage)), [orders.data]);
  const ids = useMemo(() => watched.filter((o) => !o.dispatch?.readyAt && o.dispatch?.stage !== "received").map((o) => o.id), [watched]);
  const items = useLive("orderItems", { where: { orderId: ids } }, { enabled: dispatcher && ids.length > 0 });
  const settings = useLive("settings");
  const cfg = deliverySettings(settings.data[0]);
  const pending = watched.filter(isPending);
  const mine = staff ? orders.data.filter((o) => o.driverId === staff.id && o.dispatch && ["assigned", "picked_up", "arrived"].includes(o.dispatch.stage)).length : 0;

  // chime on new inbox orders
  useEffect(() => {
    if (!dispatcher) return;
    if (lastCount >= 0 && pending.length > lastCount && cfg.sound) chime();
    lastCount = pending.length;
  }, [pending.length, dispatcher, cfg.sound]);

  // ready stamping
  const itemsRef = useRef<OrderItem[]>([]);
  itemsRef.current = items.data;
  useEffect(() => {
    if (!dispatcher) return;
    for (const o of watched) {
      if (o.dispatch?.readyAt || o.dispatch?.stage === "received") continue;
      const its = items.data.filter((i) => i.orderId === o.id);
      if (its.length && allReady(its)) void once(`ready:${o.id}`, () => markReady(db, o.id));
    }
  }, [items.data, watched, dispatcher, db]);

  // auto-reject unanswered orders
  useEffect(() => {
    if (!dispatcher) return;
    const sweep = () => {
      const now = Date.now();
      for (const o of pending) {
        const exp = o.dispatch?.expiresAt;
        if (exp && Date.parse(exp) <= now) void once(`reject:${o.id}`, () => rejectOrder(db, o.id, "لم يتم الرد في الوقت / not answered in time", { auto: true }));
      }
    };
    sweep();
    const t = setInterval(sweep, 10_000);
    return () => clearInterval(t);
  }, [pending, dispatcher, db]);

  if (dispatcher) return pending.length || null;
  return mine || null;
}
