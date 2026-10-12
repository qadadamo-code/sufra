import { describe, expect, it } from "vitest";
import { findByName, norm, parseIntent, recommend, scorePlaces, similarity } from "./recommend";
import { areaById, byId, restaurants } from "./data";

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
    expect(it.moods).toContain("work");
    expect(it.openNow).toBe(true);
  });
  it("reads Levantine phrasing and spelling variants", () => {
    const it = parseIntent("بدي فلافل هلق بالمهندسين");
    expect(it.cuisines).toContain("egyptian");
    expect(it.openNow).toBe(true);
    expect(it.areas).toContain("mohandessin");
    expect(parseIntent("مكان هادىء فى الزمالك").areas).toEqual(["zamalek"]); // ى / ء variants
  });
  it("reads moods, price and English", () => {
    expect(parseIntent("خروجة مع صحابي رخيصة").price).toBe("cheap");
    expect(parseIntent("خروجة مع الشلة").moods).toContain("friends");
    expect(parseIntent("romantic dinner in Maadi, something fancy")).toMatchObject({ areas: ["maadi"], price: "pricey" });
    expect(parseIntent("فطار في التجمع تحت ٢٠٠").maxAvg).toBe(200);
    expect(parseIntent("فطار في التجمع").moods).toContain("breakfast");
    expect(parseIntent("مكان حلو للعيلة").cuisines).toEqual([]);
  });
  it("understands 'زي <restaurant>' (similar to)", () => {
    const it = parseIntent("عايز مكان زي كشري ابو طارق");
    expect(it.likeId).toBeTruthy();
    expect(byId[it.likeId!].en.toLowerCase()).toContain("koshary");
    expect(parseIntent("something like Costa").likeId).toBe(findByName("Costa")?.id);
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
  it("'زي X' returns similar places, never X itself", () => {
    const like = findByName("كشري أبو طارق")!;
    const a = recommend("زي كشري ابو طارق", { home, lang: "ar", now: mon8pm });
    expect(a.picks.map((p) => p.r.id)).not.toContain(like.id);
    expect(a.picks.filter((p) => p.r.cuisine === like.cuisine).length).toBeGreaterThanOrEqual(2);
  });
  it("taste affinity and 'because' reasons flow into the ranking", () => {
    const fav = restaurants.find((r) => r.cuisine === "italian")!;
    const base = scorePlaces({}, { home, lang: "en", now: mon8pm });
    const tuned = scorePlaces({}, { home, lang: "en", now: mon8pm, affinity: (r) => (r.cuisine === "italian" ? 5 : 0), because: (r) => (r.cuisine === "italian" && r.id !== fav.id ? `Because you liked ${fav.en}` : null) });
    const italianRank = (l: typeof base) => l.findIndex((p) => p.r.cuisine === "italian");
    expect(italianRank(tuned)).toBeLessThanOrEqual(italianRank(base));
    expect(tuned.find((p) => p.r.cuisine === "italian" && p.r.id !== fav.id)!.reasons).toContain(`Because you liked ${fav.en}`);
  });
  it("similarity: same cuisine and moods beat a different kind of place", () => {
    const cafes = restaurants.filter((r) => r.cuisine === "cafe");
    const grill = restaurants.find((r) => r.cuisine === "grill")!;
    expect(similarity(cafes[0], cafes[1])).toBeGreaterThan(similarity(cafes[0], grill));
  });
});
