/**
 * App-wide alerts for service calls + ready food. Mounted once by the shell's notification bell, so every
 * signed-in screen gets them:
 *  - waiters: a toast (+ sound) when a guest call for their tables arrives, with a one-tap "جاي";
 *             a toast when the kitchen marks food ready / pings for pickup at their tables
 *  - managers/owners: a warning toast (+ urgent sound) when a call escalates (unanswered past the SLA)
 *  - everyone with the permission: stamps escalatedAt once
 */
import { useEffect, useMemo, useRef } from "react";
import { useSession } from "@/auth/session";
import { ROLE_RANK } from "@/auth/roles";
import { useDb, useLive } from "@/data/hooks";
import type { ServiceCall } from "@/data/types";
import { useT, type TKey } from "@/i18n/i18n";
import { startOfDay } from "@/lib/time";
import { useToast } from "@/ui";
import { callMeta, fmtWait, isForWaiter, needsManager, tableOwners, waitingSec } from "./core";
import { useArrivals, useEscalationStamper, useNow, useSla } from "./hooks";
import { ackCall } from "./ops";
import { playCue, soundEnabled } from "./sound";

export function useCallAlerts() {
  const { can, role, staff } = useSession();
  const enabled = can("service_calls.handle");
  const isWaiter = can("waiter.use");
  const isManager = !!role && ROLE_RANK[role] >= ROLE_RANK.manager;
  const db = useDb();
  const { t, L } = useT();
  const { toast } = useToast();
  const sla = useSla();
  const now = useNow(5000);
  const since = useMemo(() => startOfDay().toISOString(), []);
  const calls = useLive("serviceCalls", { where: { status: ["open", "ack"] }, gte: { createdAt: since } }, { enabled });
  const tables = useLive("tables", undefined, { enabled }).data;
  const orders = useLive("orders", { where: { status: ["open", "sent", "ready", "served"] } }, { enabled }).data;
  const ready = useLive("orderItems", { where: { status: "ready" } }, { enabled: enabled && isWaiter }).data;
  const owners = useMemo(() => tableOwners(tables, orders), [tables, orders]);
  const label = useMemo(() => new Map(tables.map((x) => [x.id, x.label])), [tables]);
  const me = staff?.id ?? null;
  const sound = () => soundEnabled("calls");

  useEscalationStamper(calls.data, sla, enabled);

  const open = useMemo(() => calls.data.filter((c) => c.status === "open"), [calls.data]);
  const tableName = (c: Pick<ServiceCall, "tableId">) => t("common.table", { n: label.get(c.tableId) ?? "?" });

  // new calls → the responsible waiter
  useArrivals(
    open,
    (fresh) => {
      if (!isWaiter || !me) return;
      const mine = fresh.filter((c) => isForWaiter(c, me, owners, now, sla));
      for (const c of mine) {
        const urgent = callMeta(c.type).priority === "urgent";
        if (sound()) playCue(c.type === "pickup" ? "ready" : urgent ? "urgent" : "call");
        toast({
          title: `${tableName(c)} · ${t(`call.${c.type}` as TKey)}`,
          description: c.text || undefined,
          tone: urgent ? "error" : c.type === "pickup" ? "success" : "default",
          duration: urgent ? 0 : 6000,
          action: c.type === "pickup" ? undefined : { label: L("جاي", "On my way"), onClick: () => void ackCall(db, c) },
        });
      }
    },
    enabled && !calls.loading,
  );

  // escalations → managers (and the assigned waiter)
  const alerted = useRef(new Set<string>());
  const first = useRef(true);
  const escalated = open.filter((c) => callMeta(c.type).guestFacing && needsManager(c, now, sla));
  const escalatedKey = escalated.map((c) => c.id).join(",");
  useEffect(() => {
    if (!enabled || calls.loading) return;
    const fresh = escalated.filter((c) => !alerted.current.has(c.id));
    fresh.forEach((c) => alerted.current.add(c.id));
    if (first.current) {
      first.current = false; // calls already late when the app opened: listed in the bell, no burst of toasts
      return;
    }
    if (!fresh.length || !(isManager || (me && fresh.some((c) => owners.get(c.tableId) === me)))) return;
    if (sound()) playCue("urgent");
    for (const c of fresh)
      toast({
        title: L(`${tableName(c)} مستنية من ${fmtWait(waitingSec(c, now))} ومحدش رد`, `${tableName(c)} waiting ${fmtWait(waitingSec(c, now))} — no answer yet`),
        description: t(`call.${c.type}` as TKey),
        tone: "warn",
        duration: 8000,
        action: isWaiter ? { label: L("جاي", "On my way"), onClick: () => void ackCall(db, c) } : undefined,
      });
  }, [escalatedKey, enabled, calls.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // food ready at my tables → waiter
  useArrivals(
    ready,
    (freshItems) => {
      const byOrder = new Map<string, number>();
      for (const i of freshItems) byOrder.set(i.orderId, (byOrder.get(i.orderId) ?? 0) + i.qty);
      const fresh = [...byOrder.entries()].map(([id, n]) => ({ id, n }));
      if (!me) return;
      const orderById = new Map(orders.map((o) => [o.id, o]));
      const mine = fresh.flatMap((r) => {
        const o = orderById.get(r.id);
        if (!o || !o.tableIds.length) return [];
        const owner = o.waiterId ?? owners.get(o.tableIds[0]) ?? null;
        return owner === me || !owner ? [{ o, n: r.n }] : [];
      });
      if (!mine.length) return;
      if (sound()) playCue("ready");
      for (const { o, n } of mine)
        toast({
          title: L(`الأكل جاهز — ترابيزة ${o.tableIds.map((x) => label.get(x)).join("+")}`, `Food ready — table ${o.tableIds.map((x) => label.get(x)).join("+")}`),
          description: t("common.items", { n }),
          tone: "success",
          duration: 6000,
        });
    },
    enabled && isWaiter,
  );

  return { escalated };
}
