/** /api/pay-callback — see _lib/pay-handlers.ts (handleCallback) and sufra-os/docs/PAYMENTS-SETUP.md */
import { handleCallback, makeDeps } from "./_lib/pay-handlers";

export default function handler(req: Request): Promise<Response> {
  return handleCallback(req, makeDeps(process.env));
}
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
