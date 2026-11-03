/**
 * Issuing ZATCA documents in the browser, from a closed check (simplified/standard invoice) or a return (credit note).
 *
 * The POS tablet is the EGS unit: it owns the ICV/PIH chain, so a document is built, hashed and chained even offline.
 *  - keyCustody "server" (production): the tablet has no private key. The document is stored `unsigned` with a Phase-1
 *    QR (tags 1–5) on the receipt; /api/zatca-report stamps it with the Vault key (same hash — the stamp is outside the
 *    hashed content) and reports it. Standard invoices go to /api/zatca-clear and are handed over once cleared.
 *  - keyCustody "demo_browser": a demo key + self-signed certificate on the tablet sign it locally (status `demo`).
 *    Nothing is ever sent to ZATCA with a demo key.
 */
import type { Bill } from "@finance/tax";
import type { Db } from "@/data/hooks";
import type { Branch, PaymentMethod, ReceiptBill, Restaurant, Settings } from "@/data/types";
import { toAmount } from "@/lib/money";
import { uuid as newUuid } from "@/lib/id";
import { loadRaw, saveRaw } from "@/lib/storage";
import { fromHex, toBase64, toHex } from "./bytes";
import { nextChain } from "./chain";
import { demoSelfSignedCertificate, generateKeyPair, keyPairFromSecret, spkiDer } from "./crypto";
import type { ZatcaEgsUnit, ZatcaInvoiceRow } from "./model";
import { phase1Qr, qrTimestamp, signInvoice } from "./sign";
import { zatcaSettingsOf } from "./settings";
import type { ZatcaBuyer, ZatcaInvoiceInput, ZatcaLine } from "./types";
import { checkInvoice } from "./validate";
import { computeTotals } from "./ubl";

/* ───────── time (AST = UTC+3, no DST) ───────── */

export function riyadhParts(d: Date): { date: string; time: string } {
  const t = new Date(d.getTime() + 3 * 3600_000).toISOString();
  return { date: t.slice(0, 10), time: t.slice(11, 19) };
}

/* ───────── money bridge ───────── */

/** Units (0.00001) → halalas, refusing anything that is not whole halalas (KSA bills are priced at 2 decimals). */
export function halalas(u: number | bigint): number {
  const a = typeof u === "bigint" ? u : toAmount(u);
  if (a % 1000n !== 0n) throw new Error(`amount ${a} is not whole halalas`);
  return Number(a / 1000n);
}
export const fromHalalas = (h: number) => h * 1000;

/** UNTDID 4461 payment means for Sufra tenders (dominant tender). */
export function paymentMeansOf(payments: { method: PaymentMethod; amount: number }[]): string {
  const top = [...payments].sort((a, b) => b.amount - a.amount)[0]?.method;
  return top === "cash" ? "10" : top === "card" || top === "online" ? "48" : top === "instapay" || top === "wallet" ? "30" : "1";
}

const EXEMPT = { exemptionCode: "VATEX-SA-OOS", exemptionReason: "Not subject to VAT" };

/** Finance Bill + frozen lines → ZATCA lines (delivery fee becomes its own line). */
export function zatcaLines(bill: Bill, frozen: ReceiptBill, rate: number): ZatcaLine[] {
  const lines: ZatcaLine[] = bill.lines.map((l) => {
    const f = frozen.lines.find((x) => x.id === l.id);
    const exempt = !!l.vatExempt || l.vat === 0n;
    return {
      id: l.id,
      name: f ? (f.name.ar === f.name.en ? f.name.ar : `${f.name.ar} / ${f.name.en}`) : l.id,
      qty: l.qty,
      net: halalas(l.net + l.service),
      vat: halalas(l.vat),
      vatRate: exempt ? 0 : rate,
      category: exempt ? "O" : "S",
      ...(exempt ? EXEMPT : {}),
      ...(l.discountTotal ? { discount: halalas(l.discountTotal) } : {}),
    };
  });
  if (bill.deliveryFee > 0n)
    lines.push({ id: "delivery", name: "رسوم التوصيل / Delivery fee", qty: 1, net: halalas(bill.deliveryFee), vat: halalas(bill.deliveryVat), vatRate: bill.deliveryVat ? rate : 0, category: bill.deliveryVat ? "S" : "O", ...(bill.deliveryVat ? {} : EXEMPT) });
  return lines;
}

/* ───────── EGS unit ───────── */

const demoKeyName = (egsId: string) => `sufra-os.zatca.demoKey.${egsId}`;
export const demoKeyOf = (egsId: string) => {
  const h = loadRaw(demoKeyName(egsId));
  return h && /^[0-9a-f]{64}$/.test(h) ? keyPairFromSecret(fromHex(h)) : null;
};

/** Create an EGS unit row for a device. Demo custody generates the key here (localStorage) + a self-signed certificate. */
export async function createEgsUnit(db: Db, x: { branchId: string; device: string; settings: Settings; restaurant: Pick<Restaurant, "slug"> }): Promise<ZatcaEgsUnit> {
  const z = zatcaSettingsOf(x.settings);
  const id = newUuid();
  const name = `Sufra-${x.device}-${x.restaurant.slug}`.slice(0, 64);
  let publicKey: string | null = null;
  let demoCertificate: string | null = null;
  if (z.keyCustody === "demo_browser") {
    const k = generateKeyPair();
    saveRaw(demoKeyName(id), toHex(k.secretKey));
    publicKey = toBase64(spkiDer(k.publicKey));
    demoCertificate = demoSelfSignedCertificate(k, { commonName: name, vatNumber: z.seller.vatNumber || "300000000000003" });
  }
  const unit = await db.insert("zatcaEgsUnits", {
    id, branchId: x.branchId, device: x.device, name, serial: `1-Sufra|2-Sufra OS 1|3-${id}`, invoiceTypes: z.invoiceTypes, keyCustody: z.keyCustody, environment: z.environment,
    publicKey, csrPem: null, status: "new", compliance: null, production: null, demoCertificate, checks: {}, lastError: null,
  } as Omit<ZatcaEgsUnit, "restaurantId" | "createdAt" | "updatedAt">);
  await db.audit("zatca.egs.create", "zatcaEgsUnits", unit.id, { device: x.device, custody: z.keyCustody });
  return unit;
}

export async function egsFor(db: Db, branchId: string, device: string) {
  const [u] = await db.list("zatcaEgsUnits", { where: { branchId, device } });
  return u ?? null;
}

/* ───────── issue ───────── */

export interface IssueZatcaInput {
  settings: Settings;
  restaurant: Pick<Restaurant, "slug" | "name">;
  branch: Pick<Branch, "id"> | null;
  branchId: string;
  device: string;
  kind: "SC" | "RC";
  bill: Bill;
  frozen: ReceiptBill;
  payments: { method: PaymentMethod; amount: number; tip: number }[];
  receiptNo: string;
  issuedAt: Date;
  checkId: string | null;
  /** RC: the sale's ZATCA document */
  original?: Pick<ZatcaInvoiceRow, "invoiceNo" | "issuedAt" | "kind"> | null;
  reason?: string;
  buyer?: ZatcaBuyer | null;
}

export type IssuedZatca = Omit<ZatcaInvoiceRow, "id" | "restaurantId" | "createdAt" | "updatedAt" | "receiptId">;

export class ZatcaIssueError extends Error {}

/** Build, chain, (demo-)sign — returns the row to insert (caller adds receiptId) or throws ZatcaIssueError. */
export async function buildZatcaDocument(db: Db, x: IssueZatcaInput): Promise<IssuedZatca> {
  const z = zatcaSettingsOf(x.settings);
  const egs = (await egsFor(db, x.branchId, x.device)) ?? (await createEgsUnit(db, { branchId: x.branchId, device: x.device, settings: x.settings, restaurant: x.restaurant }));
  const [last] = await db.list("zatcaInvoices", { where: { egsId: egs.id }, orderBy: [{ field: "icv", dir: "desc" }], limit: 1 });
  const chain = nextChain(last ? { icv: last.icv, hash: last.hash } : null);
  const { date, time } = riyadhParts(x.issuedAt);
  const docType = x.kind === "RC" ? "credit" : "invoice";
  // credit notes follow the original's kind (simplified sale → simplified credit note)
  const kind = x.kind === "RC" ? (x.original?.kind ?? "simplified") : x.buyer?.vatNumber || (x.buyer?.otherId?.value && x.buyer.address?.street) ? "standard" : "simplified";
  const input: ZatcaInvoiceInput = {
    kind,
    docType,
    invoiceNo: x.receiptNo,
    uuid: newUuid(),
    icv: chain.icv,
    pih: chain.pih,
    issueDate: date,
    issueTime: time,
    currency: "SAR",
    seller: { name: z.seller.nameAr, vatNumber: z.seller.vatNumber, id: { scheme: z.seller.idScheme, value: z.seller.idValue }, address: z.seller.address },
    buyer: kind === "standard" ? (x.buyer ?? null) : x.buyer?.name ? { name: x.buyer.name } : null,
    lines: zatcaLines(x.bill, x.frozen, x.settings.tax.vatRate),
    payable: halalas(x.bill.payable),
    paymentMeans: paymentMeansOf(x.payments),
    billingReference: x.original ? { invoiceNo: x.original.invoiceNo, issueDate: riyadhParts(new Date(x.original.issuedAt)).date } : null,
    reason: x.kind === "RC" ? (x.reason?.trim() || "مرتجع / Goods returned") : null,
  };
  const issues = checkInvoice(input);
  if (issues.length) throw new ZatcaIssueError(issues.map((i) => `${i.rule}: ${i.message.en}`).join(" · "));

  const demoKey = egs.keyCustody === "demo_browser" ? demoKeyOf(egs.id) : null;
  const cert = egs.demoCertificate;
  const signed = kind === "simplified" && demoKey && cert ? signInvoice(input, { secretKey: demoKey.secretKey, certificate: cert }) : signInvoice(input, null);
  const totals = computeTotals(input);
  const qr = signed.qr || phase1Qr({ sellerName: input.seller.name, vatNumber: input.seller.vatNumber, timestamp: qrTimestamp(input), total: totals.taxInclusive, vat: totals.vat });
  const status: IssuedZatca["status"] = egs.keyCustody === "demo_browser" ? "demo" : kind === "standard" ? "pending" : "unsigned";
  return {
    branchId: x.branchId, egsId: egs.id, device: x.device, checkId: x.checkId, kind, docType, invoiceNo: x.receiptNo, uuid: input.uuid, icv: chain.icv, pih: chain.pih,
    hash: signed.hash, issuedAt: x.issuedAt.toISOString(), xml: signed.xml, qr, total: fromHalalas(totals.payable), vat: fromHalalas(totals.vat), status,
    warnings: kind === "simplified" && !signed.signature ? ["awaiting-stamp"] : [], errors: [], attempts: 0, lastAttemptAt: null, nextAttemptAt: null, submittedAt: null, clearedXml: null,
    refInvoiceNo: x.original?.invoiceNo ?? null, signedBy: signed.signature ? "demo_browser" : null, environment: z.environment, buyer: input.buyer ?? null,
  };
}
