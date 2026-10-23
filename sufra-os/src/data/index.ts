/**
 * Picks the adapter: Supabase when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set, otherwise the
 * in-browser LocalAdapter with the demo seed.
 */
import type { Repo } from "./repo";
import { LocalAdapter } from "./local/LocalAdapter";

export * from "./types";
export type * from "./repo";

let instance: Repo | null = null;

export function backendConfig() {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? { kind: "supabase" as const, url, key } : { kind: "local" as const };
}

export async function createRepo(): Promise<Repo> {
  if (instance) return instance;
  const cfg = backendConfig();
  if (cfg.kind === "supabase") {
    // loaded on demand so the local build does not ship supabase-js in the first chunk
    const { SupabaseAdapter } = await import("./supabase/SupabaseAdapter");
    instance = new SupabaseAdapter(cfg.url, cfg.key);
  } else {
    instance = new LocalAdapter();
  }
  await instance.ready();
  return instance;
}
