/** /api/attendance-push — ZKTeco ADMS push (fingerprint/face terminals) → attendance_punches (idempotent). See _lib/attendance-push.ts */
import { handlePush, pushDb } from "./_lib/attendance-push";

export default function handler(req: Request): Promise<Response> {
  return handlePush(req, pushDb(process.env));
}
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
