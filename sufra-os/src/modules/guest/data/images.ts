/**
 * Food photography for the guest menu.
 *
 * The demo seed ships `imageUrl: null`, so until the menu module lets owners upload photos we map
 * seed dishes to the CC-licensed photos in public/img (credits in public/img/credits.json).
 * A real `imageUrl` on the item always wins.
 */
const BASE = (typeof import.meta !== "undefined" && (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL) || "/app/";

export const img = (file: string) => `${BASE}img/${file}`;

/** keyed by the item's English name (lower-case) — stable across seeds and languages */
const BY_NAME: Record<string, string> = {
  "grilled kofta": "dish-kofta",
  "lamb chops": "dish-steak",
  "shish tawook": "dish-shish-tawook",
  "half grilled chicken": "dish-fried-chicken",
  "mixed grill for two": "dish-mixed-grill",
  "molokhia with chicken": "dish-molokhia",
  "beef fattah": "dish-fattah",
  "macaroni béchamel": "dish-lasagna",
  "mixed mahshi": "dish-mahshi",
  "baladi salad": "dish-greek-salad",
  "baba ghanoush": "dish-baba-ghanoush",
  "rocket salad": "dish-tabbouleh",
  fattoush: "dish-fattoush",
  hummus: "dish-hummus",
  taameya: "dish-falafel",
  fries: "dish-fries",
  kobeba: "dish-kibbeh",
  "orzo soup": "dish-soup",
  "om ali": "dish-om-ali",
  "kunafa with cream": "dish-kunafa",
  "basbousa with cream": "dish-basbousa",
  tea: "dish-tea",
  "turkish coffee": "dish-espresso",
  "instant coffee": "dish-latte",
  cappuccino: "dish-cappuccino",
  sahlab: "dish-sahlab",
  "lemon mint": "dish-lemonade",
  "mango juice": "dish-fresh-juice",
  "strawberry juice": "dish-smoothie",
  "okra & beef tagine": "dish-ful-medames",
};

export function itemImage(item: { imageUrl: string | null; name: { en: string } }): string | null {
  if (item.imageUrl) return item.imageUrl;
  const k = BY_NAME[item.name.en.trim().toLowerCase()];
  return k ? img(`${k}.webp`) : null;
}

export const HERO_IMAGE = img("venue-restaurant-4.webp");
export const TABLE_IMAGE = img("venue-levant-2.webp");
