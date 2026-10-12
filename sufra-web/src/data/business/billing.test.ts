import { describe, expect, it } from "vitest";
import { breakEvenMonths, commissionFor, projectRevenue, quoteAddon, quotePlan, supplierStatement } from "./billing";
import { LIFETIME, PLANS, egp } from "./plans";
import { SUPPLIER_PLANS } from "./supplier-plans";

const pro = PLANS.find((p) => p.id === "pro")!;

describe("quotePlan", () => {
  it("monthly is the list price + 14% VAT", () => {
    const q = quotePlan("pro", "monthly");
    expect(q.net).toBe(pro.monthly);
    expect(q.vat).toBe(Math.round(pro.monthly * 0.14));
    expect(q.gross).toBe(q.net + q.vat);
    expect(q.saving).toBe(0);
    expect(q.perMonth).toBe(pro.monthly);
  });

  it("yearly charges 10 months for 12 (2 months free)", () => {
    const q = quotePlan("pro", "yearly");
    expect(q.net).toBe(pro.monthly * 10);
    expect(q.months).toBe(12);
    expect(q.saving).toBe(pro.monthly * 2);
    expect(q.perMonth).toBe(Math.round((pro.monthly * 10) / 12));
  });

  it("3 years takes 30% off 36 months and beats yearly per month", () => {
    const q = quotePlan("basic", "threeYear");
    const basic = PLANS[0];
    expect(q.net).toBe(basic.monthly * 36 - Math.round(basic.monthly * 36 * 0.3));
    expect(q.perMonth).toBeLessThan(quotePlan("basic", "yearly").perMonth);
    expect(q.saving).toBe(basic.monthly * 36 - q.net);
  });

  it("lifetime is a one-time licence with yearly maintenance and an optional on-prem setup", () => {
    const q = quotePlan("pro", "lifetime");
    expect(q.net).toBe(pro.lifetime);
    expect(q.months).toBe(0);
    expect(q.maintenancePerYear).toBe(Math.round((pro.lifetime * pro.maintenancePct) / 100));
    const onPrem = quotePlan("pro", "lifetime", { onPrem: true });
    expect(onPrem.net).toBe(pro.lifetime + LIFETIME.onPremSetup);
    expect(onPrem.vat).toBe(Math.round(onPrem.net * 0.14));
  });

  it("VAT is integer piastres rounded half-up", () => {
    for (const p of PLANS) for (const per of ["monthly", "yearly", "threeYear", "lifetime"] as const) {
      const q = quotePlan(p.id, per);
      expect(Number.isInteger(q.net) && Number.isInteger(q.vat)).toBe(true);
    }
  });

  it("break-even of owning vs monthly", () => {
    expect(breakEvenMonths("pro")).toBe(Math.ceil(pro.lifetime / pro.monthly));
  });

  it("add-ons follow the period; hardware is one-time", () => {
    expect(quoteAddon("pos", "yearly")).toBe(egp(290) * 10);
    expect(quoteAddon("hw-pos", "threeYear", 2)).toBe(egp(18500) * 2);
    expect(quoteAddon("nope", "monthly")).toBe(0);
  });
});

describe("supplier statement", () => {
  const orders = [
    { id: "a", net: egp(10000), status: "delivered" as const, collectedBySufra: true },
    { id: "b", net: egp(2000), status: "invoiced" as const },
    { id: "c", net: egp(5000), status: "cancelled" as const, collectedBySufra: true },
    { id: "d", net: egp(800), status: "new" as const },
    { id: "e", net: egp(3000), status: "delivered" as const, returned: egp(500) },
  ];

  it("charges commission only on delivered/invoiced value net of returns", () => {
    const s = supplierStatement("growth", orders);
    expect(s.lines.map((l) => l.id)).toEqual(["a", "b", "e"]);
    expect(s.gmv).toBe(egp(10000 + 2000 + 2500));
    // 3.5% each, min 10 EGP, max 1,500 EGP
    expect(s.lines[0].commission).toBe(egp(350));
    expect(s.lines[1].commission).toBe(egp(70));
    expect(s.lines[2].commission).toBe(egp(87.5));
  });

  it("adds subscription, collection fee and VAT on fees; payout nets them from collected money", () => {
    const s = supplierStatement("growth", orders);
    const growth = SUPPLIER_PLANS.find((p) => p.id === "growth")!;
    expect(s.subscription).toBe(growth.monthly);
    // only order a was collected by Sufra: 10,000 + 14% = 11,400 → 1.5% = 171
    expect(s.collected).toBe(egp(11400));
    expect(s.collection).toBe(egp(171));
    expect(s.feesNet).toBe(s.subscription + s.commission + s.collection);
    expect(s.feesVat).toBe(Math.round(s.feesNet * 0.14));
    expect(s.payout).toBe(s.collected - s.feesGross);
  });

  it("applies the minimum and the cap", () => {
    expect(commissionFor("starter", egp(100))).toBe(egp(15)); // 6% = 6 → min 15
    expect(commissionFor("starter", egp(10))).toBe(egp(10)); // never more than the order
    expect(commissionFor("growth", egp(100000))).toBe(egp(1500)); // capped
    expect(commissionFor("distributor", 0)).toBe(0);
  });

  it("a month with no sales still owes the subscription", () => {
    const s = supplierStatement("distributor", []);
    expect(s.commission).toBe(0);
    expect(s.feesNet).toBe(SUPPLIER_PLANS[2].monthly);
    expect(s.payout).toBe(-s.feesGross);
  });
});

describe("revenue projection", () => {
  it("sums each stream in piastres", () => {
    const r = projectRevenue({
      restaurants: 100,
      avgPlanEgp: 2000,
      ordersPerRestaurant: 300,
      avgOrderEgp: 400,
      orderFeePct: 2,
      suppliers: 20,
      avgSupplierPlanEgp: 1500,
      supplierGmvEgp: 1_000_000,
      supplierCommissionPct: 3,
      promotedPct: 10,
      promotedEgp: 1000,
    });
    expect(r.subscriptions).toBe(egp(200000));
    expect(r.orderFees).toBe(egp(240000)); // 100 × 300 × 400 × 2%
    expect(r.supplierSubscriptions).toBe(egp(30000));
    expect(r.supplierCommission).toBe(egp(30000));
    expect(r.promoted).toBe(egp(10000));
    expect(r.monthly).toBe(egp(510000));
    expect(r.yearly).toBe(r.monthly * 12);
  });

  it("ignores negative or missing inputs", () => {
    const r = projectRevenue({ restaurants: -5, avgPlanEgp: NaN, ordersPerRestaurant: 0, avgOrderEgp: 0, orderFeePct: 0, suppliers: 0, avgSupplierPlanEgp: 0, supplierGmvEgp: 0, supplierCommissionPct: 0 });
    expect(r.monthly).toBe(0);
  });
});
