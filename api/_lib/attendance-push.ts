/**
 * /api/attendance-push — fingerprint/face terminals (ZKTeco ADMS "push", iclock protocol) post punches here.
 * Parser + protocol helpers: sufra-os/src/modules/hr/lib/zkteco.ts (tested in sufra-os/src/modules/hr/push.test.ts).
 *
 * Point the terminal at the Sufra server (Menu → Comm. → Cloud Server Setting): domain sufra-planet-crm.vercel.app, port 443,
 * HTTPS on. Terminals always call /iclock/cdata and /iclock/getrequest, so the site needs these rewrites (root vercel.json):
 *   { "source": "/iclock/cdata", "destination": "/api/attendance-push" },
 *   { "source": "/iclock/getrequest", "destination": "/api/attendance-push?cmd=getrequest" }
 *
 * Auth, per device (attendance_devices row, registered in Staff → Attendance → Devices):
 *   - shared secret: `?key=<secret>` (relay / middleware / firmware with a custom URL), `x-device-key: <secret>`, or
 *     `Authorization: Bearer <secret>`; compared against sha256(secret) in constant time. The secret is never stored.
 *   - stock terminals that can only send SN=: the device row's `allowed_ips` (the branch's fixed public IP) must contain the caller.
 *   Unknown / inactive serial, wrong key or IP → 401 (the terminal keeps the punches and retries).
 * Idempotent: every punch has external_id = zk:<SN>:<user>:<time>:<status> (unique per restaurant), so re-sent batches are ignored.
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role, server only).
 */
import { attlogExternalId, attlogInstant, optionsReply, parseAttlog, parseCdataQuery, resolveAutoKinds, statusToKind } from "../../sufra-os/src/modules/hr/lib/zkteco";

export interface DeviceRecord {
  id: string;
  restaurant_id: string;
  branch_id: string;
  serial: string;
  secret_hash: string;
  timezone: string;
  active: boolean;
  allowed_ips: string[] | null;
  last_stamp: string | null;
}

export interface PunchRecord {
  restaurant_id: string;
  branch_id: string;
  membership_id: string | null;
  at: string;
  kind: string;
  source: "device";
  device_sn: string;
  device_user_id: string;
  external_id: string;
  note: string;
}

export interface PushDb {
  device(serial: string): Promise<DeviceRecord | null>;
  /** device user number → membership id, for users enrolled on this restaurant's staff profiles */
  memberships(restaurantId: string, deviceUserIds: string[]): Promise<Record<string, string>>;
  /** insert, ignoring rows whose (restaurant_id, external_id) already exists; returns how many were new */
  insertPunches(rows: PunchRecord[]): Promise<number>;
  touch(deviceId: string, patch: { last_seen_at: string; last_stamp?: string | null }): Promise<void>;
}

export type Env = Record<string, string | undefined>;

const MAX_BODY = 1_000_000;
const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** constant-time comparison of two hex strings */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function presentedKey(req: Request, url: URL): string | null {
  const q = url.searchParams.get("key");
  if (q) return q;
  const h = req.headers.get("x-device-key");
  if (h) return h.trim();
  const auth = req.headers.get("authorization") ?? "";
  if (/^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim();
  return null;
}

const clientIp = (req: Request) => (req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();

async function authorized(req: Request, url: URL, d: DeviceRecord): Promise<boolean> {
  if (!d.active) return false;
  const key = presentedKey(req, url);
  if (key) return safeEqual(await sha256Hex(key), d.secret_hash.toLowerCase());
  const ip = clientIp(req);
  return !!ip && !!d.allowed_ips?.length && d.allowed_ips.includes(ip);
}

export async function handlePush(req: Request, db: PushDb | null, now: () => Date = () => new Date()): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "GET" && req.method !== "POST") return text("method not allowed", 405);
  const q = parseCdataQuery(url);
  if (!q.serial || !/^[A-Za-z0-9_-]{4,40}$/.test(q.serial)) return text("missing SN", 400);
  if (!db) return text("attendance push is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)", 503);
  const device = await db.device(q.serial);
  if (!device || !(await authorized(req, url, device))) return text("unauthorized", 401);
  const seen = now().toISOString();

  // command poll: nothing queued
  if (url.searchParams.get("cmd") === "getrequest" || url.pathname.endsWith("/getrequest")) {
    await db.touch(device.id, { last_seen_at: seen });
    return text("OK");
  }
  // handshake
  if (req.method === "GET") {
    await db.touch(device.id, { last_seen_at: seen });
    return text(optionsReply(device.serial, { attlog: device.last_stamp }));
  }

  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_BODY) return text("too large", 413);
  const body = await req.text();
  if (body.length > MAX_BODY) return text("too large", 413);
  const table = (q.table ?? "").toUpperCase();
  if (table !== "ATTLOG") {
    // OPERLOG / ATTPHOTO / USERINFO …: acknowledged, not stored
    await db.touch(device.id, { last_seen_at: seen });
    return text(`OK: ${body.split("\n").filter((l) => l.trim()).length}`);
  }
  const parsed = parseAttlog(body);
  const users = [...new Set(parsed.records.map((r) => r.userId))];
  const map = users.length ? await db.memberships(device.restaurant_id, users) : {};
  const kinds = resolveAutoKinds(parsed.records.map((r) => ({ ...r, kind: statusToKind(r.status) })));
  const rows: PunchRecord[] = kinds.map((r) => ({
    restaurant_id: device.restaurant_id,
    branch_id: device.branch_id,
    membership_id: map[r.userId] ?? null,
    at: attlogInstant(r, device.timezone || "Africa/Cairo"),
    kind: r.kind,
    source: "device",
    device_sn: device.serial,
    device_user_id: r.userId,
    external_id: attlogExternalId(device.serial, r),
    note: `verify=${r.verify}`,
  }));
  if (rows.length) await db.insertPunches(rows);
  await db.touch(device.id, { last_seen_at: seen, last_stamp: q.stamp ?? device.last_stamp });
  // the terminal counts what we accepted (bad lines included, so it does not resend them forever)
  return text(`OK: ${parsed.records.length + parsed.errors.length}`);
}

const enc = encodeURIComponent;

export function pushDb(env: Env, fetchImpl: typeof fetch = fetch): PushDb | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  const rest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetchImpl(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json", ...(init.headers as Record<string, string> | undefined) },
    });
    if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const t = await res.text();
    return (t ? JSON.parse(t) : null) as T;
  };
  return {
    async device(serial) {
      const rows = await rest<DeviceRecord[]>(`attendance_devices?serial=eq.${enc(serial)}&select=id,restaurant_id,branch_id,serial,secret_hash,timezone,active,allowed_ips,last_stamp&limit=1`);
      return rows[0] ?? null;
    },
    async memberships(rid, ids) {
      const list = ids.map((i) => `"${i.replace(/"/g, "")}"`).join(",");
      const rows = await rest<{ membership_id: string; device_user_id: string }[]>(`staff_profiles?restaurant_id=eq.${enc(rid)}&device_user_id=in.(${enc(list)})&select=membership_id,device_user_id`);
      return Object.fromEntries(rows.map((r) => [r.device_user_id, r.membership_id]));
    },
    async insertPunches(rows) {
      const out = await rest<{ id: string }[]>(`attendance_punches?on_conflict=restaurant_id,external_id`, {
        method: "POST",
        body: JSON.stringify(rows),
        headers: { prefer: "resolution=ignore-duplicates,return=representation" },
      });
      return out?.length ?? 0;
    },
    async touch(id, patch) {
      await rest(`attendance_devices?id=eq.${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch), headers: { prefer: "return=minimal" } });
    },
  };
}
