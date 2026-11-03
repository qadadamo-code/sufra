/**
 * Units & conversions. Every stock item counts in one base unit (g, ml, pc); everything else is a multiple of it:
 * global units (kg = 1000 g, L = 1000 ml, dozen = 12 pc) plus the item's own packs (carton = 24 pc, sack 25 kg = 25 000 g,
 * tray = 30 eggs). Quantities keep at most 3 decimals so stock never drifts (0.001 g).
 */
import type { BaseUnit, PackUnit, StockItem } from "@/data/types";

export interface UnitDef {
  id: string;
  base: BaseUnit;
  factor: number;
  name: { ar: string; en: string };
}

export const GLOBAL_UNITS: UnitDef[] = [
  { id: "g", base: "g", factor: 1, name: { ar: "جم", en: "g" } },
  { id: "kg", base: "g", factor: 1000, name: { ar: "كجم", en: "kg" } },
  { id: "ml", base: "ml", factor: 1, name: { ar: "مل", en: "ml" } },
  { id: "L", base: "ml", factor: 1000, name: { ar: "لتر", en: "L" } },
  { id: "pc", base: "pc", factor: 1, name: { ar: "قطعة", en: "pc" } },
  { id: "dozen", base: "pc", factor: 12, name: { ar: "دستة", en: "dozen" } },
];

export const BASE_NAME: Record<BaseUnit, { ar: string; en: string }> = { g: { ar: "جم", en: "g" }, ml: { ar: "مل", en: "ml" }, pc: { ar: "قطعة", en: "pc" } };

/** Rounds to 3 decimals (milli-base units) — the precision every quantity is stored at. */
export const q3 = (n: number) => Math.round(n * 1000) / 1000;
/** Quantity → integer milli-base-units (what the finance cost math runs on). */
export const toMilli = (n: number) => Math.round(n * 1000);
export const fromMilli = (m: number) => m / 1000;

/** Units usable for an item: the global units of its base dimension + its own packs. */
export function unitsFor(item: Pick<StockItem, "baseUnit" | "packs">): UnitDef[] {
  const g = GLOBAL_UNITS.filter((u) => u.base === item.baseUnit);
  const own = item.packs.filter((p) => !g.some((x) => x.id === p.id)).map((p): UnitDef => ({ id: p.id, base: item.baseUnit, factor: p.factor, name: p.name }));
  return [...g, ...own];
}

export function unitDef(item: Pick<StockItem, "baseUnit" | "packs">, unitId: string): UnitDef {
  const u = unitsFor(item).find((x) => x.id === unitId);
  if (!u) throw new Error(`unit ${unitId} is not valid for this item (${item.baseUnit})`);
  return u;
}

/** Converts a quantity between two units of the same item (kg → g, carton → pc, g → kg …). */
export function convert(qty: number, from: string, to: string, item: Pick<StockItem, "baseUnit" | "packs">): number {
  const a = unitDef(item, from);
  const b = unitDef(item, to);
  if (a.base !== b.base) throw new Error(`cannot convert ${a.base} to ${b.base}`);
  return q3((qty * a.factor) / b.factor);
}

export const toBase = (qty: number, unit: string, item: Pick<StockItem, "baseUnit" | "packs">) => convert(qty, unit, item.baseUnit, item);
export const fromBase = (qty: number, unit: string, item: Pick<StockItem, "baseUnit" | "packs">) => convert(qty, item.baseUnit, unit, item);

/** The nicest unit to show a base quantity in: 2 500 g → 2.5 kg, 750 ml stays ml, 48 pc → 2 cartons when exact. */
export function bestUnit(qty: number, item: Pick<StockItem, "baseUnit" | "packs">): UnitDef {
  const abs = Math.abs(qty);
  const base = GLOBAL_UNITS.find((u) => u.id === item.baseUnit)!;
  if (item.baseUnit === "g" && abs >= 1000) return GLOBAL_UNITS.find((u) => u.id === "kg")!;
  if (item.baseUnit === "ml" && abs >= 1000) return GLOBAL_UNITS.find((u) => u.id === "L")!;
  return base;
}

const nf = (lang: "ar" | "en", max: number) => new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: max });

/** "2.5 كجم" / "2.5 kg" */
export function formatQty(qty: number, item: Pick<StockItem, "baseUnit" | "packs">, lang: "ar" | "en", unitId?: string): string {
  const u = unitId ? unitDef(item, unitId) : bestUnit(qty, item);
  const v = qty / u.factor;
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return `${nf(lang, digits).format(v)} ${u.name[lang]}`;
}

/** The pack an item is usually bought in (first own pack, else kg/L/pc). */
export function buyUnit(item: Pick<StockItem, "baseUnit" | "packs">): UnitDef {
  return unitsFor(item).find((u) => item.packs.some((p) => p.id === u.id)) ?? (item.baseUnit === "g" ? unitDef(item, "kg") : item.baseUnit === "ml" ? unitDef(item, "L") : unitDef(item, "pc"));
}

export const pack = (id: string, ar: string, en: string, factor: number): PackUnit => ({ id, name: { ar, en }, factor });
