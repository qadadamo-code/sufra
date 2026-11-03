/** /api/pay-status — which payment keys the server has (booleans only, never values) + webhook URLs. */
import { handleStatus, makeDeps } from "./_lib/pay-handlers";

export default function handler(req: Request): Response {
  return handleStatus(req, makeDeps(process.env));
}
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
