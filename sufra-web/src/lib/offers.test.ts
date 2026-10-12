import { describe, expect, it } from "vitest";
import { applyCode } from "./offers";
import { restaurants } from "./data";
import { validEgMobile } from "./phone";

const withKind = (k: string) => restaurants.find((r) => r.offers.some((o) => o.kind === k))!;

describe("applyCode", () => {
  it("rejects unknown codes", () => {
    const r = restaurants[0];
    expect(applyCode(r, "NOPE", { subtotal: 50000, mode: "pickup", now: new Date() }).ok).toBe(false);
  });
  it("free delivery needs delivery mode and EGP 300", () => {
    const r = withKind("free-delivery");
    const o = r.offers.find((x) => x.kind === "free-delivery")!;
    const day = new Date(2026, 9, 11 + ((o.days[0] - 0 + 7) % 7)); // a Sunday-based date on an allowed weekday
    expect(applyCode(r, o.code, { subtotal: 20000, mode: "delivery", now: day }).ok).toBe(false);
    const ok = applyCode(r, o.code, { subtotal: 35000, mode: "delivery", now: day });
    expect(ok.ok && ok.freeDelivery).toBe(true);
    expect(applyCode(r, o.code, { subtotal: 35000, mode: "pickup", now: day }).ok).toBe(false);
  });
  it("percent codes return a percent discount", () => {
    const r = withKind("percent");
    const o = r.offers.find((x) => x.kind === "percent")!;
    const day = new Date(2026, 9, 11 + o.days[0]);
    const res = applyCode(r, o.code.toLowerCase(), { subtotal: 10000, mode: "dine-in", now: day });
    expect(res.ok && res.discount).toEqual({ kind: "percent", value: o.value });
  });
});

describe("Egyptian mobile validation", () => {
  it("accepts 11-digit 010/011/012/015 numbers only", () => {
    expect(validEgMobile("01012345678")).toBe(true);
    expect(validEgMobile("01512345678")).toBe(true);
    expect(validEgMobile("0101234567")).toBe(false);
    expect(validEgMobile("01312345678")).toBe(false);
    expect(validEgMobile("+201012345678")).toBe(false);
  });
});
