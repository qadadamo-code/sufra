/**
 * Request building + response parsing (src/lib/zatca/api.ts) and the server handlers (/api/_lib/zatca-server.ts) with a
 * fake ZATCA and an in-memory database. Responses: fixtures.ts (sandbox Swagger shapes).
 */
import { describe, expect, it } from "vitest";
import { clearanceRequest, complianceCsidRequest, parseCsidResponse, parseSubmitResponse, reportingRequest, reportingTriage, ZATCA_BASE } from "./api";
import { fromBase64, fromUtf8, toBase64, utf8 } from "./bytes";
import { demoSelfSignedCertificate, issueCertificate, keyPairFromSecret, publicKeyFromSpki } from "./crypto";
import { parseDer } from "./asn1";
import { CLEARED_200, COMPLIANCE_CHECK_200, CSID_200, CSID_400_OTP, NOT_REPORTED_400, REPORTED_200, REPORTED_WITH_WARNINGS_202 } from "./fixtures";
import { signInvoice, stampXml, verifyInvoiceXml } from "./sign";
import { FIRST_PIH } from "./ubl";
import type { ZatcaInvoiceInput } from "./types";
import { handleClear, handleOnboard, handleReport, type EgsRow, type EgsSecret, type InvRow, type ZatcaDb, type ZatcaDeps } from "../../../../api/_lib/zatca-server";

describe("API requests", () => {
  it("compliance CSID: OTP header, Accept-Version V2, CSR body", () => {
    const r = complianceCsidRequest("sandbox", "123345", "Q1NS");
    expect(r.url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal/compliance");
    expect(r.headers.OTP).toBe("123345");
    expect(r.headers["Accept-Version"]).toBe("V2");
    expect(JSON.parse(r.body)).toEqual({ csr: "Q1NS" });
  });
  it("reporting / clearance: Basic auth with token:secret, Clearance-Status header, body fields", () => {
    const doc = { invoiceHash: "h", uuid: "u", invoice: "x" };
    const rep = reportingRequest("production", { token: "TOKEN", secret: "SECRET" }, doc);
    expect(rep.url).toBe(`${ZATCA_BASE.production}/invoices/reporting/single`);
    expect(rep.headers.Authorization).toBe(`Basic ${btoa("TOKEN:SECRET")}`);
    expect(rep.headers["Clearance-Status"]).toBe("0");
    expect(JSON.parse(rep.body)).toEqual(doc);
    const clr = clearanceRequest("simulation", { token: "T", secret: "S" }, doc);
    expect(clr.url).toBe("https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single");
    expect(clr.headers["Clearance-Status"]).toBe("1");
  });
});

describe("API responses", () => {
  it("reported / warnings / rejected / 303 / retry", () => {
    expect(parseSubmitResponse(200, REPORTED_200, "reporting").outcome).toBe("reported");
    const w = parseSubmitResponse(202, REPORTED_WITH_WARNINGS_202, "reporting");
    expect(w.outcome).toBe("warning");
    expect(w.warnings[0].code).toBe("BR-KSA-08");
    const e = parseSubmitResponse(400, NOT_REPORTED_400, "reporting");
    expect(e.outcome).toBe("rejected");
    expect(e.errors[0].code).toBe("invalid-invoice-hash");
    expect(parseSubmitResponse(303, {}, "clearance").outcome).toBe("use_reporting");
    expect(parseSubmitResponse(503, null, "reporting").outcome).toBe("retry");
    expect(parseSubmitResponse(0, null, "reporting").outcome).toBe("retry");
    expect(parseSubmitResponse(401, {}, "reporting").errors[0].message).toMatch(/credentials/);
    expect(parseSubmitResponse(200, CLEARED_200("eA=="), "clearance")).toMatchObject({ outcome: "cleared", clearedInvoice: "eA==" });
  });
  it("CSID", () => {
    const ok = parseCsidResponse(200, CSID_200("VE9LRU4="));
    expect(ok).toMatchObject({ ok: true, requestId: "1234567890123", binarySecurityToken: "VE9LRU4=", disposition: "ISSUED" });
    const bad = parseCsidResponse(400, CSID_400_OTP);
    expect(bad.ok).toBe(false);
    expect(bad.errors[0].code).toBe("Invalid-OTP");
  });
  it("24 h reporting triage", () => {
    const t0 = Date.parse("2026-11-03T10:00:00Z");
    expect(reportingTriage("2026-11-03T10:00:00Z", t0).level).toBe("ok");
    expect(reportingTriage("2026-11-03T10:00:00Z", t0 + 20 * 3600_000).level).toBe("soon");
    expect(reportingTriage("2026-11-03T10:00:00Z", t0 + 23 * 3600_000).level).toBe("urgent");
    expect(reportingTriage("2026-11-03T10:00:00Z", t0 + 25 * 3600_000).level).toBe("overdue");
  });
});

/* ───────── handlers ───────── */

const RID = "11111111-1111-4111-8111-111111111111";
const ZATCA_KEY = keyPairFromSecret(new Uint8Array(32).fill(7)); // plays ZATCA's CA in the fake
const zatcaCert = demoSelfSignedCertificate(ZATCA_KEY, { commonName: "TSTZATCA", vatNumber: "399999999900003", serial: 99n, now: new Date("2026-01-01T00:00:00Z") });

function world() {
  const egs: EgsRow = {
    id: "egs-1", restaurant_id: RID, branch_id: "b", device: "RUH1", name: "Sufra-RUH1", serial: "1-Sufra|2-OS|3-x", invoice_types: "1100", key_custody: "server", environment: "sandbox",
    public_key: null, csr_pem: null, status: "new", compliance: null, production: null, checks: {}, last_error: null,
  };
  const secrets: Record<string, EgsSecret> = {};
  const invoices: InvRow[] = [];
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const db: ZatcaDb = {
    userCan: async (jwt, rid, roles) => jwt === "owner-jwt" && rid === RID && roles.includes("owner"),
    settings: async () => ({ zatca: { seller: { nameAr: "مطعم سُفرة", vatNumber: "399999999900003", idScheme: "CRN", idValue: "1010010000", address: { street: "طريق الملك فهد", building: "2322", district: "العليا", city: "الرياض", postalCode: "12241", country: "SA" } }, invoiceTypes: "1100" } }),
    branchName: async () => "Olaya",
    egs: async (id) => (id === egs.id ? egs : null),
    patchEgs: async (_id, p) => void Object.assign(egs, p),
    secret: async (id) => secrets[id] ?? {},
    storeSecret: async (id, s) => void (secrets[id] = s),
    invoice: async (id) => invoices.find((i) => i.id === id) ?? null,
    queue: async () => invoices.filter((i) => i.kind === "simplified" && (i.status === "unsigned" || i.status === "pending")),
    patchInvoice: async (id, p) => void Object.assign(invoices.find((i) => i.id === id)!, p),
  };
  const fakeFetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: init.body });
    const path = url.replace(/^https:\/\/[^/]+\/e-invoicing\/[^/]+/, "");
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    // the fake CA certifies the public key inside the CSR, like ZATCA does
    const issueFor = (csrPem: string) => {
      const der = fromBase64(csrPem.replace(/-----[^-]+-----/g, ""));
      const pub = publicKeyFromSpki(parseDer(der).children[0].children[2].raw);
      return toBase64(utf8(issueCertificate(pub, ZATCA_KEY, { commonName: "EGS", vatNumber: "399999999900003", serial: 99n, issuerCn: "TSZEINVOICE-SubCA-1", now: new Date("2026-01-01T00:00:00Z") })));
    };
    if (path === "/compliance") return init.headers.OTP === "123345" ? reply(200, CSID_200(issueFor(fromUtf8(fromBase64(JSON.parse(init.body).csr))))) : reply(400, CSID_400_OTP);
    if (path === "/compliance/invoices") return reply(200, COMPLIANCE_CHECK_200);
    if (path === "/production/csids") return reply(200, CSID_200(issueFor(egs.csr_pem!)));
    if (path === "/invoices/reporting/single") {
      // the fake ZATCA recomputes the hash from the XML like the real one
      const b = JSON.parse(init.body);
      const v = verifyInvoiceXml(fromUtf8(fromBase64(b.invoice)));
      return v.ok && v.hash === b.invoiceHash ? reply(200, REPORTED_200) : reply(400, NOT_REPORTED_400);
    }
    if (path === "/invoices/clearance/single") {
      const b = JSON.parse(init.body);
      const stamped = stampXml(fromUtf8(fromBase64(b.invoice)), { secretKey: ZATCA_KEY.secretKey, certificate: zatcaCert });
      return reply(200, CLEARED_200(stamped.xmlBase64));
    }
    return reply(404, {});
  }) as unknown as typeof fetch;
  let n = 0;
  const deps: ZatcaDeps = { env: { ZATCA_ENV: "sandbox", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" }, fetch: fakeFetch, now: () => new Date("2026-11-03T18:00:00Z"), uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, log: () => {}, db };
  return { egs, secrets, invoices, calls, deps };
}

const post = (path: string, body: unknown, jwt = "owner-jwt") => new Request(`https://sufra.app/api/${path}`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("server functions", () => {
  it("answer 501 with a clear message when not configured", async () => {
    const w = world();
    const res = await handleReport(post("zatca-report", { restaurantId: RID }), { ...w.deps, env: {} });
    expect(res.status).toBe(501);
    const b = await res.json();
    expect(b.error).toBe("not_configured");
    expect(b.message).toMatch(/ZATCA_ENV/);
  });

  it("onboard: CSR (key stays server-side) → compliance CSID → checks for 6 types → production CSID", async () => {
    const w = world();
    expect((await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action: "csr" }, "cashier-jwt"), w.deps)).status).toBe(403);
    const csr = await (await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action: "csr" }), w.deps)).json();
    expect(csr.csrPem).toMatch(/BEGIN CERTIFICATE REQUEST/);
    expect(JSON.stringify(csr)).not.toMatch(/PRIVATE KEY/);
    expect(w.secrets["egs-1"].privateKeyPem).toMatch(/BEGIN EC PRIVATE KEY/);

    const bad = await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action: "compliance", otp: "999999" }), w.deps);
    expect(bad.status).toBe(502);
    const ok = await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action: "compliance", otp: "123345" }), w.deps);
    expect(ok.status).toBe(200);
    expect(w.egs.status).toBe("compliance");
    expect(w.egs.compliance?.serial).toBe("99");
    expect(w.secrets["egs-1"].compliance?.secret).toBeTruthy();
    const csidCall = w.calls.find((c) => c.url.endsWith("/compliance") && c.headers.OTP === "123345")!;
    expect(fromUtf8(fromBase64(JSON.parse(csidCall.body).csr))).toBe(w.egs.csr_pem);

    const checks = await (await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action: "checks" }), w.deps)).json();
    expect(Object.keys(checks.checks).sort()).toEqual(["simplified:credit", "simplified:debit", "simplified:invoice", "standard:credit", "standard:debit", "standard:invoice"]);
    expect(w.egs.status).toBe("checks_passed");
    const sample = JSON.parse(w.calls.filter((c) => c.url.endsWith("/compliance/invoices")).at(-1)!.body);
    expect(Object.keys(sample).sort()).toEqual(["invoice", "invoiceHash", "uuid"]);

    expect((await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action: "production" }), w.deps)).status).toBe(200);
    expect(w.egs.status).toBe("production");
  });

  it("report: stamps an offline-built simplified invoice server-side (same hash) and reports it; clearance returns ZATCA's QR", async () => {
    const w = world();
    for (const action of ["csr", "compliance", "checks", "production"]) await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action, otp: "123345" }), w.deps);
    const seller: ZatcaInvoiceInput["seller"] = { name: "مطعم سُفرة", vatNumber: "399999999900003", id: { scheme: "CRN", value: "1010010000" }, address: { street: "طريق الملك فهد", building: "2322", district: "العليا", city: "الرياض", postalCode: "12241", country: "SA" } };
    const input: ZatcaInvoiceInput = {
      kind: "simplified", docType: "invoice", invoiceNo: "RUH1-000001", uuid: "3cf5ee18-ee25-44ea-a444-2c37ba7f28be", icv: 1, pih: FIRST_PIH, issueDate: "2026-11-03", issueTime: "21:00:00",
      currency: "SAR", seller, lines: [{ id: "a", name: "كبسة", qty: 1, net: 6087, vat: 913, vatRate: 1500, category: "S" }], paymentMeans: "10",
    };
    const unsigned = signInvoice(input, null);
    w.invoices.push({ id: "inv-1", restaurant_id: RID, egs_id: "egs-1", kind: "simplified", doc_type: "invoice", uuid: input.uuid, icv: 1, hash: unsigned.hash, xml: unsigned.xml, qr: "phase1", status: "unsigned", attempts: 0, signed_by: null, issued_at: "2026-11-03T18:00:00Z" });
    const rep = await (await handleReport(post("zatca-report", { restaurantId: RID }), w.deps)).json();
    expect(rep.results).toEqual([{ id: "inv-1", outcome: "reported" }]);
    expect(w.invoices[0]).toMatchObject({ status: "reported", signed_by: "server", attempts: 1 });
    expect(w.invoices[0].xml).toContain("ext:UBLExtensions");
    expect(w.invoices[0].qr).not.toBe("phase1");

    const std = signInvoice({ ...input, kind: "standard", icv: 2, pih: unsigned.hash, uuid: "4cf5ee18-ee25-44ea-a444-2c37ba7f28be", buyer: { name: "شركة", vatNumber: "311111111100003", address: { street: "x", building: "1234", district: "d", city: "c", postalCode: "12345", country: "SA" } } }, null);
    w.invoices.push({ id: "inv-2", restaurant_id: RID, egs_id: "egs-1", kind: "standard", doc_type: "invoice", uuid: "4cf5ee18-ee25-44ea-a444-2c37ba7f28be", icv: 2, hash: std.hash, xml: std.xml, qr: "", status: "pending", attempts: 0, signed_by: null, issued_at: "2026-11-03T18:05:00Z" });
    const clr = await handleClear(post("zatca-clear", { restaurantId: RID, invoiceId: "inv-2" }), w.deps);
    const body = await clr.json();
    expect(body.outcome).toBe("cleared");
    expect(body.qr).toBeTruthy();
    expect(w.invoices[1].status).toBe("cleared");
  });

  it("refuses demo (browser-key) units", async () => {
    const w = world();
    w.egs.key_custody = "demo_browser";
    const r = await handleOnboard(post("zatca-onboard", { restaurantId: RID, egsId: "egs-1", action: "csr" }), w.deps);
    expect(r.status).toBe(409);
  });
});
