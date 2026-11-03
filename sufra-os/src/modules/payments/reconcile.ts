/**
 * Pure money logic for the Payments screen (tested in payments.test.ts): fee estimates, reconciliation of gateway
 * intents against POS payments/checks, expected settlements per provider, link state and CSV export.
 * All amounts are integer Units — no floats are summed.
 */
import type { Check, Payment, PaymentIntentRow, PaymentPayout, PaymentSettings, PayProviderId } from "@/data/types";
import type { Units } from "@/lib/money";

const MINOR = 1000;
const roundMinor = (u: number) => Math.round(u / MINOR) * MINOR;

/** provider-reported fee, else settings estimate (bp of the charge + fixed), whole piastres */
export function feeOf(pi: PaymentIntentRow, s: Pick<PaymentSettings, "feeBp" | "feeFixed">): { fee: Units; estimated: boolean } {
  if (pi.fee !== null) return { fee: pi.fee, estimated: false };
  if (pi.status !== "succeeded") return { fee: 0, estimated: true };
  const charge = pi.amount + pi.tip;
  return { fee: roundMinor((charge * s.feeBp) / 10_000) + s.feeFixed, estimated: true };
}

export const chargeOf = (pi: PaymentIntentRow) => pi.amount + pi.tip + Number((pi.request as { surcharge?: number })?.surcharge ?? 0);

/* ───────── reconciliation ───────── */

export type ReconIssue =
  /** the gateway says paid, but no POS payment row exists (webhook raced a manual close, or recording failed) */
  | "paid_not_recorded"
  /** an "online" tender was typed in the POS with no matching gateway payment */
  | "tender_without_gateway"
  /** recorded, but the amounts differ */
  | "amount_mismatch"
  /** paid online in full, check still open — someone needs to close it */
  | "check_left_open";

export interface ReconRow {
  issue: ReconIssue;
  intent: PaymentIntentRow | null;
  payment: Payment | null;
  check: Check | null;
  /** gateway − POS (units) */
  diff: Units;
}

export function reconcile(intents: PaymentIntentRow[], payments: Payment[], checks: Check[]): { matched: number; issues: ReconRow[] } {
  const checkById = new Map(checks.map((c) => [c.id, c]));
  const online = payments.filter((p) => p.method === "online" && p.status !== "void" && p.amount > 0);
  const payById = new Map(online.map((p) => [p.id, p]));
  const payByRef = new Map(online.filter((p) => p.reference).map((p) => [p.reference!, p]));
  const used = new Set<string>();
  const issues: ReconRow[] = [];
  let matched = 0;

  for (const pi of intents) {
    if (pi.status !== "succeeded" || !pi.checkId) continue;
    const check = checkById.get(pi.checkId) ?? null;
    const pay = (pi.paymentId ? payById.get(pi.paymentId) : undefined) ?? payByRef.get(pi.id) ?? (pi.providerRef ? payByRef.get(pi.providerRef) : undefined) ?? null;
    if (!pay) {
      issues.push({ issue: "paid_not_recorded", intent: pi, payment: null, check, diff: pi.amount });
      continue;
    }
    used.add(pay.id);
    if (pay.amount !== pi.amount) {
      issues.push({ issue: "amount_mismatch", intent: pi, payment: pay, check, diff: pi.amount - pay.amount });
      continue;
    }
    matched++;
    // dine-in only: a prepaid delivery / pickup order legitimately stays open until it is handed over
    if (check && check.tableIds.length && (pi.kind === "guest" || pi.kind === "link") && check.status !== "paid" && check.status !== "void" && check.paid >= check.total) issues.push({ issue: "check_left_open", intent: pi, payment: pay, check, diff: 0 });
  }
  for (const p of online) {
    if (used.has(p.id)) continue;
    issues.push({ issue: "tender_without_gateway", intent: null, payment: p, check: checkById.get(p.checkId) ?? null, diff: -p.amount });
  }
  return { matched, issues };
}

/* ───────── settlements ───────── */

export interface Settlement {
  provider: PayProviderId;
  /** business day of the payments (YYYY-MM-DD) */
  day: string;
  /** expected payout date */
  expected: string;
  count: number;
  gross: Units;
  fees: Units;
  refunds: Units;
  net: Units;
  feesEstimated: boolean;
  payout: PaymentPayout | null;
  intentIds: string[];
}

const dayOf = (iso: string) => iso.slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** succeeded intents grouped per provider and day, with the payout they were tied to (or still expected). */
export function settlements(intents: PaymentIntentRow[], payouts: PaymentPayout[], s: Pick<PaymentSettings, "feeBp" | "feeFixed" | "payoutDays">): Settlement[] {
  const byKey = new Map<string, Settlement>();
  for (const pi of intents) {
    if (pi.status !== "succeeded") continue;
    const day = dayOf(pi.createdAt);
    const key = `${pi.provider}|${day}|${pi.payoutId ?? ""}`;
    let g = byKey.get(key);
    if (!g) {
      g = { provider: pi.provider, day, expected: addDays(day, s.payoutDays), count: 0, gross: 0, fees: 0, refunds: 0, net: 0, feesEstimated: false, payout: payouts.find((p) => p.id === pi.payoutId) ?? null, intentIds: [] };
      byKey.set(key, g);
    }
    const f = feeOf(pi, s);
    g.count++;
    g.gross += chargeOf(pi);
    g.fees += f.fee;
    g.refunds += pi.refunded;
    g.feesEstimated ||= f.estimated;
    g.intentIds.push(pi.id);
  }
  for (const g of byKey.values()) g.net = g.gross - g.fees - g.refunds;
  return [...byKey.values()].sort((a, b) => b.day.localeCompare(a.day) || a.provider.localeCompare(b.provider));
}

/* ───────── links ───────── */

export type LinkState = "waiting" | "paid" | "failed" | "expired" | "cancelled" | "processing";
export function linkState(pi: Pick<PaymentIntentRow, "status" | "expiresAt">, now: number): LinkState {
  switch (pi.status) {
    case "succeeded":
      return "paid";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
    case "processing":
      return "processing";
    default:
      return Date.parse(pi.expiresAt) <= now ? "expired" : "waiting";
  }
}
/** "mm:ss" or "h:mm:ss" left, null once expired */
export function timeLeft(expiresAt: string, now: number): string | null {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return null;
  const t = Math.floor(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}

/** Egyptian 01xxxxxxxxx → 201xxxxxxxxx, Saudi 05xxxxxxxx → 9665xxxxxxxx; anything else digits only. */
export function waPhone(raw: string): string {
  const d = raw.replace(/[٠-٩]/g, (x) => String("٠١٢٣٤٥٦٧٨٩".indexOf(x))).replace(/\D/g, "");
  if (/^01[0125]\d{8}$/.test(d)) return `2${d}`;
  if (/^05\d{8}$/.test(d)) return `966${d.slice(1)}`;
  return d.replace(/^00/, "");
}
export const whatsappUrl = (phone: string, text: string) => `https://wa.me/${phone ? waPhone(phone) : ""}?text=${encodeURIComponent(text)}`;

/* ───────── CSV ───────── */

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // formula injection guard for Excel / Sheets
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** UTF-8 BOM + CRLF so Excel opens Arabic correctly */
export function toCsv(header: string[], rows: unknown[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
/** units → "185.50" (exact) */
export function unitsDecimal(u: Units): string {
  const minor = Math.round(u / MINOR);
  const neg = minor < 0;
  const a = Math.abs(minor);
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}
