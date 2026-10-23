import { describe, expect, it } from "vitest";
import { egp } from "@finance/money";
import { formatMoney, fromAmount, major, minor, moneyParts, pctOf, roundMinor, toAmount, UNITS_PER_MAJOR } from "./money";

describe("money units", () => {
  it("uses the sufra-finance unit (0.00001 EGP)", () => {
    expect(major(185)).toBe(185 * UNITS_PER_MAJOR);
    expect(major("185.5")).toBe(18_550_000);
    expect(major("0.01")).toBe(minor(1));
    expect(toAmount(major("185.5"))).toBe(egp("185.5"));
    expect(fromAmount(egp("1234.56789"))).toBe(123_456_789);
    expect(() => major("1.2.3")).toThrow();
  });

  it("rounds to piastres half away from zero", () => {
    expect(roundMinor(1_500)).toBe(2_000);
    expect(roundMinor(1_499)).toBe(1_000);
    expect(roundMinor(-1_500)).toBe(-2_000);
  });

  it("formats per language with the currency on the right side for each", () => {
    expect(formatMoney(major("1250"), { lang: "ar" })).toBe("1,250.00 ج.م");
    expect(formatMoney(major("1250"), { lang: "en" })).toBe("EGP 1,250.00");
    expect(formatMoney(major("1250"), { lang: "en", compact: true })).toBe("EGP 1,250");
    expect(formatMoney(major("1250.5"), { lang: "en", compact: true })).toBe("EGP 1,250.50");
    expect(formatMoney(major("0.05"), { lang: "ar" })).toBe("0.05 ج.م");
    expect(formatMoney(-major("12.3"), { lang: "en" })).toBe("EGP -12.30");
    expect(formatMoney(major("99.6"), { lang: "en", whole: true })).toBe("EGP 100");
    expect(formatMoney(major("7"), { lang: "ar", currency: "SAR" })).toBe("7.00 ر.س");
    expect(formatMoney(major("1234567.891"), { lang: "en", bare: true })).toBe("1,234,567.89");
    expect(moneyParts(major(5), { lang: "en", signed: true }).sign).toBe("+");
  });

  it("percentages in basis points", () => {
    expect(pctOf(major(100), 1400)).toBe(major(14));
    expect(pctOf(major("33.33"), 1200)).toBe(399_960);
  });
});
