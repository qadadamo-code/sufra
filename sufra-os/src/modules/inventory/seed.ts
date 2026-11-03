/**
 * Demo inventory for "مطعم سُفرة – الزمالك": ~90 ingredients and 8 prep items (sub-recipes) with realistic 2026 Cairo
 * wholesale costs (the supplier marketplace's prices where it carries the item), recipes for all 47 menu items and the
 * modifiers that change what's used (sides, extra cheese 30 g, sugar, double coffee, large juices), four storage
 * locations, 9 suppliers (8 linked to the marketplace), a week of sales at recipe cost, waste, two suppliers' purchase
 * order history (paid → invoiced → received → sent → draft, one price rise), and a fridge count from two days ago with
 * variance. Today's fired POS/QR lines are deducted exactly like the live hook does (refType "order_item").
 *
 * Built by SIMULATING the history with the real costing functions (receive / consume / count at weighted average),
 * so the stored positions equal opening + every move — the reports add up.
 */
import type {
  CountLine, GoodsReceipt, Localized, MenuItem, Modifier, OrderItem, PoLine, PurchaseOrder, Recipe, RecipeLine, StockAccount, StockBatch, StockCategory, StockCount, StockItem,
  StockLevel, StockMove, StorageLocation, Supplier, SupplierInvoice, SupplierItem, SupplierPayment, WasteReason, BaseUnit, MoveKind, PackUnit,
} from "@/data/types";
import { pctOf, type Units } from "@/lib/money";
import { consume, countTo, receive, type Position } from "./costing";
import { explodeContext, explodeLine } from "./explode";
import { commissionUnits } from "./purchasing";
import { planOf, SUPPLIER_PLANS } from "./marketplace/plans";
import { supplierById } from "./marketplace/suppliers";
import { q3 } from "./units";
import { seedId } from "@/lib/id";

const L = (ar: string, en: string): Localized => ({ ar, en });
const EGP = 100_000;

export interface InventorySeedCtx {
  restaurantId: string;
  branchId: string;
  now: Date;
  T: (minutesAgo: number) => string;
  id: (k: string) => string;
  staffId: (k: string) => string;
  created: string;
  menuItems: MenuItem[];
  modifiers: Modifier[];
  orderItems: OrderItem[];
}

/* ───────── catalogue ───────── */

type Loc = "store" | "kitchen" | "fridge" | "bar";
type Sup = "butcher" | "poultry" | "produce" | "dairy" | "grocer" | "spice" | "bakery" | "drinks" | "tea" | "pack";
interface Def {
  k: string;
  ar: string;
  en: string;
  cat: StockCategory;
  base: BaseUnit;
  /** buy pack: [id, ar, en, base units per pack] */
  pack: [string, string, string, number];
  /** EGP per pack, net */
  price: number;
  sup: Sup;
  loc: Loc;
  vat?: 0 | 14;
  acc?: StockAccount;
  batch?: number;
  yieldBp?: number;
  market?: string;
  allergens?: string[];
}
const KG: [string, string, string, number] = ["kg", "كيلو", "kg", 1000];
const LT: [string, string, string, number] = ["L", "لتر", "L", 1000];
const PC: [string, string, string, number] = ["pc", "قطعة", "piece", 1];
const BUNCH: [string, string, string, number] = ["bunch", "ربطة", "bunch", 1];

const DEFS: Def[] = [
  // meat & poultry — the butcher (marketplace s04) / poultry (s05)
  { k: "lamb", ar: "لحم ضاني", en: "Lamb", cat: "meat", base: "g", pack: KG, price: 480, sup: "butcher", loc: "fridge", vat: 0, batch: 8, yieldBp: 8500, market: "lamb" },
  { k: "lamb-chops", ar: "ريش ضاني", en: "Lamb chops", cat: "meat", base: "g", pack: KG, price: 620, sup: "butcher", loc: "fridge", vat: 0, batch: 8 },
  { k: "lamb-mince", ar: "لحم ضاني مفروم", en: "Minced lamb", cat: "meat", base: "g", pack: KG, price: 460, sup: "butcher", loc: "fridge", vat: 0, batch: 5 },
  { k: "beef-mince", ar: "لحم بقري مفروم", en: "Minced beef", cat: "meat", base: "g", pack: KG, price: 390, sup: "butcher", loc: "fridge", vat: 0, batch: 6, market: "beef-mince" },
  { k: "veal", ar: "لحم بتلو", en: "Veal", cat: "meat", base: "g", pack: KG, price: 450, sup: "butcher", loc: "fridge", vat: 0, batch: 9, market: "beef-topside" },
  { k: "beef-shank", ar: "موزة بقري", en: "Beef shank", cat: "meat", base: "g", pack: KG, price: 420, sup: "butcher", loc: "fridge", vat: 0, batch: 8 },
  { k: "lamb-fat", ar: "لية ضاني", en: "Lamb tail fat", cat: "meat", base: "g", pack: KG, price: 150, sup: "butcher", loc: "fridge", vat: 0 },
  { k: "mombar", ar: "ممبار نظيف", en: "Cleaned casings", cat: "meat", base: "g", pack: KG, price: 200, sup: "butcher", loc: "fridge", vat: 0, batch: 6 },
  { k: "chicken", ar: "فراخ بلدي", en: "Whole chicken", cat: "meat", base: "g", pack: KG, price: 110, sup: "poultry", loc: "fridge", vat: 0, batch: 3, market: "chicken-whole" },
  { k: "chicken-breast", ar: "صدور فراخ فيليه", en: "Chicken breast", cat: "meat", base: "g", pack: KG, price: 210, sup: "poultry", loc: "fridge", vat: 0, batch: 3, market: "chicken-breast" },
  { k: "pigeon", ar: "حمام بلدي", en: "Pigeon", cat: "meat", base: "pc", pack: PC, price: 120, sup: "poultry", loc: "fridge", vat: 0, batch: 3 },
  // produce — Nile Valley Produce (marketplace s01)
  { k: "tomato", ar: "طماطم", en: "Tomatoes", cat: "produce", base: "g", pack: ["crate", "قفص 20 كجم", "20 kg crate", 20000], price: 340, sup: "produce", loc: "kitchen", vat: 0, market: "tomato" },
  { k: "onion", ar: "بصل أحمر", en: "Red onions", cat: "produce", base: "g", pack: ["sack25", "شيكارة 25 كجم", "25 kg sack", 25000], price: 450, sup: "produce", loc: "store", vat: 0, market: "onion" },
  { k: "potato", ar: "بطاطس", en: "Potatoes", cat: "produce", base: "g", pack: ["sack25", "شيكارة 25 كجم", "25 kg sack", 25000], price: 425, sup: "produce", loc: "store", vat: 0, yieldBp: 8500, market: "potato" },
  { k: "cucumber", ar: "خيار", en: "Cucumbers", cat: "produce", base: "g", pack: KG, price: 22, sup: "produce", loc: "kitchen", vat: 0, market: "cucumber" },
  { k: "pepper", ar: "فلفل رومي ألوان", en: "Bell peppers", cat: "produce", base: "g", pack: KG, price: 60, sup: "produce", loc: "kitchen", vat: 0, market: "pepper" },
  { k: "chili", ar: "فلفل حامي", en: "Hot chillies", cat: "produce", base: "g", pack: KG, price: 40, sup: "produce", loc: "kitchen", vat: 0, market: "chili" },
  { k: "lemon", ar: "ليمون بلدي", en: "Baladi lemons", cat: "produce", base: "g", pack: KG, price: 45, sup: "produce", loc: "kitchen", vat: 0, market: "lemon" },
  { k: "garlic", ar: "ثوم بلدي", en: "Garlic", cat: "produce", base: "g", pack: KG, price: 95, sup: "produce", loc: "kitchen", vat: 0, yieldBp: 9000, market: "garlic" },
  { k: "carrot", ar: "جزر", en: "Carrots", cat: "produce", base: "g", pack: KG, price: 15, sup: "produce", loc: "kitchen", vat: 0, market: "carrot" },
  { k: "zucchini", ar: "كوسة", en: "Zucchini", cat: "produce", base: "g", pack: KG, price: 25, sup: "produce", loc: "kitchen", vat: 0, market: "zucchini" },
  { k: "eggplant", ar: "باذنجان رومي", en: "Eggplant", cat: "produce", base: "g", pack: KG, price: 18, sup: "produce", loc: "kitchen", vat: 0, market: "eggplant" },
  { k: "parsley", ar: "بقدونس", en: "Parsley", cat: "produce", base: "pc", pack: ["bunch10", "10 ربطات", "10 bunches", 10], price: 40, sup: "produce", loc: "kitchen", vat: 0, market: "parsley" },
  { k: "coriander", ar: "كزبرة خضرا", en: "Coriander", cat: "produce", base: "pc", pack: ["bunch10", "10 ربطات", "10 bunches", 10], price: 40, sup: "produce", loc: "kitchen", vat: 0 },
  { k: "dill", ar: "شبت", en: "Dill", cat: "produce", base: "pc", pack: ["bunch10", "10 ربطات", "10 bunches", 10], price: 40, sup: "produce", loc: "kitchen", vat: 0 },
  { k: "mint", ar: "نعناع", en: "Fresh mint", cat: "produce", base: "pc", pack: ["bunch10", "10 ربطات", "10 bunches", 10], price: 50, sup: "produce", loc: "bar", vat: 0, market: "mint" },
  { k: "rocket", ar: "جرجير", en: "Rocket", cat: "produce", base: "pc", pack: ["bunch10", "10 ربطات", "10 bunches", 10], price: 50, sup: "produce", loc: "kitchen", vat: 0 },
  { k: "rosemary", ar: "روزماري", en: "Rosemary", cat: "produce", base: "pc", pack: BUNCH, price: 6, sup: "produce", loc: "kitchen", vat: 0 },
  { k: "lettuce", ar: "خس بلدي", en: "Romaine lettuce", cat: "produce", base: "pc", pack: ["carton12", "كرتونة 12 رأس", "12 heads", 12], price: 150, sup: "produce", loc: "kitchen", vat: 0, market: "lettuce" },
  { k: "molokhia", ar: "ملوخية خضرا", en: "Fresh molokhia", cat: "produce", base: "g", pack: KG, price: 30, sup: "produce", loc: "fridge", vat: 0, market: "molokhia" },
  { k: "okra", ar: "بامية زيرو مجمدة", en: "Frozen baby okra", cat: "produce", base: "g", pack: ["bag400", "كيس 400 جم", "400 g bag", 400], price: 28, sup: "grocer", loc: "fridge", vat: 14 },
  { k: "cabbage", ar: "كرنب", en: "Cabbage", cat: "produce", base: "pc", pack: PC, price: 20, sup: "produce", loc: "kitchen", vat: 0, market: "cabbage" },
  { k: "vine-leaves", ar: "ورق عنب", en: "Vine leaves", cat: "produce", base: "g", pack: KG, price: 160, sup: "produce", loc: "fridge", vat: 0 },
  { k: "mango", ar: "مانجو عويس", en: "Awees mango", cat: "produce", base: "g", pack: KG, price: 70, sup: "produce", loc: "bar", vat: 0, yieldBp: 7000, market: "mango" },
  { k: "strawberry", ar: "فراولة", en: "Strawberries", cat: "produce", base: "g", pack: KG, price: 50, sup: "produce", loc: "bar", vat: 0, market: "strawberry" },
  // dairy — Oasis Dairy (marketplace s09)
  { k: "milk", ar: "لبن كامل الدسم", en: "Full-cream milk", cat: "dairy", base: "ml", pack: ["carton12L", "كرتونة 12 × 1 لتر", "12 × 1 L", 12000], price: 540, sup: "dairy", loc: "fridge", vat: 0, batch: 5, market: "milk", allergens: ["milk"] },
  { k: "butter", ar: "زبدة بلدي", en: "Butter", cat: "dairy", base: "g", pack: ["carton10kg", "كرتونة 10 كجم", "10 kg carton", 10000], price: 2700, sup: "dairy", loc: "fridge", vat: 14, market: "butter", allergens: ["milk"] },
  { k: "cream", ar: "قشطة بلدي", en: "Clotted cream (eshta)", cat: "dairy", base: "g", pack: KG, price: 200, sup: "dairy", loc: "fridge", vat: 14, batch: 4, allergens: ["milk"] },
  { k: "cooking-cream", ar: "كريمة طبخ", en: "Cooking cream", cat: "dairy", base: "ml", pack: ["carton12L", "كرتونة 12 × 1 لتر", "12 × 1 L", 12000], price: 1450, sup: "dairy", loc: "fridge", vat: 14, market: "cooking-cream", allergens: ["milk"] },
  { k: "yogurt", ar: "زبادي 105 جم", en: "Yogurt 105 g", cat: "dairy", base: "pc", pack: ["carton24", "كرتونة 24 علبة", "24 cups", 24], price: 192, sup: "dairy", loc: "fridge", vat: 0, batch: 10, market: "yogurt", allergens: ["milk"] },
  { k: "white-cheese", ar: "جبنة بيضا", en: "White cheese", cat: "dairy", base: "g", pack: KG, price: 135, sup: "dairy", loc: "fridge", vat: 14, allergens: ["milk"] },
  { k: "roumi", ar: "جبنة رومي", en: "Roumi cheese", cat: "dairy", base: "g", pack: KG, price: 380, sup: "dairy", loc: "fridge", vat: 14, market: "roumi", allergens: ["milk"] },
  { k: "eggs", ar: "بيض أبيض", en: "White eggs", cat: "dairy", base: "pc", pack: ["tray30", "طبق 30 بيضة", "30 eggs", 30], price: 165, sup: "dairy", loc: "fridge", vat: 0, market: "eggs", allergens: ["egg"] },
  { k: "ghee", ar: "سمنة بلدي", en: "Baladi ghee", cat: "dairy", base: "g", pack: KG, price: 280, sup: "dairy", loc: "store", vat: 14, allergens: ["milk"] },
  // dry grocery — Egyptian Wholesale Grocers (marketplace s12)
  { k: "rice", ar: "أرز مصري", en: "Egyptian rice", cat: "dry", base: "g", pack: ["sack25", "شيكارة 25 كجم", "25 kg sack", 25000], price: 850, sup: "grocer", loc: "store", vat: 14, market: "rice" },
  { k: "vermicelli", ar: "شعرية", en: "Vermicelli", cat: "dry", base: "g", pack: ["carton20", "كرتونة 20 كيس", "20 × 400 g", 8000], price: 330, sup: "grocer", loc: "store", vat: 14, market: "vermicelli", allergens: ["gluten"] },
  { k: "pasta", ar: "مكرونة قلم", en: "Penne pasta", cat: "dry", base: "g", pack: ["carton20", "كرتونة 20 كيس", "20 × 400 g", 8000], price: 360, sup: "grocer", loc: "store", vat: 14, market: "pasta", allergens: ["gluten"] },
  { k: "orzo", ar: "لسان عصفور", en: "Orzo", cat: "dry", base: "g", pack: ["carton20", "كرتونة 20 كيس", "20 × 400 g", 8000], price: 320, sup: "grocer", loc: "store", vat: 14, allergens: ["gluten"] },
  { k: "flour", ar: "دقيق فاخر", en: "Premium flour", cat: "dry", base: "g", pack: ["sack50", "شيكارة 50 كجم", "50 kg sack", 50000], price: 1350, sup: "grocer", loc: "store", vat: 14, market: "flour", allergens: ["gluten"] },
  { k: "semolina", ar: "سميد", en: "Semolina", cat: "dry", base: "g", pack: ["sack25", "شيكارة 25 كجم", "25 kg sack", 25000], price: 900, sup: "grocer", loc: "store", vat: 14, market: "semolina", allergens: ["gluten"] },
  { k: "sugar", ar: "سكر أبيض", en: "White sugar", cat: "dry", base: "g", pack: ["sack50", "شيكارة 50 كجم", "50 kg sack", 50000], price: 1700, sup: "grocer", loc: "store", vat: 14, market: "sugar" },
  { k: "salt", ar: "ملح طعام", en: "Table salt", cat: "dry", base: "g", pack: ["carton25", "كرتونة 25 كيس كيلو", "25 × 1 kg", 25000], price: 175, sup: "grocer", loc: "store", vat: 14, market: "salt" },
  { k: "oil", ar: "زيت عباد الشمس", en: "Sunflower oil", cat: "dry", base: "ml", pack: ["jerry20", "جركن 20 لتر", "20 L jerrycan", 20000], price: 1550, sup: "grocer", loc: "store", vat: 14, market: "sunflower" },
  { k: "olive-oil", ar: "زيت زيتون بكر", en: "Extra-virgin olive oil", cat: "dry", base: "ml", pack: ["jerry5", "جركن 5 لتر", "5 L jerrycan", 5000], price: 1600, sup: "grocer", loc: "store", vat: 14, market: "olive-oil" },
  { k: "veg-ghee", ar: "سمن نباتي", en: "Vegetable ghee", cat: "dry", base: "g", pack: ["tin16", "صفيحة 16 كجم", "16 kg tin", 16000], price: 1450, sup: "grocer", loc: "store", vat: 14, market: "ghee" },
  { k: "fava", ar: "فول مدشوش للطعمية", en: "Split fava (taameya)", cat: "dry", base: "g", pack: ["sack25", "شيكارة 25 كجم", "25 kg sack", 25000], price: 1000, sup: "grocer", loc: "store", vat: 14, market: "fava" },
  { k: "chickpeas", ar: "حمص الشام", en: "Chickpeas", cat: "dry", base: "g", pack: ["sack25", "شيكارة 25 كجم", "25 kg sack", 25000], price: 1375, sup: "grocer", loc: "store", vat: 14, market: "chickpeas" },
  { k: "tahini", ar: "طحينة", en: "Tahini", cat: "dry", base: "g", pack: ["tub10", "جردل 10 كجم", "10 kg tub", 10000], price: 1350, sup: "grocer", loc: "store", vat: 14, market: "tahini", allergens: ["sesame"] },
  { k: "tomato-paste", ar: "صلصة طماطم", en: "Tomato paste", cat: "dry", base: "g", pack: ["carton24", "كرتونة 24 علبة 360 جم", "24 × 360 g", 8640], price: 650, sup: "grocer", loc: "store", vat: 14, market: "tomato-paste" },
  { k: "freekeh", ar: "فريك", en: "Freekeh", cat: "dry", base: "g", pack: KG, price: 90, sup: "grocer", loc: "store", vat: 14, allergens: ["gluten"] },
  { k: "bulgur", ar: "برغل", en: "Bulgur", cat: "dry", base: "g", pack: KG, price: 45, sup: "grocer", loc: "store", vat: 14, allergens: ["gluten"] },
  { k: "kunafa-dough", ar: "كنافة شعر", en: "Kunafa dough", cat: "bakery", base: "g", pack: KG, price: 70, sup: "grocer", loc: "fridge", vat: 14, market: "kunafa", allergens: ["gluten"] },
  { k: "rokak", ar: "رقاق", en: "Rokak pastry sheets", cat: "bakery", base: "g", pack: KG, price: 90, sup: "bakery", loc: "store", vat: 14, allergens: ["gluten"] },
  { k: "starch", ar: "نشا", en: "Corn starch", cat: "dry", base: "g", pack: KG, price: 60, sup: "grocer", loc: "store", vat: 14 },
  { k: "nuts", ar: "مكسرات مشكلة", en: "Mixed nuts", cat: "dry", base: "g", pack: KG, price: 720, sup: "grocer", loc: "store", vat: 14, market: "nuts", allergens: ["nuts"] },
  { k: "raisins", ar: "زبيب", en: "Raisins", cat: "dry", base: "g", pack: KG, price: 200, sup: "grocer", loc: "store", vat: 14 },
  { k: "coconut", ar: "جوز هند مبشور", en: "Desiccated coconut", cat: "dry", base: "g", pack: KG, price: 250, sup: "grocer", loc: "store", vat: 14 },
  { k: "molasses", ar: "دبس رمان", en: "Pomegranate molasses", cat: "dry", base: "ml", pack: LT, price: 200, sup: "grocer", loc: "store", vat: 14 },
  { k: "vinegar", ar: "خل أبيض", en: "White vinegar", cat: "dry", base: "ml", pack: LT, price: 25, sup: "grocer", loc: "store", vat: 14 },
  { k: "rose-water", ar: "ماء ورد", en: "Rose water", cat: "dry", base: "ml", pack: LT, price: 80, sup: "grocer", loc: "store", vat: 14 },
  { k: "vanilla", ar: "فانيليا بودرة", en: "Vanilla powder", cat: "dry", base: "g", pack: KG, price: 600, sup: "grocer", loc: "store", vat: 14 },
  // spices — The Spice House (marketplace s14)
  { k: "cumin", ar: "كمون مطحون", en: "Ground cumin", cat: "spices", base: "g", pack: KG, price: 380, sup: "spice", loc: "store", vat: 14, market: "cumin" },
  { k: "black-pepper", ar: "فلفل أسود", en: "Black pepper", cat: "spices", base: "g", pack: KG, price: 520, sup: "spice", loc: "store", vat: 14, market: "black-pepper" },
  { k: "cinnamon", ar: "قرفة", en: "Cinnamon", cat: "spices", base: "g", pack: KG, price: 400, sup: "spice", loc: "store", vat: 14 },
  { k: "sumac", ar: "سماق", en: "Sumac", cat: "spices", base: "g", pack: KG, price: 300, sup: "spice", loc: "store", vat: 14 },
  { k: "spices", ar: "بهارات مشكلة", en: "Seven spices", cat: "spices", base: "g", pack: KG, price: 450, sup: "spice", loc: "store", vat: 14 },
  { k: "cardamom", ar: "حبهان", en: "Cardamom", cat: "spices", base: "g", pack: KG, price: 1400, sup: "spice", loc: "bar", vat: 14 },
  // bakery — the baladi bakery next door (direct, not on the marketplace)
  { k: "baladi-bread", ar: "عيش بلدي", en: "Baladi bread", cat: "bakery", base: "pc", pack: ["bag10", "كيس 10 أرغفة", "bag of 10", 10], price: 15, sup: "bakery", loc: "kitchen", vat: 0, allergens: ["gluten"] },
  { k: "shami-bread", ar: "عيش شامي", en: "Pita bread", cat: "bakery", base: "pc", pack: ["bag10", "كيس 10 أرغفة", "bag of 10", 10], price: 20, sup: "bakery", loc: "kitchen", vat: 0, allergens: ["gluten"] },
  // drinks — Cairo Beverage Distribution (s16), Al-Attar Tea & Herbs (s18)
  { k: "tea", ar: "شاي ناعم", en: "Loose black tea", cat: "drinks", base: "g", pack: KG, price: 260, sup: "tea", loc: "bar", vat: 14, acc: "beverage", market: "tea-loose" },
  { k: "turkish-coffee", ar: "بن تركي محوج", en: "Turkish coffee", cat: "drinks", base: "g", pack: KG, price: 780, sup: "tea", loc: "bar", vat: 14, acc: "beverage", market: "turkish" },
  { k: "espresso", ar: "بلند إسبريسو", en: "Espresso blend", cat: "drinks", base: "g", pack: KG, price: 1100, sup: "tea", loc: "bar", vat: 14, acc: "beverage", market: "espresso-blend" },
  { k: "instant-coffee", ar: "نسكافيه جولد", en: "Instant coffee", cat: "drinks", base: "g", pack: ["jar200", "برطمان 200 جم", "200 g jar", 200], price: 240, sup: "drinks", loc: "bar", vat: 14, acc: "beverage" },
  { k: "anise", ar: "ينسون", en: "Anise seed", cat: "drinks", base: "g", pack: KG, price: 300, sup: "tea", loc: "bar", vat: 14, acc: "beverage" },
  { k: "sahlab", ar: "سحلب بودرة", en: "Sahlab powder", cat: "drinks", base: "g", pack: KG, price: 240, sup: "tea", loc: "bar", vat: 14, acc: "beverage", market: "sahlab" },
  { k: "hibiscus", ar: "كركديه أسواني", en: "Aswan hibiscus", cat: "drinks", base: "g", pack: KG, price: 190, sup: "tea", loc: "bar", vat: 14, acc: "beverage", market: "hibiscus" },
  { k: "tamarind", ar: "تمر هندي", en: "Tamarind", cat: "drinks", base: "g", pack: KG, price: 150, sup: "tea", loc: "bar", vat: 14, acc: "beverage" },
  { k: "cola", ar: "مشروب غازي كانز", en: "Cola cans 330 ml", cat: "drinks", base: "pc", pack: ["carton24", "كرتونة 24 كانز", "24 cans", 24], price: 380, sup: "drinks", loc: "bar", vat: 14, acc: "beverage", market: "cola" },
  { k: "water", ar: "مياه معدنية 600 مل", en: "Mineral water 600 ml", cat: "drinks", base: "pc", pack: ["carton24", "كرتونة 24 زجاجة", "24 bottles", 24], price: 115, sup: "drinks", loc: "bar", vat: 14, acc: "beverage", market: "water-small" },
  // packaging — Pack Plus (s19)
  { k: "box", ar: "علب ألومنيوم", en: "Aluminium trays", cat: "packaging", base: "pc", pack: ["carton1000", "كرتونة 1000", "1,000 pcs", 1000], price: 1500, sup: "pack", loc: "store", vat: 14, acc: "packaging", market: "alu-8389" },
  { k: "cup", ar: "أكواب ورق", en: "Paper cups", cat: "packaging", base: "pc", pack: ["carton1000", "كرتونة 1000", "1,000 pcs", 1000], price: 1100, sup: "pack", loc: "store", vat: 14, acc: "packaging", market: "cups-8" },
  { k: "bag", ar: "أكياس كرافت", en: "Kraft bags", cat: "packaging", base: "pc", pack: ["carton500", "كرتونة 500", "500 pcs", 500], price: 750, sup: "pack", loc: "store", vat: 14, acc: "packaging", market: "kraft-bags" },
];

/** Prep items (sub-recipes) — made in batches in the kitchen with `produce()`. */
const PREPS: { k: string; ar: string; en: string; yieldQty: number; loc: Loc; lines: [string, number][]; allergens?: string[] }[] = [
  { k: "p-tahini", ar: "صوص طحينة", en: "Tahini sauce", yieldQty: 1200, loc: "kitchen", lines: [["tahini", 500], ["lemon", 150], ["garlic", 30], ["salt", 10], ["cumin", 5]], allergens: ["sesame"] },
  { k: "p-garlic", ar: "ثومية", en: "Garlic sauce (toum)", yieldQty: 1000, loc: "fridge", lines: [["garlic", 250], ["oil", 700], ["lemon", 100], ["salt", 10]] },
  { k: "p-rice", ar: "رز بالشعرية (مطبوخ)", en: "Vermicelli rice (cooked)", yieldQty: 2600, loc: "kitchen", lines: [["rice", 1000], ["vermicelli", 150], ["veg-ghee", 60], ["salt", 15]] },
  { k: "p-tomato", ar: "صلصة طماطم مطبوخة", en: "Tomato sauce", yieldQty: 2200, loc: "kitchen", lines: [["tomato", 2000], ["tomato-paste", 200], ["onion", 300], ["garlic", 40], ["oil", 100], ["salt", 20], ["black-pepper", 5]] },
  { k: "p-kofta", ar: "خلطة كفتة", en: "Kofta mix", yieldQty: 5000, loc: "fridge", lines: [["lamb-mince", 2500], ["beef-mince", 1500], ["lamb-fat", 500], ["onion", 500], ["parsley", 2], ["spices", 25], ["salt", 40], ["black-pepper", 10]] },
  { k: "p-taameya", ar: "عجينة طعمية", en: "Taameya mix", yieldQty: 2000, loc: "fridge", lines: [["fava", 1000], ["onion", 200], ["garlic", 50], ["parsley", 2], ["coriander", 2], ["dill", 1], ["cumin", 15], ["salt", 20]] },
  { k: "p-bechamel", ar: "صوص بشاميل", en: "Béchamel", yieldQty: 2100, loc: "kitchen", lines: [["milk", 2000], ["butter", 150], ["flour", 150], ["salt", 10], ["black-pepper", 3]], allergens: ["milk", "gluten"] },
  { k: "p-mahshi", ar: "خلطة محشي", en: "Mahshi rice stuffing", yieldQty: 2500, loc: "kitchen", lines: [["rice", 1000], ["tomato", 600], ["onion", 300], ["parsley", 2], ["dill", 1], ["mint", 1], ["tomato-paste", 100], ["oil", 100], ["salt", 20], ["spices", 10]] },
];

/** Recipes per menu item (portion), keyed by seed item key. */
const MENU: Record<string, [string, number][]> = {
  kofta: [["p-kofta", 280], ["p-tahini", 40], ["tomato", 60], ["onion", 30], ["parsley", 0.1], ["baladi-bread", 1]],
  "lamb-chops": [["lamb-chops", 400], ["rosemary", 0.2], ["garlic", 10], ["olive-oil", 15], ["salt", 4], ["black-pepper", 1], ["p-tahini", 40]],
  tawook: [["chicken-breast", 300], ["yogurt", 0.5], ["lemon", 30], ["garlic", 10], ["oil", 15], ["spices", 4], ["salt", 4], ["p-garlic", 40]],
  "half-chicken": [["chicken", 650], ["lemon", 30], ["garlic", 15], ["oil", 15], ["spices", 4], ["salt", 5], ["p-garlic", 50]],
  kebab: [["lamb", 300], ["onion", 50], ["tomato", 50], ["salt", 4], ["black-pepper", 1], ["p-tahini", 40]],
  "mixed-grill": [["p-kofta", 250], ["lamb", 200], ["chicken-breast", 200], ["lamb-chops", 250], ["p-tahini", 80], ["p-garlic", 60], ["tomato", 100], ["onion", 60], ["baladi-bread", 2]],
  okra: [["okra", 250], ["lamb", 150], ["p-tomato", 200], ["garlic", 10], ["veg-ghee", 15], ["coriander", 0.1], ["salt", 3]],
  torly: [["zucchini", 120], ["potato", 120], ["carrot", 60], ["eggplant", 80], ["pepper", 60], ["p-tomato", 200], ["onion", 50], ["oil", 20], ["salt", 3]],
  molokhia: [["molokhia", 300], ["chicken", 300], ["garlic", 20], ["veg-ghee", 20], ["coriander", 0.1], ["salt", 4], ["baladi-bread", 1]],
  "lesan-asfour": [["orzo", 120], ["veal", 150], ["p-tomato", 150], ["onion", 40], ["veg-ghee", 15], ["salt", 3]],
  bechamel: [["pasta", 180], ["beef-mince", 120], ["p-bechamel", 250], ["onion", 40], ["tomato-paste", 15], ["butter", 10], ["salt", 3]],
  fattah: [["rice", 120], ["baladi-bread", 1], ["beef-shank", 250], ["garlic", 20], ["vinegar", 30], ["p-tomato", 120], ["veg-ghee", 20], ["salt", 4]],
  "warak-enab": [["vine-leaves", 80], ["p-mahshi", 200], ["lemon", 20], ["oil", 15]],
  "mixed-mahshi": [["zucchini", 150], ["eggplant", 120], ["pepper", 100], ["tomato", 150], ["p-mahshi", 300], ["p-tomato", 100]],
  cabbage: [["cabbage", 0.35], ["p-mahshi", 300], ["cumin", 2], ["garlic", 10], ["oil", 15]],
  mombar: [["mombar", 150], ["p-mahshi", 200], ["oil", 60]],
  pigeon: [["pigeon", 2], ["freekeh", 150], ["onion", 50], ["butter", 30], ["salt", 3], ["spices", 3]],
  baladi: [["tomato", 150], ["cucumber", 120], ["onion", 40], ["lemon", 20], ["parsley", 0.1], ["salt", 2], ["oil", 5]],
  tahini: [["p-tahini", 180], ["parsley", 0.05], ["cumin", 1]],
  baba: [["eggplant", 350], ["tahini", 40], ["lemon", 15], ["garlic", 8], ["olive-oil", 10], ["salt", 2]],
  rocket: [["rocket", 1], ["tomato", 80], ["onion", 30], ["molasses", 15], ["olive-oil", 10], ["lemon", 10]],
  fattoush: [["lettuce", 0.25], ["tomato", 80], ["cucumber", 80], ["pepper", 40], ["onion", 30], ["shami-bread", 1], ["sumac", 3], ["olive-oil", 15], ["molasses", 10], ["mint", 0.05]],
  hummus: [["chickpeas", 120], ["tahini", 50], ["lemon", 20], ["garlic", 5], ["olive-oil", 15], ["cumin", 1], ["salt", 2]],
  taameya: [["p-taameya", 180], ["oil", 40]],
  fries: [["potato", 350], ["oil", 60], ["salt", 3], ["cumin", 1]],
  sambousek: [["flour", 100], ["white-cheese", 80], ["butter", 15], ["eggs", 0.25], ["oil", 40]],
  kobeba: [["bulgur", 100], ["beef-mince", 100], ["onion", 40], ["spices", 3], ["oil", 50], ["nuts", 5]],
  "orzo-soup": [["orzo", 50], ["beef-shank", 60], ["onion", 30], ["butter", 10], ["salt", 3], ["lemon", 10]],
  "om-ali": [["rokak", 100], ["milk", 250], ["cooking-cream", 50], ["sugar", 40], ["nuts", 25], ["raisins", 10], ["coconut", 10], ["butter", 15]],
  "roz-bel-laban": [["rice", 50], ["milk", 250], ["sugar", 35], ["starch", 5], ["vanilla", 1], ["cinnamon", 1]],
  kunafa: [["kunafa-dough", 120], ["cream", 80], ["ghee", 30], ["sugar", 60], ["nuts", 10]],
  basbousa: [["semolina", 90], ["sugar", 70], ["ghee", 25], ["yogurt", 0.3], ["coconut", 10], ["cream", 50]],
  mahalabia: [["milk", 220], ["starch", 25], ["sugar", 35], ["rose-water", 5], ["nuts", 10]],
  tea: [["tea", 3]],
  "tea-milk": [["tea", 3], ["milk", 120]],
  turkish: [["turkish-coffee", 7], ["cardamom", 0.2]],
  nescafe: [["instant-coffee", 4], ["milk", 150]],
  cappuccino: [["espresso", 18], ["milk", 180]],
  anise: [["anise", 5]],
  sahlab: [["sahlab", 30], ["milk", 220], ["sugar", 20], ["nuts", 10], ["coconut", 5], ["cinnamon", 0.5]],
  "lemon-mint": [["lemon", 120], ["mint", 0.2]],
  mango: [["mango", 250], ["sugar", 20]],
  strawberry: [["strawberry", 220], ["sugar", 20], ["milk", 50]],
  karkade: [["hibiscus", 15], ["sugar", 35]],
  tamarind: [["tamarind", 30], ["sugar", 35]],
  soda: [["cola", 1]],
  water: [["water", 1]],
};

/** Modifier recipes: "group:modifier" (or "group:modifier@itemKey" for item-specific ones). */
const MODS: Record<string, [string, number][]> = {
  "side:rice": [["p-rice", 200]],
  "side:fries": [["potato", 300], ["oil", 50], ["salt", 2]],
  "side:bread": [["baladi-bread", 2], ["tomato", 80], ["cucumber", 60], ["onion", 20]],
  "side:freekeh": [["freekeh", 120], ["butter", 15], ["onion", 20]],
  "spice:hot": [["chili", 15]],
  "extras:tahini": [["p-tahini", 60]],
  "extras:garlic": [["p-garlic", 50]],
  "extras:bread": [["baladi-bread", 2]],
  "extras:cheese": [["roumi", 30]],
  "portion:half": [["p-kofta", 280]],
  "sugar:light": [["sugar", 5]],
  "sugar:medium": [["sugar", 10]],
  "sugar:sweet": [["sugar", 15]],
  "coffee-size:double": [["turkish-coffee", 7]],
  "tea-extra:mint": [["mint", 0.1]],
  "tea-extra:milk": [["milk", 60]],
  "size:large@lemon-mint": [["lemon", 60], ["mint", 0.1]],
  "size:large@mango": [["mango", 120], ["sugar", 10]],
  "size:large@strawberry": [["strawberry", 110], ["sugar", 10]],
  "size:large@karkade": [["hibiscus", 7], ["sugar", 15]],
  "size:large@tamarind": [["tamarind", 15], ["sugar", 15]],
};

/** Portions a normal day sells (drives the week of history and the par levels). */
const DAILY: Record<string, number> = {
  kofta: 16, "lamb-chops": 5, tawook: 12, "half-chicken": 9, kebab: 6, "mixed-grill": 4, okra: 5, torly: 4, molokhia: 10, "lesan-asfour": 4, bechamel: 7, fattah: 6,
  "warak-enab": 8, "mixed-mahshi": 9, cabbage: 4, mombar: 3, pigeon: 0, baladi: 14, tahini: 16, baba: 8, rocket: 5, fattoush: 6, hummus: 10, taameya: 12, fries: 15,
  sambousek: 5, kobeba: 4, "orzo-soup": 6, "om-ali": 7, "roz-bel-laban": 6, kunafa: 5, basbousa: 4, mahalabia: 3, tea: 45, "tea-milk": 10, turkish: 20, nescafe: 6,
  cappuccino: 8, anise: 4, sahlab: 4, "lemon-mint": 18, mango: 8, strawberry: 6, karkade: 6, tamarind: 3, soda: 20, water: 30,
};
/** default modifiers ordered with each item (the history assumes the default choice) */
const DEFAULT_MODS: Record<string, string[]> = {
  kofta: ["portion:quarter", "side:rice"], "lamb-chops": ["side:rice"], tawook: ["side:fries"], "half-chicken": ["side:rice"], kebab: ["side:bread"], "mixed-grill": ["side:rice"],
  molokhia: ["side:rice"], tea: ["sugar:medium"], "tea-milk": ["sugar:medium"], turkish: ["coffee-size:single", "sugar:medium"], nescafe: ["sugar:medium"], cappuccino: ["sugar:light"],
  anise: ["sugar:medium"], "lemon-mint": ["size:regular", "sugar:medium"],
};

/** final on-hand as a multiple of par (some deliberately low/out for the alerts) */
const ON_HAND_X: Record<string, number> = { "lamb-mince": 0.3, lemon: 0.4, cream: 0.35, tea: 0.4, mint: 0.3, "vine-leaves": 0.05, cola: 0.45, veal: 0.9, lamb: 0.9, "beef-shank": 0.9 };

const SUPPLIERS: Record<Sup, { market: string | null; ar: string; en: string; contact: string; phone: string; terms: number; lead: number; cats: StockCategory[] }> = {
  butcher: { market: "s04", ar: "جزارة الأمانة بالجملة", en: "Al-Amana Wholesale Butchery", contact: "الحاج سيد", phone: "01005553401", terms: 14, lead: 1, cats: ["meat"] },
  poultry: { market: "s05", ar: "دواجن الدلتا", en: "Delta Poultry", contact: "أ. وليد", phone: "01005553402", terms: 7, lead: 1, cats: ["meat"] },
  produce: { market: "s01", ar: "خضار وادي النيل", en: "Nile Valley Produce", contact: "معلم رجب", phone: "01005553403", terms: 0, lead: 1, cats: ["produce"] },
  dairy: { market: "s09", ar: "ألبان الواحة", en: "Oasis Dairy", contact: "أ. هبة", phone: "01005553404", terms: 14, lead: 1, cats: ["dairy"] },
  grocer: { market: "s12", ar: "بقالة الجملة المصرية", en: "Egyptian Wholesale Grocers", contact: "أ. ماجد", phone: "01005553405", terms: 30, lead: 2, cats: ["dry", "bakery"] },
  spice: { market: "s14", ar: "بيت البهارات", en: "The Spice House", contact: "عم عبده", phone: "01005553406", terms: 0, lead: 3, cats: ["spices"] },
  bakery: { market: null, ar: "مخبز الزمالك البلدي", en: "Zamalek Baladi Bakery", contact: "عم فتحي", phone: "01005553407", terms: 0, lead: 0, cats: ["bakery"] },
  drinks: { market: "s16", ar: "مشروبات القاهرة للتوزيع", en: "Cairo Beverage Distribution", contact: "أ. كريم", phone: "01005553408", terms: 30, lead: 2, cats: ["drinks"] },
  tea: { market: "s18", ar: "شاي وأعشاب العطار", en: "Al-Attar Tea & Herbs", contact: "الحاج عطية", phone: "01005553409", terms: 14, lead: 2, cats: ["drinks"] },
  pack: { market: "s19", ar: "تغليف بلس", en: "Pack Plus", contact: "أ. نادين", phone: "01005553410", terms: 30, lead: 3, cats: ["packaging"] },
};

const LOCS: { k: Loc; ar: string; en: string; kind: StorageLocation["kind"] }[] = [
  { k: "store", ar: "المخزن الرئيسي", en: "Main store", kind: "store" },
  { k: "kitchen", ar: "المطبخ", en: "Kitchen", kind: "kitchen" },
  { k: "fridge", ar: "التلاجة والفريزر", en: "Cold room", kind: "fridge" },
  { k: "bar", ar: "البار", en: "Bar", kind: "bar" },
];

/* ───────── builder ───────── */

/**
 * Two passes: the quantities that leave stock don't depend on the opening balance (sales, production, waste and the
 * count's differences are fixed), so pass 1 measures them and pass 2 opens each item with exactly what it needs to
 * end the week at its target (par × ON_HAND_X — some deliberately low/out for the alerts).
 */
export function demoInventoryRows(c: InventorySeedCtx) {
  const first = build(c, null);
  const opening = new Map<string, number>();
  for (const [id, x] of first.sim) opening.set(id, Math.max(x.min, q3(x.target - (x.final - x.opening))));
  const { sim: _s, ...out } = build(c, opening);
  return out;
}

function build(c: InventorySeedCtx, openingOverride: Map<string, number> | null) {
  const sim = new Map<string, { opening: number; final: number; target: number; min: number }>();
  const R = c.restaurantId;
  const B = c.branchId;
  const base = (k: string, at = c.created) => ({ id: c.id(k), restaurantId: R, createdAt: at, updatedAt: at });
  const at = (day: number, hh: number, mm = 0) => {
    const d = new Date(c.now);
    d.setDate(d.getDate() - day);
    d.setHours(hh, mm, 0, 0);
    return d.toISOString();
  };
  const sid = (k: Sup) => c.id(`supplier:${k}`);
  const iid = (k: string) => c.id(`stock:${k}`);
  const lid = (k: Loc) => c.id(`location:${k}`);

  const storageLocations: StorageLocation[] = LOCS.map((l, i) => ({ ...base(`location:${l.k}`), branchId: B, name: L(l.ar, l.en), kind: l.kind, sort: i + 1, active: true }));

  const suppliers: Supplier[] = (Object.entries(SUPPLIERS) as [Sup, (typeof SUPPLIERS)[Sup]][]).map(([k, s]) => {
    const m = s.market ? supplierById[s.market] : null;
    return {
      ...base(`supplier:${k}`), name: L(s.ar, s.en), contactName: s.contact, phone: s.phone, whatsapp: s.phone, email: null, taxId: m?.tax ?? "", categories: s.cats,
      area: m ? L(m.areaAr, m.areaEn) : L("الزمالك", "Zamalek"), termsDays: s.terms, leadDays: s.lead, days: m?.days ?? [0, 1, 2, 3, 4, 5, 6],
      minOrder: m ? m.minOrder * 1000 : 0, deliveryFee: m ? m.deliveryFee * 1000 : 0, marketplaceId: s.market, eInvoice: m?.eInvoice ?? false, rating: m?.rating ?? 4.5, active: true,
      note: s.market ? "" : "بيعدي كل يوم الصبح الساعة ٨",
    };
  });

  // daily usage (base units) from the sales mix → par levels
  const stockItems: StockItem[] = [];
  const mkItem = (k: string, x: { ar: string; en: string; cat: StockCategory; kind: "raw" | "prep"; base: BaseUnit; packs: PackUnit[]; acc: StockAccount; cost: Units; sup: Sup | null; loc: Loc; vat: number; batch?: number; yieldBp?: number; market?: string | null; allergens?: string[] }) => {
    stockItems.push({
      ...base(`stock:${k}`), name: L(x.ar, x.en), sku: k.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12), category: x.cat, kind: x.kind, baseUnit: x.base, packs: x.packs,
      countUnit: x.packs[0]?.id ?? x.base, account: x.acc, levels: { min: 0, par: 0, max: 0 }, branchLevels: {}, supplierIds: x.sup ? [sid(x.sup)] : [], preferredSupplierId: x.sup ? sid(x.sup) : null,
      lastCost: x.cost, defaultLocationIds: [lid(x.loc)], trackBatches: !!x.batch, shelfLifeDays: x.batch ?? null, vatBp: x.vat * 100, yieldBp: x.yieldBp ?? 10_000,
      allergens: x.allergens ?? [], active: true, note: "", marketKey: x.market ?? null,
    });
  };
  const costOf = (d: Def) => Math.round((d.price * EGP) / d.pack[3]);
  for (const d of DEFS) {
    const packs: PackUnit[] = d.pack[0] === "kg" || d.pack[0] === "L" || d.pack[0] === "pc" ? [] : [{ id: d.pack[0], name: L(d.pack[1], d.pack[2]), factor: d.pack[3] }];
    mkItem(d.k, { ...d, kind: "raw", packs, acc: d.acc ?? "food", cost: costOf(d), sup: d.sup, vat: d.vat ?? 0, market: d.market ?? null });
  }
  // prep items: cost = recipe ÷ yield at the raw items' last cost
  const rawCost = new Map(DEFS.map((d) => [d.k, costOf(d)]));
  for (const p of PREPS) {
    const batch = p.lines.reduce((a, [k, q]) => a + q * (rawCost.get(k) ?? 0), 0);
    mkItem(p.k, { ar: p.ar, en: p.en, cat: "prep", kind: "prep", base: "g", packs: [{ id: "batch", name: L("تشغيلة", "batch"), factor: p.yieldQty }], acc: "food", cost: Math.round(batch / p.yieldQty), sup: null, loc: p.loc, vat: 0, allergens: p.allergens });
  }
  const itemBy = new Map(stockItems.map((s) => [s.id, s]));

  /* recipes */
  const menuBy = new Map(c.menuItems.map((m) => [m.id, m]));
  const keyOfMenu = (m: MenuItem) => [...Object.keys(MENU)].find((k) => c.id(`item:${k}`) === m.id) ?? null;
  const rl = (lines: [string, number][]): RecipeLine[] => lines.map(([k, qty]) => ({ itemId: iid(k), qty }));
  const recipes: Recipe[] = [];
  for (const p of PREPS) recipes.push({ ...base(`recipe:prep:${p.k}`), ownerType: "prep", ownerId: iid(p.k), lines: rl(p.lines), yieldQty: p.yieldQty, method: "", updatedBy: c.staffId("chef") });
  for (const [k, lines] of Object.entries(MENU)) {
    if (!menuBy.has(c.id(`item:${k}`))) continue;
    recipes.push({ ...base(`recipe:item:${k}`), ownerType: "menu_item", ownerId: c.id(`item:${k}`), lines: rl(lines), yieldQty: 1, method: "", updatedBy: c.staffId("chef") });
  }
  for (const [key, lines] of Object.entries(MODS)) {
    const [gm, scope] = key.split("@");
    const [g, m] = gm.split(":");
    recipes.push({ ...base(`recipe:mod:${key}`), ownerType: "modifier", ownerId: c.id(`mod:${g}:${m}`), scopeItemId: scope ? c.id(`item:${scope}`) : null, lines: rl(lines), yieldQty: 1, method: "", updatedBy: c.staffId("chef") });
  }
  const ctx = explodeContext(c.menuItems, stockItems, recipes);

  /* a normal day's usage per stock item (with default modifiers), and how much prep that needs */
  const modRef = (gm: string) => {
    const [g, m] = gm.split(":");
    const mod = c.modifiers.find((x) => x.id === c.id(`mod:${g}:${m}`));
    return mod ? { groupId: mod.groupId, modifierId: mod.id, name: mod.name, price: mod.price } : null;
  };
  const dayUse = new Map<string, number>();
  for (const [k, n] of Object.entries(DAILY)) {
    if (!n || !menuBy.has(c.id(`item:${k}`))) continue;
    const mods = (DEFAULT_MODS[k] ?? []).map(modRef).filter((x): x is NonNullable<typeof x> => !!x);
    for (const [s, q] of explodeLine({ itemId: c.id(`item:${k}`), qty: n, modifiers: mods }, ctx)) dayUse.set(s, q3((dayUse.get(s) ?? 0) + q));
  }
  // prep consumption → raw consumption through production (part of "usage" for par levels)
  const rawUse = new Map(dayUse);
  // (+ half a batch a day: production runs in whole batches)
  for (const p of PREPS) {
    const used = dayUse.get(iid(p.k)) ?? 0;
    if (!used) continue;
    for (const [k, q] of p.lines) rawUse.set(iid(k), q3((rawUse.get(iid(k)) ?? 0) + (q * (used * 1.05 + p.yieldQty * 0.5)) / p.yieldQty));
  }
  for (const it of stockItems) {
    const u = rawUse.get(it.id) ?? 0;
    const f = it.packs[0]?.factor ?? (it.baseUnit === "pc" ? 1 : 1000);
    const step = it.baseUnit === "pc" ? 1 : 100;
    const round = (x: number) => Math.ceil(x / step) * step;
    if (it.kind === "prep") {
      // prep is made every morning for the day: alert only when a day's worth is missing
      const d = dayUse.get(it.id) ?? 0;
      it.levels = { min: round(d * 0.25), par: round(d * 1.1), max: round(d * 2) };
    } else it.levels = u > 0 ? { min: round(u * 1.5), par: round(u * 3), max: round(Math.max(u * 7, f * 1.5)) } : { min: 0, par: it.baseUnit === "pc" ? 4 : 1000, max: it.baseUnit === "pc" ? 10 : 3000 };
  }
  const loc = (it: StockItem) => it.defaultLocationIds[0];

  /* ───────── simulate two weeks: opening → POs → production → daily sales → waste → count ───────── */
  const pos = new Map<string, Position>(); // key itemId (one home location each)
  const moves: StockMove[] = [];
  let mv = 0;
  const move = (itemId: string, kind: MoveKind, qty: number, value: Units, when: string, extra: Partial<StockMove> = {}) => {
    const k = `m${++mv}`;
    moves.push({
      ...base(`move:${k}`, when), branchId: B, locationId: loc(itemBy.get(itemId)!), itemId, kind, qty: q3(qty), value, unitCost: qty ? Math.round(Math.abs(value / qty)) : 0,
      refType: null, refId: null, groupId: null, reason: null, note: "", photo: null, batchId: null, at: when, by: c.staffId("chef"), ...extra,
    });
  };
  const get = (id: string) => pos.get(id) ?? { qty: 0, value: 0 };
  const doIn = (id: string, qty: number, value: Units, kind: MoveKind, when: string, extra: Partial<StockMove> = {}) => {
    pos.set(id, receive(get(id), qty, value));
    move(id, kind, qty, value, when, extra);
  };
  const doOut = (id: string, qty: number, kind: MoveKind, when: string, extra: Partial<StockMove> = {}) => {
    const r = consume(get(id), qty, itemBy.get(id)!.lastCost);
    pos.set(id, r.position);
    move(id, kind, -qty, -r.value, when, extra);
  };

  const HIST = 7;
  type PoSpec = { n: number; sup: Sup; day: number; status: PurchaseOrder["status"]; lines: [string, number, number?, number?][]; late?: boolean; short?: boolean };
  // [stock key, packs ordered, packs received (default = ordered), price EGP charged (default = list)]
  const PO_SPECS: PoSpec[] = [
    { n: 1, sup: "butcher", day: 7, status: "paid", lines: [["lamb", 12], ["lamb-mince", 6], ["beef-mince", 8], ["lamb-chops", 6], ["veal", 5], ["beef-shank", 6], ["lamb-fat", 2], ["mombar", 2]] },
    { n: 2, sup: "produce", day: 7, status: "paid", lines: [["tomato", 1], ["onion", 1], ["potato", 2], ["cucumber", 6], ["lemon", 8], ["garlic", 3], ["parsley", 3], ["eggplant", 15], ["zucchini", 6], ["pepper", 6], ["coriander", 2], ["dill", 1]] },
    { n: 3, sup: "butcher", day: 5, status: "invoiced", lines: [["lamb", 12], ["lamb-mince", 6], ["beef-mince", 10], ["lamb-chops", 8], ["veal", 4], ["beef-shank", 7], ["lamb-fat", 2], ["mombar", 2]] },
    { n: 4, sup: "produce", day: 4, status: "invoiced", short: true, lines: [["tomato", 2, 1], ["cucumber", 6], ["lemon", 10, 8], ["garlic", 3], ["parsley", 3], ["mint", 3], ["eggplant", 15], ["zucchini", 6], ["molokhia", 18], ["mango", 15], ["potato", 1], ["rocket", 2]] },
    { n: 5, sup: "butcher", day: 3, status: "received", lines: [["lamb", 10, 10, 510], ["lamb-mince", 4, 4, 475], ["beef-mince", 8], ["lamb-chops", 6], ["beef-shank", 5]] },
    { n: 6, sup: "produce", day: 2, status: "received", late: true, lines: [["tomato", 1], ["onion", 1], ["cucumber", 5], ["pepper", 5], ["strawberry", 8], ["rocket", 2], ["lettuce", 1], ["coriander", 2], ["dill", 1], ["potato", 1]] },
    { n: 7, sup: "butcher", day: 0, status: "sent", lines: [["lamb", 12], ["lamb-mince", 14], ["beef-mince", 8], ["veal", 5]] },
    { n: 8, sup: "produce", day: 0, status: "draft", lines: [["lemon", 10], ["mint", 4], ["tomato", 2], ["vine-leaves", 5]] },
  ];

  /* waste through the week */
  const WASTE: [number, string, number, WasteReason, string][] = [
    [6, "tomato", 2500, "spoiled", "قفص طماطم فيه حبات معطوبة"],
    [5, "p-rice", 800, "overproduction", "رز زيادة آخر الليل"],
    [5, "milk", 1000, "expired", ""],
    [4, "p-kofta", 400, "dropped", "صينية وقعت عند الشوّاية"],
    [4, "strawberry", 600, "spoiled", ""],
    [3, "chicken", 700, "burnt", "نص فرخة اتحرقت"],
    [3, "p-tahini", 300, "expired", "صوص امبارح"],
    [2, "lettuce", 2, "spoiled", ""],
    [2, "p-kofta", 560, "staff_meal", "غدا الطاقم"],
    [1, "mint", 3, "spoiled", "النعناع دبلان"],
    [1, "lamb", 300, "returned_by_guest", "زبون رجّع الكباب — مستوي زيادة"],
  ];

  /* fridge count two days ago (10:00) with variance */
  const COUNT_DAY = 2;
  const countDiff: Record<string, number> = { "lamb-mince": -650, chicken: -900, "beef-mince": -220, milk: -1500, cream: 150, eggs: -6, "white-cheese": -180, butter: 0, roumi: -90, yogurt: 0, "p-kofta": -320 };
  const countLines: CountLine[] = [];
  // opening (day −8) = what the week uses (sales + production + waste) + the on-hand we want to end with − what the
  // seeded purchase orders deliver (never less than ~a day, so the first deliveries are needed)
  const delivered = new Map<string, number>();
  for (const p of PO_SPECS)
    if (p.status !== "draft" && p.status !== "sent")
      for (const [k, qty, rq] of p.lines) delivered.set(k, (delivered.get(k) ?? 0) + (rq ?? qty) * (DEFS.find((d) => d.k === k)!.pack[3]));
  const wasted = (k: string) => WASTE.filter((w) => w[1] === k).reduce((a, w) => a + w[2], 0) + Math.max(0, -(countDiff[k] ?? 0));
  for (const it of stockItems) {
    if (it.kind === "prep") continue;
    const k = keyOf(it);
    const u = rawUse.get(it.id) ?? 0;
    const target = it.levels.par * (ON_HAND_X[k] ?? 1.15);
    const need = u * (HIST + 1.1) + wasted(k) + target - (delivered.get(k) ?? 0);
    const min = it.baseUnit === "pc" ? 2 : 200;
    const qty = openingOverride?.get(it.id) ?? Math.max(min, Math.ceil(Math.max(need, u * 1.2)));
    sim.set(it.id, { opening: qty, final: 0, target: q3(target), min });
    doIn(it.id, qty, Math.round(qty * it.lastCost), "opening", at(HIST + 1, 9), { note: "رصيد أول المدة" });
  }
  function keyOf(it: StockItem) {
    return DEFS.find((d) => iid(d.k) === it.id)?.k ?? PREPS.find((p) => iid(p.k) === it.id)?.k ?? "";
  }

  /* purchase orders (butcher + produce), received into the simulation on their day */
  const offerPrice = new Map<string, Units>(); // `${supplier}:${item}` → current pack price
  const supplierItems: SupplierItem[] = [];
  for (const d of DEFS) {
    const it = itemBy.get(iid(d.k))!;
    const price = Math.round(d.price * EGP);
    const factor = d.pack[3];
    const sup = d.sup;
    const history = [{ price, at: at(60, 10) }];
    supplierItems.push({
      ...base(`offer:${sup}:${d.k}`), supplierId: sid(sup), itemId: it.id, packName: L(d.pack[1], d.pack[2]), packFactor: factor, price, vatBp: (d.vat ?? 0) * 100,
      code: SUPPLIERS[sup].market && d.market ? `${SUPPLIERS[sup].market}-${d.market}` : null, history, preferred: true,
    });
    offerPrice.set(`${sup}:${d.k}`, price);
  }
  // a second offer for a few items (compare prices): the grocer also sells tahini/oil cheaper or dearer
  const alt: [Sup, string, number][] = [["grocer", "lemon", 48], ["dairy", "white-cheese", 128], ["produce", "garlic", 92]];
  for (const [sup, k, egp] of alt) {
    const d = DEFS.find((x) => x.k === k)!;
    if (d.sup === sup) continue;
    supplierItems.push({ ...base(`offer:${sup}:${k}`), supplierId: sid(sup), itemId: iid(k), packName: L(d.pack[1], d.pack[2]), packFactor: d.pack[3], price: egp * EGP, vatBp: (d.vat ?? 0) * 100, code: null, history: [{ price: egp * EGP, at: at(30, 10) }], preferred: false });
  }
  const offerOf = (sup: Sup, k: string) => supplierItems.find((o) => o.id === c.id(`offer:${sup}:${k}`))!;

  const purchaseOrders: PurchaseOrder[] = [];
  const goodsReceipts: GoodsReceipt[] = [];
  const supplierInvoices: SupplierInvoice[] = [];
  const supplierPayments: SupplierPayment[] = [];
  const stockBatches: StockBatch[] = [];
  const year = c.now.getFullYear();
  const receiveEvents: { day: number; fn: () => void }[] = [];
  for (const p of PO_SPECS) {
    const sup = suppliers.find((s) => s.id === sid(p.sup))!;
    const poId = c.id(`po:${p.n}`);
    const created = at(p.day + 1, 15);
    const expected = at(p.day, 9);
    const received = p.status === "draft" || p.status === "sent" ? null : at(p.day, p.late ? 14 : 9, p.late ? 40 : 30);
    const lines: PoLine[] = p.lines.map(([k, qty, rq, egp], i) => {
      const o = offerOf(p.sup, k);
      const charged = egp ? egp * EGP : o.price;
      const recQty = received ? (rq ?? qty) : 0;
      return { id: c.id(`po:${p.n}:line:${i}`), itemId: iid(k), name: itemBy.get(iid(k))!.name, packName: o.packName, packFactor: o.packFactor, qty, price: o.price, vatBp: o.vatBp, receivedQty: recQty, receivedValue: Math.round(recQty * charged) };
    });
    const net = lines.reduce((a, l) => a + l.qty * l.price, 0) + sup.deliveryFee;
    const vat = lines.reduce((a, l) => a + pctOf(l.qty * l.price, l.vatBp), 0);
    const delivered = lines.reduce((a, l) => a + l.receivedValue, 0);
    const plan = sup.marketplaceId ? planOf(sup.marketplaceId) : null;
    const viaMarket = !!sup.marketplaceId && p.sup === "butcher";
    const po: PurchaseOrder = {
      ...base(`po:${p.n}`, created), branchId: B, locationId: lid(p.sup === "butcher" ? "fridge" : "kitchen"), supplierId: sup.id, number: `PO-${year}-${String(p.n).padStart(4, "0")}`,
      status: p.status, channel: viaMarket ? "marketplace" : "direct", lines, net, vat, total: net + vat, deliveryFee: sup.deliveryFee, expectedAt: expected,
      sentAt: p.status === "draft" ? null : at(p.day + 1, 16), receivedAt: received, invoiceId: null, note: p.status === "draft" ? "اقتراح من مستويات الـ par" : "",
      createdBy: c.staffId("chef"), approvedBy: p.status === "draft" ? null : c.staffId("manager"), sentVia: p.status === "draft" ? null : viaMarket ? "marketplace" : "whatsapp",
      marketplace: viaMarket && plan ? { supplierRef: sup.marketplaceId!, plan, commissionPct: SUPPLIER_PLANS.find((x) => x.id === plan)!.commissionPct, commission: received ? commissionUnits(plan, delivered) : 0, base: received ? delivered : 0, collectedBySufra: true } : null,
      suggested: p.status === "draft",
    };
    purchaseOrders.push(po);
    if (received) {
      receiveEvents.push({
        day: p.day,
        fn: () => {
          for (const l of lines) {
            if (!l.receivedQty) continue;
            const it = itemBy.get(l.itemId)!;
            const qty = l.receivedQty * l.packFactor;
            let batchId: string | null = null;
            if (it.trackBatches) {
              const b: StockBatch = { ...base(`batch:${p.n}:${l.id}`, received), branchId: B, locationId: loc(it), itemId: it.id, lot: `${po.number}-${keyOf(it).slice(0, 4).toUpperCase()}`, receivedAt: received, expiresOn: new Date(Date.parse(received) + (it.shelfLifeDays ?? 3) * 86_400_000).toISOString().slice(0, 10), qty, remaining: qty, poId };
              stockBatches.push(b);
              batchId = b.id;
            }
            doIn(it.id, qty, l.receivedValue, "receive", received, { refType: "purchase_order", refId: poId, groupId: poId, batchId, note: po.number });
            const charged = Math.round(l.receivedValue / l.receivedQty);
            it.lastCost = Math.round(charged / l.packFactor);
            const o = offerOf(p.sup, keyOf(it));
            if (o.price !== charged) {
              o.history.push({ price: charged, at: received });
              o.price = charged;
            }
          }
        },
      });
      goodsReceipts.push({
        ...base(`grn:${p.n}`, received), branchId: B, locationId: po.locationId, poId, supplierId: sup.id, value: delivered, receivedAt: received, receivedBy: c.staffId("chef"),
        note: p.short ? "الطماطم والليمون ناقصين — المعلم قال هيكملهم المرة الجاية" : p.late ? "اتأخر للضهر" : "",
        lines: lines.filter((l) => l.receivedQty).map((l) => ({ lineId: l.id, itemId: l.itemId, qty: l.receivedQty, price: Math.round(l.receivedValue / l.receivedQty), packFactor: l.packFactor, lot: null, expiresOn: null, note: "" })),
      });
    }
    if (p.status === "invoiced" || p.status === "paid") {
      const invId = c.id(`inv:${p.n}`);
      const invLines: SupplierInvoice["lines"] = [{ account: "food", net: delivered, vat: lines.reduce((a, l) => a + pctOf(l.receivedValue, l.vatBp), 0) }];
      if (sup.deliveryFee) invLines.push({ account: "expense", net: sup.deliveryFee, vat: pctOf(sup.deliveryFee, 1400) });
      const inet = invLines.reduce((a, l) => a + l.net, 0);
      const ivat = invLines.reduce((a, l) => a + l.vat, 0);
      const date = received!.slice(0, 10);
      const due = new Date(Date.parse(`${date}T12:00:00Z`) + sup.termsDays * 86_400_000).toISOString().slice(0, 10);
      supplierInvoices.push({
        ...base(`inv:${p.n}`, received!), branchId: B, supplierId: sup.id, poId, number: p.sup === "butcher" ? `AM-${4410 + p.n}` : `NV-${8820 + p.n}`, date, dueDate: due, lines: invLines,
        net: inet, vat: ivat, total: inet + ivat, paid: p.status === "paid" ? inet + ivat : 0, status: p.status === "paid" ? "paid" : "open", etaUuid: null, ledgerEntryId: null,
      });
      po.invoiceId = invId;
      if (p.status === "paid")
        supplierPayments.push({ ...base(`pay:${p.n}`, at(p.day - 2, 13)), supplierId: sup.id, invoiceId: invId, amount: inet + ivat, method: p.sup === "produce" ? "cash" : "bank", reference: p.sup === "produce" ? "" : `TRX-${7700 + p.n}`, paidAt: at(p.day - 2, 13), by: c.staffId("accountant") });
    }
  }

  /* production: prep items made each morning to cover the day */
  const prepRecipe = new Map(recipes.filter((r) => r.ownerType === "prep").map((r) => [r.ownerId, r]));
  const produceDay = (day: number) => {
    for (const p of PREPS) {
      const id = iid(p.k);
      const need = (dayUse.get(id) ?? 0) * (day === 0 ? 1.6 : 1.05) - Math.max(0, get(id).qty);
      if (need <= 0) continue;
      const batches = Math.ceil(need / p.yieldQty);
      const r = prepRecipe.get(id)!;
      const g = c.id(`prod:${day}:${p.k}`);
      const when = at(day, 10);
      let value = 0;
      for (const l of r.lines) {
        const before = get(l.itemId).value;
        doOut(l.itemId, q3(l.qty * batches), "production_out", when, { refType: "production", refId: g, groupId: g });
        value += before - get(l.itemId).value;
      }
      doIn(id, p.yieldQty * batches, value, "production_in", when, { refType: "production", refId: g, groupId: g });
    }
  };

  const countId = c.id("count:fridge");

  for (let day = HIST + 1; day >= 0; day--) {
    for (const e of receiveEvents.filter((x) => x.day === day)) e.fn();
    if (day === COUNT_DAY) {
      for (const it of stockItems.filter((s) => loc(s) === lid("fridge"))) {
        const p = get(it.id);
        const k = keyOf(it);
        const diff = countDiff[k] ?? 0;
        const unit = p.qty > 0 ? Math.round(p.value / p.qty) : it.lastCost;
        const counted = q3(Math.max(0, p.qty + diff));
        countLines.push({ itemId: it.id, locationId: lid("fridge"), expected: p.qty, counted, unitCost: unit });
        if (counted !== p.qty) {
          const r = countTo(p, counted, it.lastCost);
          pos.set(it.id, r.position);
          move(it.id, "count_adjust", r.qty, r.value, at(day, 10, 40), { refType: "count", refId: countId, groupId: countId });
        }
      }
    }
    if (day === 0) break;
    produceDay(day);
    for (const w of WASTE.filter((x) => x[0] === day)) {
      const id = iid(w[1]);
      const g = c.id(`waste:${day}:${w[1]}`);
      doOut(id, w[2], w[3] === "staff_meal" ? "staff_meal" : "waste", at(day, 23, 15), { reason: w[3], note: w[4], refType: "waste", refId: g, groupId: g });
    }
    // the day's sales, one line per stock item (at recipe cost — what the live hook writes per order line)
    const g = c.id(`sales:${day}`);
    for (const [id, q] of dayUse) {
      const wobble = 0.85 + ((day * 7 + id.charCodeAt(3)) % 30) / 100;
      doOut(id, q3(q * wobble), "sale", at(day, 23, 30), { refType: "daily_sales", refId: g, groupId: g, note: "مبيعات اليوم (ملخص)" });
    }
  }
  // today: produce for the day (service is in full swing — a bit more), then deduct the seed's fired lines exactly like deductForItems (refType order_item)
  produceDay(0);
  for (const oi of c.orderItems) {
    if (oi.status === "new" || oi.status === "void" || !oi.firedAt) continue;
    for (const [id, q] of explodeLine(oi, ctx)) doOut(id, q, "sale", oi.firedAt, { refType: "order_item", refId: oi.id, groupId: c.id(`deduct:${oi.orderId}`), note: oi.name.ar });
  }

  const stockLevels: StockLevel[] = stockItems.map((it) => {
    const p = get(it.id);
    const last = [...moves].reverse().find((m) => m.itemId === it.id);
    return {
      ...base(`level:${it.id}`), id: levelIdFor(R, loc(it), it.id), branchId: B, locationId: loc(it), itemId: it.id, qty: p.qty, value: p.value,
      lastCountAt: loc(it) === lid("fridge") ? at(COUNT_DAY, 10, 40) : null, lastMoveAt: last?.at ?? null,
    };
  });

  for (const [id, x] of sim) x.final = get(id).qty;
  const countVariance = countLines.reduce((a, l) => a + Math.round(((l.counted ?? l.expected) - l.expected) * l.unitCost), 0);
  const stockCounts: StockCount[] = [{
    ...base("count:fridge", at(COUNT_DAY, 10)), branchId: B, locationId: lid("fridge"), kind: "partial", blind: true, status: "approved", lines: countLines,
    startedBy: c.staffId("kitchen"), startedAt: at(COUNT_DAY, 10), submittedAt: at(COUNT_DAY, 10, 30), approvedBy: c.staffId("manager"), approvedAt: at(COUNT_DAY, 10, 40),
    varianceValue: countVariance, note: "جرد التلاجة الأسبوعي (أعمى من الموبايل)",
  }];

  /* menu extras: allergens + calories from the recipes, a breakfast combo with hours, channel prices online */
  const allergensOf = (lines: RecipeLine[]): string[] => {
    const s = new Set<string>();
    for (const l of lines) for (const a of itemBy.get(l.itemId)?.allergens ?? []) s.add(a);
    return [...s].sort();
  };
  const CAL: Record<string, number> = { kofta: 780, "lamb-chops": 820, tawook: 610, "half-chicken": 690, kebab: 720, "mixed-grill": 1650, okra: 540, torly: 380, molokhia: 520, "lesan-asfour": 560, bechamel: 860, fattah: 980, "warak-enab": 330, "mixed-mahshi": 520, cabbage: 410, mombar: 640, pigeon: 870, baladi: 90, tahini: 260, baba: 210, rocket: 120, fattoush: 230, hummus: 340, taameya: 420, fries: 410, sambousek: 460, kobeba: 520, "orzo-soup": 240, "om-ali": 620, "roz-bel-laban": 290, kunafa: 640, basbousa: 480, mahalabia: 260, tea: 40, "tea-milk": 110, turkish: 20, nescafe: 120, cappuccino: 130, anise: 30, sahlab: 280, "lemon-mint": 150, mango: 210, strawberry: 190, karkade: 140, tamarind: 160, soda: 140, water: 0 };
  for (const m of c.menuItems) {
    const k = keyOfMenu(m);
    if (!k) continue;
    const r = recipes.find((x) => x.ownerType === "menu_item" && x.ownerId === m.id);
    m.allergens = r ? allergensOf(r.lines) : [];
    m.calories = CAL[k] ?? null;
    // online & delivery-app menus are priced a bit higher than the hall (packaging, commission)
    if (["kofta", "tawook", "half-chicken", "molokhia", "bechamel"].includes(k)) m.channelPrices = { aggregator: Math.round((m.price * 1.15) / (5 * EGP)) * 5 * EGP };
    // recipe cost on the item (POS reports / menu engineering read `cost`)
  }
  const catOf = (k: string) => c.menuItems.find((m) => m.id === c.id(`item:${k}`))?.categoryId ?? c.menuItems[0].categoryId;
  const extraMenu: MenuItem[] = [
    {
      ...base("item:breakfast-combo"), categoryId: catOf("taameya"), name: L("فطار بلدي", "Baladi breakfast"), description: L("طعمية وحمص وسلطة بلدي وشاي — لحد الساعة ١", "Taameya, hummus, baladi salad and tea — until 1 pm"),
      price: 195 * EGP, cost: null, sku: "BREAKFAST", stationId: null, modifierGroupIds: [], tags: ["new"], prepMinutes: 8, available: true, vatExempt: false, imageUrl: null, sort: 50, active: true,
      comboOf: [{ itemId: c.id("item:taameya"), qty: 1 }, { itemId: c.id("item:hummus"), qty: 1 }, { itemId: c.id("item:baladi"), qty: 1 }, { itemId: c.id("item:tea"), qty: 1 }],
      schedule: [{ days: [5, 6], from: "09:00", to: "13:00" }], allergens: ["gluten", "sesame"], calories: 820,
    },
    {
      ...base("item:kofta-meal"), categoryId: catOf("kofta"), name: L("وجبة كفتة", "Kofta meal"), description: L("كفتة ربع + بطاطس + مشروب غازي", "¼ kg kofta, fries and a soft drink"),
      price: 435 * EGP, cost: null, sku: "KOFTAMEAL", stationId: null, modifierGroupIds: [], tags: ["new"], prepMinutes: 18, available: true, vatExempt: false, imageUrl: null, sort: 50, active: true,
      comboOf: [{ itemId: c.id("item:kofta"), qty: 1 }, { itemId: c.id("item:fries"), qty: 1 }, { itemId: c.id("item:soda"), qty: 1 }], allergens: ["gluten", "sesame"], calories: 1330,
      channelPrices: { aggregator: 495 * EGP },
    },
  ];

  return {
    sim,
    menuItems: extraMenu,
    rows: { storageLocations, stockItems, stockLevels, stockMoves: moves, recipes, stockBatches, suppliers, supplierItems, purchaseOrders, goodsReceipts, supplierInvoices, supplierPayments, stockCounts, stockTransfers: [] },
  };
}

/** Same id as stock.ts levelId (kept here to avoid importing the Db layer into the seed). */
const levelIdFor = (restaurantId: string, locationId: string, itemId: string) => seedId(`stock-level:${restaurantId}:${locationId}:${itemId}`);
