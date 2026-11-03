/**
 * Inventory, recipes & purchasing rows (supabase/migrations/0012_inventory.sql; src/modules/inventory, src/modules/menu).
 *
 *  - Quantities are in the stock item's BASE unit (g, ml, pc) and may carry up to 3 decimals (0.5 g of saffron).
 *    Cost math runs on integer milli-base-units through sufra-finance `applyMove` (moving weighted average, EAS 2 / IAS 2).
 *  - Money is Units (0.00001 EGP). A unit cost is per ONE base unit (e.g. per gram).
 *  - Rates are basis points (14% = 1400).
 */
import type { Units } from "@/lib/money";

interface Row {
  id: string;
  createdAt: string;
  updatedAt: string;
  restaurantId: string;
}
interface Loc {
  ar: string;
  en: string;
}

export type BaseUnit = "g" | "ml" | "pc";
/** a pack / purchase / count unit of one stock item: `factor` base units each (kg = 1000 g, carton = 24 pc) */
export interface PackUnit {
  id: string;
  name: Loc;
  factor: number;
}

export type StockCategory = "produce" | "meat" | "fish" | "dairy" | "dry" | "spices" | "bakery" | "drinks" | "packaging" | "cleaning" | "prep";
/** which inventory / COGS accounts the item posts to (sufra-finance 1301/5101 · 1302/5102 · 1303) */
export type StockAccount = "food" | "beverage" | "packaging";

export interface StockLevels {
  /** reorder point: below this → low-stock alert + suggested order */
  min: number;
  /** par: what a normal day needs on the shelf (suggested orders fill up to par + forecast) */
  par: number;
  /** don't order beyond this (storage / shelf life) */
  max: number;
}

/** An ingredient, a bought-in product (cans, water) or a prep item (sub-recipe made in house: sauces, doughs). */
export interface StockItem extends Row {
  name: Loc;
  sku: string;
  category: StockCategory;
  kind: "raw" | "prep";
  baseUnit: BaseUnit;
  /** extra units for buying / counting (kg, carton=24, sack 25 kg …) */
  packs: PackUnit[];
  /** unit shown on count sheets (pack id or the base unit) */
  countUnit: string;
  account: StockAccount;
  /** defaults for every branch; per-branch override in `branchLevels` */
  levels: StockLevels;
  branchLevels: Record<string, StockLevels>;
  supplierIds: string[];
  preferredSupplierId: string | null;
  /** last purchase cost per base unit (net of recoverable VAT) */
  lastCost: Units;
  /** the location this item is received into by default (per branch: first match wins) */
  defaultLocationIds: string[];
  /** batch & expiry tracking (dairy, meat) */
  trackBatches: boolean;
  shelfLifeDays: number | null;
  /** VAT on purchases, bp (fresh produce/meat 0, processed 1400) */
  vatBp: number;
  /** edible yield after trimming, bp (whole chicken → 7000). Recipes state the trimmed weight; cost is grossed up. */
  yieldBp: number;
  allergens: string[];
  active: boolean;
  note: string;
  /** matching product key in the Sufra supplier marketplace (compare prices / order online), e.g. "tomato" */
  marketKey?: string | null;
}

export type LocationKind = "store" | "kitchen" | "bar" | "fridge" | "freezer" | "central";
export interface StorageLocation extends Row {
  branchId: string;
  name: Loc;
  kind: LocationKind;
  sort: number;
  active: boolean;
}

/** On hand per item per location. id = stable per (item, location) — see levelId(). */
export interface StockLevel extends Row {
  branchId: string;
  locationId: string;
  itemId: string;
  qty: number;
  /** value of what is on hand (weighted average) */
  value: Units;
  lastCountAt: string | null;
  lastMoveAt: string | null;
}

export type MoveKind =
  | "opening"
  | "receive"
  | "sale"
  | "waste"
  | "staff_meal"
  | "transfer_out"
  | "transfer_in"
  | "production_in"
  | "production_out"
  | "count_adjust"
  | "supplier_return"
  | "sale_reversal";

export type WasteReason = "expired" | "spoiled" | "burnt" | "dropped" | "overproduction" | "returned_by_guest" | "void_after_send" | "staff_meal" | "other";

/** Every change to stock. Append-only; qty/value are signed (+ in, − out). */
export interface StockMove extends Row {
  branchId: string;
  locationId: string;
  itemId: string;
  kind: MoveKind;
  qty: number;
  value: Units;
  /** value per base unit at the time of the move */
  unitCost: Units;
  /** what caused it: orderItem / purchaseOrder / transfer / count / production / waste */
  refType: string | null;
  refId: string | null;
  /** groups the moves of one action (a sale line, a production run) */
  groupId: string | null;
  reason: WasteReason | null;
  note: string;
  /** waste photo (data: URL, downsized) */
  photo: string | null;
  batchId: string | null;
  at: string;
  by: string | null;
}

/** Recipe / bill of materials for a menu item, a modifier ("extra cheese" adds 30 g) or a prep item (yield). */
export interface RecipeLine {
  itemId: string;
  /** base units for one portion (menu item / modifier) or for one batch (prep item, see yieldQty) */
  qty: number;
  /** optional cooking/handling loss on top, bp */
  lossBp?: number;
  note?: string;
}
export interface Recipe extends Row {
  ownerType: "menu_item" | "modifier" | "prep";
  ownerId: string;
  /** modifier recipes only: applies to this menu item ("large" mango juice ≠ "large" lemon-mint); null = every item */
  scopeItemId?: string | null;
  lines: RecipeLine[];
  /** prep items: base units one batch yields (5 kg tahini sauce = 5000). Menu items/modifiers: 1. */
  yieldQty: number;
  /** modifiers that swap an ingredient ("no onion"): lines with negative qty remove it */
  method: string;
  updatedBy: string | null;
}

export interface StockBatch extends Row {
  branchId: string;
  locationId: string;
  itemId: string;
  lot: string;
  receivedAt: string;
  expiresOn: string | null;
  qty: number;
  remaining: number;
  poId: string | null;
}

/* ───────── suppliers & purchasing ───────── */

export interface Supplier extends Row {
  name: Loc;
  contactName: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  taxId: string;
  categories: StockCategory[];
  area: Loc;
  /** credit terms: days from invoice to due date */
  termsDays: number;
  /** days from order to delivery */
  leadDays: number;
  /** delivery weekdays 0=Sun … 6=Sat */
  days: number[];
  minOrder: Units;
  deliveryFee: Units;
  /** linked marketplace supplier (copied catalogue id, e.g. "s04") */
  marketplaceId: string | null;
  eInvoice: boolean;
  rating: number;
  active: boolean;
  note: string;
}

/** A supplier's price for one stock item, per pack. Keeps the price history (price-increase alerts). */
export interface SupplierItem extends Row {
  supplierId: string;
  itemId: string;
  /** what they sell: pack name + base units per pack */
  packName: Loc;
  packFactor: number;
  price: Units;
  vatBp: number;
  /** supplier's own code / marketplace product id */
  code: string | null;
  history: { price: Units; at: string }[];
  preferred: boolean;
}

export type PoStatus = "draft" | "sent" | "partial" | "received" | "invoiced" | "paid" | "cancelled";
export interface PoLine {
  id: string;
  itemId: string;
  name: Loc;
  packName: Loc;
  packFactor: number;
  /** ordered packs */
  qty: number;
  /** agreed price per pack (net) */
  price: Units;
  vatBp: number;
  /** received so far */
  receivedQty: number;
  receivedValue: Units;
}
export interface MarketplaceInfo {
  /** copied marketplace supplier id (s01…) */
  supplierRef: string;
  /** supplier's Sufra plan (subscription + commission per delivered order) */
  plan: "starter" | "growth" | "distributor";
  commissionPct: number;
  /** commission Sufra charges the SUPPLIER on the delivered value (not the restaurant) */
  commission: Units;
  /** delivered (chargeable) value before VAT */
  base: Units;
  collectedBySufra: boolean;
}
export interface PurchaseOrder extends Row {
  branchId: string;
  locationId: string;
  supplierId: string;
  number: string;
  status: PoStatus;
  channel: "direct" | "marketplace";
  lines: PoLine[];
  net: Units;
  vat: Units;
  total: Units;
  deliveryFee: Units;
  expectedAt: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  invoiceId: string | null;
  note: string;
  createdBy: string | null;
  approvedBy: string | null;
  /** sent how (WhatsApp / phone / email / Sufra marketplace) */
  sentVia: "whatsapp" | "phone" | "email" | "marketplace" | null;
  marketplace: MarketplaceInfo | null;
  /** from a suggestion run */
  suggested: boolean;
}

/** Goods received note — what actually arrived against a PO (quantity & price variance). */
export interface GrnLine {
  lineId: string;
  itemId: string;
  qty: number;
  price: Units;
  packFactor: number;
  lot: string | null;
  expiresOn: string | null;
  note: string;
}
export interface GoodsReceipt extends Row {
  branchId: string;
  locationId: string;
  poId: string;
  supplierId: string;
  lines: GrnLine[];
  value: Units;
  receivedAt: string;
  receivedBy: string | null;
  note: string;
}

export interface SupplierInvoiceLine {
  account: StockAccount | "expense";
  net: Units;
  vat: Units;
}
export interface SupplierInvoice extends Row {
  branchId: string;
  supplierId: string;
  poId: string | null;
  number: string;
  date: string;
  dueDate: string;
  lines: SupplierInvoiceLine[];
  net: Units;
  vat: Units;
  total: Units;
  paid: Units;
  status: "open" | "partial" | "paid";
  /** ETA e-invoice uuid from the supplier (B2B) */
  etaUuid: string | null;
  ledgerEntryId: string | null;
}

export interface SupplierPayment extends Row {
  supplierId: string;
  invoiceId: string | null;
  amount: Units;
  method: "cash" | "bank" | "instapay" | "cheque";
  reference: string;
  paidAt: string;
  by: string | null;
}

export interface CountLine {
  itemId: string;
  locationId: string;
  /** frozen when the count starts (hidden on a blind count) */
  expected: number;
  counted: number | null;
  unitCost: Units;
}
export interface StockCount extends Row {
  branchId: string;
  /** null = every location */
  locationId: string | null;
  kind: "full" | "partial";
  blind: boolean;
  status: "open" | "submitted" | "approved" | "cancelled";
  lines: CountLine[];
  startedBy: string | null;
  startedAt: string;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  /** counted − expected, valued (Units, signed) */
  varianceValue: Units;
  note: string;
}

export interface StockTransfer extends Row {
  fromBranchId: string;
  fromLocationId: string;
  toBranchId: string;
  toLocationId: string;
  status: "requested" | "sent" | "received" | "cancelled";
  lines: { itemId: string; qty: number; unitCost: Units }[];
  requestedBy: string | null;
  sentAt: string | null;
  receivedAt: string | null;
  note: string;
}

export interface InventorySettings {
  /** when a sale takes stock out: "send" = when the line fires to the kitchen (default), "paid" = when the check closes */
  deductAt: "send" | "paid";
  /** count variance above this (bp of expected value) is flagged */
  varianceAlertBp: number;
  /** a supplier price rise above this (bp) raises an alert */
  priceAlertBp: number;
  /** days before expiry to warn */
  expiryWarnDays: number;
  /** let stock go negative instead of blocking (always true for sales) */
  allowNegative: boolean;
  /** forecast window for suggested orders (days of cover) */
  coverDays: number;
  /** a count above this variance needs a manager to approve */
  approvalVarianceValue: Units;
}

/* ───────── menu extras (optional MenuItem columns, 0012_inventory.sql) ───────── */

export type SalesChannel = "dine_in" | "takeaway" | "delivery" | "qr" | "online" | "aggregator";
export interface AvailabilityWindow {
  /** 0=Sun … 6=Sat; empty = every day */
  days: number[];
  /** "07:00" – "12:00" (may wrap past midnight) */
  from: string;
  to: string;
}
export interface ComboComponent {
  itemId: string;
  qty: number;
}
