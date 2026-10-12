/**
 * POST /api/ask — the "اسأل سُفرة" concierge, powered by Claude (Vercel Edge Function).
 *
 * Request JSON: { question, lang, origin: {lat,lng,label?}, localTime: "YYYY-MM-DDTHH:mm", favourites: string[], recent: string[] }
 * Response: newline-delimited JSON events, streamed as they happen:
 *   {"t":"status","tool":"search_restaurants"}   a tool is running (UI shows "searching…")
 *   {"t":"text","d":"…"}                          answer text deltas (short, 1–3 sentences)
 *   {"t":"picks","items":[{"id","reasons":[…]}]}  2–4 picks with reasons (the UI renders cards + deep links)
 *   {"t":"done"} | {"t":"error","message":"…"}
 *
 * ANTHROPIC_API_KEY stays on the server (Vercel env var) and never reaches the browser. If it's missing the
 * function answers 503 and the website falls back to its local recommender.
 */
import Anthropic from "@anthropic-ai/sdk";
import { byId } from "../src/lib/data";
import { catalogue, getRestaurant, openNow, searchRestaurants, validatePicks, type AskContext } from "../src/lib/concierge-tools";

export const config = { runtime: "edge" };

const MODEL = "claude-haiku-5-5"; // the fast model: short, tool-driven answers
const MAX_TURNS = 5;

const AREAS = "zamalek, garden-city, downtown, dokki, mohandessin, maadi, heliopolis, nasr-city, new-cairo, rehab, zayed, october, manial, sheraton, mokattam";
const tools: Anthropic.Tool[] = [
  {
    name: "search_restaurants",
    description:
      "Search Sufra's Cairo restaurants with the website's own filters and ranking (distance is from the user's origin). Returns the best matches with distance, travel time, open/closed, price and reasons. Call it before recommending anything. Omit filters you don't need; if nothing matches, filters are relaxed automatically and reported in relaxed_filters.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text: a dish, a restaurant name or a word (Arabic or English), e.g. 'كشري', 'sushi'." },
        areas: { type: "array", items: { type: "string" }, description: `Area ids: ${AREAS}` },
        cuisines: { type: "array", items: { type: "string" }, description: "Cuisine ids: cafe, egyptian, levant, grill, italian, burger, asian, seafood, dessert, bakery, healthy, gulf, shisha, indian, mexican" },
        moods: { type: "array", items: { type: "string" }, description: "Mood ids: work, eat, drinks, friends, family, date, celebrate, quick, late, breakfast" },
        amenities: { type: "array", items: { type: "string" }, description: "wifi, outlets, quiet, parking, outdoor, kids, wheelchair, shisha, live-music, prayer, sports-screens, pet-friendly, valet, nile-view, rooftop, reservations" },
        price: { type: "string", enum: ["cheap", "pricey"] },
        max_avg_egp: { type: "number", description: "Max average spend per person in EGP" },
        open_now: { type: "boolean" },
        near_me: { type: "boolean", description: "Weight distance heavily" },
        walkable: { type: "boolean", description: "Only within ~2 km" },
        max_km: { type: "number" },
        delivery: { type: "boolean" },
        has_offer: { type: "boolean" },
        like_restaurant: { type: "string", description: "Find places similar to this one (id or name), e.g. for 'زي أبو طارق'" },
        limit: { type: "number", description: "1–8, default 6" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_restaurant",
    description: "Full details for one restaurant by id: address, phone, weekly hours (and whether they are estimated), how busy it is now, popular dishes, offers.",
    eager_input_streaming: true,
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
  },
  {
    name: "open_now",
    description: "Opening status. With ids: whether each is open now (or at at_time, 'HH:MM' 24h, today). Without ids: how many places are open and the nearest open ones.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: { ids: { type: "array", items: { type: "string" } }, at_time: { type: "string", description: "HH:MM, 24-hour, today" } },
      additionalProperties: false,
    },
  },
  {
    name: "show_picks",
    description: "Show your final 2–4 picks to the user as cards with deep links. Call this exactly once, at the end, after writing your short answer. Each reason is a few words (e.g. 'Wi-Fi and quiet', '8 min walk', 'open till 2 AM').",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        picks: {
          type: "array",
          items: { type: "object", properties: { id: { type: "string" }, reasons: { type: "array", items: { type: "string" } } }, required: ["id", "reasons"], additionalProperties: false },
        },
      },
      required: ["picks"],
      additionalProperties: false,
    },
  },
];

// Stable system prompt: instructions + the full catalogue. Cached (it's the same bytes on every request).
const SYSTEM_TEXT = `You are "اسأل سُفرة" (Ask Sufra), the concierge of Sufra, a Cairo restaurant guide.
Help the user pick where to go: 2–4 places with concrete reasons (distance/time from them, open now, mood, amenities, price).

How to work:
- Always use search_restaurants (and get_restaurant / open_now when useful) before recommending. Never invent places, numbers or facts that the tools didn't return.
- Reply in the user's language and dialect: Egyptian Arabic if they wrote Arabic (Levantine if they did), otherwise English.
- Keep the visible answer short: 1–3 sentences naming your picks and the single most useful reason for each. No markdown headings, no lists.
- Then call show_picks once with 2–4 ids and 2–3 short reasons each, in the user's language.
- Be honest about data quality: names and locations are real (OpenStreetMap); menus, prices, ratings and offers are samples unless the tool says otherwise; when hours_are_estimated is true, suggest calling ahead.
- If the question isn't about eating or going out in Cairo, answer briefly and steer back.

Catalogue (id | English name | Arabic name | cuisine | area | price | moods | osm✓ = verified on OpenStreetMap):
${catalogue()}`;

const enc = new TextEncoder();
const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");

function wallClock(s: unknown): Date {
  const m = typeof s === "string" ? s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/) : null;
  // the device's local wall-clock time, rebuilt in this runtime's zone so getHours() is the user's hour
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(Date.now() + 2 * 3600 * 1000);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return Response.json({ error: "concierge not configured" }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (raw.length > 8000) return Response.json({ error: "too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!question) return Response.json({ error: "empty question" }, { status: 400 });
  const o = body.origin as { lat?: unknown; lng?: unknown; label?: unknown } | undefined;
  const lat = typeof o?.lat === "number" && Math.abs(o.lat) <= 90 ? o.lat : 30.045;
  const lng = typeof o?.lng === "number" && Math.abs(o.lng) <= 180 ? o.lng : 31.235;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!byId[x]).slice(0, 12) : []);
  const ctx: AskContext = {
    origin: { lat, lng },
    originLabel: typeof o?.label === "string" ? o.label.slice(0, 80) : null,
    now: wallClock(body.localTime),
    lang: body.lang === "en" ? "en" : "ar",
    favourites: ids(body.favourites),
    recent: ids(body.recent),
  };

  // Volatile, per-request context goes in the user turn (after the cached prefix).
  const userContext = [
    `Local time: ${String(body.localTime ?? "").slice(0, 16) || "unknown"} (Cairo).`,
    `User's origin: ${ctx.originLabel ?? "their chosen area"} (${lat.toFixed(4)}, ${lng.toFixed(4)}).`,
    ctx.favourites.length ? `Favourites: ${ctx.favourites.map((id) => `${byId[id].en} (${id})`).join(", ")}.` : "",
    ctx.recent.length ? `Recently viewed: ${ctx.recent.map((id) => `${byId[id].en} (${id})`).join(", ")}.` : "",
    `Interface language: ${ctx.lang === "ar" ? "Arabic" : "English"}.`,
  ].filter(Boolean).join("\n");

  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `${userContext}\n\nQuestion: ${question}` }];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(line(o));
      let shown = false;
      let text = "";
      let jsonRetries = 0;
      try {
        for (let turn = 0; turn < MAX_TURNS && !shown; turn++) {
          const s = client.messages.stream({
            model: MODEL,
            max_tokens: 4096,
            output_config: { effort: "low" },
            system: [{ type: "text", text: SYSTEM_TEXT, cache_control: { type: "ephemeral" } }],
            tools,
            messages,
          });
          s.on("text", (d) => {
            text += d;
            send({ t: "text", d });
          });
          s.on("streamEvent", (e) => {
            if (e.type === "content_block_start" && e.content_block.type === "tool_use" && e.content_block.name !== "show_picks") send({ t: "status", tool: e.content_block.name });
          });
          let msg: Anthropic.Message;
          try {
            msg = await s.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            // only a tool input that isn't parseable JSON is retried; API errors surface below
            if (err instanceof Anthropic.APIError || jsonRetries++ >= 1) throw err;
            continue;
          }
          if (msg.stop_reason === "refusal") break;
          const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (!uses.length) break; // plain answer, no tools
          if (msg.stop_reason === "max_tokens") break; // never run a truncated tool call
          messages.push({ role: "assistant", content: msg.content });
          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const u of uses) {
            const input = (u.input ?? {}) as Record<string, unknown>;
            let out: unknown;
            if (u.name === "show_picks") {
              const picks = validatePicks(input);
              if (picks) {
                send({ t: "picks", items: picks });
                shown = true;
                out = { shown: picks.length };
              } else out = { error: "INVALID_INPUT: picks must be 1–4 objects with a real restaurant id and short reasons" };
            } else if (u.name === "search_restaurants") out = searchRestaurants(input, ctx);
            else if (u.name === "get_restaurant") out = getRestaurant(input, ctx);
            else if (u.name === "open_now") out = openNow(input, ctx);
            else out = { error: `unknown tool ${u.name}` };
            const isError = typeof out === "object" && out !== null && "error" in out;
            results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out), ...(isError ? { is_error: true } : {}) });
          }
          messages.push({ role: "user", content: results });
        }
        if (!shown) {
          // the model answered without show_picks: recover picks from ids/links mentioned in its text
          const found = [...new Set([...text.matchAll(/#\/r\/([a-z0-9-]+)|\b(osm-[nwr]\d+|r\d{3})\b/g)].map((m) => m[1] ?? m[2]))]
            .map((k) => byId[k]?.id ?? Object.values(byId).find((r) => r.slug === k)?.id)
            .filter((x): x is string => !!x)
            .slice(0, 4);
          if (found.length) send({ t: "picks", items: found.map((id) => ({ id, reasons: [] })) });
        }
        send({ t: "done" });
      } catch (err) {
        const status = err instanceof Anthropic.APIError ? err.status : undefined;
        send({ t: "error", message: status === 429 ? "busy" : "failed", status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
