/** ZATCA document → what the printed receipt shows (QR, UUID, title, VAT/CR numbers, B2B buyer). */
import type { Settings } from "@/data/types";
import type { ReceiptZatca } from "@/lib/receipt/model";
import type { ZatcaInvoiceRow } from "./model";
import { zatcaSettingsOf } from "./settings";

export function receiptZatca(z: ZatcaInvoiceRow | null | undefined, settings: Settings | null | undefined): ReceiptZatca | null {
  if (!z) return null;
  const s = zatcaSettingsOf(settings);
  return {
    uuid: z.uuid,
    qr: z.qr,
    kind: z.kind,
    docType: z.docType,
    signed: !!z.signedBy || z.status === "cleared",
    demo: z.status === "demo",
    vatNumber: s.seller.vatNumber,
    crn: s.seller.idValue,
    buyer: z.kind === "standard" && z.buyer ? { name: z.buyer.name, vatNumber: z.buyer.vatNumber } : null,
  };
}
