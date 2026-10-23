/**
 * Guest cart math. Pure functions — the same rules on the table QR page and the online ordering page.
 * Totals always go through @finance/tax (src/data/pricing.ts) so the cart shows exactly what the
 * server/POS will charge. The server re-prices every line from the menu; nothing here is trusted.
 */
import type { GuestMenu } from "@/data/repo";
import type { OrderItem, OrderMode, TaxSettings } from "@/data/types";
import { EMPTY_TOTALS, priceItems, type CheckTotals } from "@/data/pricing";
import type { Units } from "@/lib/money";

export type MenuItemView = GuestMenu["items"][number];

export interface CartLine {
  /** stable identity of (item + modifiers + notes) */
  key: string;
  itemId: string;
  qty: number;
  modifierIds: string[];
  notes: string;
}

export const MAX_QTY = 50;

export const lineKey = (itemId: string, modifierIds: string[], notes: string) => `${itemId}|${[...modifierIds].sort().join(",")}|${notes.trim()}`;

/** Full tax profile from what the public menu exposes (Egyptian defaults for the codes). */
export function taxFromPricing(p: GuestMenu["pricing"], extra: Partial<TaxSettings> = {}): TaxSettings {
  return {
    vatRegistered: p.vatRegistered,
    vatRate: p.vatRate,
    vatCode: { type: "T1", subType: "V009" },
    serviceRate: p.serviceRate,
    serviceModes: ["dine_in"],
    vatOnService: true,
    serviceCode: p.serviceRate ? { type: "T9", subType: "SC01" } : null,
    priceMode: p.priceMode,
    vatOnDelivery: true,
    taxDecimals: 2,
    taxId: "",
    commercialRegister: "",
    activityCode: "",
    ...extra,
  };
}

export function groupsFor(menu: GuestMenu, item: MenuItemView) {
  return item.modifierGroupIds
    .map((gid) => menu.modifierGroups.find((g) => g.id === gid))
    .filter((g): g is GuestMenu["modifierGroups"][number] => !!g)
    .map((g) => ({ ...g, options: menu.modifiers.filter((m) => m.groupId === g.id) }))
    .filter((g) => g.options.length > 0);
}

export function defaultModifiers(menu: GuestMenu, item: MenuItemView): string[] {
  return groupsFor(menu, item).flatMap((g) => {
    const defs = g.options.filter((o) => o.isDefault).slice(0, Math.max(1, g.max));
    if (defs.length) return defs.map((d) => d.id);
    return g.min > 0 ? g.options.slice(0, g.min).map((o) => o.id) : [];
  });
}

/** Toggle an option respecting the group's max (max 1 behaves like a radio). */
export function toggleModifier(menu: GuestMenu, item: MenuItemView, selected: string[], modifierId: string): string[] {
  const mod = menu.modifiers.find((m) => m.id === modifierId);
  const g = mod && groupsFor(menu, item).find((x) => x.id === mod.groupId);
  if (!mod || !g) return selected;
  const inGroup = selected.filter((id) => g.options.some((o) => o.id === id));
  if (selected.includes(modifierId)) {
    if (g.max === 1 && g.min >= 1) return selected; // a required radio cannot be cleared
    return selected.filter((id) => id !== modifierId);
  }
  if (g.max === 1) return [...selected.filter((id) => !inGroup.includes(id)), modifierId];
  if (inGroup.length >= g.max) return selected;
  return [...selected, modifierId];
}

/** Groups whose min/max is not met. */
export function invalidGroups(menu: GuestMenu, item: MenuItemView, selected: string[]): string[] {
  return groupsFor(menu, item)
    .filter((g) => {
      const n = selected.filter((id) => g.options.some((o) => o.id === id)).length;
      return n < g.min || n > g.max;
    })
    .map((g) => g.id);
}

export function unitPrice(menu: GuestMenu, itemId: string, modifierIds: string[]): Units {
  const it = menu.items.find((i) => i.id === itemId);
  if (!it) return 0;
  return it.price + modifierIds.reduce((a, id) => a + (menu.modifiers.find((m) => m.id === id)?.price ?? 0), 0);
}

export const lineTotal = (menu: GuestMenu, l: CartLine): Units => unitPrice(menu, l.itemId, l.modifierIds) * l.qty;

export const cartCount = (lines: CartLine[]) => lines.reduce((a, l) => a + l.qty, 0);
export const cartSubtotal = (menu: GuestMenu, lines: CartLine[]): Units => lines.reduce((a, l) => a + lineTotal(menu, l), 0);

/** Add (merging identical lines), clamped to MAX_QTY. */
export function addLine(lines: CartLine[], add: Omit<CartLine, "key">): CartLine[] {
  const key = lineKey(add.itemId, add.modifierIds, add.notes);
  const hit = lines.find((l) => l.key === key);
  if (hit) return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, l.qty + add.qty) } : l));
  return [...lines, { ...add, notes: add.notes.trim(), key, qty: Math.min(MAX_QTY, Math.max(1, add.qty)) }];
}

export function setQty(lines: CartLine[], key: string, qty: number): CartLine[] {
  if (qty <= 0) return lines.filter((l) => l.key !== key);
  return lines.map((l) => (l.key === key ? { ...l, qty: Math.min(MAX_QTY, qty) } : l));
}

/** Drop lines whose item disappeared or was 86'd (menu refreshed while the cart was open). */
export function pruneUnavailable(menu: GuestMenu, lines: CartLine[]): CartLine[] {
  return lines.filter((l) => menu.items.some((i) => i.id === l.itemId && i.available));
}

/** The cart as order-item rows, for @finance/tax pricing. */
export function cartAsItems(menu: GuestMenu, lines: CartLine[]): OrderItem[] {
  return lines.map((l, i) => {
    const it = menu.items.find((x) => x.id === l.itemId);
    return {
      id: `cart-${i}`,
      itemId: l.itemId,
      qty: l.qty,
      unitPrice: it?.price ?? 0,
      modifiers: l.modifierIds.map((id) => {
        const m = menu.modifiers.find((x) => x.id === id);
        return { groupId: m?.groupId ?? "", modifierId: id, name: m?.name ?? { ar: "", en: "" }, price: m?.price ?? 0 };
      }),
      status: "new",
      discount: 0,
      stationId: null,
    } as unknown as OrderItem;
  });
}

export function cartTotals(menu: GuestMenu, lines: CartLine[], opts: { mode: OrderMode; tax: TaxSettings; deliveryFee?: Units }): CheckTotals {
  if (!lines.length) return { ...EMPTY_TOTALS, deliveryFee: opts.deliveryFee ?? 0 };
  return priceItems(cartAsItems(menu, lines), { mode: opts.mode, tax: opts.tax, deliveryFee: opts.deliveryFee }).totals;
}

/* ───────── persistence (per restaurant + table/online) ───────── */

const cartKey = (slug: string, scope: string) => `sufra-guest.cart.${slug}.${scope}`;

export function loadCart(slug: string, scope: string): CartLine[] {
  try {
    const raw = localStorage.getItem(cartKey(slug, scope));
    const v = raw ? (JSON.parse(raw) as CartLine[]) : [];
    return Array.isArray(v) ? v.filter((l) => l && typeof l.itemId === "string" && Number.isInteger(l.qty)) : [];
  } catch {
    return [];
  }
}
export function saveCart(slug: string, scope: string, lines: CartLine[]) {
  try {
    if (lines.length) localStorage.setItem(cartKey(slug, scope), JSON.stringify(lines));
    else localStorage.removeItem(cartKey(slug, scope));
  } catch {
    /* private mode */
  }
}
