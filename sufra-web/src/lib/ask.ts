/**
 * Client for /api/ask (Claude concierge). Streams NDJSON events; on any failure — no function (static preview,
 * local dev without a key), 4xx/5xx, network, timeout — it falls back to the local recommender, so the
 * concierge always answers.
 */
import { byId, type Lang } from "./data";
import type { LatLng } from "./geo";
import { recommend, type Answer, type Pick, type ScoreCtx } from "./recommend";
import { haversineKm } from "./geo";

export type AskEvent = { t: "status"; tool: string } | { t: "text"; d: string } | { t: "picks"; items: { id: string; reasons: string[] }[] } | { t: "done" } | { t: "error"; message: string };

export interface AskResult extends Answer {
  source: "claude" | "local";
}

const pad = (n: number) => String(n).padStart(2, "0");
const localTime = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** If the endpoint is missing once (static hosting), don't keep asking for it this session. */
let endpointMissing = import.meta.env.VITE_HAS_API !== "1";

export async function askSufra(
  question: string,
  ctx: ScoreCtx & { originLabel?: string | null; recent?: string[] },
  onProgress?: (p: { text: string; tool: string | null }) => void,
): Promise<AskResult> {
  const local = (): AskResult => ({ ...recommend(question, ctx), source: "local" });
  if (endpointMissing || typeof fetch === "undefined") return local();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const res = await fetch("api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ac.signal,
      body: JSON.stringify({
        question,
        lang: ctx.lang,
        origin: { lat: ctx.home.lat, lng: ctx.home.lng, label: ctx.originLabel ?? null },
        localTime: localTime(ctx.now ?? new Date()),
        favourites: ctx.favourites ?? [],
        recent: ctx.recent ?? [],
      }),
    });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !res.body || !type.includes("ndjson")) {
      if (res.status === 404 || res.status === 405 || type.includes("text/html")) endpointMissing = true;
      return local();
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let text = "";
    let tool: string | null = null;
    let picks: { id: string; reasons: string[] }[] = [];
    let failed = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const raw = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!raw) continue;
        let ev: AskEvent;
        try {
          ev = JSON.parse(raw) as AskEvent;
        } catch {
          continue;
        }
        if (ev.t === "text") text += ev.d;
        else if (ev.t === "status") tool = ev.tool;
        else if (ev.t === "picks") picks = ev.items;
        else if (ev.t === "error") failed = true;
        onProgress?.({ text, tool });
      }
    }
    if (failed && !text.trim()) return local();
    const loc = local(); // for reasons/km on picks the model didn't annotate, and as a safety net
    const chosen: Pick[] = picks
      .map((p) => {
        const r = byId[p.id];
        if (!r) return null;
        const fallback = loc.picks.find((x) => x.r.id === r.id)?.reasons ?? [];
        return { r, score: 0, km: haversineKm(ctx.home, r), reasons: p.reasons.length ? p.reasons : fallback.slice(0, 3) };
      })
      .filter((x): x is Pick => !!x);
    if (!text.trim() && !chosen.length) return loc;
    return { picks: chosen.length ? chosen : loc.picks, text: text.trim() || loc.text, intent: loc.intent, relaxed: false, source: "claude" };
  } catch {
    return local();
  } finally {
    clearTimeout(timer);
  }
}

export const toolLabel = (tool: string | null, lang: Lang) => {
  const ar: Record<string, string> = { search_restaurants: "بدوّر في المطاعم…", get_restaurant: "بشوف التفاصيل…", open_now: "بتأكد مين مفتوح…" };
  const en: Record<string, string> = { search_restaurants: "Searching places…", get_restaurant: "Checking details…", open_now: "Checking who's open…" };
  return tool ? (lang === "ar" ? ar : en)[tool] ?? null : null;
};

export type { LatLng };
