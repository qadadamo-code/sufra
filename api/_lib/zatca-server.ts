/**
 * Server side of ZATCA (FATOORA) Phase 2 — used by api/zatca-onboard.ts, api/zatca-report.ts, api/zatca-clear.ts.
 * Pure invoice/crypto/API code comes from sufra-os/src/lib/zatca (alias-free files, shared with the browser).
 *
 * Environment (see sufra-os/src/lib/zatca/DESIGN.md):
 *   ZATCA_ENV                  sandbox | simulation | production   (unset → every endpoint answers 501)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   rows + Vault (EGS private keys and CSID secrets never leave the server)
 *   CRON_SECRET                lets Vercel Cron call /api/zatca-report without a user (Authorization: Bearer <CRON_SECRET>)
 *   ZATCA_SOLUTION_NAME        optional, CSR serial "1-…" part (default "Sufra")
 *
 * Callers: staff with a Supabase user JWT (Authorization: Bearer <access token>); roles checked with has_role().
 * Demo units (key_custody = demo_browser) are refused: a browser key is never used against ZATCA.
 */
import {
  clearanceRequest, complianceCsidRequest, complianceInvoiceRequest, nextRetryMs, parseCsidResponse, parseSubmitResponse, productionCsidRequest, renewCsidRequest, reportingRequest,
  type Credentials, type SubmitResult, type ZatcaEnvName, type ZatcaRequest,
} from "../../sufra-os/src/lib/zatca/api";
import { fromBase64, fromUtf8, toBase64 } from "../../sufra-os/src/lib/zatca/bytes";
import { buildCsr, generateKeyPair, keyPairFromPem, parseCertificate, sec1Pem, spkiDer } from "../../sufra-os/src/lib/zatca/crypto";
import { complianceSamples } from "../../sufra-os/src/lib/zatca/samples";
import { qrOfXml, signInvoice, stampXml } from "../../sufra-os/src/lib/zatca/sign";
import type { ZatcaSeller } from "../../sufra-os/src/lib/zatca/types";
import { checkSeller } from "../../sufra-os/src/lib/zatca/validate";

export type ZEnv = Partial<Record<string, string | undefined>>;

/* ───────── rows (snake_case, as PostgREST returns them) ───────── */

export interface EgsRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  device: string;
  name: string;
  serial: string;
  invoice_types: string;
  key_custody: "server" | "demo_browser";
  environment: ZatcaEnvName;
  public_key: string | null;
  csr_pem: string | null;
  status: string;
  compliance: { certificate: string; requestId: string | null; issuedAt: string; expiresAt: string | null; serial: string } | null;
  production: { certificate: string; requestId: string | null; issuedAt: string; expiresAt: string | null; serial: string } | null;
  checks: Record<string, string>;
  last_error: string | null;
}
export interface InvRow {
  id: string;
  restaurant_id: string;
  egs_id: string;
  kind: "simplified" | "standard";
  doc_type: string;
  uuid: string;
  icv: number;
  hash: string;
  xml: string;
  qr: string;
  status: string;
  attempts: number;
  signed_by: string | null;
  issued_at: string;
}
export interface EgsSecret {
  privateKeyPem?: string;
  compliance?: Credentials;
  production?: Credentials;
}
export interface ZatcaSettingsJson {
  enabled?: boolean;
  environment?: ZatcaEnvName;
  seller?: { nameAr?: string; vatNumber?: string; idScheme?: ZatcaSeller["id"]["scheme"]; idValue?: string; address?: ZatcaSeller["address"] };
  invoiceTypes?: string;
  industry?: string;
}

export interface ZatcaDb {
  userCan(jwt: string, restaurantId: string, roles: string[]): Promise<boolean>;
  settings(restaurantId: string): Promise<{ zatca: ZatcaSettingsJson | null } | null>;
  branchName(branchId: string): Promise<string>;
  egs(id: string): Promise<EgsRow | null>;
  patchEgs(id: string, patch: Partial<EgsRow>): Promise<void>;
  secret(egsId: string): Promise<EgsSecret>;
  storeSecret(egsId: string, s: EgsSecret): Promise<void>;
  invoice(id: string): Promise<InvRow | null>;
  /** simplified documents due for reporting (unsigned / pending / retry time reached), oldest first, per unit in ICV order */
  queue(restaurantId: string | null, limit: number): Promise<InvRow[]>;
  patchInvoice(id: string, patch: Record<string, unknown>): Promise<void>;
}

export interface ZatcaDeps {
  env: ZEnv;
  fetch: typeof fetch;
  now: () => Date;
  uuid: () => string;
  log: (msg: string, data?: Record<string, unknown>) => void;
  db: ZatcaDb | null;
}

/* ───────── helpers ───────── */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
export const notConfigured = (missing: string[]) => ({
  error: "not_configured",
  message: `ZATCA submission is not configured on this deployment. Set ${missing.join(", ")} (see sufra-os/src/lib/zatca/DESIGN.md). Nothing was sent to ZATCA.`,
  missing,
});

export function zatcaEnv(env: ZEnv): ZatcaEnvName | null {
  const v = env.ZATCA_ENV;
  return v === "sandbox" || v === "simulation" || v === "production" ? v : null;
}

function gate(d: ZatcaDeps): Response | null {
  const missing: string[] = [];
  if (!zatcaEnv(d.env)) missing.push("ZATCA_ENV (sandbox|simulation|production)");
  if (!d.env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!d.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length || !d.db) return json(501, notConfigured(missing.length ? missing : ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]));
  return null;
}

const bearer = (req: Request) => /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

async function send(d: ZatcaDeps, r: ZatcaRequest): Promise<{ status: number; body: unknown }> {
  try {
    const res = await d.fetch(r.url, { method: r.method, headers: r.headers, body: r.body });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* ZATCA sometimes answers text/plain (406) */
    }
    return { status: res.status, body };
  } catch (e) {
    d.log("zatca.network", { url: r.url, error: String((e as Error).message ?? e) });
    return { status: 0, body: null };
  }
}

function sellerOf(z: ZatcaSettingsJson | null | undefined): ZatcaSeller {
  const s = z?.seller ?? {};
  return {
    name: s.nameAr ?? "",
    vatNumber: s.vatNumber ?? "",
    id: { scheme: s.idScheme ?? "CRN", value: s.idValue ?? "" },
    address: { street: "", building: "", district: "", city: "", postalCode: "", country: "SA", ...(s.address ?? {}) },
  };
}

const certToken = (token: string) => fromUtf8(fromBase64(token)); // binarySecurityToken = Base64(Base64 DER)
function csidMeta(token: string, requestId: string | null, now: Date) {
  const c = parseCertificate(token);
  return { certificate: c.base64, requestId, issuedAt: now.toISOString(), expiresAt: c.notAfter.toISOString(), serial: c.serial.toString(10) };
}

/* ───────── /api/zatca-onboard ───────── */

export interface OnboardBody {
  restaurantId: string;
  egsId: string;
  action: "csr" | "compliance" | "checks" | "production" | "renew";
  otp?: string;
}

export async function handleOnboard(req: Request, d: ZatcaDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const g = gate(d);
  if (g) return g;
  const db = d.db!;
  const env = zatcaEnv(d.env)!;
  const jwt = bearer(req);
  const b = (await req.json().catch(() => null)) as OnboardBody | null;
  if (!b?.restaurantId || !b.egsId || !b.action) return json(400, { error: "bad_request", message: "restaurantId, egsId and action are required" });
  if (!jwt || !(await db.userCan(jwt, b.restaurantId, ["owner", "admin"]))) return json(403, { error: "forbidden", message: "owner or admin only" });
  const egs = await db.egs(b.egsId);
  if (!egs || egs.restaurant_id !== b.restaurantId) return json(404, { error: "egs_not_found" });
  if (egs.key_custody !== "server") return json(409, { error: "demo_unit", message: "This EGS unit holds a DEMO browser key. Create a server-custody unit to onboard with ZATCA." });
  const settings = await db.settings(b.restaurantId);
  const z = settings?.zatca ?? null;
  const seller = sellerOf(z);
  const issues = checkSeller(seller);
  if (issues.length) return json(422, { error: "seller_incomplete", issues });
  const now = d.now();
  const secret = await db.secret(egs.id);

  if (b.action === "csr") {
    // key generated HERE and kept in Vault; only the public key + CSR go back
    const k = generateKeyPair();
    const csr = buildCsr(k, {
      env, commonName: egs.name, egsSerial: egs.serial, vatNumber: seller.vatNumber, orgUnit: await db.branchName(egs.branch_id), orgName: seller.name,
      invoiceTypes: egs.invoice_types, location: `${seller.address.building} ${seller.address.street}, ${seller.address.district}, ${seller.address.city}`.slice(0, 120), industry: z?.industry ?? "Restaurants",
    });
    await db.storeSecret(egs.id, { ...secret, privateKeyPem: sec1Pem(k) });
    await db.patchEgs(egs.id, { public_key: toBase64(spkiDer(k.publicKey)), csr_pem: csr.pem, environment: env, status: "new", last_error: null });
    return json(200, { ok: true, csrPem: csr.pem, publicKey: toBase64(spkiDer(k.publicKey)) });
  }

  if (b.action === "compliance" || b.action === "renew") {
    if (!b.otp || !/^\d{6}$/.test(b.otp)) return json(400, { error: "otp_required", message: "6-digit OTP from the Fatoora portal" });
    if (!egs.csr_pem) return json(409, { error: "no_csr", message: "generate the CSR first" });
    const csrB64 = toBase64(new TextEncoder().encode(egs.csr_pem));
    const r = b.action === "compliance" ? complianceCsidRequest(env, b.otp, csrB64) : secret.production ? renewCsidRequest(env, secret.production, b.otp, csrB64) : null;
    if (!r) return json(409, { error: "no_production_csid" });
    const res = await send(d, r);
    const p = parseCsidResponse(res.status, res.body);
    if (!p.ok) {
      await db.patchEgs(egs.id, { last_error: p.errors.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}` });
      return json(502, { error: "zatca_rejected", httpStatus: res.status, errors: p.errors });
    }
    const creds = { token: p.binarySecurityToken!, secret: p.secret! };
    const meta = csidMeta(certToken(creds.token), p.requestId, now);
    if (b.action === "compliance") {
      await db.storeSecret(egs.id, { ...secret, compliance: creds });
      await db.patchEgs(egs.id, { compliance: meta, status: "compliance", checks: {}, last_error: null });
    } else {
      await db.storeSecret(egs.id, { ...secret, production: creds });
      await db.patchEgs(egs.id, { production: meta, status: "production", last_error: null });
    }
    return json(200, { ok: true, requestId: p.requestId, certificate: { serial: meta.serial, expiresAt: meta.expiresAt } });
  }

  if (b.action === "checks") {
    if (!secret.compliance || !egs.compliance || !secret.privateKeyPem) return json(409, { error: "no_compliance_csid" });
    const key = keyPairFromPem(secret.privateKeyPem);
    const docs = complianceSamples(seller, egs.invoice_types, now, d.uuid, (input) =>
      signInvoice(input, input.kind === "simplified" ? { secretKey: key.secretKey, certificate: certToken(secret.compliance!.token) } : null),
    );
    const checks: Record<string, string> = {};
    const details: { type: string; result: SubmitResult }[] = [];
    for (const doc of docs) {
      const res = await send(d, complianceInvoiceRequest(env, secret.compliance, { invoiceHash: doc.result.hash, uuid: doc.input.uuid, invoice: doc.result.xmlBase64 }));
      const r = parseSubmitResponse(res.status, res.body, "compliance");
      checks[doc.type] = r.outcome === "rejected" || r.outcome === "retry" ? "fail" : r.outcome === "warning" ? "warn" : "pass";
      details.push({ type: doc.type, result: r });
    }
    const allOk = Object.values(checks).every((c) => c !== "fail");
    await db.patchEgs(egs.id, { checks, status: allOk ? "checks_passed" : "compliance", last_error: allOk ? null : "compliance checks failed" });
    return json(200, { ok: allOk, checks, details });
  }

  if (b.action === "production") {
    if (!secret.compliance || !egs.compliance?.requestId) return json(409, { error: "no_compliance_csid" });
    if (egs.status !== "checks_passed") return json(409, { error: "checks_pending", message: "pass the compliance checks first" });
    const res = await send(d, productionCsidRequest(env, secret.compliance, egs.compliance.requestId));
    const p = parseCsidResponse(res.status, res.body);
    if (!p.ok) {
      await db.patchEgs(egs.id, { last_error: p.errors.map((e) => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}` });
      return json(502, { error: "zatca_rejected", httpStatus: res.status, errors: p.errors });
    }
    const creds = { token: p.binarySecurityToken!, secret: p.secret! };
    const meta = csidMeta(certToken(creds.token), p.requestId, now);
    await db.storeSecret(egs.id, { ...secret, production: creds });
    await db.patchEgs(egs.id, { production: meta, status: "production", last_error: null });
    return json(200, { ok: true, certificate: { serial: meta.serial, expiresAt: meta.expiresAt } });
  }
  return json(400, { error: "unknown_action" });
}

/* ───────── shared: stamp + submit one document ───────── */

async function prepare(d: ZatcaDeps, inv: InvRow): Promise<{ egs: EgsRow; creds: Credentials; xml: string; hash: string } | { error: string }> {
  const db = d.db!;
  const egs = await db.egs(inv.egs_id);
  if (!egs) return { error: "egs_not_found" };
  if (egs.key_custody !== "server") return { error: "demo_unit" };
  const secret = await db.secret(egs.id);
  if (egs.status !== "production" || !secret.production || !egs.production) return { error: "egs_not_onboarded" };
  let xml = inv.xml;
  if (!inv.signed_by && (inv.kind === "simplified" || inv.status === "use_reporting")) {
    if (!secret.privateKeyPem) return { error: "no_private_key" };
    const k = keyPairFromPem(secret.privateKeyPem);
    const s = stampXml(inv.xml, { secretKey: k.secretKey, certificate: egs.production.certificate });
    if (s.hash !== inv.hash) return { error: "hash_mismatch" };
    xml = s.xml;
    await db.patchInvoice(inv.id, { xml: s.xml, qr: s.qr, signed_by: "server" });
  }
  return { egs, creds: secret.production, xml, hash: inv.hash };
}

const b64Xml = (xml: string) => toBase64(new TextEncoder().encode(xml));
const msgs = (r: SubmitResult, k: "warnings" | "errors") => r[k].map((m) => `${m.code}: ${m.message}`);

async function record(d: ZatcaDeps, inv: InvRow, r: SubmitResult) {
  const now = d.now();
  const status = r.outcome === "use_reporting" ? "pending" : r.outcome === "retry" ? inv.status : r.outcome;
  await d.db!.patchInvoice(inv.id, {
    status,
    warnings: msgs(r, "warnings"),
    errors: msgs(r, "errors"),
    attempts: inv.attempts + 1,
    last_attempt_at: now.toISOString(),
    next_attempt_at: r.outcome === "retry" ? new Date(now.getTime() + nextRetryMs(inv.attempts + 1)).toISOString() : null,
    ...(r.outcome === "reported" || r.outcome === "cleared" || r.outcome === "warning" ? { submitted_at: now.toISOString() } : {}),
    ...(r.clearedInvoice ? { cleared_xml: r.clearedInvoice } : {}),
  });
}

/* ───────── /api/zatca-report ───────── */

export async function handleReport(req: Request, d: ZatcaDeps): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "method_not_allowed" });
  const g = gate(d);
  if (g) return g;
  const db = d.db!;
  const env = zatcaEnv(d.env)!;
  const token = bearer(req);
  const cron = !!d.env.CRON_SECRET && token === d.env.CRON_SECRET;
  const b = req.method === "POST" ? ((await req.json().catch(() => ({}))) as { restaurantId?: string; invoiceId?: string }) : {};
  if (!cron) {
    if (!b.restaurantId || !token || !(await db.userCan(token, b.restaurantId, ["owner", "admin", "manager", "cashier", "accountant"]))) return json(403, { error: "forbidden" });
  }
  let docs: InvRow[];
  if (b.invoiceId) {
    const one = await db.invoice(b.invoiceId);
    if (!one || (!cron && one.restaurant_id !== b.restaurantId)) return json(404, { error: "not_found" });
    if (one.kind !== "simplified") return json(409, { error: "standard_document", message: "standard documents go through /api/zatca-clear" });
    docs = [one];
  } else docs = await db.queue(cron ? null : (b.restaurantId ?? null), 200);

  const results: { id: string; outcome: string; errors?: string[] }[] = [];
  for (const inv of docs) {
    const p = await prepare(d, inv);
    if ("error" in p) {
      results.push({ id: inv.id, outcome: "skipped", errors: [p.error] });
      continue;
    }
    const res = await send(d, reportingRequest(env, p.creds, { invoiceHash: p.hash, uuid: inv.uuid, invoice: b64Xml(p.xml) }));
    const r = parseSubmitResponse(res.status, res.body, "reporting");
    await record(d, inv, r);
    results.push({ id: inv.id, outcome: r.outcome, ...(r.errors.length ? { errors: msgs(r, "errors") } : {}) });
  }
  return json(200, { ok: true, processed: results.length, results });
}

/* ───────── /api/zatca-clear ───────── */

export async function handleClear(req: Request, d: ZatcaDeps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const g = gate(d);
  if (g) return g;
  const db = d.db!;
  const env = zatcaEnv(d.env)!;
  const token = bearer(req);
  const b = (await req.json().catch(() => null)) as { restaurantId?: string; invoiceId?: string } | null;
  if (!b?.restaurantId || !b.invoiceId) return json(400, { error: "bad_request" });
  if (!token || !(await db.userCan(token, b.restaurantId, ["owner", "admin", "manager", "cashier", "accountant"]))) return json(403, { error: "forbidden" });
  const inv = await db.invoice(b.invoiceId);
  if (!inv || inv.restaurant_id !== b.restaurantId) return json(404, { error: "not_found" });
  if (inv.kind !== "standard") return json(409, { error: "simplified_document", message: "simplified documents are reported, not cleared" });
  const p = await prepare(d, inv);
  if ("error" in p) return json(409, { error: p.error });
  const res = await send(d, clearanceRequest(env, p.creds, { invoiceHash: p.hash, uuid: inv.uuid, invoice: b64Xml(p.xml) }));
  let r = parseSubmitResponse(res.status, res.body, "clearance");
  if (r.outcome === "use_reporting") {
    // clearance switched off by ZATCA (303): the EGS stamps the standard document itself and reports it
    const p2 = await prepare(d, { ...inv, status: "use_reporting" });
    if ("error" in p2) return json(409, { error: p2.error });
    const res2 = await send(d, reportingRequest(env, p2.creds, { invoiceHash: p2.hash, uuid: inv.uuid, invoice: b64Xml(p2.xml) }));
    r = parseSubmitResponse(res2.status, res2.body, "reporting");
  }
  await record(d, inv, r);
  let qr: string | null = null;
  if (r.clearedInvoice) {
    try {
      qr = qrOfXml(fromUtf8(fromBase64(r.clearedInvoice)));
      if (qr) await db.patchInvoice(inv.id, { qr });
    } catch (e) {
      d.log("zatca.cleared.parse", { id: inv.id, error: String((e as Error).message ?? e) });
    }
  }
  return json(r.outcome === "rejected" ? 422 : 200, { ok: r.outcome === "cleared" || r.outcome === "reported" || r.outcome === "warning", outcome: r.outcome, qr, warnings: msgs(r, "warnings"), errors: msgs(r, "errors") });
}

/* ───────── Supabase (PostgREST over fetch, service role) ───────── */

export function supabaseZatcaDb(env: ZEnv, f: typeof fetch): ZatcaDb | null {
  const url = env.SUPABASE_URL?.replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const get = async <T>(path: string): Promise<T[]> => {
    const r = await f(`${url}/rest/v1/${path}`, { headers: H });
    if (!r.ok) throw new Error(`supabase ${r.status} ${path}`);
    return (await r.json()) as T[];
  };
  const patch = async (table: string, id: string, body: unknown) => {
    const r = await f(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`supabase ${r.status} patch ${table}: ${await r.text()}`);
  };
  const rpc = async <T>(fn: string, args: unknown, auth = H): Promise<T> => {
    const r = await f(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: auth, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`supabase rpc ${fn} ${r.status}`);
    return (await r.json()) as T;
  };
  const enc = encodeURIComponent;
  return {
    async userCan(jwt, restaurantId, roles) {
      try {
        return await rpc<boolean>("has_role", { rid: restaurantId, roles }, { apikey: key, Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" });
      } catch {
        return false;
      }
    },
    async settings(restaurantId) {
      return (await get<{ zatca: ZatcaSettingsJson | null }>(`settings?restaurant_id=eq.${enc(restaurantId)}&select=zatca`))[0] ?? null;
    },
    async branchName(branchId) {
      const [b] = await get<{ name: { ar?: string; en?: string } }>(`branches?id=eq.${enc(branchId)}&select=name`);
      return b?.name?.en || b?.name?.ar || "Main";
    },
    async egs(id) {
      return (await get<EgsRow>(`zatca_egs_units?id=eq.${enc(id)}`))[0] ?? null;
    },
    patchEgs: (id, p) => patch("zatca_egs_units", id, p),
    async secret(egsId) {
      return (await rpc<EgsSecret | null>("zatca_egs_secret", { p_egs: egsId })) ?? {};
    },
    async storeSecret(egsId, s) {
      await rpc("zatca_store_egs_secret", { p_egs: egsId, p_secret: s });
    },
    async invoice(id) {
      return (await get<InvRow>(`zatca_invoices?id=eq.${enc(id)}`))[0] ?? null;
    },
    async queue(restaurantId, limit) {
      const now = new Date().toISOString();
      const scope = restaurantId ? `&restaurant_id=eq.${enc(restaurantId)}` : "";
      return get<InvRow>(`zatca_invoices?kind=eq.simplified&status=in.(unsigned,pending)${scope}&or=(next_attempt_at.is.null,next_attempt_at.lte.${enc(now)})&order=egs_id.asc,icv.asc&limit=${limit}`);
    },
    patchInvoice: (id, p) => patch("zatca_invoices", id, p),
  };
}

export function makeZatcaDeps(env: ZEnv = process.env): ZatcaDeps {
  const f = globalThis.fetch.bind(globalThis);
  return {
    env,
    fetch: f,
    now: () => new Date(),
    uuid: () => crypto.randomUUID(),
    log: (m, x) => console.log(`[zatca] ${m}`, x ? JSON.stringify(x) : ""),
    db: supabaseZatcaDb(env, f),
  };
}
