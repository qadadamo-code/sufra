/**
 * End-to-end test of api/ask.ts with the Anthropic API mocked at the fetch level (no key, no network):
 * turn 1 the model calls search_restaurants; turn 2 it writes a short answer and calls show_picks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../../api/ask";
import { restaurants } from "./data";

type Ev = Record<string, unknown>;
const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const msgStart = (id: string): Ev => ({ type: "message_start", message: { id, type: "message", role: "assistant", model: "claude-haiku-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
const toolBlock = (index: number, id: string, name: string, json: string): Ev[] => [
  { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
  { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } },
  { type: "content_block_stop", index },
];
const end = (reason: string): Ev[] => [{ type: "message_delta", delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 20 } }, { type: "message_stop" }];

const pick = restaurants.find((r) => r.area === "zamalek" && r.cuisine === "cafe")!;
const turns = [
  sse([msgStart("m1"), ...toolBlock(0, "tu1", "search_restaurants", JSON.stringify({ areas: ["zamalek"], cuisines: ["cafe"], moods: ["work"] })), ...end("tool_use")]),
  sse([
    msgStart("m2"),
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `جرّب ${pick.ar} ` } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "— هادي وفيه واي فاي." } },
    { type: "content_block_stop", index: 0 },
    ...toolBlock(1, "tu2", "show_picks", JSON.stringify({ picks: [{ id: pick.id, reasons: ["واي فاي", "قريب"] }, { id: "fake", reasons: [] }] })),
    ...end("tool_use"),
  ]),
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function readAll(res: Response) {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l) as Ev);
}

describe("/api/ask", () => {
  it("503 without a key (the site then uses its local recommender)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await handler(new Request("http://x/api/ask", { method: "POST", body: JSON.stringify({ question: "hi" }) }));
    expect(res.status).toBe(503);
  });

  it("runs the tool loop, streams text and validated picks", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const bodies: Record<string, unknown>[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(turns[n++], { status: 200, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
    });
    const res = await handler(
      new Request("http://x/api/ask", {
        method: "POST",
        body: JSON.stringify({ question: "كافيه هادي للشغل في الزمالك", lang: "ar", origin: { lat: 30.0626, lng: 31.2197, label: "الزمالك" }, localTime: "2026-10-12T20:00", favourites: [], recent: [] }),
      }),
    );
    expect(res.headers.get("content-type")).toContain("ndjson");
    const evs = await readAll(res);
    expect(evs.find((e) => e.t === "status")).toMatchObject({ tool: "search_restaurants" });
    expect(evs.filter((e) => e.t === "text").map((e) => e.d).join("")).toContain(pick.ar);
    const picks = evs.find((e) => e.t === "picks") as { items: { id: string }[] };
    expect(picks.items.map((p) => p.id)).toEqual([pick.id]); // the fake id was dropped
    expect(evs[evs.length - 1]).toEqual({ t: "done" });

    // request shape: fast model, cached system catalogue, tools, tool_result fed back on turn 2
    expect(bodies).toHaveLength(2);
    expect(bodies[0].model).toBe("claude-haiku-5-5");
    expect(bodies[0].stream).toBe(true);
    const sys = bodies[0].system as { text: string; cache_control?: unknown }[];
    expect(sys[0].cache_control).toEqual({ type: "ephemeral" });
    expect(sys[0].text).toContain(pick.id);
    expect(JSON.stringify(bodies[0].system)).toBe(JSON.stringify(bodies[1].system)); // stable prefix
    const t2 = (bodies[1].messages as { role: string; content: unknown }[]).at(-1)!;
    expect(JSON.stringify(t2.content)).toContain("tool_result");
    expect(JSON.stringify(t2.content)).toContain(pick.id); // search results reached the model
  });

  it("rejects bad input", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    expect((await handler(new Request("http://x/api/ask", { method: "GET" }))).status).toBe(405);
    expect((await handler(new Request("http://x/api/ask", { method: "POST", body: "{" }))).status).toBe(400);
    expect((await handler(new Request("http://x/api/ask", { method: "POST", body: JSON.stringify({ question: "  " }) }))).status).toBe(400);
  });
});
