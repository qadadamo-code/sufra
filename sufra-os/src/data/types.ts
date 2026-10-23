/**
 * Sufra OS data model (TypeScript side). camelCase here, snake_case in Postgres
 * (supabase/migrations/0001_init.sql) — the Supabase adapter converts keys both ways.
 *
 * Conventions
 *  - Every id is a UUID string.
 *  - Every tenant row carries `restaurantId` (multi-tenant, enforced by RLS in Postgres).
 *  - Timestamps are ISO-8601 strings (timestamptz in Postgres).
 *  - Money is `Units` (integer, 0.00001 of the currency — the sufra-finance Amount unit). See src/lib/money.ts.
 *  - Rates are basis points (14% = 1400), like sufra-finance.
 *  - Floor geometry is centimetres on the real floor, like sufra-floor (x/y = table centre).
 */
import type { Units, Currency } from "@/lib/money";
import type { Role } from "@/auth/roles";

export type { Units, Currency, Role };

export interface Localized {
  ar: string;
  en: string;
}

export interface BaseRow {
  id: string;
  createdAt: string;
  updatedAt: string;
}
export interface TenantRow extends BaseRow {
  restaurantId: string;
}

/* ───────────── Tenancy ───────────── */

export interface Restaurant extends BaseRow {
  slug: string;
  name: Localized;
  ownerUserId: string | null;
  country: "EG" | "SA";
  currency: Currency;
  timezone: string;
  /** brand colour for avatars/receipts (token-friendly hex) */
  brandColor: string;
  phone: string | null;
  plan: "trial" | "starter" | "pro" | "chain";
  active: boolean;
}

export interface Branch extends TenantRow {
  name: Localized;
  slug: string;
  address: Localized;
  phone: string | null;
  isDefault: boolean;
  /** ETA branch code used on e-receipts (`0` for the main branch) */
  etaBranchCode: string;
  openingHours: { open: string; close: string } | null;
}

/**
 * Staff member of a restaurant. `userId` is the Supabase auth user when the person logs in with email;
 * PIN-only staff (most cashiers/waiters/kitchen) have `userId = null` and log in on shared devices.
 * The PIN hash never leaves the server/adapter; rows only say `hasPin`.
 */
export interface Membership extends TenantRow {
  userId: string | null;
  name: string;
  role: Role;
  /** empty = all branches */
  branchIds: string[];
  phone: string | null;
  email: string | null;
  color: string;
  hasPin: boolean;
  active: boolean;
  lastSeenAt: string | null;
}

/** Example of a role-limited table: only owner/admin/accountant can read it (RLS). */
export interface StaffCompensation extends TenantRow {
  membershipId: string;
  monthlySalary: Units;
  hourlyRate: Units;
}

/* ───────────── Floor ───────────── */

export interface Zone extends TenantRow {
  branchId: string;
  name: Localized;
  width: number; // cm
  height: number; // cm
  sort: number;
}

export type TableShape = "square" | "rect" | "round" | "oval" | "booth" | "bar";
/** Stored, fast-to-read status. The floor module may also derive it from checks/reservations. */
export type TableStatus = "free" | "seated" | "ordered" | "bill" | "dirty" | "reserved" | "blocked";

export interface DiningTable extends TenantRow {
  branchId: string;
  zoneId: string;
  label: string;
  /** printed in the QR: /r/:slug/t/:code */
  code: string;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number; // degrees, multiples of 45
  seatsOverride: number | null; // null = computed from size (sufra-floor seats.ts)
  status: TableStatus;
  statusSince: string | null;
  active: boolean;
}

export type DecorKind = "wall" | "pillar" | "door" | "counter" | "plant" | "window";
export interface FloorDecor extends TenantRow {
  zoneId: string;
  kind: DecorKind;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/** Tables joined on purpose even though they are not touching (sufra-floor ManualLink). */
export interface TableLink extends TenantRow {
  tableIds: string[];
}

/* ───────────── Menu ───────────── */

export interface KitchenStation extends TenantRow {
  branchId: string;
  name: Localized;
  color: string;
  printerId: string | null;
  sort: number;
}

export interface Printer extends TenantRow {
  branchId: string;
  name: string;
  kind: "receipt" | "kitchen" | "label";
  connection: "network" | "usb" | "bluetooth" | "cloud";
  address: string | null;
  paperWidth: 58 | 80;
  stationId: string | null;
  active: boolean;
}

export interface MenuCategory extends TenantRow {
  name: Localized;
  sort: number;
  color: string;
  /** lucide icon name, purely decorative */
  icon: string;
  stationId: string | null;
  active: boolean;
}

export type MenuTag = "spicy" | "veg" | "new" | "popular" | "chef" | "kids" | "gluten_free";

export interface MenuItem extends TenantRow {
  categoryId: string;
  name: Localized;
  description: Localized;
  price: Units;
  cost: Units | null;
  sku: string | null;
  /** overrides the category's station */
  stationId: string | null;
  modifierGroupIds: string[];
  tags: MenuTag[];
  prepMinutes: number;
  /** false = "86'd" (sold out today) */
  available: boolean;
  vatExempt: boolean;
  imageUrl: string | null;
  sort: number;
  active: boolean;
}

export interface ModifierGroup extends TenantRow {
  name: Localized;
  /** 0 = optional */
  min: number;
  /** 1 = pick one (radio) */
  max: number;
  sort: number;
}

export interface Modifier extends TenantRow {
  groupId: string;
  name: Localized;
  price: Units;
  isDefault: boolean;
  available: boolean;
  sort: number;
}

/* ───────────── Orders ───────────── */

export type OrderMode = "dine_in" | "takeaway" | "delivery";
export type OrderSource = "pos" | "waiter" | "qr" | "online" | "phone" | "aggregator";
export type OrderStatus = "open" | "sent" | "ready" | "served" | "closed" | "void";
export type DeliveryStatus = "pending" | "assigned" | "picked_up" | "delivered" | "failed";

export interface DeliveryInfo {
  address: string;
  area: string;
  notes: string;
  lat: number | null;
  lng: number | null;
}

export interface Order extends TenantRow {
  branchId: string;
  /** daily sequence per branch, printed on tickets */
  number: number;
  mode: OrderMode;
  source: OrderSource;
  status: OrderStatus;
  tableIds: string[];
  checkId: string | null;
  customerId: string | null;
  guests: number;
  openedBy: string | null; // membership id (null for guest QR / online)
  waiterId: string | null;
  note: string;
  delivery: DeliveryInfo | null;
  deliveryStatus: DeliveryStatus | null;
  driverId: string | null;
  deliveryFee: Units;
  openedAt: string;
  closedAt: string | null;
}

export type OrderItemStatus = "new" | "sent" | "preparing" | "ready" | "served" | "void";

export interface OrderItemModifier {
  groupId: string;
  modifierId: string;
  name: Localized;
  price: Units;
}

export interface OrderItem extends TenantRow {
  orderId: string;
  itemId: string;
  /** snapshot at order time */
  name: Localized;
  qty: number;
  unitPrice: Units;
  modifiers: OrderItemModifier[];
  notes: string;
  seat: number | null;
  course: number;
  status: OrderItemStatus;
  stationId: string | null;
  /** lets a merged bill be split back to its tables (sufra-floor CheckLine.originTableId) */
  originTableId: string | null;
  discount: Units;
  firedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  voidReason: string | null;
  voidedBy: string | null;
  createdBy: string | null;
}

export type CheckStatus = "open" | "bill_requested" | "paid" | "void";
export type Discount = { kind: "percent"; rate: number } | { kind: "amount"; value: Units };

export interface Check extends TenantRow {
  branchId: string;
  /** first id is the primary table */
  tableIds: string[];
  status: CheckStatus;
  guests: number;
  reservationId: string | null;
  customerId: string | null;
  discount: Discount | null;
  discountApprovedBy: string | null;
  /** cached totals (recomputed with @finance/tax priceBill on every change) */
  subtotal: Units;
  discountTotal: Units;
  service: Units;
  vat: Units;
  total: Units;
  paid: Units;
  receiptNo: string | null;
  etaUuid: string | null;
  openedAt: string;
  closedAt: string | null;
}

export type PaymentMethod = "cash" | "card" | "wallet" | "instapay" | "online";
export type PaymentStatus = "captured" | "refunded" | "void";

export interface Payment extends TenantRow {
  branchId: string;
  checkId: string;
  method: PaymentMethod;
  amount: Units;
  tip: Units;
  /** cash handed over (cash only) */
  tendered: Units | null;
  change: Units | null;
  reference: string | null;
  /** "Ahmed's share" / seat 2 — for split bills */
  splitLabel: string | null;
  status: PaymentStatus;
  takenBy: string | null;
  refundOf: string | null;
}

/* ───────────── Service ───────────── */

export type ServiceCallType = "napkins" | "water" | "coffee" | "tea" | "clean_table" | "bill" | "help" | "other";
export type ServiceCallStatus = "open" | "ack" | "done" | "cancelled";

export interface ServiceCall extends TenantRow {
  branchId: string;
  tableId: string;
  type: ServiceCallType;
  text: string;
  status: ServiceCallStatus;
  source: "qr" | "waiter" | "pos";
  ackBy: string | null;
  ackAt: string | null;
  doneAt: string | null;
}

export type ReservationStatus = "pending" | "confirmed" | "seated" | "done" | "no_show" | "cancelled";
export type ReservationTag = "birthday" | "vip" | "kids" | "smoking" | "quiet";

export interface Reservation extends TenantRow {
  branchId: string;
  customerId: string | null;
  name: string;
  phone: string;
  party: number;
  startsAt: string;
  durationMin: number;
  tableIds: string[];
  status: ReservationStatus;
  note: string;
  tags: ReservationTag[];
  source: "phone" | "walk_in" | "online" | "app";
}

export interface Customer extends TenantRow {
  phone: string;
  name: string;
  email: string | null;
  visits: number;
  lastVisitAt: string | null;
  totalSpent: Units;
  loyaltyPoints: number;
  tags: string[];
  notes: string;
  birthday: string | null; // YYYY-MM-DD
  addresses: DeliveryInfo[];
}

/* ───────────── Settings & audit ───────────── */

/** Mirrors @finance/tax TaxProfile (JSON-safe). */
export interface TaxSettings {
  vatRegistered: boolean;
  vatRate: number;
  vatCode: { type: string; subType: string };
  serviceRate: number;
  serviceModes: OrderMode[];
  vatOnService: boolean;
  serviceCode: { type: string; subType: string } | null;
  priceMode: "exclusive" | "inclusive";
  vatOnDelivery: boolean;
  taxDecimals: number;
  /** Egyptian tax registration number (RIN) */
  taxId: string;
  commercialRegister: string;
  activityCode: string;
}

export interface InvoiceTemplate {
  header: Localized;
  footer: Localized;
  showLogo: boolean;
  showQr: boolean;
  showTaxBreakdown: boolean;
  showWaiter: boolean;
  language: "ar" | "en" | "both";
  paperWidth: 58 | 80;
}

export interface Settings extends TenantRow {
  tax: TaxSettings;
  invoice: InvoiceTemplate;
  /** discounts above this % need a manager PIN */
  discountApprovalPct: number;
  /** a shared terminal locks back to the PIN screen after this many idle minutes (0 = never) */
  autoLockMinutes: number;
  tipsEnabled: boolean;
  qrOrdering: { enabled: boolean; requireWaiterConfirm: boolean; allowServiceCalls: boolean };
  locale: { defaultLang: "ar" | "en"; currency: Currency; timezone: string };
}

export interface AuditEntry extends TenantRow {
  branchId: string | null;
  /** membership acting (PIN user on a shared device) */
  actorId: string | null;
  action: string; // e.g. "order.void", "check.discount", "drawer.open"
  entity: string;
  entityId: string | null;
  data: Record<string, unknown>;
  approvedBy: string | null;
}

/* ───────────── Collections ───────────── */

export interface Collections {
  restaurants: Restaurant;
  branches: Branch;
  memberships: Membership;
  staffCompensation: StaffCompensation;
  zones: Zone;
  tables: DiningTable;
  floorDecor: FloorDecor;
  tableLinks: TableLink;
  kitchenStations: KitchenStation;
  printers: Printer;
  menuCategories: MenuCategory;
  menuItems: MenuItem;
  modifierGroups: ModifierGroup;
  modifiers: Modifier;
  orders: Order;
  orderItems: OrderItem;
  checks: Check;
  payments: Payment;
  serviceCalls: ServiceCall;
  reservations: Reservation;
  customers: Customer;
  settings: Settings;
  auditLog: AuditEntry;
}
export type CollectionName = keyof Collections;
export type RowOf<C extends CollectionName> = Collections[C];

/** Postgres table for each collection. */
export const TABLE_NAMES: { [C in CollectionName]: string } = {
  restaurants: "restaurants",
  branches: "branches",
  memberships: "memberships",
  staffCompensation: "staff_compensation",
  zones: "zones",
  tables: "dining_tables",
  floorDecor: "floor_decor",
  tableLinks: "table_links",
  kitchenStations: "kitchen_stations",
  printers: "printers",
  menuCategories: "menu_categories",
  menuItems: "menu_items",
  modifierGroups: "modifier_groups",
  modifiers: "modifiers",
  orders: "orders",
  orderItems: "order_items",
  checks: "checks",
  payments: "payments",
  serviceCalls: "service_calls",
  reservations: "reservations",
  customers: "customers",
  settings: "settings",
  auditLog: "audit_log",
};
export const COLLECTIONS = Object.keys(TABLE_NAMES) as CollectionName[];
