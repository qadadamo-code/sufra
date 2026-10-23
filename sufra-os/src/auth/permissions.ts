/**
 * Permissions matrix — the single source of truth for what each role may do in the app.
 * Postgres RLS (supabase/migrations/0001_init.sql) enforces the data side of the same rules;
 * this file drives the UI (what to show, when to ask for a manager PIN).
 *
 *   can(role, "menu.edit")                      → boolean
 *   authorize(role, { kind: "discount", pct })  → { ok } | { ok:false, needs:"approval", approvers } | { ok:false, needs:"denied" }
 */
import { ROLES, ROLE_RANK, type Role } from "./roles";

export const PERMISSIONS = [
  // service
  "pos.use",
  "orders.create",
  "orders.edit",
  "orders.transfer",
  "orders.void",
  "orders.discount",
  "orders.comp",
  "checks.split",
  "checks.merge",
  "checks.reopen",
  "payments.take",
  "payments.refund",
  "drawer.open",
  "shift.close",
  "floor.view",
  "floor.manage", // seat guests, move tables, mark dirty
  "floor.edit", // edit the layout
  "waiter.use",
  "service_calls.handle",
  "kitchen.view",
  "kitchen.bump",
  "menu.availability", // 86 an item
  "delivery.view",
  "delivery.dispatch",
  "delivery.run",
  "reservations.view",
  "reservations.manage",
  "customers.view",
  "customers.edit",
  // management
  "dashboard.view",
  "reports.view",
  "reports.financial",
  "menu.edit",
  "staff.view",
  "staff.manage",
  "staff.payroll",
  "accounting.view",
  "accounting.post",
  "settings.view",
  "settings.edit",
  "settings.tax",
  "audit.view",
  "restaurant.billing",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);
const without = (...xs: Permission[]) => new Set<Permission>(PERMISSIONS.filter((p) => !xs.includes(p)));
const only = (...xs: Permission[]) => new Set<Permission>(xs);

const SERVICE_BASE: Permission[] = ["floor.view", "service_calls.handle", "reservations.view", "customers.view", "kitchen.view"];

export const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  owner: ALL,
  admin: without("restaurant.billing"),
  manager: without("restaurant.billing", "staff.payroll", "settings.tax", "accounting.post"),
  cashier: only(
    ...SERVICE_BASE,
    "pos.use",
    "orders.create",
    "orders.edit",
    "orders.transfer",
    "orders.discount",
    "checks.split",
    "checks.merge",
    "payments.take",
    "drawer.open",
    "shift.close",
    "floor.manage",
    "reservations.manage",
    "customers.edit",
    "delivery.view",
    "delivery.dispatch",
  ),
  waiter: only(...SERVICE_BASE, "waiter.use", "orders.create", "orders.edit", "orders.transfer", "checks.split", "floor.manage", "reservations.manage", "customers.edit"),
  chef: only("kitchen.view", "kitchen.bump", "menu.availability", "menu.edit", "reports.view", "staff.view"),
  kitchen: only("kitchen.view", "kitchen.bump", "menu.availability"),
  delivery: only("delivery.view", "delivery.run", "customers.view"),
  accountant: only("dashboard.view", "reports.view", "reports.financial", "accounting.view", "accounting.post", "audit.view", "staff.view", "staff.payroll", "settings.view", "customers.view"),
};

export function can(role: Role | null | undefined, p: Permission): boolean {
  return !!role && MATRIX[role].has(p);
}

/** Sensitive actions: some roles may do them outright, others only with an approver's PIN. */
export type Action =
  | { kind: "discount"; pct: number }
  | { kind: "void"; afterSend: boolean }
  | { kind: "refund" }
  | { kind: "comp" }
  | { kind: "drawer.open"; noSale: boolean }
  | { kind: "check.reopen" }
  | { kind: "price.override" };

export type Decision = { ok: true } | { ok: false; needs: "approval"; approvers: Role[] } | { ok: false; needs: "denied" };

export interface Policy {
  /** discounts above this % need approval (Settings.discountApprovalPct) */
  discountApprovalPct: number;
}
export const DEFAULT_POLICY: Policy = { discountApprovalPct: 10 };

const MANAGERS: Role[] = ["owner", "admin", "manager"];

/** Who can approve each action with their PIN. */
export function approversFor(_a: Action): Role[] {
  // Today every sensitive action is approved by a manager or above; kept per-action so a restaurant
  // can later let e.g. a head cashier approve small refunds.
  return MANAGERS;
}

export function authorize(role: Role, a: Action, policy: Policy = DEFAULT_POLICY): Decision {
  const isManager = ROLE_RANK[role] >= ROLE_RANK.manager;
  const need = (): Decision => ({ ok: false, needs: "approval", approvers: approversFor(a) });
  switch (a.kind) {
    case "discount":
      if (!can(role, "orders.discount") && !can(role, "orders.create")) return { ok: false, needs: "denied" };
      if (isManager) return { ok: true };
      if (can(role, "orders.discount") && a.pct <= policy.discountApprovalPct) return { ok: true };
      return need();
    case "void":
      // removing an item nobody has cooked yet is free; voiding something the kitchen has seen needs a manager
      if (!a.afterSend && can(role, "orders.edit")) return { ok: true };
      if (can(role, "orders.void")) return { ok: true };
      return can(role, "orders.edit") ? need() : { ok: false, needs: "denied" };
    case "refund":
      if (can(role, "payments.refund")) return { ok: true };
      return can(role, "payments.take") ? need() : { ok: false, needs: "denied" };
    case "comp":
      if (can(role, "orders.comp")) return { ok: true };
      return can(role, "orders.edit") ? need() : { ok: false, needs: "denied" };
    case "drawer.open":
      if (!can(role, "drawer.open")) return { ok: false, needs: "denied" };
      // opening the drawer without a sale is logged and needs a manager unless you are one
      return a.noSale && !isManager ? need() : { ok: true };
    case "check.reopen":
      if (can(role, "checks.reopen")) return { ok: true };
      return can(role, "payments.take") ? need() : { ok: false, needs: "denied" };
    case "price.override":
      return isManager ? { ok: true } : can(role, "orders.edit") ? need() : { ok: false, needs: "denied" };
  }
}

/** Can `approver` approve action `a`? */
export function canApprove(approver: Role, a: Action): boolean {
  return approversFor(a).includes(approver);
}

export function permissionsOf(role: Role): Permission[] {
  return PERMISSIONS.filter((p) => MATRIX[role].has(p));
}

export { ROLES };
