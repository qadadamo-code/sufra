/**
 * Compliance-check sample documents (onboarding step 2: "submit compliance sample invoices for every type the EGS will
 * issue"). One chain of up to six documents — standard/simplified × invoice/credit/debit, as the CSR's TSCZ flags allow.
 * Alias-free: used by /api/zatca-onboard and by the Settings wizard's local dry run.
 */
import { nextChain } from "./chain";
import type { ZatcaDocType, ZatcaInvoiceInput, ZatcaKind, ZatcaSeller } from "./types";

export const SAMPLE_BUYER = {
  name: "شركة نموذج للتجارة",
  vatNumber: "300000000000003",
  address: { street: "طريق الملك عبدالعزيز", building: "1111", district: "الملز", city: "الرياض", postalCode: "12629", country: "SA" },
};

export function sampleTypes(invoiceTypes: string): `${ZatcaKind}:${ZatcaDocType}`[] {
  const out: `${ZatcaKind}:${ZatcaDocType}`[] = [];
  if (invoiceTypes[0] === "1") out.push("standard:invoice", "standard:credit", "standard:debit");
  if (invoiceTypes[1] === "1") out.push("simplified:invoice", "simplified:credit", "simplified:debit");
  return out;
}

/** Builds the samples in chain order; `build` signs one (or leaves it unsigned) and returns at least its hash. */
export function complianceSamples<R extends { hash: string }>(seller: ZatcaSeller, invoiceTypes: string, now: Date, uuid: () => string, build: (input: ZatcaInvoiceInput) => R): { type: `${ZatcaKind}:${ZatcaDocType}`; input: ZatcaInvoiceInput; result: R }[] {
  const t = new Date(now.getTime() + 3 * 3600_000).toISOString();
  let prev: { icv: number; hash: string } | null = null;
  const out: { type: `${ZatcaKind}:${ZatcaDocType}`; input: ZatcaInvoiceInput; result: R }[] = [];
  for (const type of sampleTypes(invoiceTypes)) {
    const [kind, docType] = type.split(":") as [ZatcaKind, ZatcaDocType];
    const c = nextChain(prev);
    const input: ZatcaInvoiceInput = {
      kind, docType, invoiceNo: `SME-${String(c.icv).padStart(5, "0")}`, uuid: uuid(), icv: c.icv, pih: c.pih, issueDate: t.slice(0, 10), issueTime: t.slice(11, 19), currency: "SAR", seller,
      buyer: kind === "standard" ? SAMPLE_BUYER : null,
      lines: [
        { id: "1", name: "كبسة لحم", qty: 1, net: 6087, vat: 913, vatRate: 1500, category: "S" },
        { id: "2", name: "شاي", qty: 2, net: 1739, vat: 261, vatRate: 1500, category: "S" },
      ],
      paymentMeans: "10",
      billingReference: docType === "invoice" ? null : { invoiceNo: "SME-00001" },
      reason: docType === "credit" ? "مرتجع بضاعة / Goods returned" : docType === "debit" ? "تعديل سعر / Price adjustment" : null,
    };
    const result = build(input);
    out.push({ type, input, result });
    prev = { icv: c.icv, hash: result.hash };
  }
  return out;
}
