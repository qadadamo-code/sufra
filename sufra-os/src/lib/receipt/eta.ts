/**
 * ETA e-receipts in the browser.
 *
 * sufra-finance's `eta-receipt.ts` hashes with `node:crypto`; its crypto-free core (`eta-receipt-core.ts`) builds the very
 * same document and takes an async SHA-256. Here that hash is WebCrypto (`crypto.subtle.digest`), so the uuid a tablet
 * computes offline is byte-for-byte what the server (or ETA) recomputes — see eta.test.ts.
 *
 * Submitting to ETA needs the POS client id/secret, which are server-side secrets: the browser only issues, chains,
 * prints and queues receipts. Submission runs in a server function (README → "ETA submission").
 */
import {
  DEFAULT_DELIVERY_MODE, EtaValidationError, issueReceiptAsync, submissionDeadline, verifyReceiptUuidAsync,
  type EtaConfig, type EtaItemCode, type IssuedReceipt, type ReceiptLineMeta,
} from "@finance/eta-receipt-core";
import type { Bill, TaxProfile } from "@finance/tax";
import type { Payment as FinPayment } from "@finance/posting";
import type { Branch, EtaSettings, Restaurant, Settings } from "@/data/types";

export { EtaValidationError, submissionDeadline };
export type { IssuedReceipt };

/** Hex SHA-256 of a UTF-8 string with WebCrypto (browsers, workers, Node ≥ 18). */
export async function webSha256Hex(s: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto is not available (needs a secure context: https or localhost)");
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const DEFAULT_ETA: EtaSettings = {
  enabled: true,
  environment: "preprod",
  posSerial: "",
  tradeName: "",
  branchAddress: { governate: "", regionCity: "", street: "", buildingNumber: "", postalCode: "" },
  splitTender: "dominant",
  itemCodePrefix: "",
  credentialsConfigured: false,
};

export const etaSettingsOf = (s: Pick<Settings, "eta"> | null | undefined): EtaSettings => ({
  ...DEFAULT_ETA,
  ...(s?.eta ?? {}),
  branchAddress: { ...DEFAULT_ETA.branchAddress, ...(s?.eta?.branchAddress ?? {}) },
});

export const ETA_PORTAL = { preprod: "https://preprod.invoicing.eta.gov.eg", prod: "https://invoicing.eta.gov.eg" } as const;

/** Things ETA will reject that we can see before going live (shown in Tax settings and the ETA queue). */
export function etaReadiness(settings: Settings | null | undefined): { ok: boolean; missing: ("rin" | "activity" | "serial" | "tradeName" | "address")[] } {
  const eta = etaSettingsOf(settings);
  const missing: ("rin" | "activity" | "serial" | "tradeName" | "address")[] = [];
  if (!/^\d{9}$/.test((settings?.tax.taxId ?? "").replace(/\D/g, ""))) missing.push("rin");
  if (!settings?.tax.activityCode) missing.push("activity");
  if (!eta.posSerial.trim()) missing.push("serial");
  if (!eta.tradeName.trim()) missing.push("tradeName");
  if (!eta.branchAddress.governate.trim() || !eta.branchAddress.street.trim()) missing.push("address");
  return { ok: missing.length === 0, missing };
}

/** EGS code for a menu item: `${prefix}${internalCode}` (prefix defaults to EG-<RIN>-). */
export function itemCodeFor(eta: EtaSettings, rin: string, internalCode: string): EtaItemCode {
  const prefix = eta.itemCodePrefix || `EG-${rin || "000000000"}-`;
  return { itemType: "EGS", itemCode: `${prefix}${internalCode}`, unitType: "EA" };
}

export function etaConfig(opts: { settings: Settings; restaurant: Pick<Restaurant, "name">; branch: Pick<Branch, "etaBranchCode" | "address"> | null; internalCodes: string[] }): EtaConfig {
  const eta = etaSettingsOf(opts.settings);
  const rin = (opts.settings.tax.taxId ?? "").replace(/\D/g, "");
  const itemCodes: Record<string, EtaItemCode> = {};
  for (const c of [...opts.internalCodes, "DELIVERY"]) itemCodes[c] = itemCodeFor(eta, rin, c);
  return {
    seller: {
      rin,
      companyTradeName: eta.tradeName || opts.restaurant.name.en || opts.restaurant.name.ar,
      branchCode: opts.branch?.etaBranchCode ?? "0",
      branchAddress: {
        country: "EG",
        governate: eta.branchAddress.governate,
        regionCity: eta.branchAddress.regionCity,
        street: eta.branchAddress.street || opts.branch?.address.en || "",
        buildingNumber: eta.branchAddress.buildingNumber || "0",
        ...(eta.branchAddress.postalCode ? { postalCode: eta.branchAddress.postalCode } : {}),
      },
      deviceSerialNumber: eta.posSerial,
      activityCode: opts.settings.tax.activityCode || "5610",
    },
    portalUrl: ETA_PORTAL[eta.environment],
    itemCodes,
    deliveryMode: DEFAULT_DELIVERY_MODE,
    splitTender: eta.splitTender,
  };
}

/** Issue one SC/RC e-receipt in the browser (same uuid/JSON as sufra-finance's node `issueReceipt`). */
export async function issueEtaReceipt(
  cfg: EtaConfig,
  x: { kind: "SC" | "RC"; bill: Bill; profile: TaxProfile; lines: ReceiptLineMeta[]; payments: FinPayment[]; receiptNumber: string; issuedAt: Date; previousUUID: string; referenceUUID?: string; orderRef?: string },
  now = new Date(),
): Promise<IssuedReceipt> {
  return issueReceiptAsync(cfg, x, webSha256Hex, now);
}

export const verifyEtaUuid = (json: string) => verifyReceiptUuidAsync(json, webSha256Hex);
