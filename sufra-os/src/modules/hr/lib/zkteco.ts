/**
 * Fingerprint / face terminals — ZKTeco ADMS ("push SDK", iclock protocol) and CSV exports.
 * Pure TypeScript, no path aliases: imported by the Vercel function /api/attendance-push (../../sufra-os/src/modules/hr/lib/zkteco).
 *
 * Push protocol (ZKTeco "Attendance PUSH Communication Protocol", firmware ≥ 8 / ADMS):
 *   GET  /iclock/cdata?SN=<serial>&options=all&pushver=2.4.1      handshake → we answer the option block (stamps, realtime, delay …)
 *   POST /iclock/cdata?SN=<serial>&table=ATTLOG&Stamp=<n>          body = one punch per line, TAB separated:
 *        <user PIN>\t<YYYY-MM-DD HH:MM:SS>\t<status>\t<verify>\t<workcode>\t<reserved>\t<reserved>
 *        → we answer "OK: <lines accepted>"
 *   POST ...&table=OPERLOG (enrolment, admin events) → "OK" (ignored)
 *   GET  /iclock/getrequest?SN=<serial>                            → "OK" (no queued commands)
 * Times are the terminal's wall clock (set it to the restaurant's zone). status: 0 check-in · 1 check-out · 2 break-out ·
 * 3 break-in · 4 OT-in · 5 OT-out · 255 "auto" (the terminal has no state keys). verify: 0 password · 1 finger · 2 card ·
 * 3/4 combos · 15 face · 25 palm.
 */
import { zonedToMs } from "./tz";

export type ZkKind = "in" | "out" | "break_start" | "break_end";

export interface AttlogRecord {
  /** the user number enrolled on the terminal (maps to staffProfiles.deviceUserId) */
  userId: string;
  /** wall-clock time on the terminal, "YYYY-MM-DD HH:MM:SS" */
  local: string;
  status: number;
  verify: number;
  workcode: string;
}

export interface AttlogParse {
  records: AttlogRecord[];
  errors: { line: number; text: string; reason: string }[];
}

const DT = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function validDate(s: string): boolean {
  const m = DT.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && y >= 2000;
}

/** Parses an ATTLOG body. Accepts TAB-separated lines (the protocol) and space-separated ones (some firmwares/exports). */
export function parseAttlog(body: string): AttlogParse {
  const out: AttlogParse = { records: [], errors: [] };
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((raw, i) => {
    const text = raw.trim();
    if (!text) return;
    let f = raw.split("\t").map((x) => x.trim());
    if (f.length < 2) {
      // "<pin> <date> <time> <status> <verify> …"
      const t = text.split(/\s+/);
      f = t.length >= 3 ? [t[0], `${t[1]} ${t[2]}`, ...t.slice(3)] : t;
    }
    const [userId, when, status = "0", verify = "0", workcode = "0"] = f;
    if (!userId || !/^[A-Za-z0-9_-]{1,24}$/.test(userId)) return out.errors.push({ line: i + 1, text, reason: "bad user id" });
    const local = (when ?? "").replace("T", " ");
    if (!validDate(local)) return out.errors.push({ line: i + 1, text, reason: "bad time" });
    const st = Number(status);
    const vf = Number(verify);
    if (!Number.isInteger(st) || st < 0 || st > 255) return out.errors.push({ line: i + 1, text, reason: "bad status" });
    out.records.push({ userId, local: local.length === 16 ? `${local}:00` : local, status: st, verify: Number.isInteger(vf) ? vf : 0, workcode: workcode || "0" });
  });
  return out;
}

/** status → punch kind; null = "auto" (decide from the person's previous punch) */
export function statusToKind(status: number): ZkKind | null {
  switch (status) {
    case 0:
    case 4:
      return "in";
    case 1:
    case 5:
      return "out";
    case 2:
      return "break_start";
    case 3:
      return "break_end";
    default:
      return null;
  }
}

export const VERIFY_LABEL: Record<number, string> = { 0: "password", 1: "fingerprint", 2: "card", 3: "finger+password", 4: "finger+card", 15: "face", 25: "palm" };

/** Stable idempotency key: the same punch pushed twice (retries, re-uploads after a network drop) is stored once. */
export const attlogExternalId = (serial: string, r: AttlogRecord) => `zk:${serial}:${r.userId}:${r.local}:${r.status}`;

/** Terminal wall clock → ISO instant in the device's zone. */
export function attlogInstant(r: AttlogRecord, tz: string): string {
  const [d, t] = r.local.split(" ");
  return new Date(zonedToMs(d, t, tz)).toISOString();
}

export interface CdataQuery {
  serial: string;
  table: string | null;
  stamp: string | null;
  options: string | null;
}

export function parseCdataQuery(url: URL): CdataQuery {
  const g = (k: string) => url.searchParams.get(k) ?? url.searchParams.get(k.toLowerCase());
  return { serial: (g("SN") ?? "").trim(), table: g("table"), stamp: g("Stamp"), options: g("options") };
}

/** Handshake answer: the device then pushes new punches in real time and retries every 30 s on errors. */
export function optionsReply(serial: string, stamps: { attlog?: string | null; operlog?: string | null } = {}): string {
  return [
    `GET OPTION FROM: ${serial}`,
    `ATTLOGStamp=${stamps.attlog || "None"}`,
    `OPERLOGStamp=${stamps.operlog || "9999"}`,
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    "Realtime=1",
    "Encrypt=None",
    "",
  ].join("\n");
}

/* ───────── CSV import fallback (exports from ZKTeco Attendance Management / ZKBioTime / Excel) ───────── */

export interface CsvPunch {
  userId: string;
  local: string;
  kind: ZkKind | null;
  name: string | null;
}

const KIND_WORDS: [RegExp, ZkKind][] = [
  [/^(c\/?in|check[- ]?in|in|0|حضور|دخول)$/i, "in"],
  [/^(c\/?out|check[- ]?out|out|1|انصراف|خروج)$/i, "out"],
  [/^(break[- ]?out|2|بداية استراحة)$/i, "break_start"],
  [/^(break[- ]?in|3|نهاية استراحة)$/i, "break_end"],
  [/^(ot[- ]?in|4)$/i, "in"],
  [/^(ot[- ]?out|5)$/i, "out"],
];

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** dd/mm/yyyy or yyyy-mm-dd [hh:mm[:ss]] [AM/PM] → "YYYY-MM-DD HH:MM:SS" */
export function normalizeDateTime(date: string, time = ""): string | null {
  const s = `${date} ${time}`.trim().replace(/\s+/g, " ");
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|ص|م)?)?$/i.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|ص|م)?)?$/i.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  let h = Number(m[4] ?? 0);
  const ap = m[7]?.toUpperCase();
  if ((ap === "PM" || ap === "م") && h < 12) h += 12;
  if ((ap === "AM" || ap === "ص") && h === 12) h = 0;
  const p = (n: number) => String(n).padStart(2, "0");
  const out = `${y}-${p(mo)}-${p(d)} ${p(h)}:${p(Number(m[5] ?? 0))}:${p(Number(m[6] ?? 0))}`;
  return validDate(out) ? out : null;
}

/**
 * Columns are found by header name: user (No./AC-No./ID/Emp ID/User ID/PIN/الرقم), name, date/time (one "Time"/"Date/Time"
 * column or separate "Date" + "Time"), state (State/Status/Type/Punch). Comma, semicolon or TAB separated.
 */
export function parseAttendanceCsv(text: string): { punches: CsvPunch[]; errors: { line: number; reason: string }[] } {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const errors: { line: number; reason: string }[] = [];
  if (!lines.length) return { punches: [], errors };
  const sep = lines[0].includes("\t") ? "\t" : lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const head = splitCsvLine(lines[0], sep).map((h) => h.toLowerCase().replace(/[\s._-]+/g, ""));
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iUser = find("no", "acno", "id", "empid", "employeeid", "userid", "pin", "enrollno", "badge", "الرقم", "كود");
  const iName = find("name", "employee", "الاسم");
  const iDT = find("time", "datetime", "date/time", "punchtime", "checktime", "التاريخوالوقت");
  const iDate = find("date", "التاريخ");
  const iTime = iDT === -1 ? find("clock", "hour", "الوقت") : -1;
  const iState = find("state", "status", "type", "punch", "punchstate", "checktype", "الحالة");
  if (iUser === -1 || (iDT === -1 && iDate === -1)) return { punches: [], errors: [{ line: 1, reason: "need a user number column and a date/time column" }] };
  const punches: CsvPunch[] = [];
  lines.slice(1).forEach((l, k) => {
    const f = splitCsvLine(l, sep);
    const userId = (f[iUser] ?? "").trim();
    const local = iDT !== -1 ? normalizeDateTime(f[iDT] ?? "") : normalizeDateTime(f[iDate] ?? "", iTime !== -1 ? f[iTime] : "");
    if (!userId) return errors.push({ line: k + 2, reason: "no user number" });
    if (!local) return errors.push({ line: k + 2, reason: "bad date/time" });
    const st = iState !== -1 ? (f[iState] ?? "").trim() : "";
    const kind = st ? (KIND_WORDS.find(([re]) => re.test(st))?.[1] ?? null) : null;
    punches.push({ userId, local, kind, name: iName !== -1 ? f[iName] || null : null });
  });
  return { punches, errors };
}

/** For "auto" punches: alternate in/out per person per day in time order. */
export function resolveAutoKinds<T extends { userId: string; local: string; kind: ZkKind | null }>(rows: T[], lastKind: (userId: string, day: string) => ZkKind | null = () => null): (T & { kind: ZkKind })[] {
  const sorted = [...rows].sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0));
  const state = new Map<string, ZkKind | null>();
  return sorted.map((r) => {
    const day = r.local.slice(0, 10);
    const key = `${r.userId}|${day}`;
    const prev = state.has(key) ? state.get(key)! : lastKind(r.userId, day);
    const kind: ZkKind = r.kind ?? (prev === "in" || prev === "break_end" ? "out" : "in");
    state.set(key, kind);
    return { ...r, kind };
  });
}
