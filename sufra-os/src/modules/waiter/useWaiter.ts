/** Live data for the waiter app. */
import { useMemo } from "react";
import { useBranch, useSession } from "@/auth/session";
import { useLive } from "@/data/hooks";
import type { Check, DiningTable, Order, OrderItem, ServiceCall } from "@/data/types";
import { startOfDay } from "@/lib/time";
import { tableOwners } from "@/lib/service-calls";

export interface TableView {
  table: DiningTable;
  owner: string | null;
  mine: boolean;
  orders: Order[];
  items: OrderItem[];
  check: Check | null;
  calls: ServiceCall[];
  ready: number;
  qrWaiting: boolean;
  guests: number;
}

export function useWaiter() {
  const { staff } = useSession();
  const me = staff?.id ?? null;
  const branch = useBranch();
  const bq = branch ? { branchId: branch.id } : {};
  const since = useMemo(() => startOfDay().toISOString(), []);
  const tables = useLive("tables", { where: { ...bq, active: true }, orderBy: [{ field: "label" }] });
  const zones = useLive("zones", { where: { ...bq }, orderBy: [{ field: "sort" }] }).data;
  const orders = useLive("orders", { where: { ...bq, status: ["open", "sent", "ready", "served"] }, orderBy: [{ field: "openedAt" }] }).data;
  const checks = useLive("checks", { where: { ...bq, status: ["open", "bill_requested"] } }).data;
  const items = useLive("orderItems", { where: { status: ["new", "sent", "preparing", "ready", "served"] } }).data;
  const calls = useLive("serviceCalls", { where: { ...bq }, gte: { createdAt: since }, orderBy: [{ field: "createdAt", dir: "desc" }] });
  const staffRows = useLive("memberships").data;

  return useMemo(() => {
    const owners = tableOwners(tables.data, orders);
    const orderIds = new Set(orders.map((o) => o.id));
    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const i of items) if (orderIds.has(i.orderId)) itemsByOrder.set(i.orderId, [...(itemsByOrder.get(i.orderId) ?? []), i]);
    const views: TableView[] = tables.data
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
      .map((table) => {
        const os = orders.filter((o) => o.tableIds.includes(table.id));
        const its = os.flatMap((o) => itemsByOrder.get(o.id) ?? []);
        const check = checks.find((c) => c.tableIds.includes(table.id)) ?? null;
        const owner = owners.get(table.id) ?? null;
        return {
          table,
          owner,
          mine: !!me && owner === me,
          orders: os,
          items: its,
          check,
          calls: calls.data.filter((c) => c.tableId === table.id && (c.status === "open" || c.status === "ack")),
          ready: its.filter((i) => i.status === "ready").reduce((a, i) => a + i.qty, 0),
          qrWaiting: os.some((o) => o.source === "qr" && its.some((i) => i.orderId === o.id && i.status === "new") && !its.some((i) => i.orderId === o.id && i.status !== "new" && i.status !== "void")),
          guests: check?.guests ?? os[0]?.guests ?? 0,
        };
      });
    const staffName = new Map(staffRows.map((m) => [m.id, m.name]));
    const label = new Map(tables.data.map((t) => [t.id, t.label]));
    return { me, views, zones, owners, calls: calls.data, callsLoading: calls.loading, staffName, staff: staffRows, label, loading: tables.loading };
  }, [tables.data, tables.loading, orders, checks, items, calls.data, calls.loading, staffRows, zones, me]);
}
export type WaiterData = ReturnType<typeof useWaiter>;
