/**
 * /api/zatca-report — Reporting API for simplified tax invoices and their credit/debit notes (Node runtime).
 *   POST { restaurantId, invoiceId? }   staff (JWT): report one document, or this restaurant's due queue
 *   GET/POST with Authorization: Bearer <CRON_SECRET>   Vercel Cron: every due document of every restaurant
 * Unsigned documents (built + chained offline by the POS) are stamped here with the Vault key first — same hash.
 * Simplified documents must be reported within 24 h of issue. 501 until ZATCA_ENV + Supabase are configured.
 */
import { handleReport, makeZatcaDeps } from "./_lib/zatca-server";

export function GET(req: Request): Promise<Response> {
  return handleReport(req, makeZatcaDeps(process.env));
}
export function POST(req: Request): Promise<Response> {
  return handleReport(req, makeZatcaDeps(process.env));
}
