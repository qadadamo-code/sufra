/** /api/pay-webhook-paymob — verified paymob webhook → guest_record_payment (idempotent). See _lib/pay-handlers.ts */
import { handleWebhook, makeDeps } from "./_lib/pay-handlers";

export default function handler(req: Request): Promise<Response> {
  return handleWebhook("paymob", req, makeDeps(process.env));
}
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
