/** /api/pay-intent — see _lib/pay-handlers.ts (handleIntent) and sufra-os/docs/PAYMENTS-SETUP.md */
import { handleIntent, makeDeps } from "./_lib/pay-handlers";

export default function handler(req: Request): Promise<Response> {
  return handleIntent(req, makeDeps(process.env));
}
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
