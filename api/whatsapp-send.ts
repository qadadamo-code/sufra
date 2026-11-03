/**
 * /api/whatsapp-send — send a WhatsApp template / free text / media for a restaurant (Node runtime).
 *   POST { restaurantId, to, template: { name, lang, params[], buttonParams[] } | text | media, messageId? }
 *   GET  → configuration status (no secrets) for Settings → Messaging
 * Auth: Supabase user JWT (owner/admin/manager/cashier of that restaurant) or, without Supabase, header x-sufra-api-key.
 * 501 when WhatsApp is not configured. Logic + env vars: _lib/wa-server.ts · docs: sufra-os/docs/WHATSAPP-SETUP.md
 */
import { handleSend, makeWaDeps } from "./_lib/wa-server";

export function GET(req: Request): Promise<Response> {
  return handleSend(req, makeWaDeps(process.env));
}

export function POST(req: Request): Promise<Response> {
  return handleSend(req, makeWaDeps(process.env));
}
