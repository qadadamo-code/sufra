/** /api/attendance-push (ZKTeco ADMS) against an in-memory PushDb. */
import { describe, expect, it } from "vitest";
import { handlePush, safeEqual, sha256Hex, type DeviceRecord, type PunchRecord, type PushDb } from "../../../../api/_lib/attendance-push";

async function setup(over: Partial<DeviceRecord> = {}) {
  const device: DeviceRecord = {
    id: "dev1", restaurant_id: "r1", branch_id: "b1", serial: "CQZ7231460021", secret_hash: await sha256Hex("s3cret-zm"), timezone: "Africa/Cairo", active: true, allowed_ips: null, last_stamp: null, ...over,
  };
  const punches: PunchRecord[] = [];
  const touched: unknown[] = [];
  const db: PushDb = {
    device: async (sn) => (sn === device.serial ? device : null),
    memberships: async (_rid, ids) => Object.fromEntries(ids.filter((i) => i === "1" || i === "27").map((i) => [i, `m${i}`])),
    insertPunches: async (rows) => {
      let n = 0;
      for (const r of rows) if (!punches.some((p) => p.restaurant_id === r.restaurant_id && p.external_id === r.external_id)) (punches.push(r), n++);
      return n;
    },
    touch: async (_id, p) => void touched.push(p),
  };
  return { db, punches, touched, device };
}

const BASE = "https://sufra-planet-crm.vercel.app/api/attendance-push";
const body = "1\t2026-10-12 15:58:21\t0\t1\t0\t0\t0\n27\t2026-10-12 16:31:00\t0\t15\t0\t0\t0\n99\t2026-10-12 16:40:00\t255\t1\t0\t0\t0\nbad line\n";

describe("attendance push (ZKTeco ADMS)", () => {
  it("rejects unknown serials, wrong keys and missing SN", async () => {
    const { db } = await setup();
    expect((await handlePush(new Request(`${BASE}?SN=NOPE1234&key=s3cret-zm`), db)).status).toBe(401);
    expect((await handlePush(new Request(`${BASE}?SN=CQZ7231460021&key=wrong`), db)).status).toBe(401);
    expect((await handlePush(new Request(`${BASE}?SN=CQZ7231460021`), db)).status).toBe(401);
    expect((await handlePush(new Request(BASE), db)).status).toBe(400);
    expect((await handlePush(new Request(`${BASE}?SN=CQZ7231460021&key=s3cret-zm`), null)).status).toBe(503);
    expect(safeEqual("ab", "ab") && !safeEqual("ab", "ac") && !safeEqual("ab", "abc")).toBe(true);
  });

  it("handshake returns the option block; getrequest says OK", async () => {
    const { db } = await setup();
    const r = await handlePush(new Request(`${BASE}?SN=CQZ7231460021&options=all&pushver=2.4.1`, { headers: { "x-device-key": "s3cret-zm" } }), db);
    expect(r.status).toBe(200);
    const t = await r.text();
    expect(t).toContain("GET OPTION FROM: CQZ7231460021");
    expect(t).toContain("Realtime=1");
    expect(await (await handlePush(new Request(`${BASE}?SN=CQZ7231460021&cmd=getrequest`, { headers: { authorization: "Bearer s3cret-zm" } }), db)).text()).toBe("OK");
  });

  it("stores ATTLOG punches once, maps device users, converts Cairo time, keeps unmapped users", async () => {
    const { db, punches } = await setup();
    const post = () => handlePush(new Request(`${BASE}?SN=CQZ7231460021&table=ATTLOG&Stamp=9999&key=s3cret-zm`, { method: "POST", body }), db);
    const r = await post();
    expect(await r.text()).toBe("OK: 4");
    expect(punches).toHaveLength(3);
    expect(punches[0]).toMatchObject({ membership_id: "m1", at: "2026-10-12T12:58:21.000Z", kind: "in", source: "device", device_user_id: "1", external_id: "zk:CQZ7231460021:1:2026-10-12 15:58:21:0" });
    expect(punches[2]).toMatchObject({ membership_id: null, device_user_id: "99", kind: "in" });
    // the terminal re-sends the same batch after a timeout: nothing doubles
    await post();
    expect(punches).toHaveLength(3);
  });

  it("IP allow-list for stock terminals that cannot send a key; OPERLOG is acknowledged", async () => {
    const { db, punches } = await setup({ allowed_ips: ["196.219.10.20"] });
    const ok = await handlePush(new Request(`${BASE}?SN=CQZ7231460021&table=OPERLOG`, { method: "POST", body: "OPLOG 4\t0\t2026-10-12 15:00:00\t0\t0\t0\t0\n", headers: { "x-forwarded-for": "196.219.10.20, 10.0.0.1" } }), db);
    expect(await ok.text()).toBe("OK: 1");
    expect(punches).toHaveLength(0);
    expect((await handlePush(new Request(`${BASE}?SN=CQZ7231460021&table=ATTLOG`, { method: "POST", body, headers: { "x-forwarded-for": "8.8.8.8" } }), db)).status).toBe(401);
    const { db: off } = await setup({ active: false });
    expect((await handlePush(new Request(`${BASE}?SN=CQZ7231460021&key=s3cret-zm`), off)).status).toBe(401);
  });
});
