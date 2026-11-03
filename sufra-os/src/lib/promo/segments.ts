/**
 * Customer segments (pure): rule-based filters with live counts, plus automatic RFM segments.
 *
 *   const stats = customerStats(customer, visits, now);
 *   matchesSegment(stats, { match: "all", rules: [{ field: "lastVisitDays", op: "gt", value: 30 }] }, now)
 */
import type { Units } from "@/lib/money";

export type LeadSource = "qr" | "online" | "pos" | "reservation" | "wifi" | "manual" | "import" | "referral";
export type RfmSegment = "champions" | "loyal" | "new" | "at_risk" | "lost" | "promising";

export type NumOp = "gt" | "gte" | "lt" | "lte" | "eq";

export type SegmentRule =
  | { field: "lastVisitDays"; op: NumOp; value: number }
  | { field: "visits"; op: NumOp; value: number }
  | { field: "totalSpent"; op: NumOp; value: Units }
  | { field: "avgSpend"; op: NumOp; value: Units }
  | { field: "points"; op: NumOp; value: number }
  | { field: "joinedDays"; op: NumOp; value: number }
  | { field: "tag"; op: "has" | "not"; value: string }
  | { field: "item"; op: "ordered" | "not_ordered"; value: string }
  | { field: "birthdayMonth"; op: "this" | "next" }
  | { field: "channel"; op: "is" | "not"; value: LeadSource }
  | { field: "tier"; op: "is" | "not"; value: string }
  | { field: "rfm"; op: "is" | "not"; value: RfmSegment }
  | { field: "consent"; op: "has" | "not"; value: "whatsapp" | "sms" | "email" | "push" };

export interface SegmentDef {
  match: "all" | "any";
  rules: SegmentRule[];
}

/** Everything the rules look at, derived once per customer. */
export interface CustomerStats {
  id: string;
  visits: number;
  totalSpent: Units;
  avgSpend: Units;
  lastVisitAt: string | null;
  firstVisitAt: string | null;
  createdAt: string;
  points: number;
  tags: string[];
  /** itemId → units ever ordered */
  items: Record<string, number>;
  birthday: string | null;
  source: LeadSource | null;
  tierId: string | null;
  consent: { whatsapp?: boolean; sms?: boolean; email?: boolean; push?: boolean };
  rfm?: RfmSegment;
}

const DAY = 86_400_000;
export const daysSince = (iso: string | null, now: Date) => (iso ? Math.floor((now.getTime() - Date.parse(iso)) / DAY) : Infinity);

function num(op: NumOp, a: number, b: number) {
  switch (op) {
    case "gt":
      return a > b;
    case "gte":
      return a >= b;
    case "lt":
      return a < b;
    case "lte":
      return a <= b;
    case "eq":
      return a === b;
  }
}

/** Month (1–12) of a YYYY-MM-DD birthday. */
const bMonth = (b: string | null) => (b && /^\d{4}-\d{2}-\d{2}$/.test(b) ? Number(b.slice(5, 7)) : null);

export function matchesRule(s: CustomerStats, r: SegmentRule, now: Date): boolean {
  switch (r.field) {
    case "lastVisitDays": {
      const d = daysSince(s.lastVisitAt, now);
      // never visited counts as "a long time ago" for gt/gte and never for lt/lte/eq
      return d === Infinity ? r.op === "gt" || r.op === "gte" : num(r.op, d, r.value);
    }
    case "visits":
      return num(r.op, s.visits, r.value);
    case "totalSpent":
      return num(r.op, s.totalSpent, r.value);
    case "avgSpend":
      return num(r.op, s.avgSpend, r.value);
    case "points":
      return num(r.op, s.points, r.value);
    case "joinedDays":
      return num(r.op, daysSince(s.createdAt, now), r.value);
    case "tag":
      return r.op === "has" ? s.tags.includes(r.value) : !s.tags.includes(r.value);
    case "item":
      return r.op === "ordered" ? (s.items[r.value] ?? 0) > 0 : !(s.items[r.value] ?? 0);
    case "birthdayMonth": {
      const m = bMonth(s.birthday);
      if (!m) return false;
      const cur = now.getMonth() + 1;
      return r.op === "this" ? m === cur : m === (cur % 12) + 1;
    }
    case "channel":
      return r.op === "is" ? s.source === r.value : s.source !== r.value;
    case "tier":
      return r.op === "is" ? s.tierId === r.value : s.tierId !== r.value;
    case "rfm":
      return r.op === "is" ? s.rfm === r.value : s.rfm !== r.value;
    case "consent":
      return r.op === "has" ? !!s.consent[r.value] : !s.consent[r.value];
  }
}

export function matchesSegment(s: CustomerStats, def: SegmentDef, now: Date = new Date()): boolean {
  if (!def.rules.length) return true;
  return def.match === "all" ? def.rules.every((r) => matchesRule(s, r, now)) : def.rules.some((r) => matchesRule(s, r, now));
}

export function countSegment(all: CustomerStats[], def: SegmentDef, now: Date = new Date()): number {
  return all.reduce((a, s) => a + (matchesSegment(s, def, now) ? 1 : 0), 0);
}

/* ───────── RFM ───────── */

export interface RfmScore {
  r: number;
  f: number;
  m: number;
  segment: RfmSegment;
}

/** 1–5 score by rank within the population (ties share a score). `higherIsBetter=false` for recency days. */
function quintiles(values: number[], higherIsBetter: boolean): number[] {
  const n = values.length;
  if (!n) return [];
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    // fraction of the population strictly below v (for ties, everyone gets the same)
    const below = sorted.findIndex((x) => x >= v);
    const pct = n === 1 ? 1 : below / (n - 1 || 1);
    const s = Math.min(5, Math.floor(pct * 5) + 1);
    return higherIsBetter ? s : 6 - s;
  });
}

/** ≤14 days → 5, ≤30 → 4, ≤60 → 3, ≤120 → 2, older → 1. */
export const recencyScore = (days: number) => (days <= 14 ? 5 : days <= 30 ? 4 : days <= 60 ? 3 : days <= 120 ? 2 : 1);

export function rfmSegment(r: number, f: number, m: number, visits: number, daysSinceLast: number): RfmSegment {
  if (visits <= 1 && daysSinceLast <= 30) return "new";
  if (r >= 4 && f >= 4 && m >= 4) return "champions";
  if (r <= 1 || (r <= 2 && f <= 2)) return "lost";
  if (r <= 2 && f >= 3) return "at_risk";
  if (f >= 4 || (f >= 3 && r >= 3)) return "loyal";
  return "promising";
}

/** Scores the whole customer base at once (RFM is relative). Customers with no visit are "new" or "lost". */
export function scoreRfm(all: Pick<CustomerStats, "id" | "visits" | "totalSpent" | "lastVisitAt">[], now: Date = new Date()): Map<string, RfmScore> {
  const out = new Map<string, RfmScore>();
  const active = all.filter((c) => c.visits > 0 && c.lastVisitAt);
  const days = active.map((c) => daysSince(c.lastVisitAt, now));
  // recency uses absolute restaurant-friendly bands (relative ranks are too harsh on small bases)
  const R = days.map(recencyScore);
  const F = quintiles(active.map((c) => c.visits), true);
  const M = quintiles(active.map((c) => c.totalSpent), true);
  active.forEach((c, i) => out.set(c.id, { r: R[i], f: F[i], m: M[i], segment: rfmSegment(R[i], F[i], M[i], c.visits, days[i]) }));
  for (const c of all) if (!out.has(c.id)) out.set(c.id, { r: 0, f: 0, m: 0, segment: c.lastVisitAt ? "lost" : "new" });
  return out;
}

export const RFM_LABEL: Record<RfmSegment, { ar: string; en: string; tone: "ok" | "primary" | "info" | "warn" | "danger" | "brass" }> = {
  champions: { ar: "الأبطال", en: "Champions", tone: "ok" },
  loyal: { ar: "مخلصين", en: "Loyal", tone: "primary" },
  new: { ar: "جداد", en: "New", tone: "info" },
  promising: { ar: "واعدين", en: "Promising", tone: "brass" },
  at_risk: { ar: "في خطر", en: "At risk", tone: "warn" },
  lost: { ar: "فقدناهم", en: "Lost", tone: "danger" },
};

/** Built-in segments offered as templates in the builder. */
export const SEGMENT_TEMPLATES: { key: string; name: { ar: string; en: string }; def: SegmentDef }[] = [
  { key: "winback", name: { ar: "ماجوش من ٣٠ يوم", en: "No visit in 30 days" }, def: { match: "all", rules: [{ field: "lastVisitDays", op: "gt", value: 30 }, { field: "visits", op: "gte", value: 2 }] } },
  { key: "big", name: { ar: "صرفوا أكتر من ١٠ آلاف", en: "Spent over EGP 10k" }, def: { match: "all", rules: [{ field: "totalSpent", op: "gt", value: 10_000 * 100_000 }] } },
  { key: "bday", name: { ar: "عيد ميلادهم الشهر ده", en: "Birthday this month" }, def: { match: "all", rules: [{ field: "birthdayMonth", op: "this" }] } },
  { key: "online", name: { ar: "بيطلبوا أونلاين", en: "Order online" }, def: { match: "any", rules: [{ field: "channel", op: "is", value: "online" }, { field: "tag", op: "has", value: "online" }] } },
  { key: "regulars", name: { ar: "زباين دايمين (١٠+ زيارات)", en: "Regulars (10+ visits)" }, def: { match: "all", rules: [{ field: "visits", op: "gte", value: 10 }] } },
];
