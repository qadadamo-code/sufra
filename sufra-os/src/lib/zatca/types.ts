/**
 * ZATCA e-invoice input model (pure data, no `@/` imports — the server functions import this file too).
 * Money is integer **halalas** (1 SAR = 100); rates are basis points (15% = 1500), like sufra-finance.
 */

/** simplified = B2C (reported within 24 h) · standard = B2B/B2G (cleared before it is handed to the buyer) */
export type ZatcaKind = "simplified" | "standard";
export type ZatcaDocType = "invoice" | "credit" | "debit";

/** UN/CEFACT 1001 subset (XML Implementation Standard §11.2.1) */
export const TYPE_CODE: Record<ZatcaDocType, "388" | "381" | "383"> = { invoice: "388", credit: "381", debit: "383" };
/** KSA-2: positions 1–2 = 01 standard / 02 simplified; 3 third party, 4 nominal, 5 export, 6 summary, 7 self-billed */
export const subtypeName = (k: ZatcaKind) => (k === "standard" ? "0100000" : "0200000");

/** VAT category (UNCL5305 subset): S standard · Z zero rated · E exempt · O not subject to VAT */
export type VatCategory = "S" | "Z" | "E" | "O";

export interface ZatcaAddress {
  street: string;
  /** 4 digits (BR-KSA-37) */
  building: string;
  /** 4-digit additional number of the national address (cbc:PlotIdentification) */
  additionalNo?: string;
  /** district (KSA-3, cbc:CitySubdivisionName) */
  district: string;
  city: string;
  /** 5 digits for SA (BR-KSA-66) */
  postalCode: string;
  /** ISO 3166-1 alpha-2 */
  country: string;
}

export interface ZatcaSeller {
  /** registration name — Arabic is mandatory on KSA tax invoices (VAT Implementing Regulations art. 53) */
  name: string;
  /** 15 digits, starts and ends with 3 */
  vatNumber: string;
  /** seller identification (BT-29) — Commercial Registration by default */
  id: { scheme: "CRN" | "MOM" | "MLS" | "700" | "SAG" | "OTH"; value: string };
  address: ZatcaAddress;
}

export interface ZatcaBuyer {
  name: string;
  /** buyer VAT number (BT-48) → standard invoice */
  vatNumber?: string;
  /** other buyer ID (BT-46) when not VAT registered: TIN, CRN, MOM, MLS, 700, SAG, NAT, GCC, IQA, PAS, OTH */
  otherId?: { scheme: string; value: string };
  address?: Partial<ZatcaAddress>;
}

export interface ZatcaLine {
  id: string;
  name: string;
  /** up to 3 decimals */
  qty: number;
  /** line net amount after discounts (BT-131), halalas */
  net: number;
  /** line VAT (KSA-11), halalas */
  vat: number;
  /** basis points */
  vatRate: number;
  category: VatCategory;
  /** required for Z/E/O (BR-KSA-CL-04), e.g. VATEX-SA-OOS */
  exemptionCode?: string;
  exemptionReason?: string;
  /** what the discount was on this line (informational; the net already includes it) */
  discount?: number;
}

export interface ZatcaInvoiceInput {
  kind: ZatcaKind;
  docType: ZatcaDocType;
  /** BT-1 — Sufra receipt number (POS1-000123) */
  invoiceNo: string;
  /** KSA-1, RFC 4122 */
  uuid: string;
  /** KSA-16 invoice counter value, per EGS unit, never reset */
  icv: number;
  /** KSA-13 previous invoice hash (base64) */
  pih: string;
  /** "YYYY-MM-DD" and "HH:MM:SS" in Riyadh time (AST, UTC+3) */
  issueDate: string;
  issueTime: string;
  /** supply date (KSA-5) — mandatory for standard invoices (BR-KSA-15); defaults to issueDate */
  supplyDate?: string;
  currency: "SAR";
  seller: ZatcaSeller;
  buyer?: ZatcaBuyer | null;
  lines: ZatcaLine[];
  /** what the customer actually pays (halalas); difference to TaxInclusiveAmount → PayableRoundingAmount (BT-114) */
  payable?: number;
  /** UNTDID 4461: 10 cash · 30 credit transfer · 42 bank account · 48 bank card · 1 instrument not defined */
  paymentMeans: string;
  /** credit/debit notes: BT-25 original invoice number (+ date) and KSA-10 reason */
  billingReference?: { invoiceNo: string; issueDate?: string } | null;
  reason?: string | null;
  note?: string | null;
}

export interface VatBreakdown {
  category: VatCategory;
  rate: number;
  taxable: number;
  tax: number;
  exemptionCode?: string;
  exemptionReason?: string;
}

export interface ZatcaTotals {
  lineExtension: number;
  taxExclusive: number;
  vat: number;
  taxInclusive: number;
  allowance: number;
  rounding: number;
  payable: number;
  breakdown: VatBreakdown[];
}
