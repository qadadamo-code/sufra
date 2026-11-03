import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { useNow, useSla } from "@/lib/service-calls";
import { useToast } from "@/ui";
import { useVideoEvents } from "../cameras/useEvents";
import { useOpsSettings } from "../settings";
import { buildAlerts, lowStockNow, shouldNotify, type Alert } from "./alerts";

export function useAlerts(enabled = true): { alerts: Alert[]; acked: Set<string> } {
  const { branchId } = useSession();
  const { lang, L } = useT();
  const now = useNow(30_000);
  const callSla = useSla();
  const { cfg } = useOpsSettings();
  const calls = useLive("serviceCalls", { where: { status: "open" } }, { enabled }).data;
  const tables = useLive("tables", undefined, { enabled }).data;
  const orders = useLive("orders", { where: { mode: "delivery", status: ["open", "sent", "ready", "served"] } }, { enabled }).data;
  const { events } = useVideoEvents(2, enabled);
  const since = useMemo(() => new Date(Date.now() - 86400_000).toISOString().slice(0, 13) + ":00:00.000Z", []);
  const payments = useLive("paymentIntents", { where: { status: "failed" }, gte: { updatedAt: since } }, { enabled }).data;
  const tickets = useLive("supportTickets", { where: { kind: "guest", status: ["new", "open", "pending"] } }, { enabled }).data;
  const acks = useLive("opsAcks", { where: { kind: "alert" } }, { enabled }).data;
  const alerts = useMemo(() => {
    const label = new Map(tables.map((t) => [t.id, t.label]));
    return buildAlerts({
      now, callSla, rules: cfg.alertRules, ticketSla: cfg.sla,
      calls: calls.map((c) => ({ ...c, table: label.get(c.tableId) })),
      orders, lowStock: lowStockNow(), events, payments, tickets,
      money: (u) => formatMoney(u, { lang }),
    }).filter((a) => !branchId || !a.branchId || a.branchId === branchId);
  }, [now, callSla, cfg.alertRules, cfg.sla, calls, tables, orders, events, payments, tickets, lang, branchId]); // eslint-disable-line react-hooks/exhaustive-deps
  void L;
  return { alerts, acked: useMemo(() => new Set(acks.map((a) => a.id)), [acks]) };
}

export function useAlertsBadge(): number | null {
  const { alerts, acked } = useAlerts();
  const n = alerts.filter((a) => !acked.has(a.id)).length;
  return n || null;
}

const SEEN = "sufra-os.alerts.seen";

/** Toast new alerts for the roles their rule notifies (once per alert per tab session). */
export function useAlertToasts() {
  const { role, can } = useSession();
  const { cfg } = useOpsSettings();
  const { alerts, acked } = useAlerts(can("alerts.view") || role === "cashier" || role === "chef" || role === "accountant");
  const { toast } = useToast();
  const { loc, L } = useT();
  const nav = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const mountedAt = useRef(Date.now());
  useEffect(() => {
    if (!seen.current) {
      try {
        seen.current = new Set(JSON.parse(sessionStorage.getItem(SEEN) ?? "[]"));
      } catch {
        seen.current = new Set();
      }
    }
    // first seconds after sign-in: don't replay everything already open
    const priming = Date.now() - mountedAt.current < 5000;
    for (const a of alerts) {
      if (priming) {
        seen.current.add(a.id);
        continue;
      }
      if (seen.current.has(a.id) || acked.has(a.id)) continue;
      seen.current.add(a.id);
      if (!shouldNotify(cfg.alertRules, a, role)) continue;
      toast({ title: `🚨 ${loc(a.title)}`, description: loc(a.detail), tone: a.severity === "high" ? "error" : "warn", action: { label: L("افتح", "Open"), onClick: () => nav(can("alerts.view") ? "/alerts" : a.path) } });
    }
    try {
      sessionStorage.setItem(SEEN, JSON.stringify([...seen.current].slice(-300)));
    } catch {
      /* private mode */
    }
  }, [alerts]); // eslint-disable-line react-hooks/exhaustive-deps
}
