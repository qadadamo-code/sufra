/**
 * Pre-flight checks Sufra can do before ZATCA sees a document (a subset of the BR-KSA rules + our own sanity checks).
 * Passing these is NOT compliance: ZATCA's validator (SDK / compliance API) is the authority.
 */
import type { ZatcaAddress, ZatcaInvoiceInput, ZatcaSeller } from "./types";
import { computeTotals } from "./ubl";
import { byName, find, findAll, parseXml, textOf, type XElement } from "./xml";

export interface Issue {
  rule: string;
  field: string;
  message: { ar: string; en: string };
}
const I = (rule: string, field: string, ar: string, en: string): Issue => ({ rule, field, message: { ar, en } });

/** 15 digits, first and last digit 3 (Security Features Table 1; BR-KSA-39/40) */
export const isVatNumber = (v: string) => /^3\d{13}3$/.test(v);
const ARABIC = /[؀-ۿ]/;

export function checkAddress(a: Partial<ZatcaAddress> | undefined, who: "seller" | "buyer"): Issue[] {
  const out: Issue[] = [];
  const f = (k: string) => `${who}.address.${k}`;
  if (!a?.street?.trim()) out.push(I(who === "seller" ? "BR-KSA-09" : "BR-KSA-63", f("street"), "اسم الشارع مطلوب", "Street name is required"));
  if (!/^\d{4}$/.test(a?.building ?? "")) out.push(I(who === "seller" ? "BR-KSA-37" : "BR-KSA-63", f("building"), "رقم المبنى لازم ٤ أرقام", "Building number must be 4 digits"));
  if (a?.additionalNo && !/^\d{4}$/.test(a.additionalNo)) out.push(I("national-address", f("additionalNo"), "الرقم الإضافي ٤ أرقام", "Additional number must be 4 digits"));
  if (!a?.district?.trim()) out.push(I(who === "seller" ? "BR-KSA-09" : "BR-KSA-63", f("district"), "الحي مطلوب", "District is required"));
  if (!a?.city?.trim()) out.push(I("BR-KSA-09", f("city"), "المدينة مطلوبة", "City is required"));
  if (!/^\d{5}$/.test(a?.postalCode ?? "")) out.push(I(who === "seller" ? "BR-KSA-66" : "BR-KSA-67", f("postalCode"), "الرمز البريدي ٥ أرقام", "Postal code must be 5 digits"));
  return out;
}

export function checkSeller(s: Partial<ZatcaSeller> | undefined): Issue[] {
  const out: Issue[] = [];
  if (!s?.name?.trim()) out.push(I("BR-06", "seller.name", "اسم البائع مطلوب", "Seller name is required"));
  else if (!ARABIC.test(s.name)) out.push(I("VAT-IR-53", "seller.name", "لازم اسم البائع بالعربي على الفاتورة", "The seller name must be in Arabic on the invoice"));
  if (!isVatNumber(s?.vatNumber ?? "")) out.push(I("BR-KSA-39", "seller.vatNumber", "الرقم الضريبي ١٥ رقم يبدأ وينتهي بـ ٣", "VAT number: 15 digits, starts and ends with 3"));
  if (!s?.id?.value || !/^[A-Za-z0-9]+$/.test(s.id.value)) out.push(I("BR-KSA-08", "seller.id", "رقم السجل التجاري (أو معرف آخر) مطلوب وأرقام/حروف فقط", "Commercial registration (or other ID) is required, alphanumeric only"));
  else if (s.id.scheme === "CRN" && !/^\d{10}$/.test(s.id.value)) out.push(I("BR-KSA-08", "seller.id", "السجل التجاري عادة ١٠ أرقام", "A commercial registration number is normally 10 digits"));
  out.push(...checkAddress(s?.address, "seller"));
  return out;
}

export function checkInvoice(x: ZatcaInvoiceInput): Issue[] {
  const out = checkSeller(x.seller);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x.uuid)) out.push(I("BR-KSA-03", "uuid", "UUID غير صالح", "Invalid UUID"));
  if (!Number.isSafeInteger(x.icv) || x.icv < 1) out.push(I("BR-KSA-34", "icv", "عداد الفواتير لازم رقم صحيح موجب", "ICV must be a positive integer"));
  if (!x.pih) out.push(I("BR-KSA-61", "pih", "هاش الفاتورة السابقة مطلوب", "Previous invoice hash is required"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(x.issueDate)) out.push(I("BR-KSA-04", "issueDate", "تاريخ غير صالح", "Invalid issue date"));
  if (!/^\d{2}:\d{2}:\d{2}$/.test(x.issueTime)) out.push(I("BR-KSA-70", "issueTime", "وقت غير صالح (hh:mm:ss)", "Invalid issue time (hh:mm:ss)"));
  if (!x.lines.length) out.push(I("BR-16", "lines", "الفاتورة من غير أصناف", "Invoice has no lines"));
  for (const l of x.lines) {
    if (l.category !== "S" && !l.exemptionCode) out.push(I("BR-KSA-CL-04", `line.${l.id}`, "صنف معفى بدون كود سبب الإعفاء", "Exempt/zero line without an exemption reason code"));
    if (!l.name.trim()) out.push(I("BR-25", `line.${l.id}`, "اسم الصنف مطلوب", "Item name is required"));
  }
  if (x.docType !== "invoice") {
    if (!x.billingReference?.invoiceNo) out.push(I("BR-KSA-56", "billingReference", "إشعار دائن/مدين لازم يرجع لرقم الفاتورة الأصلية", "Credit/debit notes must reference the original invoice"));
    if (!x.reason?.trim()) out.push(I("BR-KSA-17", "reason", "سبب الإشعار مطلوب", "Reason for the note is required"));
  }
  if (x.kind === "standard") {
    const b = x.buyer;
    if (!b?.name?.trim()) out.push(I("BR-KSA-42", "buyer.name", "اسم المشتري مطلوب في الفاتورة الضريبية", "Buyer name is required on a standard invoice"));
    if (b?.vatNumber && !isVatNumber(b.vatNumber)) out.push(I("BR-KSA-44", "buyer.vatNumber", "رقم ضريبي للمشتري غير صالح", "Invalid buyer VAT number"));
    if (!b?.vatNumber && !b?.otherId?.value) out.push(I("BR-KSA-14", "buyer.otherId", "رقم ضريبي أو معرف آخر للمشتري مطلوب", "Buyer VAT number or other ID is required"));
    if ((b?.address?.country ?? "SA") === "SA") out.push(...checkAddress(b?.address, "buyer"));
  }
  const t = computeTotals(x);
  if (Math.abs(t.rounding) > 100) out.push(I("BR-CO-16", "payable", "فرق التقريب أكبر من ١ ريال — راجع الحساب", "Rounding difference above SAR 1 — check the bill"));
  return out;
}

/** Paths every Sufra document must carry (test helper + queue "XML" view sanity check). */
export const REQUIRED_PATHS = [
  "cbc:ProfileID", "cbc:ID", "cbc:UUID", "cbc:IssueDate", "cbc:IssueTime", "cbc:InvoiceTypeCode", "cbc:DocumentCurrencyCode", "cbc:TaxCurrencyCode",
  "cac:AccountingSupplierParty", "cac:AccountingCustomerParty", "cac:PaymentMeans", "cac:TaxTotal", "cac:LegalMonetaryTotal", "cac:InvoiceLine",
] as const;

export function missingInXml(xml: string | XElement): string[] {
  const root = typeof xml === "string" ? parseXml(xml) : xml;
  const miss: string[] = REQUIRED_PATHS.filter((p) => !root.children.some((c) => typeof c !== "string" && c.name === p));
  const adr = findAll(root, byName("cac:AdditionalDocumentReference")).map((e) => textOf(find(e, byName("cbc:ID"))));
  if (!adr.includes("ICV")) miss.push("ICV");
  if (!adr.includes("PIH")) miss.push("PIH");
  const sup = find(root, byName("cac:AccountingSupplierParty"));
  for (const p of ["cbc:StreetName", "cbc:BuildingNumber", "cbc:CitySubdivisionName", "cbc:CityName", "cbc:PostalZone", "cbc:CompanyID", "cbc:RegistrationName"]) if (sup && !find(sup, byName(p))) miss.push(`supplier ${p}`);
  return miss;
}
