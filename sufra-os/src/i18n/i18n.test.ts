import { describe, expect, it } from "vitest";
import { dict } from "./dict";
import { format, translate } from "./i18n";
import { modules } from "@/modules/registry";
import { ROLE_LABEL } from "@/auth/roles";

const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n coverage", () => {
  it("every key has Arabic and English with the same placeholders", () => {
    for (const [k, e] of Object.entries(dict) as [string, { ar: string; en: string }][]) {
      expect(e.ar.trim(), `${k}.ar`).not.toBe("");
      expect(e.en.trim(), `${k}.en`).not.toBe("");
      expect(vars(e.ar), `${k} placeholders`).toEqual(vars(e.en));
      expect(/[؀-ۿ]/.test(e.ar) || /^[\w\s#{}%.,:/()+-]*$/.test(e.ar), `${k}.ar should be Arabic`).toBe(true);
    }
  });

  it("module titles, descriptions, features and role labels are bilingual", () => {
    const loc: [string, { ar: string; en: string }][] = [];
    for (const m of modules) {
      loc.push([`${m.id}.title`, m.title], [`${m.id}.description`, m.description]);
      m.features?.forEach((f, i) => loc.push([`${m.id}.features.${i}`, f]));
      m.tabs?.forEach((f, i) => loc.push([`${m.id}.tabs.${i}`, f.title]));
    }
    for (const [r, l] of Object.entries(ROLE_LABEL)) loc.push([`role.${r}`, l]);
    for (const [k, e] of loc) {
      expect(e.ar.trim(), `${k}.ar`).not.toBe("");
      expect(e.en.trim(), `${k}.en`).not.toBe("");
    }
  });

  it("translate + format", () => {
    expect(translate("ar", "common.table", { n: 5 })).toBe("ترابيزة 5");
    expect(translate("en", "common.table", { n: 5 })).toBe("Table 5");
    expect(format("{a} {b}", { a: 1 })).toBe("1 {b}");
  });
});
