/**
 * /api/whatsapp-webhook — Meta WhatsApp Cloud API webhook (Node runtime).
 *   GET  hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → echoes the challenge when the token matches WHATSAPP_VERIFY_TOKEN
 *   POST messages + delivery statuses, signed with X-Hub-Signature-256 (HMAC-SHA256 of the raw body, WHATSAPP_APP_SECRET)
 * Stores into Supabase (messaging_ingest_webhook, service role) when configured, else logs. Handles STOP / إلغاء / وقف.
 * Callback URL to paste in Meta: https://sufra-planet-crm.vercel.app/api/whatsapp-webhook
 */
import { handleVerify, handleWebhookPost, makeWaDeps } from "./_lib/wa-server";

export function GET(req: Request): Response {
  return handleVerify(req, makeWaDeps(process.env));
}

export function POST(req: Request): Promise<Response> {
  return handleWebhookPost(req, makeWaDeps(process.env));
}
