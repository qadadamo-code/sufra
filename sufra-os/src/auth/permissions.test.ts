import { describe, expect, it } from "vitest";
import { authorize, can, canApprove, MATRIX, PERMISSIONS, permissionsOf } from "./permissions";
import { ROLES, ROLE_HOME } from "./roles";

describe("permissions matrix", () => {
  it("owner can do everything; every role has at least one permission", () => {
    expect(permissionsOf("owner")).toEqual([...PERMISSIONS]);
    for (const r of ROLES) expect(MATRIX[r].size).toBeGreaterThan(0);
  });

  it("role basics", () => {
    expect(can("cashier", "pos.use")).toBe(true);
    expect(can("cashier", "menu.edit")).toBe(false);
    expect(can("waiter", "payments.take")).toBe(false);
    expect(can("waiter", "staff.payroll")).toBe(false);
    expect(can("kitchen", "kitchen.bump")).toBe(true);
    expect(can("kitchen", "orders.create")).toBe(false);
    expect(can("chef", "menu.availability")).toBe(true);
    expect(can("delivery", "delivery.run")).toBe(true);
    expect(can("delivery", "pos.use")).toBe(false);
    expect(can("accountant", "reports.financial")).toBe(true);
    expect(can("accountant", "orders.create")).toBe(false);
    expect(can("manager", "staff.payroll")).toBe(false);
    expect(can("admin", "restaurant.billing")).toBe(false);
    expect(can(null, "pos.use")).toBe(false);
  });

  it("discounts above the limit need a manager PIN", () => {
    expect(authorize("cashier", { kind: "discount", pct: 5 })).toEqual({ ok: true });
    expect(authorize("cashier", { kind: "discount", pct: 10 })).toEqual({ ok: true });
    const d = authorize("cashier", { kind: "discount", pct: 15 });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.needs === "approval" && d.approvers).toEqual(["owner", "admin", "manager"]);
    expect(authorize("cashier", { kind: "discount", pct: 15 }, { discountApprovalPct: 20 })).toEqual({ ok: true });
    expect(authorize("manager", { kind: "discount", pct: 50 })).toEqual({ ok: true });
    expect(authorize("waiter", { kind: "discount", pct: 5 }).ok).toBe(false);
    expect(authorize("kitchen", { kind: "discount", pct: 5 })).toEqual({ ok: false, needs: "denied" });
  });

  it("void: free before the kitchen saw it, manager after", () => {
    expect(authorize("waiter", { kind: "void", afterSend: false })).toEqual({ ok: true });
    expect(authorize("waiter", { kind: "void", afterSend: true })).toMatchObject({ ok: false, needs: "approval" });
    expect(authorize("manager", { kind: "void", afterSend: true })).toEqual({ ok: true });
    expect(authorize("delivery", { kind: "void", afterSend: true })).toEqual({ ok: false, needs: "denied" });
  });

  it("refunds, drawer, reopen", () => {
    expect(authorize("cashier", { kind: "refund" })).toMatchObject({ ok: false, needs: "approval" });
    expect(authorize("owner", { kind: "refund" })).toEqual({ ok: true });
    expect(authorize("cashier", { kind: "drawer.open", noSale: false })).toEqual({ ok: true });
    expect(authorize("cashier", { kind: "drawer.open", noSale: true })).toMatchObject({ ok: false, needs: "approval" });
    expect(authorize("waiter", { kind: "drawer.open", noSale: true })).toEqual({ ok: false, needs: "denied" });
    expect(authorize("cashier", { kind: "check.reopen" })).toMatchObject({ ok: false, needs: "approval" });
    expect(canApprove("manager", { kind: "refund" })).toBe(true);
    expect(canApprove("cashier", { kind: "refund" })).toBe(false);
  });

  it("every role has a home", () => {
    for (const r of ROLES) expect(ROLE_HOME[r]).toMatch(/^\//);
  });
});
