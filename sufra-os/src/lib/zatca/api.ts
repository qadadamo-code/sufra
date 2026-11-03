/**
 * ZATCA FATOORA e-invoicing APIs — request building + response parsing, shared by the server functions
 * (/api/zatca-*.ts) and tests. No secrets here; callers pass credentials they loaded server-side.
 *
 * Base URLs (gateway gw-fatoora.zatca.gov.sa; see DESIGN.md for sources and what is confirmed):
 *   sandbox    /e-invoicing/developer-portal   (Developer Portal "Integration Sandbox", dummy OTP / TSTZATCA template)
 *   simulation /e-invoicing/simulation         (Fatoora simulation portal OTP, PREZATCA template)
 *   production /e-invoicing/core
 * Every call sends `Accept-Version: V2` ("V2 is currently the only valid version" — Developer Portal Manual §2.3.10).
 */

export type ZatcaEnvName = "sandbox" | "simulation" | "production";
export const ZATCA_BASE: Record<ZatcaEnvName, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

export interface ZatcaRequest {
  method: "POST" | "PATCH";
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface Credentials {
  /** binarySecurityToken from the CSID response (Base64) — Basic-auth username */
  token: string;
  /** secret from the CSID response — Basic-auth password */
  secret: string;
}

const b64 = (s: string) => {
  // Basic auth in both Node and edge runtimes without Buffer
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};
const base = (env: ZatcaEnvName, lang: "ar" | "en" = "en") => ({ Accept: "application/json", "Content-Type": "application/json", "Accept-Language": lang, "Accept-Version": "V2" });
const auth = (c: Credentials) => ({ Authorization: `Basic ${b64(`${c.token}:${c.secret}`)}` });

/** 1 · Compliance CSID: OTP from the Fatoora portal + CSR → compliance certificate (binarySecurityToken) + secret + requestID. */
export const complianceCsidRequest = (env: ZatcaEnvName, otp: string, csrBase64: string): ZatcaRequest => ({
  method: "POST",
  url: `${ZATCA_BASE[env]}/compliance`,
  headers: { ...base(env), OTP: otp },
  body: JSON.stringify({ csr: csrBase64 }),
});

/** 2 · Compliance checks: one sample of every document type the EGS will issue, authenticated with the compliance CSID. */
export const complianceInvoiceRequest = (env: ZatcaEnvName, c: Credentials, doc: { invoiceHash: string; uuid: string; invoice: string }): ZatcaRequest => ({
  method: "POST",
  url: `${ZATCA_BASE[env]}/compliance/invoices`,
  headers: { ...base(env), ...auth(c) },
  body: JSON.stringify(doc),
});

/** 3 · Production CSID (onboarding) after the compliance checks pass. */
export const productionCsidRequest = (env: ZatcaEnvName, c: Credentials, complianceRequestId: string): ZatcaRequest => ({
  method: "POST",
  url: `${ZATCA_BASE[env]}/production/csids`,
  headers: { ...base(env), ...auth(c) },
  body: JSON.stringify({ compliance_request_id: complianceRequestId }),
});

/** 3b · Production CSID renewal: new OTP + new CSR, authenticated with the current production CSID. */
export const renewCsidRequest = (env: ZatcaEnvName, c: Credentials, otp: string, csrBase64: string): ZatcaRequest => ({
  method: "PATCH",
  url: `${ZATCA_BASE[env]}/production/csids`,
  headers: { ...base(env), ...auth(c), OTP: otp },
  body: JSON.stringify({ csr: csrBase64 }),
});

/** 4 · Reporting (simplified invoices + their notes, within 24 h). `Clearance-Status: 0`. */
export const reportingRequest = (env: ZatcaEnvName, c: Credentials, doc: { invoiceHash: string; uuid: string; invoice: string }): ZatcaRequest => ({
  method: "POST",
  url: `${ZATCA_BASE[env]}/invoices/reporting/single`,
  headers: { ...base(env), ...auth(c), "Clearance-Status": "0" },
  body: JSON.stringify(doc),
});

/** 5 · Clearance (standard invoices + their notes, before handing them to the buyer). `Clearance-Status: 1`. */
export const clearanceRequest = (env: ZatcaEnvName, c: Credentials, doc: { invoiceHash: string; uuid: string; invoice: string }): ZatcaRequest => ({
  method: "POST",
  url: `${ZATCA_BASE[env]}/invoices/clearance/single`,
  headers: { ...base(env), ...auth(c), "Clearance-Status": "1" },
  body: JSON.stringify(doc),
});

/* ───────── responses ───────── */

export interface ZatcaMessage {
  type?: string;
  code: string;
  category?: string;
  message: string;
  status?: string;
}

export interface CsidResult {
  ok: boolean;
  requestId: string | null;
  /** Base64 — decode once for the Base64 DER certificate */
  binarySecurityToken: string | null;
  secret: string | null;
  disposition: string | null;
  errors: ZatcaMessage[];
  httpStatus: number;
}

export function parseCsidResponse(httpStatus: number, body: unknown): CsidResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors = toMessages(b.errors).concat(typeof b.message === "string" && httpStatus >= 400 ? [{ code: String(b.code ?? httpStatus), message: b.message }] : []);
  return {
    ok: httpStatus === 200 && typeof b.binarySecurityToken === "string",
    requestId: b.requestID != null ? String(b.requestID) : null,
    binarySecurityToken: typeof b.binarySecurityToken === "string" ? b.binarySecurityToken : null,
    secret: typeof b.secret === "string" ? b.secret : null,
    disposition: typeof b.dispositionMessage === "string" ? b.dispositionMessage : null,
    errors,
    httpStatus,
  };
}

/** Sufra's status for a submitted document. */
export type SubmitOutcome = "reported" | "cleared" | "warning" | "rejected" | "use_reporting" | "retry";

export interface SubmitResult {
  outcome: SubmitOutcome;
  httpStatus: number;
  /** REPORTED / NOT_REPORTED / CLEARED / NOT_CLEARED as ZATCA wrote it */
  zatcaStatus: string | null;
  warnings: ZatcaMessage[];
  errors: ZatcaMessage[];
  /** clearance: the stamped invoice (Base64 XML) ZATCA returns — this is what the buyer receives */
  clearedInvoice: string | null;
  /** compliance checks: per-document statuses */
  compliance?: { reportingStatus: string | null; clearanceStatus: string | null };
}

function toMessages(x: unknown): ZatcaMessage[] {
  if (!Array.isArray(x)) return [];
  return x.map((m) => {
    const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    return { type: str(o.type), code: String(o.code ?? ""), category: str(o.category), message: String(o.message ?? ""), status: str(o.status) };
  });
}
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Response handling (Developer Portal Manual FAQ "Response causes"):
 *   200 → reported/cleared (may still carry info/warnings) · 202 → accepted WITH warnings ·
 *   303 → clearance switched off: submit standard documents through reporting · 400 → rejected (errors) ·
 *   401/403 → credentials problem (do not burn the 24 h retrying blindly) · 409 → already submitted ·
 *   429 / 5xx / network → retry with back-off.
 */
export function parseSubmitResponse(httpStatus: number, body: unknown, mode: "reporting" | "clearance" | "compliance"): SubmitResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const vr = (b.validationResults && typeof b.validationResults === "object" ? b.validationResults : {}) as Record<string, unknown>;
  const warnings = toMessages(vr.warningMessages);
  const errors = toMessages(vr.errorMessages).concat(toMessages(b.errors));
  const zs = str(b.reportingStatus) ?? str(b.clearanceStatus) ?? null;
  const cleared = str(b.clearedInvoice) ?? null;
  const out = (outcome: SubmitOutcome): SubmitResult => ({
    outcome, httpStatus, zatcaStatus: zs, warnings, errors, clearedInvoice: cleared,
    ...(mode === "compliance" ? { compliance: { reportingStatus: str(b.reportingStatus) ?? null, clearanceStatus: str(b.clearanceStatus) ?? null } } : {}),
  });
  if (httpStatus === 303) return out("use_reporting");
  if (httpStatus === 409) return out(mode === "clearance" ? "cleared" : "reported"); // duplicate: ZATCA already has it
  if (httpStatus === 429 || httpStatus >= 500 || httpStatus === 0) return out("retry");
  if (httpStatus === 401 || httpStatus === 403) return { ...out("retry"), errors: errors.length ? errors : [{ code: String(httpStatus), message: "ZATCA rejected the credentials (CSID expired or revoked?)" }] };
  if (httpStatus === 400 || errors.length || zs === "NOT_REPORTED" || zs === "NOT_CLEARED") return out("rejected");
  if (httpStatus === 202 || warnings.length) return out("warning");
  if (httpStatus === 200) return out(mode === "clearance" || zs === "CLEARED" ? "cleared" : "reported");
  return out("retry");
}

/* ───────── deadlines ───────── */

/** Simplified documents must be reported within 24 hours of issue (E-Invoicing Implementing Resolution, art. 4(2)(b)). */
export const REPORTING_WINDOW_MS = 24 * 3600_000;
export function reportingTriage(issuedAt: string, now = Date.now()): { deadline: string; msLeft: number; level: "ok" | "soon" | "urgent" | "overdue" } {
  const deadline = Date.parse(issuedAt) + REPORTING_WINDOW_MS;
  const msLeft = deadline - now;
  return { deadline: new Date(deadline).toISOString(), msLeft, level: msLeft < 0 ? "overdue" : msLeft < 2 * 3600_000 ? "urgent" : msLeft < 8 * 3600_000 ? "soon" : "ok" };
}

/** Retry back-off for the reporting queue: 1, 2, 4 … 60 minutes. */
export const nextRetryMs = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;
