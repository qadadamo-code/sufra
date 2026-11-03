import { useMemo } from "react";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { eventsFromAudit, type VideoEvent } from "./events";

export const EVENT_ACTIONS = ["order.void", "payment.void", "payment.refund", "check.discount", "item.discount", "drawer.open", "shift.close", "delivery.settle", "menu.86"];

/** Video exceptions of the last `days` days for the current branch (derived live from audit_log). */
export function useVideoEvents(days = 7, enabled = true): { events: VideoEvent[]; loading: boolean } {
  const { branchId } = useSession();
  const since = useMemo(() => {
    const d = new Date(Date.now() - days * 86400_000);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }, [days]);
  const audit = useLive("auditLog", { where: { action: EVENT_ACTIONS }, gte: { createdAt: since }, orderBy: [{ field: "createdAt", dir: "desc" }], limit: 500 }, { enabled });
  const shifts = useLive("shifts", { gte: { openedAt: since } }, { enabled });
  const moves = useLive("cashMovements", { gte: { createdAt: since } }, { enabled });
  const receipts = useLive("receipts", { gte: { issuedAt: since } }, { enabled });
  const checks = useLive("checks", { gte: { createdAt: since } }, { enabled });
  const settings = useLive("settings", undefined, { enabled }).data[0];
  const events = useMemo(
    () =>
      eventsFromAudit(audit.data, {
        shifts: shifts.data,
        cashMovements: moves.data,
        receipts: receipts.data,
        checks: checks.data,
        discountLimitPct: settings?.discountApprovalPct ?? 10,
      }).filter((e) => !branchId || !e.branchId || e.branchId === branchId),
    [audit.data, shifts.data, moves.data, receipts.data, checks.data, settings?.discountApprovalPct, branchId],
  );
  return { events, loading: audit.loading };
}
