import { describe, expect, it } from "vitest";
import { canon, editDistance, fuzzyScore, hasPhrase, norm, tokens } from "./arabic";

describe("Arabic normalisation", () => {
  it("unifies alef forms, taa marbuta, alef maqsura and strips tashkeel/tatweel", () => {
    expect(norm("أحمد إسلام آمال ٱلبيت")).toBe("احمد اسلام امال البيت");
    expect(norm("قهوة")).toBe(norm("قهوه"));
    expect(norm("مستشفى")).toBe("مستشفي");
    expect(norm("كُشَرِيّ")).toBe("كشري");
    expect(norm("كـــشري")).toBe("كشري");
    expect(norm("سؤال شاطئ")).toBe("سوال شاطي");
  });
  it("keeps digits (Arabic-Indic → Latin) instead of eating them with the tashkeel range", () => {
    expect(norm("تحت ٢٠٠ جنيه")).toBe("تحت 200 جنيه");
    expect(norm("۱۲")).toBe("12");
  });
  it("lowercases and drops punctuation", () => {
    expect(norm("Koshary  Abou-Tarek!!")).toBe("koshary abou tarek");
  });
});

describe("synonyms + articles", () => {
  it("maps Egyptian/Levantine/English variants to one token", () => {
    expect(canon(norm("فلافل"))).toBe(canon(norm("طعمية")));
    expect(canon(norm("koshary"))).toBe(canon(norm("كشري")));
    expect(canon(norm("كشرى"))).toBe(canon(norm("كشري")));
    expect(canon(norm("هلق"))).toBe(canon(norm("دلوقتي")));
    expect(canon(norm("بدي"))).toBe(canon(norm("عايز")));
  });
  it("strips the article so الكشري ≈ كشري", () => {
    expect(tokens("الكشري")).toEqual(tokens("كشري"));
  });
});

describe("typo tolerance", () => {
  it("edit distance with transpositions and early exit", () => {
    expect(editDistance("pizza", "pizza")).toBe(0);
    expect(editDistance("piza", "pizza")).toBe(1);
    expect(editDistance("ipzza", "pizza")).toBe(1); // transposition
    expect(editDistance("abcdef", "uvwxyz", 2)).toBeGreaterThan(2);
  });
  it("fuzzyScore accepts small typos on longer words but not on short ones", () => {
    expect(fuzzyScore("كشري ابو طارك", "كشري أبو طارق")).toBeGreaterThan(0.6);
    expect(fuzzyScore("Koshary Abu Tarek", "Koshary Abou Tarek")).toBeGreaterThan(0.6);
    expect(fuzzyScore("ستاربكس", "ستاربكس")).toBe(1);
    expect(fuzzyScore("بن", "تين")).toBe(0);
  });
  it("hasPhrase tolerates a one-letter slip on long area names", () => {
    expect(hasPhrase(norm("عايز اكل في المهندسن"), "المهندسين")).toBe(true);
    expect(hasPhrase(norm("في الزمالك"), "زمالك")).toBe(true);
    expect(hasPhrase(norm("في المعادي"), "زمالك")).toBe(false);
  });
});
