import { describe, expect, it } from "vitest";
import { norm, parseIntent, recommend } from "./recommend";
import { areaById } from "./data";

const home = { lat: areaById.dokki.lat, lng: areaById.dokki.lng };
const mon8pm = new Date(2026, 9, 12, 20, 0);

describe("parseIntent", () => {
  it("normalises Arabic", () => {
    expect(norm("مَكانٌ هادئ في الزمالك!")).toBe("مكان هادي في الزمالك");
    expect(norm("قهوة ٣٠٠")).toBe("قهوه 300");
  });
  it("reads Egyptian phrasing", () => {
    const it = parseIntent("عايز كافيه هادي فيه واي فاي في الزمالك أشتغل منه، مفتوح دلوقتي");
    expect(it.areas).toEqual(["zamalek"]);
    expect(it.cuisines).toContain("cafe");
    expect(it.amenities).toEqual(expect.arrayContaining(["quiet", "wifi"]));
    expect(it.openNow).toBe(true);
  });
  it("reads moods, price and English", () => {
    expect(parseIntent("خروجة مع صحابي رخيصة").price).toBe("cheap");
    expect(parseIntent("خروجة مع الشلة").moods).toContain("friends");
    expect(parseIntent("romantic dinner in Maadi, something fancy")).toMatchObject({ areas: ["maadi"], price: "pricey" });
    expect(parseIntent("فطار في التجمع تحت ٢٠٠").maxAvg).toBe(200);
    expect(parseIntent("فطار في التجمع").moods).toContain("breakfast");
    expect(parseIntent("مكان حلو للعيلة").cuisines).toEqual([]);
  });
});

describe("recommend", () => {
  it("returns 2–3 named picks with reasons", () => {
    const a = recommend("كافيه للشغل فيه واي فاي في الزمالك", { home, lang: "ar", now: mon8pm });
    expect(a.picks.length).toBeGreaterThanOrEqual(2);
    expect(a.picks.length).toBeLessThanOrEqual(3);
    for (const p of a.picks) expect(p.reasons.length).toBeGreaterThan(1);
    expect(a.text).toContain(a.picks[0].r.ar);
    if (!a.relaxed) for (const p of a.picks) expect(p.r.area).toBe("zamalek");
  });
  it("relaxes when nothing matches", () => {
    const a = recommend("سوشي في الرحاب على النيل رخيص", { home, lang: "en", now: mon8pm });
    expect(a.picks.length).toBeGreaterThan(0);
  });
  it("prefers close places when asked", () => {
    const a = recommend("حاجة قريبة مني", { home, lang: "ar", now: mon8pm });
    expect(a.picks[0].km).toBeLessThan(6);
  });
});
