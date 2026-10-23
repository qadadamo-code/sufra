import { describe, expect, it } from "vitest";
import { buildSeed } from "@/data/seed";
import type { GuestMenu } from "@/data/repo";
import { major } from "@/lib/money";
import { addLine, cartCount, cartSubtotal, cartTotals, defaultModifiers, invalidGroups, lineKey, setQty, taxFromPricing, toggleModifier, unitPrice, pruneUnavailable } from "./cart";

function demoMenu(): GuestMenu {
  const s = buildSeed(new Date("2026-10-23T18:00:00Z")).data;
  const st = s.settings[0];
  return {
    restaurant: { id: s.restaurants[0].id, slug: s.restaurants[0].slug, name: s.restaurants[0].name, currency: "EGP", brandColor: "#0d5a53" },
    branch: null,
    table: null,
    categories: s.menuCategories.map((c) => ({ id: c.id, name: c.name, sort: c.sort, icon: c.icon })),
    items: s.menuItems.map((i) => ({ id: i.id, categoryId: i.categoryId, name: i.name, description: i.description, price: i.price, tags: i.tags, available: i.available, modifierGroupIds: i.modifierGroupIds, imageUrl: i.imageUrl })),
    modifierGroups: s.modifierGroups.map((g) => ({ id: g.id, name: g.name, min: g.min, max: g.max })),
    modifiers: s.modifiers.map((m) => ({ id: m.id, groupId: m.groupId, name: m.name, price: m.price, isDefault: m.isDefault })),
    qrOrdering: { enabled: true, allowServiceCalls: true },
    pricing: { priceMode: st.tax.priceMode, serviceRate: st.tax.serviceRate, vatRate: st.tax.vatRate, vatRegistered: st.tax.vatRegistered },
  };
}

const menu = demoMenu();
const byName = (en: string) => menu.items.find((i) => i.name.en === en)!;
const mod = (en: string) => menu.modifiers.find((m) => m.name.en === en)!;
const tax = taxFromPricing(menu.pricing);

describe("guest cart", () => {
  it("defaults pick the default option of each required group", () => {
    const kofta = byName("Grilled kofta"); // portion (req) + side (req) + spice (opt, default) + extras
    const d = defaultModifiers(menu, kofta);
    expect(d).toContain(mod("¼ kg").id);
    expect(d).toContain(mod("Vermicelli rice").id);
    expect(invalidGroups(menu, kofta, d)).toEqual([]);
  });

  it("radio groups swap, multi groups respect max, required radios can't be cleared", () => {
    const kofta = byName("Grilled kofta");
    let sel = defaultModifiers(menu, kofta);
    sel = toggleModifier(menu, kofta, sel, mod("½ kg").id);
    expect(sel).toContain(mod("½ kg").id);
    expect(sel).not.toContain(mod("¼ kg").id);
    expect(toggleModifier(menu, kofta, sel, mod("½ kg").id)).toEqual(sel);
    for (const n of ["Extra tahini", "Garlic sauce", "Extra bread", "Roumy cheese"]) sel = toggleModifier(menu, kofta, sel, mod(n).id);
    expect(sel.filter((id) => menu.modifiers.find((m) => m.id === id)?.groupId === mod("Extra tahini").groupId)).toHaveLength(4);
    expect(invalidGroups(menu, kofta, sel.filter((id) => id !== mod("Vermicelli rice").id))).toEqual([mod("Vermicelli rice").groupId]);
  });

  it("unit price adds modifiers; identical lines merge; qty is clamped", () => {
    const kofta = byName("Grilled kofta");
    const mods = [mod("½ kg").id, mod("Freekeh").id];
    expect(unitPrice(menu, kofta.id, mods)).toBe(major(345 + 330 + 35));
    let c = addLine([], { itemId: kofta.id, qty: 2, modifierIds: mods, notes: "no onion " });
    c = addLine(c, { itemId: kofta.id, qty: 1, modifierIds: [...mods].reverse(), notes: "no onion" });
    expect(c).toHaveLength(1);
    expect(c[0].key).toBe(lineKey(kofta.id, mods, "no onion"));
    expect(cartCount(c)).toBe(3);
    expect(cartSubtotal(menu, c)).toBe(major(710 * 3));
    c = addLine(c, { itemId: kofta.id, qty: 1, modifierIds: mods, notes: "" });
    expect(c).toHaveLength(2);
    expect(setQty(c, c[0].key, 99)[0].qty).toBe(50);
    expect(setQty(c, c[0].key, 0)).toHaveLength(1);
  });

  it("totals go through @finance/tax: 12% service + 14% VAT on (net + service) for dine-in", () => {
    const tea = byName("Tea"); // 45
    const c = addLine([], { itemId: tea.id, qty: 2, modifierIds: [mod("Medium").id], notes: "" });
    const t = cartTotals(menu, c, { mode: "dine_in", tax });
    expect(t.subtotal).toBe(major(90));
    expect(t.service).toBe(major(10.8));
    expect(t.vat).toBe(major("14.11")); // taxDecimals 2
    expect(t.total).toBe(major("114.91"));
  });

  it("takeaway has no service; delivery adds the zone fee (+VAT on delivery)", () => {
    const hummus = byName("Hummus"); // 95
    const c = addLine([], { itemId: hummus.id, qty: 1, modifierIds: [], notes: "" });
    const ta = cartTotals(menu, c, { mode: "takeaway", tax });
    expect(ta.service).toBe(0);
    expect(ta.total).toBe(major("108.30"));
    const dl = cartTotals(menu, c, { mode: "delivery", tax, deliveryFee: major(25) });
    expect(dl.deliveryFee).toBe(major(25));
    expect(dl.total).toBe(major("136.80"));
  });

  it("drops 86'd items when the menu refreshes", () => {
    const pigeon = menu.items.find((i) => !i.available)!;
    const c = addLine(addLine([], { itemId: pigeon.id, qty: 1, modifierIds: [], notes: "" }), { itemId: byName("Tea").id, qty: 1, modifierIds: [], notes: "" });
    expect(pruneUnavailable(menu, c).map((l) => l.itemId)).toEqual([byName("Tea").id]);
  });
});
