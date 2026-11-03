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
import type {
  AdBooking, AdSlot, Campaign, CampaignMessage, Consent, CouponCode, GiftCard, GiftCardTxn, GuestFeedback, Journey, LeadSource, LoyaltyEntry, LoyaltyProgram,
  MarketProfile, PromoBanner, PromoRedemption, Promotion, ReceiptPromoBlock, Referral, Segment,
} from "./crmTypes";
import type {
  Advance, AttendanceDevice, AttendancePunch, LeaveBalance, LeaveRequest, PayrollAdjustment, PayrollRun, Payslip, RotaShift, ShiftSwap, ShiftTemplate, StaffProfile,
} from "./hrTypes";
import type {
  AvailabilityWindow, ComboComponent, GoodsReceipt, InventorySettings, PurchaseOrder, Recipe, SalesChannel, StockBatch, StockCount, StockItem, StockLevel, StockMove, StockTransfer,
  StorageLocation, Supplier, SupplierInvoice, SupplierItem, SupplierPayment,
} from "./inventoryTypes";
import type { Camera, PeopleCount, RadioClip, SupportTicket, OpsSettings, OpsAck } from "@/modules/ops/types";
import type { AccountingSettings, BankStatementLine, CashAccount, CashTransfer, CostCentre, Expense, GlAccount, JournalDraft, RecurringExpense } from "./accountingTypes";

export type { Units, Currency, Role };
export * from "./crmTypes";
/* ZATCA (KSA e-invoicing) rows — 0014_zatca.sql, src/lib/zatca */
export type { ZatcaEgsUnit, ZatcaInvoiceRow, ZatcaSettings } from "@/lib/zatca/model";
export * from "./hrTypes";
export * from "./inventoryTypes";
export * from "./accountingTypes";

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
  /* HR & payroll (0010_hr.sql) — all optional; defaults in src/modules/hr/lib/comp.ts */
  salaryType?: import("./hrTypes").SalaryType;
  /** daily-paid staff (عمالة يومية) */
  dailyRate?: Units;
  allowances?: { housing: Units; transport: Units; meal: Units; other: Units };
  /** declared insurable wage (أجر الاشتراك); null = basic + fixed allowances, clamped to the legal bounds */
  insurableWage?: Units | null;
  insured?: boolean;
  /** KSA: GOSI scheme for Saudi nationals ("legacy" before Jul 2024, "new" entrants after) */
  gosiScheme?: "legacy" | "new";
  /** service-charge pool points (نقاط الخدمة) */
  servicePoints?: number;
  /** shares the POS tips pool */
  tipsEligible?: boolean;
  payMethod?: import("./hrTypes").PayMethod;
  bankName?: string | null;
  iban?: string | null;
  walletNumber?: string | null;
}

/* ───────────── Floor ───────────── */

export interface Zone extends TenantRow {
  branchId: string;
  name: Localized;
  width: number; // cm
  height: number; // cm
  sort: number;
  /** architectural drawing traced under the floor (floor module; 0003_floor.sql) */
  background?: ZoneBackground | null;
}

/** A locked image layer under a zone: the uploaded plan, scaled so `cmPerPx` image pixels match the floor. */
export interface ZoneBackground {
  /** data: URL (small JPEG/PNG) or a storage URL */
  src: string;
  /** natural size of the image in px */
  pxW: number;
  pxH: number;
  /** calibration: centimetres per image pixel */
  cmPerPx: number;
  /** top-left of the image on the floor, cm */
  x: number;
  y: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  fileName: string | null;
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
  /** waiter whose section this table is in (service calls route to them first). Optional: 0004_kitchen_waiter.sql */
  waiterId?: string | null;
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
  /* menu manager (0012_inventory.sql) — optional so older rows stay valid */
  /** price per sales channel (missing = `price`) */
  channelPrices?: Partial<Record<SalesChannel, Units>>;
  /** price per branch (missing = `price`); a channel price wins over a branch price */
  branchPrices?: Record<string, Units>;
  /** only sold inside these windows (breakfast 07:00–12:00); empty/missing = whenever open */
  schedule?: AvailabilityWindow[];
  allergens?: string[];
  calories?: number | null;
  /** a combo/meal: selling it deducts each component's recipe */
  comboOf?: ComboComponent[];
  /** hidden from these channels (e.g. not on aggregators) */
  hiddenOn?: SalesChannel[];
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
  /** pickup (pre-order) time for takeaway orders. Optional: 0002_pos.sql */
  pickupAt?: string | null;
  openedAt: string;
  closedAt: string | null;
  /** kitchen priority flag (rush / VIP). Optional: 0004_kitchen_waiter.sql */
  priority?: OrderPriority;
  /** delivery/online-order workflow: accept, prep ETA, driver hand-off, proof, aggregator. Optional: 0006_delivery.sql */
  dispatch?: DispatchInfo | null;
}
export type OrderPriority = "normal" | "rush" | "vip";

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
  /** why the bill discount was given (reason code / free text). Optional: 0002_pos.sql */
  discountReason?: string | null;
  /** set on checks created by splitting another check. Optional: 0002_pos.sql */
  splitFrom?: string | null;
  /** cached totals (recomputed with @finance/tax priceBill on every change) */
  subtotal: Units;
  discountTotal: Units;
  service: Units;
  vat: Units;
  total: Units;
  paid: Units;
  receiptNo: string | null;
  etaUuid: string | null;
  /** KSA B2B buyer for a standard (cleared) tax invoice. Optional: 0014_zatca.sql */
  taxBuyer?: import("@/lib/zatca/model").ZatcaBuyer | null;
  openedAt: string;
  closedAt: string | null;
}

export type PaymentMethod = "cash" | "card" | "wallet" | "instapay" | "online" | "gift_card";
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

export type ServiceCallType = "napkins" | "water" | "coffee" | "tea" | "clean_table" | "bill" | "help" | "other" | "waiter" | "item" | "complaint" | "pickup";
export type ServiceCallStatus = "open" | "ack" | "done" | "cancelled";

export interface ServiceCall extends TenantRow {
  branchId: string;
  tableId: string;
  type: ServiceCallType;
  text: string;
  status: ServiceCallStatus;
  source: "qr" | "waiter" | "pos" | "kitchen";
  ackBy: string | null;
  ackAt: string | null;
  doneAt: string | null;
  /** type "item": the menu item the guest asked for. Optional: 0004_kitchen_waiter.sql */
  itemId?: string | null;
  /** type "pickup" (kitchen pinged the waiter): the order whose food is ready */
  orderId?: string | null;
  /** set once when the call crossed the manager-escalation threshold (first client to notice writes it) */
  escalatedAt?: string | null;
}

/** "waiting" = a walk-in on the waitlist (no time/table yet). */
export type ReservationStatus = "pending" | "confirmed" | "seated" | "done" | "no_show" | "cancelled" | "waiting";
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
  /* floor/reservations module (0003_floor.sql) — optional so older rows stay valid */
  /** deposit asked for this booking (0 = none) */
  deposit?: Units;
  depositPaid?: boolean;
  /** waitlist: minutes quoted to the guest when they were added */
  quotedWaitMin?: number | null;
  arrivedAt?: string | null;
  seatedAt?: string | null;
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
  /* CRM (0009_crm.sql) — optional so older rows stay valid */
  gender?: "m" | "f" | null;
  consent?: Consent;
  /** how we first got the lead */
  source?: LeadSource | null;
  /** loyalty tier id (cached from lifetime points) */
  tierId?: string | null;
  lifetimePoints?: number;
  /** stamp card id → stamps */
  stamps?: Record<string, number>;
  referralCode?: string | null;
  referredBy?: string | null;
  /** set on a duplicate merged into another profile */
  mergedInto?: string | null;
  allergies?: string;
  noShows?: number;
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
  /** receipt designer (src/modules/settings/invoice). Optional: older rows fall back to DEFAULT_DESIGN in src/lib/receipt. */
  design?: InvoiceDesign;
  /** promo / QR block under the totals (marketing → own promos). Optional: 0009_crm.sql */
  promo?: ReceiptPromoBlock;
}

export interface InvoiceDesign {
  paper: "58" | "80" | "a4";
  /** PNG/JPEG/SVG data URL (kept small: the designer downsizes uploads) */
  logoDataUrl: string | null;
  accent: string;
  /** base font size in px for thermal paper (A4 scales up) */
  fontSize: number;
  fields: {
    branch: boolean;
    address: boolean;
    phone: boolean;
    taxId: boolean;
    activityCode: boolean;
    cashier: boolean;
    table: boolean;
    guests: boolean;
    orderType: boolean;
    customer: boolean;
    modifiers: boolean;
    itemNotes: boolean;
    serviceVatLines: boolean;
    payments: boolean;
    etaUuid: boolean;
  };
}

/** Egyptian Tax Authority e-receipt settings. Client id/secret are NOT here: they are server-side secrets (see README → ETA). */
export interface EtaSettings {
  enabled: boolean;
  environment: "preprod" | "prod";
  /** registered POS serial (deviceSerialNumber on the receipt) */
  posSerial: string;
  /** company trade name as registered with ETA */
  tradeName: string;
  branchAddress: { governate: string; regionCity: string; street: string; buildingNumber: string; postalCode: string };
  /** how split tender is reported (one paymentMethod per receipt) */
  splitTender: "dominant" | "others";
  /** EGS item code prefix; item codes default to `${prefix}${sku}` (e.g. EG-<RIN>-) */
  itemCodePrefix: string;
  /** true once a server function holds the client id/secret for this POS (never the secret itself) */
  credentialsConfigured: boolean;
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
  /** service-call SLA thresholds (seconds). Optional: defaults in src/lib/service-calls. 0004_kitchen_waiter.sql */
  serviceCalls?: { warnSec: number; escalateSec: number; criticalSec: number };
  /** KDS ticket aging (minutes) + sound. Optional: defaults in src/modules/kitchen/kds.ts. 0004_kitchen_waiter.sql */
  kitchen?: { amberMin: number; redMin: number; sound: boolean };
  locale: { defaultLang: "ar" | "en"; currency: Currency; timezone: string };
  /** ETA e-receipts. Optional: 0002_pos.sql (defaults in src/lib/receipt/eta.ts) */
  eta?: EtaSettings;
  /** online payments. Optional: 0008_payments.sql (defaults in src/modules/payments/config.ts) */
  payments?: PaymentSettings;
  /** online-order inbox + dispatch. Optional: 0006_delivery.sql (defaults in src/modules/delivery/settings.ts) */
  delivery?: DeliverySettings;
  /** WhatsApp / customer messaging. Optional: 0007_messaging.sql (defaults in src/lib/notify/settings.ts) */
  messaging?: import("@/lib/notify/settings").MessagingSettings;
  /** KSA ZATCA (FATOORA) e-invoicing. Optional: 0014_zatca.sql (defaults in src/lib/zatca/settings.ts) */
  zatca?: import("@/lib/zatca/model").ZatcaSettings;
  /** HR, attendance & payroll rules. Optional: 0010_hr.sql (defaults in src/modules/hr/lib/settings.ts) */
  hr?: import("@/modules/hr/lib/settings").HrSettings;
  /** inventory & purchasing. Optional: 0012_inventory.sql (defaults in src/modules/inventory/settings.ts) */
  inventory?: InventorySettings;
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

/* ───────────── POS: shifts, drawer, receipts, ledger (0002_pos.sql) ───────────── */

/** A cashier's till session on one POS device. */
export interface Shift extends TenantRow {
  branchId: string;
  /** POS device code (receipt prefix), e.g. "POS-1" */
  device: string;
  openedBy: string | null;
  closedBy: string | null;
  status: "open" | "closed";
  openingFloat: Units;
  openedAt: string;
  closedAt: string | null;
  /** blind count entered at close */
  countedCash: Units | null;
  expectedCash: Units | null;
  /** counted − expected (over > 0, short < 0) */
  difference: Units | null;
  /** sequential Z number per device */
  zNumber: number | null;
  /** frozen Z report (amounts as Units) */
  zReport: Record<string, unknown> | null;
}

export type CashMoveKind = "in" | "out" | "no_sale";
export interface CashMovement extends TenantRow {
  branchId: string;
  shiftId: string;
  kind: CashMoveKind;
  amount: Units;
  reason: string;
  actorId: string | null;
  approvedBy: string | null;
}

export type ReceiptKind = "SC" | "RC";
export type EtaStatus = "not_required" | "pending" | "submitted" | "valid" | "invalid" | "late";

/** Line of a frozen bill (Units), enough to rebuild the finance Bill for Z reports and returns. */
export interface ReceiptBillLine {
  id: string;
  itemId: string | null;
  name: Localized;
  modifiers: Localized[];
  notes: string;
  qty: number;
  unitPrice: Units;
  category: string;
  vatExempt: boolean;
  gross: Units;
  discountTotal: Units;
  net: Units;
  service: Units;
  vat: Units;
  total: Units;
}
export interface ReceiptBill {
  mode: "dine-in" | "takeaway" | "delivery";
  lines: ReceiptBillLine[];
  gross: Units;
  discount: Units;
  net: Units;
  service: Units;
  vat: Units;
  deliveryFee: Units;
  deliveryVat: Units;
  total: Units;
  payable: Units;
  rounding: Units;
}

/** One issued sale (SC) or return (RC) document — the legal receipt, with its ETA e-receipt. */
export interface Receipt extends TenantRow {
  branchId: string;
  checkId: string;
  shiftId: string | null;
  device: string;
  kind: ReceiptKind;
  /** continuous per device */
  seq: number;
  receiptNo: string;
  issuedAt: string;
  issuedBy: string | null;
  bill: ReceiptBill;
  payments: { method: PaymentMethod; amount: Units; tip: Units }[];
  /** RC: the original sale */
  refundOf: string | null;
  etaUuid: string | null;
  etaPreviousUuid: string | null;
  /** exact JSON submitted to ETA (verbatim) */
  etaJson: string | null;
  etaQr: string | null;
  etaStatus: EtaStatus;
  etaSubmissionUuid: string | null;
  etaErrors: string[];
}

/** Journal entry posted by sufra-finance rules (postSale / postReturn / postCashMove / postDrawerCount). Amounts in Units. */
export interface LedgerEntry extends TenantRow {
  branchId: string | null;
  date: string;
  sourceType: string;
  sourceId: string;
  memo: string;
  lines: { account: string; debit: Units; credit: Units; dims?: Record<string, string> }[];
}

/* ───────────── Online payments (0005_guest.sql + 0008_payments.sql; src/modules/payments) ───────────── */

export type PayProviderId = "demo" | "paymob" | "kashier" | "moyasar" | "fawry" | "geidea" | "hyperpay" | "tap";
export type OnlineMethod = "card" | "wallet" | "kiosk" | "applepay" | "mada" | "stcpay" | "meeza" | "valu";
export type PaymentIntentStatus = "requires_action" | "processing" | "succeeded" | "failed" | "cancelled" | "expired";
/** guest = pay at table · link = pay-by-link (POS/WhatsApp) · online_order = web order prepay · gift_card / wallet_topup / deposit = no check */
export type PaymentIntentKind = "guest" | "link" | "online_order" | "gift_card" | "wallet_topup" | "deposit";

/** One online payment attempt (our id "pi_…"). Written by the payment server functions (service role) — or the DemoProvider locally. */
export interface PaymentIntentRow extends TenantRow {
  branchId: string | null;
  checkId: string | null;
  orderId: string | null;
  kind: PaymentIntentKind;
  provider: PayProviderId;
  mode: "test" | "live";
  method: OnlineMethod | null;
  status: PaymentIntentStatus;
  /** bill share (units), without tip */
  amount: Units;
  tip: Units;
  currency: Currency;
  /** provider fee (units) once known; null = not reported (estimated from settings in the UI) */
  fee: Units | null;
  /** refunded so far (units) */
  refunded: Units;
  splitLabel: string | null;
  redirectUrl: string | null;
  /** provider transaction id (set by the verified webhook) */
  providerRef: string | null;
  /** provider-side order/intention/session/invoice id */
  providerOrderId: string | null;
  failureReason: string | null;
  request: Record<string, unknown>;
  /** payments row created when it succeeded (null for check-less kinds) */
  paymentId: string | null;
  /** gift card id / customer id / reservation id for check-less kinds */
  purposeRef: string | null;
  note: string;
  customer: { name: string; phone: string; email?: string | null } | null;
  createdBy: string | null;
  expiresAt: string;
  payoutId: string | null;
}

export interface PaymentRefund extends TenantRow {
  intentId: string;
  paymentId: string | null;
  amount: Units;
  reason: string;
  status: "pending" | "succeeded" | "failed";
  providerRef: string | null;
  error: string | null;
  requestedBy: string | null;
  approvedBy: string | null;
}

/** A provider settlement (bank payout) — entered by the accountant or imported from the provider report. */
export interface PaymentPayout extends TenantRow {
  provider: PayProviderId;
  periodStart: string;
  periodEnd: string;
  gross: Units;
  fees: Units;
  net: Units;
  reference: string;
  paidAt: string | null;
  note: string;
}

/** settings.payments (0008_payments.sql). Never holds secrets — keys live in Vercel env / Supabase Vault. */
export interface PaymentSettings {
  country: "EG" | "SA";
  provider: PayProviderId;
  mode: "test" | "live";
  methods: OnlineMethod[];
  /** true = the restaurant absorbs gateway fees; false = add surchargeBp to online payments */
  absorbFees: boolean;
  surchargeBp: number;
  /** pay-by-link default expiry */
  linkExpiryMin: number;
  /** fee estimate for the settlement view when the provider doesn't report it: basis points + fixed units */
  feeBp: number;
  feeFixed: Units;
  /** days from payment to bank payout (T+n) */
  payoutDays: number;
}

/* ───────────── Delivery & online-order operations (0006_delivery.sql, src/modules/delivery) ───────────── */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Where an order is in the hand-off workflow. Kitchen readiness is `readyAt` (items), not a stage. */
export type DispatchStage = "received" | "accepted" | "assigned" | "picked_up" | "arrived" | "delivered" | "failed" | "rejected" | "cancelled";
/** Who the order came through (inbox auto-accept is per channel). */
export type OrderChannel = "online_delivery" | "online_takeaway" | "qr" | "phone" | "pos" | "aggregator";
export type AggregatorId = "talabat" | "elmenus" | "hungerstation" | "jahez" | "keeta" | "other";

export interface DispatchInfo {
  stage: DispatchStage;
  channel: OrderChannel;
  receivedAt: string;
  /** unanswered by then → auto-rejected (null = never) */
  expiresAt: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  /** kitchen prep minutes promised at accept */
  prepMin: number | null;
  /** promised hand-over time (pickup ready / door) */
  promisedAt: string | null;
  readyAt: string | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failReason: string | null;
  rejectReason: string | null;
  /** 4-digit code the customer reads to the driver (proof of delivery) */
  otp: string | null;
  proof: { kind: "photo" | "otp" | "none"; photo?: string | null; at: string } | null;
  /** what the driver collected at the door */
  collected: { method: "cash" | "card" | "prepaid"; amount: Units } | null;
  driverShiftId: string | null;
  /** orders sent out together (same driver, one trip) */
  batchId: string | null;
  /** zone slug the address fell in */
  zone: string | null;
  /** aggregator orders (manual entry) */
  aggregator: { id: AggregatorId; ref: string; commissionBps: number; theirRider: boolean } | null;
  /** last "delayed" notice sent */
  delayedAt: string | null;
}

export interface DeliverySettings {
  /** accept without staff action, per channel (QR follows qrOrdering.requireWaiterConfirm) */
  autoAccept: { online_delivery: boolean; online_takeaway: boolean; phone: boolean; aggregator: boolean };
  /** unanswered online orders are rejected after this many minutes (0 = never) */
  autoRejectMin: number;
  defaultPrepMin: number;
  /** average rider speed in town, km/h (ETA estimates) */
  speedKmh: number;
  /** minutes past the promise before an order counts as late */
  lateGraceMin: number;
  proof: "none" | "photo" | "otp" | "either";
  /** orders whose doors are this close (km) can go out together */
  batchRadiusKm: number;
  maxBatch: number;
  sound: boolean;
  /** the kitchen door (restaurant pin) */
  origin: LatLng;
}

export type ZoneGeometry = { kind: "polygon"; points: LatLng[] } | { kind: "ring"; center: LatLng; radiusKm: number };

export interface DeliveryZoneRow extends TenantRow {
  branchId: string | null;
  /** what guests send as zoneId (stable) */
  slug: string;
  name: Localized;
  fee: Units;
  minOrder: Units;
  /** free delivery at or above this subtotal (null = never) */
  freeOver: Units | null;
  etaMin: number;
  etaMax: number;
  geometry: ZoneGeometry | null;
  /** active hours (null = whenever the branch is open) */
  hours: { open: string; close: string } | null;
  color: string;
  sort: number;
  active: boolean;
}

/** A rider's time on duty. Cash they collect is settled against it at the till. */
export interface DriverShift extends TenantRow {
  branchId: string;
  driverId: string;
  status: "on" | "off" | "settled";
  startedAt: string;
  endedAt: string | null;
  settlement: {
    expected: Units;
    handedIn: Units;
    /** handedIn − expected (over > 0, short < 0) */
    difference: Units;
    orders: number;
    settledBy: string | null;
    settledAt: string;
    posShiftId: string | null;
    note: string;
  } | null;
}

/** Last known position of a rider (one row per rider, unique driverId). */
export interface DriverLocation extends TenantRow {
  driverId: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  at: string;
  onShift: boolean;
}

/* ───────────── Messaging (WhatsApp) — 0007_messaging.sql, src/lib/notify, src/modules/messaging ───────────── */

export type MessageChannel = "whatsapp" | "click_to_chat" | "sms" | "log";
/**
 * scheduled → queued → sent → delivered → read   (Cloud API / BSP)
 * pending_tap → opened                            (click-to-chat: waiting for staff to tap / opened in WhatsApp)
 * received (inbound) · failed · skipped (off / opted out)
 */
export type MessageStatus = "scheduled" | "queued" | "pending_tap" | "opened" | "sent" | "delivered" | "read" | "failed" | "received" | "skipped";
export type MessageCategory = "utility" | "marketing" | "authentication" | "service";

export interface Conversation extends TenantRow {
  /** E.164 */
  phone: string;
  name: string;
  customerId: string | null;
  status: "open" | "closed";
  /** membership id */
  assignedTo: string | null;
  unread: number;
  lastMessageAt: string | null;
  /** last message FROM the customer — opens the 24h window */
  lastInboundAt: string | null;
  lastPreview: string;
  lastAutoReplyAt: string | null;
  tags: string[];
}

export interface Message extends TenantRow {
  conversationId: string;
  direction: "in" | "out";
  channel: MessageChannel;
  kind: "text" | "template" | "media" | "interactive" | "system";
  template: string | null;
  lang: "ar" | "en";
  category: MessageCategory | null;
  body: string;
  params: Record<string, string>;
  media: { kind: "image" | "document" | "video"; link: string; caption?: string } | null;
  status: MessageStatus;
  /** WhatsApp message id (wamid…) */
  providerId: string | null;
  error: string | null;
  sentBy: string | null;
  /** scheduled send time */
  sendAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  orderId: string | null;
  dedupeKey: string | null;
  /** estimated Meta charge, micro-USD */
  costMicros: number;
}

export type ConsentSource = "online_checkout" | "qr_loyalty" | "reservation" | "staff" | "inbound_keyword" | "import";
export interface MessagingConsent extends TenantRow {
  /** E.164 */
  phone: string;
  customerId: string | null;
  channel: "whatsapp" | "sms";
  status: "opted_in" | "opted_out";
  source: ConsentSource;
  /** the exact wording the customer agreed to */
  wording: string;
  capturedAt: string;
  capturedBy: string | null;
  history: { status: "opted_in" | "opted_out"; source: ConsentSource; at: string }[];
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
  shifts: Shift;
  cashMovements: CashMovement;
  receipts: Receipt;
  ledgerEntries: LedgerEntry;
  paymentIntents: PaymentIntentRow;
  paymentRefunds: PaymentRefund;
  paymentPayouts: PaymentPayout;
  deliveryZones: DeliveryZoneRow;
  driverShifts: DriverShift;
  driverLocations: DriverLocation;
  conversations: Conversation;
  messages: Message;
  messagingConsents: MessagingConsent;
  /* CRM, loyalty, marketing, platform ads (0009_crm.sql) */
  loyaltyPrograms: LoyaltyProgram;
  loyaltyLedger: LoyaltyEntry;
  promotions: Promotion;
  couponCodes: CouponCode;
  promoRedemptions: PromoRedemption;
  giftCards: GiftCard;
  giftCardTxns: GiftCardTxn;
  segments: Segment;
  campaigns: Campaign;
  campaignMessages: CampaignMessage;
  journeys: Journey;
  referrals: Referral;
  promoBanners: PromoBanner;
  guestFeedback: GuestFeedback;
  marketProfiles: MarketProfile;
  adSlots: AdSlot;
  adBookings: AdBooking;
  /* ZATCA e-invoicing (0014_zatca.sql) */
  zatcaEgsUnits: import("@/lib/zatca/model").ZatcaEgsUnit;
  zatcaInvoices: import("@/lib/zatca/model").ZatcaInvoiceRow;
  /* HR, attendance & payroll (0010_hr.sql) */
  staffProfiles: StaffProfile;
  shiftTemplates: ShiftTemplate;
  rotaShifts: RotaShift;
  shiftSwaps: ShiftSwap;
  attendancePunches: AttendancePunch;
  attendanceDevices: AttendanceDevice;
  leaveRequests: LeaveRequest;
  leaveBalances: LeaveBalance;
  advances: Advance;
  payrollAdjustments: PayrollAdjustment;
  payrollRuns: PayrollRun;
  payslips: Payslip;
  /* Inventory, recipes & purchasing (0012_inventory.sql) */
  stockItems: StockItem;
  storageLocations: StorageLocation;
  stockLevels: StockLevel;
  stockMoves: StockMove;
  recipes: Recipe;
  stockBatches: StockBatch;
  suppliers: Supplier;
  supplierItems: SupplierItem;
  purchaseOrders: PurchaseOrder;
  goodsReceipts: GoodsReceipt;
  supplierInvoices: SupplierInvoice;
  supplierPayments: SupplierPayment;
  stockCounts: StockCount;
  stockTransfers: StockTransfer;
  /* Wave 3 ops: cameras, walkie-talkie, support desk, alerts (0013_ops.sql) */
  cameras: Camera;
  peopleCounts: PeopleCount;
  radioClips: RadioClip;
  supportTickets: SupportTicket;
  opsSettings: OpsSettings;
  opsAcks: OpsAck;
  /* Accounting, cash & liquidity (0011_accounting.sql) */
  glAccounts: GlAccount;
  costCentres: CostCentre;
  journalDrafts: JournalDraft;
  accountingSettings: AccountingSettings;
  cashAccounts: CashAccount;
  cashTransfers: CashTransfer;
  expenses: Expense;
  recurringExpenses: RecurringExpense;
  bankLines: BankStatementLine;
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
  shifts: "shifts",
  cashMovements: "cash_movements",
  receipts: "receipts",
  ledgerEntries: "ledger_entries",
  paymentIntents: "payment_intents",
  paymentRefunds: "payment_refunds",
  paymentPayouts: "payment_payouts",
  deliveryZones: "delivery_zones",
  driverShifts: "driver_shifts",
  driverLocations: "driver_locations",
  conversations: "wa_conversations",
  messages: "wa_messages",
  messagingConsents: "messaging_consents",
  loyaltyPrograms: "loyalty_programs",
  loyaltyLedger: "loyalty_ledger",
  promotions: "promotions",
  couponCodes: "coupon_codes",
  promoRedemptions: "promo_redemptions",
  giftCards: "gift_cards",
  giftCardTxns: "gift_card_txns",
  segments: "segments",
  campaigns: "campaigns",
  campaignMessages: "campaign_messages",
  journeys: "journeys",
  referrals: "referrals",
  promoBanners: "promo_banners",
  guestFeedback: "guest_feedback",
  marketProfiles: "market_profiles",
  adSlots: "ad_slots",
  adBookings: "ad_bookings",
  zatcaEgsUnits: "zatca_egs_units",
  zatcaInvoices: "zatca_invoices",
  staffProfiles: "staff_profiles",
  shiftTemplates: "shift_templates",
  rotaShifts: "rota_shifts",
  shiftSwaps: "shift_swaps",
  attendancePunches: "attendance_punches",
  attendanceDevices: "attendance_devices",
  leaveRequests: "leave_requests",
  leaveBalances: "leave_balances",
  advances: "staff_advances",
  payrollAdjustments: "payroll_adjustments",
  payrollRuns: "payroll_runs",
  payslips: "payslips",
  stockItems: "stock_items",
  storageLocations: "storage_locations",
  stockLevels: "stock_levels",
  stockMoves: "stock_moves",
  recipes: "recipes",
  stockBatches: "stock_batches",
  suppliers: "suppliers",
  supplierItems: "supplier_items",
  purchaseOrders: "purchase_orders",
  goodsReceipts: "goods_receipts",
  supplierInvoices: "supplier_invoices",
  supplierPayments: "supplier_payments",
  stockCounts: "stock_counts",
  stockTransfers: "stock_transfers",
  cameras: "cameras",
  peopleCounts: "people_counts",
  radioClips: "radio_clips",
  supportTickets: "support_tickets",
  opsSettings: "ops_settings",
  opsAcks: "ops_acks",
  glAccounts: "gl_accounts",
  costCentres: "cost_centres",
  journalDrafts: "journal_drafts",
  accountingSettings: "accounting_settings",
  cashAccounts: "cash_accounts",
  cashTransfers: "cash_transfers",
  expenses: "expenses",
  recurringExpenses: "recurring_expenses",
  bankLines: "bank_statement_lines",
};
export const COLLECTIONS = Object.keys(TABLE_NAMES) as CollectionName[];
