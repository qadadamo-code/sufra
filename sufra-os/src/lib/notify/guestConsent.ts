/**
 * Consent captured on public guest pages (online checkout, QR "join the club").
 *   cloud: guest_messaging_consent() RPC (0007_messaging.sql — anon, opt-in only for a known customer)
 *   local: written straight into the in-browser rows through MessagingService (same rules)
 */
import type { Repo } from "@/data/repo";
import type { ConsentSource } from "@/data/types";
import { makeDb } from "@/data/hooks";
import { toE164 } from "./core";
import { MessagingService } from "./service";

export interface GuestConsentInput {
  phone: string;
  name?: string;
  source: Extract<ConsentSource, "online_checkout" | "qr_loyalty" | "reservation">;
  granted: boolean;
  /** the exact checkbox text the guest saw */
  wording: string;
}

type Rpc = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

export async function recordGuestConsent(repo: Repo, slug: string, input: GuestConsentInput): Promise<void> {
  if (!toE164(input.phone)) return;
  if (repo.kind === "supabase") {
    const client = (repo as unknown as { client?: Rpc }).client;
    if (!client) return;
    const { error } = await client.rpc("guest_messaging_consent", { p_slug: slug, p_phone: input.phone, p_name: input.name ?? "", p_source: input.source, p_granted: input.granted, p_wording: input.wording.slice(0, 300) });
    if (error) throw new Error(error.message);
    return;
  }
  const [r] = await repo.list("restaurants", { where: { slug } });
  if (!r) return;
  const svc = await MessagingService.load(makeDb(repo, r.id, null, null));
  const prev = await svc.consentOf(input.phone);
  // never silently re-subscribe someone who opted out by keyword; an explicit tick does count as opting back in
  if (!input.granted && !prev) return;
  if (prev?.status === (input.granted ? "opted_in" : "opted_out")) return;
  await svc.recordConsent({ phone: input.phone, status: input.granted ? "opted_in" : "opted_out", source: input.source, wording: input.wording });
}
