/**
 * /api/radio-token — token for a LIVE push-to-talk provider (LiveKit / Agora / Zello Work). Interface only for now:
 * the app ships store-and-forward voice clips (Supabase Storage + Realtime) and does not call this yet.
 *
 *   POST { restaurantId, channels[] } with a Supabase user JWT → { provider, url, token } (when implemented)
 *   GET  → which provider is configured (booleans only)
 *
 * Env: PTT_PROVIDER=livekit|agora|zello · LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET · AGORA_APP_ID, AGORA_APP_CERTIFICATE ·
 * ZELLO_NETWORK, ZELLO_API_KEY. Design: sufra-os/src/modules/ops/DESIGN.md §Walkie-talkie.
 */
import { radioTokenStatus } from "./_lib/ops-radio";

export default function handler(req: Request): Response {
  return radioTokenStatus(req, process.env);
}
export const config = { runtime: "edge" };
