/**
 * What a guest page may offer: gateway + enabled methods (no keys). Local: the restaurant's settings row;
 * cloud: the public `guest_pay_config(slug)` RPC (0008_payments.sql).
 */
import { useEffect, useState } from "react";
import type { Repo } from "@/data/repo";
import type { OnlineMethod } from "@/data/types";
import { paySettingsOf } from "@/modules/payments/config";

export interface GuestPayConfig {
  provider: string | null;
  methods: OnlineMethod[];
  absorbFees: boolean;
  surchargeBp: number;
  currency: string;
}

type Rpc = { rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };

export async function loadGuestPayConfig(repo: Repo, slug: string): Promise<GuestPayConfig | null> {
  if (repo.kind === "local") {
    const [r] = await repo.list("restaurants", { where: { slug } });
    if (!r) return null;
    const [s] = await repo.list("settings", { where: { restaurantId: r.id } });
    const p = paySettingsOf(s);
    return { provider: "demo", methods: p.methods, absorbFees: p.absorbFees, surchargeBp: p.surchargeBp, currency: s?.locale.currency ?? "EGP" };
  }
  const client = (repo as unknown as { client?: Rpc }).client;
  if (!client) return null;
  const { data, error } = await client.rpc("guest_pay_config", { p_slug: slug });
  if (error || !data) return null;
  return data as GuestPayConfig;
}

export function useGuestPayConfig(repo: Repo, slug: string): GuestPayConfig | null {
  const [cfg, setCfg] = useState<GuestPayConfig | null>(null);
  useEffect(() => {
    let alive = true;
    loadGuestPayConfig(repo, slug).then((c) => alive && setCfg(c), () => alive && setCfg(null));
    return () => {
      alive = false;
    };
  }, [repo, slug]);
  return cfg;
}

/** Apple Pay only shows on Apple devices with Safari's ApplePaySession; the others always show. */
export function visibleMethods(methods: OnlineMethod[]): OnlineMethod[] {
  const apple = typeof window !== "undefined" && "ApplePaySession" in window;
  const ios = typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent);
  return methods.filter((m) => m !== "applepay" || apple || ios);
}
