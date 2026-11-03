/**
 * Menu engineering (Kasavana & Smith): each item by popularity (share of portions sold) and contribution margin
 * (net price − recipe cost).
 *   popular   = sold ≥ 70% of an equal share (0.7 × total ÷ number of items)
 *   profitable = contribution ≥ the menu's sales-weighted average contribution
 *   ⭐ star (popular + profitable) · 🐴 plowhorse (popular, low margin) · 🧩 puzzle (profitable, not popular) · 🐶 dog (neither)
 */
import type { Units } from "@/lib/money";

export type EngClass = "star" | "plowhorse" | "puzzle" | "dog";
export interface EngInput {
  id: string;
  qty: number;
  /** contribution per portion */
  contribution: Units;
}
export interface EngRow extends EngInput {
  cls: EngClass;
  mixBp: number;
  totalContribution: Units;
}

export function classify(rows: EngInput[]): { rows: EngRow[]; popularityCut: number; avgContribution: Units } {
  const n = rows.length || 1;
  const total = rows.reduce((a, r) => a + r.qty, 0);
  const popularityCut = (0.7 * total) / n;
  const avgContribution = total ? Math.round(rows.reduce((a, r) => a + r.contribution * r.qty, 0) / total) : 0;
  return {
    popularityCut,
    avgContribution,
    rows: rows.map((r) => {
      const popular = r.qty >= popularityCut && r.qty > 0;
      const profitable = r.contribution >= avgContribution;
      const cls: EngClass = popular ? (profitable ? "star" : "plowhorse") : profitable ? "puzzle" : "dog";
      return { ...r, cls, mixBp: total ? Math.round((r.qty * 10_000) / total) : 0, totalContribution: r.contribution * r.qty };
    }),
  };
}

export const ENG_LABEL: Record<EngClass, { ar: string; en: string; tip: { ar: string; en: string }; tone: "ok" | "info" | "brass" | "danger" }> = {
  star: { ar: "نجوم", en: "Stars", tone: "ok", tip: { ar: "حافظ عليها وخليها ظاهرة", en: "Keep them prominent; protect quality" } },
  plowhorse: { ar: "خيول شغل", en: "Plowhorses", tone: "info", tip: { ar: "بتتباع كتير وهامشها قليل: زوّد السعر شوية أو قلّل التكلفة", en: "Popular, thin margin: nudge the price or cut the cost" } },
  puzzle: { ar: "ألغاز", en: "Puzzles", tone: "brass", tip: { ar: "مربحة ومش بتتطلب: حطها في مكان أحسن أو خلي الجرسون يرشحها", en: "Profitable but slow: better placement, staff recommendation" } },
  dog: { ar: "ضعيفة", en: "Dogs", tone: "danger", tip: { ar: "فكّر تشيلها أو تعيد تصميمها", en: "Consider removing or reworking" } },
};
