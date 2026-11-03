/**
 * Minimal Supabase access for the payment functions: PostgREST over fetch with the SERVICE ROLE key (server only).
 * When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing, `payDb(env)` returns null and callers log instead of writing.
 */
import type { Env, IntentStatus, ProviderId } from "./pay-core";

export interface IntentRecord {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  check_id: string | null;
  order_id: string | null;
  kind: string;
  provider: string;
  mode: string;
  method: string | null;
  status: IntentStatus;
  amount: number;
  tip: number;
  currency: string;
  fee: number | null;
  refunded: number;
  split_label: string | null;
  redirect_url: string | null;
  provider_ref: string | null;
  provider_order_id: string | null;
  failure_reason: string | null;
  request: Record<string, unknown>;
  payment_id: string | null;
  purpose_ref: string | null;
  note: string;
  customer: { name: string; phone: string; email?: string | null } | null;
  created_by: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface PayDb {
  check(id: string): Promise<{ id: string; restaurant_id: string; branch_id: string; total: number; paid: number; status: string } | null>;
  order(id: string): Promise<{ id: string; restaurant_id: string; branch_id: string; check_id: string | null } | null>;
  /** amount of other intents still open on this check (so two phones can't both pay the full bill) */
  pendingOnCheck(checkId: string): Promise<number>;
  settings(restaurantId: string): Promise<{ payments: Record<string, unknown> | null; locale: { currency?: string } | null } | null>;
  /** per-tenant merchant config + secrets from Vault (pay_account_config, service role only) */
  account(restaurantId: string, provider: ProviderId): Promise<{ mode: string; public_config: Record<string, string>; secrets: Record<string, string> } | null>;
  intent(id: string): Promise<IntentRecord | null>;
  intentByProviderOrder(provider: string, providerOrderId: string): Promise<IntentRecord | null>;
  insertIntent(row: Partial<IntentRecord>): Promise<IntentRecord>;
  patchIntent(id: string, patch: Partial<IntentRecord>): Promise<void>;
  /** guest_record_payment (idempotent, SECURITY DEFINER) */
  record(id: string, status: IntentStatus, providerRef: string | null, failure: string | null): Promise<{ status: string; paymentId: string | null }>;
  insertRefund(row: Record<string, unknown>): Promise<{ id: string }>;
  patchRefund(id: string, patch: Record<string, unknown>): Promise<void>;
  /** is the bearer of this user JWT an active member with one of these roles? (has_role with the user's token) */
  hasRole(userJwt: string, restaurantId: string, roles: string[]): Promise<boolean>;
  /** membership id of the JWT's user in that restaurant (for created_by / requested_by) */
  membershipOf(userJwt: string, restaurantId: string): Promise<string | null>;
}

const enc = encodeURIComponent;

export function payDb(env: Env, fetchImpl: typeof fetch = fetch): PayDb | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  const anon = env.SUPABASE_ANON_KEY?.trim() || key;

  const rest = async <T>(path: string, init: RequestInit = {}, auth = key): Promise<T> => {
    const res = await fetchImpl(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: auth === key ? key : anon, authorization: `Bearer ${auth}`, "content-type": "application/json", accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
    });
    if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  };
  const one = async <T>(path: string): Promise<T | null> => (await rest<T[]>(path))[0] ?? null;

  return {
    check: (id) => one(`checks?id=eq.${enc(id)}&select=id,restaurant_id,branch_id,total,paid,status`),
    order: (id) => one(`orders?id=eq.${enc(id)}&select=id,restaurant_id,branch_id,check_id`),
    async pendingOnCheck(checkId) {
      const rows = await rest<{ amount: number }[]>(`payment_intents?check_id=eq.${enc(checkId)}&status=in.(requires_action,processing)&expires_at=gt.${enc(new Date().toISOString())}&select=amount`);
      return rows.reduce((a, r) => a + Number(r.amount), 0);
    },
    settings: (rid) => one(`settings?restaurant_id=eq.${enc(rid)}&select=payments,locale`),
    async account(rid, provider) {
      try {
        return await rest("rpc/pay_account_config", { method: "POST", body: JSON.stringify({ p_restaurant_id: rid, p_provider: provider }) });
      } catch {
        return null;
      }
    },
    intent: (id) => one(`payment_intents?id=eq.${enc(id)}&select=*`),
    intentByProviderOrder: (p, oid) => one(`payment_intents?provider=eq.${enc(p)}&provider_order_id=eq.${enc(oid)}&select=*`),
    async insertIntent(row) {
      const [r] = await rest<IntentRecord[]>("payment_intents", { method: "POST", body: JSON.stringify(row), headers: { prefer: "return=representation" } });
      return r;
    },
    async patchIntent(id, patch) {
      await rest(`payment_intents?id=eq.${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch), headers: { prefer: "return=minimal" } });
    },
    record: (id, status, ref, failure) => rest("rpc/guest_record_payment", { method: "POST", body: JSON.stringify({ p_intent_id: id, p_status: status, p_provider_ref: ref, p_failure: failure }) }),
    async insertRefund(row) {
      const [r] = await rest<{ id: string }[]>("payment_refunds", { method: "POST", body: JSON.stringify(row), headers: { prefer: "return=representation" } });
      return r;
    },
    async patchRefund(id, patch) {
      await rest(`payment_refunds?id=eq.${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch), headers: { prefer: "return=minimal" } });
    },
    async hasRole(jwt, rid, roles) {
      try {
        return (await rest<boolean>("rpc/has_role", { method: "POST", body: JSON.stringify({ rid, roles }) }, jwt)) === true;
      } catch {
        return false;
      }
    },
    async membershipOf(jwt, rid) {
      try {
        return (await rest<string | null>("rpc/pay_my_membership", { method: "POST", body: JSON.stringify({ p_restaurant_id: rid }) }, jwt)) ?? null;
      } catch {
        return null;
      }
    },
  };
}
