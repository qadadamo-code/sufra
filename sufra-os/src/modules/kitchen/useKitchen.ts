/** Live data the KDS needs, in one place. Everything here re-renders on writes from any tab/device. */
import { useMemo } from "react";
import { useBranch } from "@/auth/session";
import { useLive } from "@/data/hooks";
import type { KitchenStation, OrderItem } from "@/data/types";
import { startOfDay } from "@/lib/time";
import { kdsSettings, prepStats, avgTicketMinutes } from "./kds";

export function useKitchen() {
  const branch = useBranch();
  const bq = branch ? { branchId: branch.id } : {};
  const since = useMemo(() => startOfDay().toISOString(), []);
  const stations = useLive("kitchenStations", { where: { ...bq }, orderBy: [{ field: "sort" }] }).data;
  const orders = useLive("orders", { where: { ...bq, status: ["open", "sent", "ready", "served"] }, orderBy: [{ field: "openedAt" }] });
  const active = useLive("orderItems", { where: { status: ["new", "sent", "preparing", "ready"] } });
  const today = useLive("orderItems", { gte: { updatedAt: since } });
  const tables = useLive("tables").data;
  const staff = useLive("memberships").data;
  const settingsRow = useLive("settings").data[0];

  const items = useMemo(() => {
    const m = new Map<string, OrderItem>();
    for (const i of today.data) m.set(i.id, i);
    for (const i of active.data) m.set(i.id, i);
    return [...m.values()];
  }, [today.data, active.data]);

  const stationById = useMemo(() => new Map<string, KitchenStation>(stations.map((s) => [s.id, s])), [stations]);
  const tableLabel = useMemo(() => new Map(tables.map((t) => [t.id, t.label])), [tables]);
  const staffName = useMemo(() => new Map(staff.map((m) => [m.id, m.name])), [staff]);
  const prep = useMemo(() => prepStats(today.data), [today.data]);
  const avgTicket = useMemo(() => avgTicketMinutes(today.data), [today.data]);
  const settings = kdsSettings(settingsRow);

  return {
    loading: orders.loading || active.loading,
    stations,
    stationById,
    orders: orders.data,
    items,
    tableLabel,
    staffName,
    prep,
    avgTicket,
    settings,
  };
}
export type KitchenData = ReturnType<typeof useKitchen>;
