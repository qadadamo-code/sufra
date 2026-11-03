/**
 * /api/zatca-onboard — EGS onboarding with ZATCA FATOORA (Node runtime).
 *   POST { restaurantId, egsId, action: "csr" }                 server generates the secp256k1 key (→ Vault) + CSR
 *   POST { restaurantId, egsId, action: "compliance", otp }     OTP (Fatoora portal) + CSR → compliance CSID
 *   POST { restaurantId, egsId, action: "checks" }              signed sample of every document type → /compliance/invoices
 *   POST { restaurantId, egsId, action: "production" }          → production CSID
 *   POST { restaurantId, egsId, action: "renew", otp }          new CSR + OTP → renewed production CSID
 * Auth: Supabase user JWT of an owner/admin. 501 until ZATCA_ENV + Supabase are configured.
 * Logic: _lib/zatca-server.ts · design + sources: sufra-os/src/lib/zatca/DESIGN.md
 */
import { handleOnboard, makeZatcaDeps } from "./_lib/zatca-server";

export function POST(req: Request): Promise<Response> {
  return handleOnboard(req, makeZatcaDeps(process.env));
}
