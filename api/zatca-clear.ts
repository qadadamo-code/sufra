/**
 * /api/zatca-clear — Clearance API for standard (B2B) tax invoices and their notes (Node runtime).
 *   POST { restaurantId, invoiceId }  → { outcome: cleared | warning | rejected | reported, qr, warnings, errors }
 * The buyer only receives the invoice ZATCA returns (cleared XML with ZATCA's stamp + QR). If ZATCA answers 303
 * (clearance switched off) the document is stamped here and reported instead. 501 until configured.
 */
import { handleClear, makeZatcaDeps } from "./_lib/zatca-server";

export function POST(req: Request): Promise<Response> {
  return handleClear(req, makeZatcaDeps(process.env));
}
