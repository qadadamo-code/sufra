/** /api/pay-refund — see _lib/pay-handlers.ts (handleRefund) and sufra-os/docs/PAYMENTS-SETUP.md */
import { handleRefund, makeDeps } from "./_lib/pay-handlers";

export default function handler(req: Request): Promise<Response> {
  return handleRefund(req, makeDeps(process.env));
}
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
