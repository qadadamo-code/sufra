/** Live push-to-talk provider status (api/radio-token.ts). Minting tokens is deliberately not implemented yet. */
type Env = Partial<Record<string, string | undefined>>;

export function radioProvider(env: Env): { provider: "livekit" | "agora" | "zello" | null; ready: boolean } {
  const p = (env.PTT_PROVIDER ?? "").toLowerCase();
  if (p === "livekit") return { provider: "livekit", ready: !!(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET) };
  if (p === "agora") return { provider: "agora", ready: !!(env.AGORA_APP_ID && env.AGORA_APP_CERTIFICATE) };
  if (p === "zello") return { provider: "zello", ready: !!(env.ZELLO_NETWORK && env.ZELLO_API_KEY) };
  return { provider: null, ready: false };
}

export function radioTokenStatus(req: Request, env: Env): Response {
  const s = radioProvider(env);
  const h = { "content-type": "application/json", "cache-control": "no-store" };
  if (req.method === "GET") return new Response(JSON.stringify(s), { status: 200, headers: h });
  return new Response(JSON.stringify({ error: "not_implemented", message: "Live PTT is an adapter interface; the app uses recorded clips. See src/modules/ops/DESIGN.md.", ...s }), { status: 501, headers: h });
}
