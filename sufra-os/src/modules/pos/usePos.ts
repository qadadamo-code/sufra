/** Data every POS screen needs, live. */
import { useMemo } from "react";
import { useLive } from "@/data/hooks";
import { useBranch, useSession } from "@/auth/session";
import type { Check, Membership, Order, Payment, Receipt, Settings } from "@/data/types";
import { buildReceiptModel, freezeBill, type ReceiptModel, type ReceiptSource } from "@/lib/receipt";
import { priceItems } from "@/data/pricing";
import type { OrderItem } from "@/data/types";
import { deviceCode } from "./sale";

export function useMenu() {
  const cats = useLive("menuCategories", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const items = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const groups = useLive("modifierGroups", { orderBy: [{ field: "sort" }] }).data;
  const mods = useLive("modifiers", { orderBy: [{ field: "sort" }] }).data;
  return { cats, items, groups, mods };
}

export function useSettings(): Settings | null {
  return useLive("settings").data[0] ?? null;
}

export function useShift() {
  const device = deviceCode();
  const { branchId } = useSession();
  const live = useLive("shifts", { where: { device, status: "open", ...(branchId ? { branchId } : {}) } });
  return { device, shift: live.data[0] ?? null, loading: live.loading };
}

export function useStaffNames() {
  const staff = useLive("memberships").data;
  return useMemo(() => new Map<string, Membership>(staff.map((m) => [m.id, m])), [staff]);
}

/** Everything a receipt shows, from a receipt row (reprint) or a live check (pre-bill). */
export function useReceiptSourceBuilder() {
  const settings = useSettings();
  const { restaurant } = useSession();
  const branch = useBranch();
  const staff = useStaffNames();
  const tables = useLive("tables").data;
  const customers = useLive("customers").data;
  return useMemo(() => {
    if (!settings || !restaurant) return null;
    const base = (check: Check, orders: Order[]) => {
      const order = orders[0];
      const cust = customers.find((c) => c.id === (check.customerId ?? order?.customerId));
      return {
        tax: settings.tax,
        invoice: settings.invoice,
        restaurant: { name: restaurant.name, phone: restaurant.phone },
        branch: branch ? { name: branch.name, address: branch.address, phone: branch.phone } : null,
        orderNumber: order?.number ?? null,
        waiter: order?.waiterId ? (staff.get(order.waiterId)?.name ?? null) : null,
        tableLabels: check.tableIds.map((id) => tables.find((t) => t.id === id)?.label ?? "?"),
        guests: check.guests,
        mode: order?.mode ?? "dine_in",
        pickup: !!order?.pickupAt,
        customer: cust ? { name: cust.name, phone: cust.phone, address: order?.delivery?.address ?? null } : order?.delivery ? { name: "", phone: "", address: order.delivery.address } : null,
      };
    };
    return {
      fromReceipt(r: Receipt, check: Check, orders: Order[], payments: Payment[], original?: Receipt | null): ReceiptModel {
        const cash = payments.filter((p) => p.method === "cash" && p.status === "captured");
        const src: ReceiptSource = {
          ...base(check, orders),
          kind: r.kind,
          bill: r.bill,
          receiptNo: r.receiptNo,
          issuedAt: r.issuedAt,
          cashier: r.issuedBy ? (staff.get(r.issuedBy)?.name ?? null) : null,
          payments: r.payments,
          tendered: r.kind === "SC" && cash.length ? cash.reduce((a, p) => a + (p.tendered ?? p.amount), 0) : null,
          change: r.kind === "SC" && cash.length ? cash.reduce((a, p) => a + (p.change ?? 0), 0) : null,
          eta: r.etaUuid && r.etaQr ? { uuid: r.etaUuid, qr: r.etaQr } : null,
          refundOf: original?.receiptNo ?? null,
        };
        return buildReceiptModel(src);
      },
      /** Pre-bill (or a paid check from before receipts existed, e.g. seed data). */
      fromCheck(check: Check, orders: Order[], items: OrderItem[], payments: Payment[], cashierId: string | null): ReceiptModel | null {
        const order = orders[0];
        const { bill } = priceItems(items, { mode: order?.mode ?? "dine_in", tax: settings.tax, discount: check.discount, deliveryFee: order?.deliveryFee });
        if (!bill) return null;
        const paid = check.status === "paid";
        const caps = payments.filter((p) => p.status === "captured");
        const cash = caps.filter((p) => p.method === "cash");
        return buildReceiptModel({
          ...base(check, orders),
          kind: paid ? "SC" : "prebill",
          bill: freezeBill(bill, items.filter((i) => i.status !== "void")),
          receiptNo: check.receiptNo,
          issuedAt: check.closedAt ?? new Date().toISOString(),
          cashier: cashierId ? (staff.get(cashierId)?.name ?? null) : null,
          payments: paid ? caps.map((p) => ({ method: p.method, amount: p.amount, tip: p.tip })) : [],
          tendered: paid && cash.length ? cash.reduce((a, p) => a + (p.tendered ?? p.amount), 0) : null,
          change: paid && cash.length ? cash.reduce((a, p) => a + (p.change ?? 0), 0) : null,
          eta: null,
        });
      },
    };
  }, [settings, restaurant, branch, staff, tables, customers]);
}
