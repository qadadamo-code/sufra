/**
 * Sufra OS rows + settings for ZATCA (supabase/migrations/0014_zatca.sql). camelCase here, snake_case in Postgres.
 * No secrets live in any of these: EGS private keys and CSID secrets are server-side (Vault). The demo key of a
 * `demo_browser` unit lives only in that tablet's localStorage.
 */
import type { TenantRow, Units } from "@/data/types";
import type { ZatcaEnvName } from "./api";
import type { ZatcaAddress, ZatcaBuyer, ZatcaDocType, ZatcaKind } from "./types";

export type { ZatcaBuyer };

/** settings.zatca — the seller (VAT registrant) and how this restaurant talks to FATOORA. */
export interface ZatcaSettings {
  enabled: boolean;
  environment: ZatcaEnvName;
  seller: {
    /** registration name in Arabic (mandatory on the invoice) */
    nameAr: string;
    nameEn: string;
    /** 15 digits, starts + ends with 3 */
    vatNumber: string;
    idScheme: "CRN" | "MOM" | "MLS" | "700" | "SAG" | "OTH";
    /** commercial registration (CR) number by default */
    idValue: string;
    address: ZatcaAddress;
  };
  /** CSR "title": TSCZ flags. 1100 = standard + simplified (restaurants with corporate customers), 0100 = simplified only */
  invoiceTypes: "1100" | "0100";
  industry: string;
  /** server = production (keys in Vault, signing by /api); demo_browser = offline demo, key on the tablet */
  keyCustody: "server" | "demo_browser";
  /** set by the server function once ZATCA_ENV + Supabase are configured (never a secret) */
  serverConfigured: boolean;
}

export type EgsStatus = "new" | "compliance" | "checks_passed" | "production" | "expired" | "revoked";
export type ComplianceDoc = `${ZatcaKind}:${ZatcaDocType}`;

export interface CsidMeta {
  /** Base64 DER certificate (public) */
  certificate: string;
  requestId: string | null;
  issuedAt: string;
  expiresAt: string | null;
  serial: string;
}

/** One EGS unit (e-invoice generation solution) = one POS device of a branch. Owns its ICV/PIH chain. */
export interface ZatcaEgsUnit extends TenantRow {
  branchId: string;
  /** POS device code (receipt prefix), e.g. RUH1 */
  device: string;
  /** CSR CN */
  name: string;
  /** "1-Sufra|2-Sufra OS 1|3-<uuid>" */
  serial: string;
  invoiceTypes: string;
  keyCustody: "server" | "demo_browser";
  environment: ZatcaEnvName;
  /** Base64 SubjectPublicKeyInfo DER */
  publicKey: string | null;
  csrPem: string | null;
  status: EgsStatus;
  compliance: CsidMeta | null;
  production: CsidMeta | null;
  /** DEMO only: self-signed certificate for a browser key (NOT a CSID) */
  demoCertificate: string | null;
  checks: Partial<Record<ComplianceDoc, "pass" | "warn" | "fail">>;
  lastError: string | null;
}

/**
 * pending   signed, waiting to be reported (simplified) / cleared (standard)
 * unsigned  built + chained offline, waiting for the server to stamp it (keys in Vault)
 * reported · cleared · warning (accepted with warnings) · rejected (errors — fix and issue a new document)
 * demo      signed with a demo key; never sent to ZATCA
 */
export type ZatcaInvoiceStatus = "pending" | "unsigned" | "reported" | "cleared" | "warning" | "rejected" | "demo";

export interface ZatcaInvoiceRow extends TenantRow {
  branchId: string;
  egsId: string;
  device: string;
  receiptId: string | null;
  checkId: string | null;
  kind: ZatcaKind;
  docType: ZatcaDocType;
  invoiceNo: string;
  uuid: string;
  icv: number;
  pih: string;
  /** invoice hash (Base64) — next document's PIH */
  hash: string;
  issuedAt: string;
  /** the XML exactly as signed/sent (verbatim) */
  xml: string;
  /** QR Base64 (Phase-2 tags 1–9, or Phase-1 tags 1–5 while unsigned) */
  qr: string;
  total: Units;
  vat: Units;
  status: ZatcaInvoiceStatus;
  warnings: string[];
  errors: string[];
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  submittedAt: string | null;
  /** clearance: the stamped invoice ZATCA returned (Base64 XML) */
  clearedXml: string | null;
  /** credit/debit notes: the original invoice number */
  refInvoiceNo: string | null;
  signedBy: "demo_browser" | "server" | null;
  environment: ZatcaEnvName;
  buyer: ZatcaBuyer | null;
}
