/**
 * /api/support-ticket — forwards a new "اطلب دعم" ticket to Sufra's team (webhook / Slack / e-mail). Optional:
 * without SUPPORT_WEBHOOK_URL (or RESEND_API_KEY + SUPPORT_EMAIL_TO) it answers 501 and the ticket simply lives in
 * support_tickets, where the Sufra support desk (/sufra-desk) reads it. Logic + env: _lib/ops-support.ts.
 */
import { handleSupportTicket, makeSupportDeps } from "./_lib/ops-support";

export default function handler(req: Request): Promise<Response> {
  return handleSupportTicket(req, makeSupportDeps(process.env));
}
// must be a literal here: Vercel reads the runtime statically from the entry file
export const config = { runtime: "edge" };
