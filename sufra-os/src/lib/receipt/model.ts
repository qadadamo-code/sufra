/**
 * Receipt model: everything a printed receipt / invoice shows, computed once from a frozen bill and the restaurant's
 * settings. The renderer (ReceiptView) only lays it out, so 58 mm, 80 mm and A4 always say the same thing.
 */
import type { Currency, InvoiceDesign, InvoiceTemplate, Localized, OrderMode, PaymentMethod, ReceiptBill, TaxSettings, Units } from "@/data/types";
import { resolveDesign } from "./design";

const L = (ar: string, en: string): Localized => ({ ar, en });

export const MODE_LABEL: Record<OrderMode | "pickup", Localized> = {
  dine_in: L("صالة", "Dine-in"),
  takeaway: L("تيك أواي", "Takeaway"),
  pickup: L("استلام", "Pickup"),
  delivery: L("دليفري", "Delivery"),
};
export const METHOD_LABEL: Record<PaymentMethod, Localized> = {
  cash: L("كاش", "Cash"),
  card: L("فيزا", "Card"),
  wallet: L("محفظة", "Wallet"),
  instapay: L("إنستاباي", "InstaPay"),
  online: L("لينك دفع", "Pay link"),
  gift_card: L("كارت هدية", "Gift card"),
};

export interface ReceiptSource {
  kind: "SC" | "RC" | "prebill";
  bill: ReceiptBill;
  tax: TaxSettings;
  invoice: InvoiceTemplate;
  /** slug: builds the promo-block QR links (loyalty card / feedback / menu) */
  restaurant: { name: Localized; phone: string | null; slug?: string };
  branch: { name: Localized; address: Localized; phone: string | null } | null;
  receiptNo: string | null;
  orderNumber: number | null;
  issuedAt: string;
  cashier: string | null;
  waiter: string | null;
  tableLabels: string[];
  guests: number | null;
  mode: OrderMode;
  pickup?: boolean;
  customer: { name: string; phone: string; address?: string | null } | null;
  payments: { method: PaymentMethod; amount: Units; tip: Units }[];
  tendered: Units | null;
  change: Units | null;
  eta: { uuid: string; qr: string } | null;
  /** RC: the original receipt number */
  refundOf?: string | null;
  /** KSA: the ZATCA document of this receipt (its QR replaces the ETA QR) — src/lib/zatca */
  zatca?: ReceiptZatca | null;
  /** currency label on totals (default EGP) */
  currency?: Currency;
}

export interface ReceiptZatca {
  uuid: string;
  qr: string;
  kind: "simplified" | "standard";
  docType: "invoice" | "credit" | "debit";
  /** false = Phase-1 QR (tags 1–5) until the server stamps the document */
  signed: boolean;
  /** stamped with a DEMO browser key — never sent to ZATCA */
  demo?: boolean;
  vatNumber: string;
  crn: string;
  /** standard invoices: buyer shown on the invoice */
  buyer?: { name: string; vatNumber?: string } | null;
}

export interface MetaRow {
  label: Localized;
  value: string | Localized;
  mono?: boolean;
}
export interface LineRow {
  name: Localized;
  qty: number;
  unitPrice: Units;
  amount: Units;
  modifiers: Localized[];
  notes: string;
  discount: Units;
}
export interface TotalRow {
  key: "subtotal" | "discount" | "service" | "vat" | "delivery" | "rounding" | "total" | "includes";
  label: Localized;
  amount: Units;
  strong?: boolean;
}
export interface ReceiptModel {
  kind: ReceiptSource["kind"];
  design: InvoiceDesign;
  language: InvoiceTemplate["language"];
  title: Localized;
  brand: { name: Localized; header: Localized; logo: string | null; branch: Localized | null; address: Localized | null; phone: string | null };
  legal: MetaRow[];
  meta: MetaRow[];
  lines: LineRow[];
  totals: TotalRow[];
  payments: { label: Localized; amount: Units; tip: Units }[];
  tendered: Units | null;
  change: Units | null;
  footer: Localized;
  eta: { uuid: string; qr: string } | null;
  zatca: ReceiptZatca | null;
  currency: Currency;
  issuedAt: string;
  /** marketing promo block (Settings.invoice.promo) — next-visit coupon, loyalty/feedback QR */
  promo: { title: Localized; body: Localized; code: string | null; qr: string | null } | null;
}

const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0).replace(/\.?0+$/, "")}%`;

export function receiptTitle(kind: ReceiptSource["kind"], vatRegistered: boolean): Localized {
  if (kind === "prebill") return L("شيك مبدئي — ليس فاتورة", "Pre-bill — not a receipt");
  if (kind === "RC") return L("إيصال مرتجع", "Return receipt");
  return vatRegistered ? L("إيصال ضريبي إلكتروني", "Electronic tax receipt") : L("إيصال", "Receipt");
}

export function buildReceiptModel(src: ReceiptSource): ReceiptModel {
  const design = resolveDesign(src.invoice);
  const f = design.fields;
  const b = src.bill;
  const legal: MetaRow[] = [];
  const z = src.zatca ?? null;
  if (z) {
    legal.push({ label: L("الرقم الضريبي", "VAT No."), value: z.vatNumber, mono: true });
    if (z.crn) legal.push({ label: L("السجل التجاري", "CR No."), value: z.crn, mono: true });
  }
  if (!z && f.taxId && src.tax.taxId) legal.push({ label: L("رقم التسجيل الضريبي", "Tax reg. no (RIN)"), value: src.tax.taxId, mono: true });
  if (!z && f.activityCode && src.tax.activityCode) legal.push({ label: L("كود النشاط", "Activity code"), value: src.tax.activityCode, mono: true });
  if (!z && src.tax.commercialRegister) legal.push({ label: L("سجل تجاري", "Commercial reg."), value: src.tax.commercialRegister, mono: true });

  const meta: MetaRow[] = [];
  if (src.receiptNo) meta.push({ label: L("رقم الإيصال", "Receipt no"), value: src.receiptNo, mono: true });
  if (src.refundOf) meta.push({ label: L("مرتجع من", "Return of"), value: src.refundOf, mono: true });
  if (z?.buyer) {
    meta.push({ label: L("المشتري", "Buyer"), value: z.buyer.name });
    if (z.buyer.vatNumber) meta.push({ label: L("الرقم الضريبي للمشتري", "Buyer VAT No."), value: z.buyer.vatNumber, mono: true });
  }
  if (src.orderNumber != null) meta.push({ label: L("رقم الطلب", "Order"), value: `#${src.orderNumber}`, mono: true });
  meta.push({ label: L("التاريخ", "Date"), value: formatStamp(src.issuedAt), mono: true });
  if (f.orderType) meta.push({ label: L("النوع", "Type"), value: MODE_LABEL[src.pickup ? "pickup" : src.mode] });
  if (f.table && src.tableLabels.length) meta.push({ label: L("ترابيزة", "Table"), value: src.tableLabels.join(" + "), mono: true });
  if (f.guests && src.guests && src.mode === "dine_in") meta.push({ label: L("أفراد", "Guests"), value: String(src.guests), mono: true });
  if (f.cashier && src.cashier) meta.push({ label: L("الكاشير", "Cashier"), value: src.cashier });
  if (src.invoice.showWaiter && src.waiter) meta.push({ label: L("الجرسون", "Waiter"), value: src.waiter });
  if (f.customer && src.customer) {
    meta.push({ label: L("العميل", "Customer"), value: src.customer.name || src.customer.phone });
    if (src.customer.phone) meta.push({ label: L("موبايل", "Phone"), value: src.customer.phone, mono: true });
    if (src.customer.address) meta.push({ label: L("العنوان", "Address"), value: src.customer.address });
  }

  const lines: LineRow[] = b.lines.map((l) => ({
    name: l.name,
    qty: l.qty,
    unitPrice: l.unitPrice,
    amount: l.gross,
    modifiers: f.modifiers ? l.modifiers : [],
    notes: f.itemNotes ? l.notes : "",
    discount: l.discountTotal,
  }));

  const inclusive = src.tax.priceMode === "inclusive";
  const totals: TotalRow[] = [{ key: "subtotal", label: L("الإجمالي قبل الخصم", "Subtotal"), amount: b.gross }];
  if (b.discount) totals.push({ key: "discount", label: L("خصم", "Discount"), amount: -b.discount });
  if (!inclusive) {
    if (b.service) totals.push({ key: "service", label: L(`خدمة ${pct(src.tax.serviceRate)}`, `Service ${pct(src.tax.serviceRate)}`), amount: b.service });
    if (b.vat && f.serviceVatLines) totals.push({ key: "vat", label: L(`ضريبة القيمة المضافة ${pct(src.tax.vatRate)}`, `VAT ${pct(src.tax.vatRate)}`), amount: b.vat });
    else if (b.vat) totals.push({ key: "vat", label: L("ضرائب", "Taxes"), amount: b.vat });
  }
  if (b.deliveryFee) totals.push({ key: "delivery", label: L("توصيل", "Delivery"), amount: b.deliveryFee });
  if (b.rounding) totals.push({ key: "rounding", label: L("تقريب", "Rounding"), amount: b.rounding });
  totals.push({ key: "total", label: L("الإجمالي", "Total"), amount: b.payable, strong: true });
  if (inclusive && f.serviceVatLines && (b.service || b.vat)) {
    if (b.service) totals.push({ key: "includes", label: L(`شامل خدمة ${pct(src.tax.serviceRate)}`, `Incl. service ${pct(src.tax.serviceRate)}`), amount: b.service });
    if (b.vat) totals.push({ key: "includes", label: L(`شامل ضريبة ${pct(src.tax.vatRate)}`, `Incl. VAT ${pct(src.tax.vatRate)}`), amount: b.vat });
  }

  return {
    kind: src.kind,
    design,
    language: src.invoice.language,
    title: z && src.kind !== "prebill" ? zatcaTitle(z) : receiptTitle(src.kind, src.tax.vatRegistered),
    brand: {
      name: src.restaurant.name,
      header: src.invoice.header,
      logo: src.invoice.showLogo ? design.logoDataUrl : null,
      branch: f.branch && src.branch ? src.branch.name : null,
      address: f.address && src.branch ? src.branch.address : null,
      phone: f.phone ? (src.branch?.phone ?? src.restaurant.phone) : null,
    },
    legal,
    meta,
    lines,
    totals,
    payments: f.payments ? src.payments.map((p) => ({ label: METHOD_LABEL[p.method], amount: p.amount, tip: p.tip })) : [],
    tendered: f.payments ? src.tendered : null,
    change: f.payments ? src.change : null,
    footer: src.invoice.footer,
    eta: src.invoice.showQr && src.eta && !z ? src.eta : null,
    // ZATCA QR is mandatory on KSA tax invoices — printed regardless of the designer's QR toggle
    zatca: z,
    currency: src.currency ?? "EGP",
    issuedAt: src.issuedAt,
    promo: promoBlock(src),
  };
}

/** Arabic is mandatory on KSA tax invoices; the English line is a courtesy. */
export function zatcaTitle(z: Pick<ReceiptZatca, "kind" | "docType">): Localized {
  if (z.docType === "credit") return z.kind === "standard" ? L("إشعار دائن", "Credit note") : L("إشعار دائن مبسط", "Simplified credit note");
  if (z.docType === "debit") return z.kind === "standard" ? L("إشعار مدين", "Debit note") : L("إشعار مدين مبسط", "Simplified debit note");
  return z.kind === "standard" ? L("فاتورة ضريبية", "Tax invoice") : L("فاتورة ضريبية مبسطة", "Simplified tax invoice");
}

/** Extension point for marketing: the receipt promo block, if enabled and in its dates (not on returns). */
export function promoBlock(src: Pick<ReceiptSource, "invoice" | "kind" | "issuedAt" | "restaurant">): ReceiptModel["promo"] {
  const p = src.invoice.promo;
  if (!p?.enabled || src.kind === "RC") return null;
  if ((p.startsAt && src.issuedAt < p.startsAt) || (p.endsAt && src.issuedAt >= p.endsAt)) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://sufra.app";
  const appBase = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/app/";
  const base = `${origin}${appBase}r/${src.restaurant.slug ?? ""}`;
  const qr = p.qr === "none" ? null : p.qr === "url" ? p.url : !src.restaurant.slug ? null : p.qr === "loyalty" ? `${base}/me` : p.qr === "menu" ? base : `${base}/me?feedback=1`;
  return { title: p.title, body: p.body, code: p.code, qr: qr || null };
}

/** "2026-10-23 21:04" in Cairo-local wall time of the device (Latin digits, like ETA). */
export function formatStamp(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
