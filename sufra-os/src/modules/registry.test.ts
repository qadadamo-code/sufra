import { describe, expect, it } from "vitest";
import { homeFor, modules, visibleModules } from "./registry";

describe("module registry", () => {
  it("discovers every module folder", () => {
    const ids = modules.map((m) => m.id).sort();
    for (const id of ["overview", "pos", "floor", "kitchen", "waiter", "orders", "menu", "reservations", "customers", "delivery", "reports", "staff", "accounting", "settings", "guest"]) expect(ids).toContain(id);
  });
  it("lands each role on its own home", () => {
    expect(homeFor("owner")).toBe("/overview");
    expect(homeFor("admin")).toBe("/overview");
    expect(homeFor("manager")).toBe("/floor");
    expect(homeFor("cashier")).toBe("/pos");
    expect(homeFor("waiter")).toBe("/waiter");
    expect(homeFor("chef")).toBe("/kitchen");
    expect(homeFor("kitchen")).toBe("/kitchen");
    expect(homeFor("delivery")).toBe("/delivery");
    expect(homeFor("accountant")).toBe("/accounting");
  });
  it("nav is filtered by permission", () => {
    const k = visibleModules("kitchen").map((m) => m.id);
    expect(k).toContain("kitchen");
    expect(k).not.toContain("pos");
    expect(k).not.toContain("settings");
  });
  it("guest routes are public (the staff QR page is not)", () => {
    const g = modules.find((m) => m.id === "guest")!;
    const pub = g.routes.filter((r) => r.path.startsWith("/r/"));
    expect(pub.every((r) => r.layout === "guest")).toBe(true);
    expect(pub.map((r) => r.path)).toEqual(expect.arrayContaining(["/r/:restaurantSlug/t/:tableCode", "/r/:restaurantSlug", "/r/:restaurantSlug/o/:orderId"]));
    const staff = g.routes.filter((r) => !r.path.startsWith("/r/"));
    expect(staff.every((r) => (r.layout ?? "shell") === "shell" && !!r.permission)).toBe(true);
  });
});
