/**
 * Bank reconciliation (pure): parse a bank statement CSV (CIB / NBE / QNB / Banque Misr exports, Arabic or English
 * headers) and auto-match statement lines to journal entries that moved the same bank GL account.
 *
 * Match rule: exact amount (same sign), within ±`days` (default 3) of the entry date, each entry used once;
 * ties go to the closest date, then to a reference / description that shares a token with the entry memo.
 */
import type { BankStatementLine } from "@/data/accountingTypes";
import type { LedgerEntry } from "@/data/types";
import type { Units } from "@/lib/money";

export interface ParsedLine {
  date: string;
  description: string;
  reference: string;
  amount: Units;
  balance: Units | null;
}

/** RFC 4180-ish: quotes, escaped quotes, commas / semicolons / tabs. */
export function splitCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : firstLine.includes("\t") && !firstLine.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const AR_DIGITS = /[٠-٩]/g;
const toLatin = (s: string) => s.replace(AR_DIGITS, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** "1,234.50" · "(75.00)" · "-75" · "75.00-" · "١٢٣٫٥" → units; empty → null */
export function parseAmount(raw: string): Units | null {
  let s = toLatin(raw).replace(/[٬\s]/g, "").replace("٫", ".").replace(/(EGP|E£|ج\.م|جم)/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  }
  s = s.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,5}))?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]) * 100_000 + Number((m[2] ?? "").padEnd(5, "0"));
  return neg ? -v : v;
}

/** 2026-10-21 · 21/10/2026 · 21-10-2026 · 21.10.2026 · 21/10/26 → YYYY-MM-DD */
export function parseDate(raw: string): string | null {
  const s = toLatin(raw).trim().slice(0, 10);
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

const HEAD: Record<keyof ParsedLine | "debit" | "credit", RegExp> = {
  date: /^(date|value ?date|transaction ?date|posting ?date|التاريخ|تاريخ.*)$/i,
  description: /^(description|narrative|details|particulars|البيان|الوصف|التفاصيل)$/i,
  reference: /^(ref(erence)?|cheque|check ?no|المرجع|رقم المرجع|رقم الشيك)$/i,
  debit: /^(debit|withdrawals?|money out|مدين|سحب|خصم)$/i,
  credit: /^(credit|deposits?|money in|دائن|إيداع|ايداع|إضافة)$/i,
  amount: /^(amount|المبلغ|القيمة)$/i,
  balance: /^(balance|running balance|الرصيد)$/i,
};

export class BankCsvError extends Error {}

export function parseBankCsv(text: string): ParsedLine[] {
  const rows = splitCsv(text);
  const hi = rows.findIndex((r) => r.some((c) => HEAD.date.test(c.trim())));
  if (hi < 0) throw new BankCsvError("no header row with a date column");
  const head = rows[hi].map((c) => c.trim());
  const col = (k: keyof typeof HEAD) => head.findIndex((h) => HEAD[k].test(h));
  const ci = { date: col("date"), description: col("description"), reference: col("reference"), debit: col("debit"), credit: col("credit"), amount: col("amount"), balance: col("balance") };
  if (ci.amount < 0 && (ci.debit < 0 || ci.credit < 0)) throw new BankCsvError("need an amount column or debit + credit columns");
  const out: ParsedLine[] = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[ci.date] ?? "");
    if (!date) continue;
    let amount: Units | null;
    if (ci.amount >= 0) amount = parseAmount(r[ci.amount] ?? "");
    else {
      const dr = parseAmount(r[ci.debit] ?? "") ?? 0;
      const cr = parseAmount(r[ci.credit] ?? "") ?? 0;
      amount = cr - Math.abs(dr);
    }
    if (amount == null || amount === 0) continue;
    out.push({
      date,
      description: (r[ci.description] ?? "").trim(),
      reference: ci.reference >= 0 ? (r[ci.reference] ?? "").trim() : "",
      amount,
      balance: ci.balance >= 0 ? parseAmount(r[ci.balance] ?? "") : null,
    });
  }
  return out;
}

/** Dedupe key for re-imports of overlapping statements. */
export const lineKey = (l: Pick<ParsedLine, "date" | "amount" | "reference" | "description">) => `${l.date}|${l.amount}|${l.reference}|${l.description}`;

export interface MatchCandidate {
  id: string;
  date: string;
  /** signed movement on the bank account (+ in, − out) */
  amount: Units;
  memo: string;
  sourceId: string;
}

/** Bank-account movement of each entry that touched `glCode`. */
export function bankCandidates(entries: Pick<LedgerEntry, "id" | "date" | "lines" | "memo" | "sourceId">[], glCode: string): MatchCandidate[] {
  return entries
    .map((e) => ({ id: e.id, date: e.date, memo: e.memo, sourceId: e.sourceId, amount: e.lines.filter((l) => l.account === glCode).reduce((a, l) => a + l.debit - l.credit, 0) }))
    .filter((c) => c.amount !== 0);
}

const dayDiff = (a: string, b: string) => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));
const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9؀-ۿ]+/).filter((t) => t.length >= 3));

export interface AutoMatch {
  lineId: string;
  entryId: string;
  days: number;
}

export function autoMatch(lines: Pick<BankStatementLine, "id" | "date" | "amount" | "description" | "reference" | "status">[], candidates: MatchCandidate[], used: Set<string>, days = 3): AutoMatch[] {
  const pairs: { lineId: string; entryId: string; score: number; days: number }[] = [];
  for (const l of lines) {
    if (l.status !== "unmatched") continue;
    const lt = tokens(`${l.description} ${l.reference}`);
    for (const c of candidates) {
      if (used.has(c.id) || c.amount !== l.amount) continue;
      const d = dayDiff(l.date, c.date);
      if (d > days) continue;
      const shared = [...tokens(`${c.memo} ${c.sourceId}`)].some((t) => lt.has(t)) ? 1 : 0;
      pairs.push({ lineId: l.id, entryId: c.id, days: d, score: d * 10 - shared * 5 - (l.date >= c.date ? 1 : 0) });
    }
  }
  pairs.sort((a, b) => a.score - b.score || a.lineId.localeCompare(b.lineId));
  const doneL = new Set<string>();
  const doneE = new Set(used);
  const out: AutoMatch[] = [];
  for (const p of pairs) {
    if (doneL.has(p.lineId) || doneE.has(p.entryId)) continue;
    doneL.add(p.lineId);
    doneE.add(p.entryId);
    out.push({ lineId: p.lineId, entryId: p.entryId, days: p.days });
  }
  return out;
}

/** Book balance vs statement balance: what explains the gap. */
export function reconSummary(lines: Pick<BankStatementLine, "amount" | "status" | "balance" | "date">[], bookBalance: Units, unmatchedBookTotal: Units) {
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
  const statement = [...sorted].reverse().find((l) => l.balance != null)?.balance ?? null;
  const unmatchedBank = lines.filter((l) => l.status === "unmatched").reduce((a, l) => a + l.amount, 0);
  return { statement, book: bookBalance, unmatchedBank, unmatchedBook: unmatchedBookTotal, difference: statement == null ? null : statement - bookBalance };
}
