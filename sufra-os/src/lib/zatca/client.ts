/**
 * Browser → /api/zatca-* calls. Secrets never pass through here; the staff JWT authorises the call and the server
 * reads keys/CSIDs from Vault. In local (demo) mode the functions don't exist; callers get a ZatcaApiError(0, "offline").
 */
import { PAY_API, staffToken } from "@/modules/guest/pay/server";

export class ZatcaApiError extends Error {
  constructor(public status: number, public code: string, public detail: string | null) {
    super(detail ?? code);
  }
}

export async function zatcaFetch<T>(fn: "zatca-onboard" | "zatca-report" | "zatca-clear", body: Record<string, unknown>): Promise<T> {
  if (!PAY_API) throw new ZatcaApiError(0, "offline", "API base is off (VITE_PAY_API=off)");
  const token = staffToken();
  let res: Response;
  try {
    res = await fetch(`${PAY_API}/${fn}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  } catch (e) {
    throw new ZatcaApiError(0, "offline", String((e as Error).message ?? e));
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) throw new ZatcaApiError(res.status, "not_deployed", `/api/${fn} is not deployed here (HTTP ${res.status})`);
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ZatcaApiError(res.status, String(j.error ?? res.status), typeof j.message === "string" ? j.message : null);
  return j as T;
}
