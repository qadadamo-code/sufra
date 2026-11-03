/**
 * CRM operations: lead capture (with consent), duplicate detection + merge, CSV import/export.
 * Phones are stored normalised (01xxxxxxxxx) — the guest pages and the POS look customers up by phone.
 */
import type { Db } from "@/data/hooks";
import type { Consent, Customer, LeadSource } from "@/data/types";
import { latinDigits, norm } from "@/lib/arabic";
import { formatMoney } from "@/lib/money";
import { nowIso } from "@/lib/time";
import { normalizePhone } from "@/modules/guest/api/service";
import { referralCode } from "@/lib/promo/referral";

export const NO_CONSENT: Consent = { whatsapp: false, sms: false, email: false, push: false, at: null, via: null };

/** Phone key for duplicate detection: normalised Egyptian mobile, else the last 10 digits. */
export function phoneKey(p: string): string {
  return normalizePhone(p) ?? latinDigits(p).replace(/\D/g, "").slice(-10);
}

export interface LeadInput {
  name: string;
  phone: string;
  email?: string | null;
  birthday?: string | null;
  source: LeadSource;
  consent?: Partial<Consent>;
  tags?: string[];
  notes?: string;
}

/** Creates or enriches a customer from any capture point (QR join, checkout, Wi-Fi, reservation, manual). */
export async function captureLead(db: Db, x: LeadInput): Promise<{ customer: Customer; created: boolean }> {
  const phone = normalizePhone(x.phone);
  if (!phone) throw new Error("bad_phone");
  const all = await db.list("customers");
  const hit = all.find((c) => !c.mergedInto && phoneKey(c.phone) === phone);
  const consent = x.consent ? { ...NO_CONSENT, ...(hit?.consent ?? {}), ...x.consent, at: nowIso(), via: x.source } : undefined;
  if (hit) {
    const customer = await db.update("customers", hit.id, {
      name: hit.name || x.name.trim(), email: hit.email ?? x.email ?? null, birthday: hit.birthday ?? x.birthday ?? null, tags: [...new Set([...hit.tags, ...(x.tags ?? [])])],
      ...(consent ? { consent } : {}), source: hit.source ?? x.source,
    });
    return { customer, created: false };
  }
  const customer = await db.insert("customers", {
    phone, name: x.name.trim() || phone, email: x.email ?? null, visits: 0, lastVisitAt: null, totalSpent: 0, loyaltyPoints: 0, tags: x.tags ?? [], notes: x.notes ?? "", birthday: x.birthday ?? null,
    addresses: [], source: x.source, consent: consent ?? { ...NO_CONSENT }, stamps: {}, lifetimePoints: 0, tierId: null, referralCode: null,
  });
  await db.update("customers", customer.id, { referralCode: referralCode(customer.id) });
  await db.audit("customer.lead", "customers", customer.id, { source: x.source });
  return { customer: { ...customer, referralCode: referralCode(customer.id) }, created: true };
}

/** Groups of probable duplicates: same phone key, or same normalised name with the same last 7 digits. */
export function findDuplicates(customers: Customer[]): Customer[][] {
  const live = customers.filter((c) => !c.mergedInto);
  const groups = new Map<string, Customer[]>();
  for (const c of live) {
    const k = phoneKey(c.phone);
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const out = [...groups.values()].filter((g) => g.length > 1);
  const seen = new Set(out.flat().map((c) => c.id));
  const byName = new Map<string, Customer[]>();
  for (const c of live) {
    if (seen.has(c.id) || !c.name.trim()) continue;
    const k = `${norm(c.name).replace(/\s+/g, "")}|${phoneKey(c.phone).slice(-7)}`;
    byName.set(k, [...(byName.get(k) ?? []), c]);
  }
  return [...out, ...[...byName.values()].filter((g) => g.length > 1)];
}

/** Merges `dupes` into `keep`: history moves over, totals add up, tags/addresses union, duplicates are marked. */
export async function mergeCustomers(db: Db, keep: Customer, dupes: Customer[]) {
  const ids = dupes.map((d) => d.id);
  const moves: [Parameters<Db["list"]>[0], string][] = [
    ["orders", "customerId"], ["checks", "customerId"], ["reservations", "customerId"], ["loyaltyLedger", "customerId"], ["promoRedemptions", "customerId"],
    ["couponCodes", "customerId"], ["campaignMessages", "customerId"], ["guestFeedback", "customerId"], ["giftCards", "customerId"],
  ];
  for (const [col, field] of moves) {
    const rows = (await db.list(col, { where: { [field]: ids } as never })) as { id: string }[];
    for (const r of rows) await db.update(col, r.id, { [field]: keep.id } as never);
  }
  const all = [keep, ...dupes];
  const last = all.map((c) => c.lastVisitAt).filter(Boolean).sort().pop() ?? null;
  const addresses = [...keep.addresses];
  for (const d of dupes) for (const a of d.addresses) if (!addresses.some((x) => x.address === a.address)) addresses.push(a);
  const stamps = { ...(keep.stamps ?? {}) };
  for (const d of dupes) for (const [k, v] of Object.entries(d.stamps ?? {})) stamps[k] = (stamps[k] ?? 0) + v;
  await db.update("customers", keep.id, {
    visits: all.reduce((a, c) => a + c.visits, 0), totalSpent: all.reduce((a, c) => a + c.totalSpent, 0), loyaltyPoints: all.reduce((a, c) => a + c.loyaltyPoints, 0),
    lifetimePoints: all.reduce((a, c) => a + (c.lifetimePoints ?? 0), 0), lastVisitAt: last, tags: [...new Set(all.flatMap((c) => c.tags))], addresses: addresses.slice(0, 8),
    email: keep.email ?? dupes.find((d) => d.email)?.email ?? null, birthday: keep.birthday ?? dupes.find((d) => d.birthday)?.birthday ?? null,
    notes: [keep.notes, ...dupes.map((d) => d.notes)].filter(Boolean).join(" · "), stamps,
  });
  for (const d of dupes) await db.update("customers", d.id, { mergedInto: keep.id, tags: [...d.tags, "merged"] });
  await db.audit("customer.merge", "customers", keep.id, { merged: ids });
}

/* ───────── CSV ───────── */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_COLUMNS = ["name", "phone", "email", "birthday", "tags", "notes", "visits", "total_spent_egp", "points", "tier", "last_visit", "source", "whatsapp_ok", "sms_ok"];

export function toCsv(customers: Customer[]): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const c of customers.filter((x) => !x.mergedInto))
    lines.push(
      [c.name, c.phone, c.email, c.birthday, c.tags.join("|"), c.notes, c.visits, formatMoney(c.totalSpent, { lang: "en", bare: true }).replace(/,/g, ""), c.loyaltyPoints, c.tierId, c.lastVisitAt?.slice(0, 10), c.source, c.consent?.whatsapp ? 1 : 0, c.consent?.sms ? 1 : 0]
        .map(esc)
        .join(","),
    );
  // BOM so Excel opens Arabic correctly
  return "﻿" + lines.join("\r\n");
}

const HEADER_ALIASES: Record<string, string[]> = {
  name: ["name", "الاسم", "اسم", "full name"],
  phone: ["phone", "mobile", "الموبايل", "موبايل", "رقم", "تليفون", "phone number"],
  email: ["email", "e-mail", "الإيميل", "ايميل"],
  birthday: ["birthday", "dob", "عيد الميلاد", "تاريخ الميلاد"],
  tags: ["tags", "تاجز", "وسوم"],
  notes: ["notes", "ملاحظات"],
  whatsapp_ok: ["whatsapp_ok", "whatsapp", "واتساب"],
  sms_ok: ["sms_ok", "sms"],
};

export interface ImportPreview {
  rows: { name: string; phone: string | null; raw: string; email: string | null; birthday: string | null; tags: string[]; notes: string; whatsapp: boolean; sms: boolean; status: "new" | "update" | "invalid" }[];
  columns: Record<string, number>;
}

export function previewImport(text: string, existing: Customer[]): ImportPreview {
  const rows = parseCsv(text);
  if (!rows.length) return { rows: [], columns: {} };
  const head = rows[0].map((h) => norm(h.trim()));
  const columns: Record<string, number> = {};
  for (const [k, al] of Object.entries(HEADER_ALIASES)) {
    const i = head.findIndex((h) => al.some((a) => norm(a) === h));
    if (i >= 0) columns[k] = i;
  }
  const hasHeader = columns.phone != null;
  if (!hasHeader) Object.assign(columns, { name: 0, phone: 1 });
  const keys = new Set(existing.filter((c) => !c.mergedInto).map((c) => phoneKey(c.phone)));
  const yes = (v?: string) => !!v && /^(1|y|yes|true|نعم|اه|آه)$/i.test(v.trim());
  return {
    columns,
    rows: rows.slice(hasHeader ? 1 : 0).map((r) => {
      const get = (k: string) => (columns[k] != null ? (r[columns[k]] ?? "").trim() : "");
      const phone = normalizePhone(get("phone"));
      const bd = get("birthday");
      return {
        name: get("name"), phone, raw: get("phone"), email: get("email") || null, birthday: /^\d{4}-\d{2}-\d{2}$/.test(bd) ? bd : null, tags: get("tags").split(/[|،,]/).map((t) => t.trim()).filter(Boolean),
        notes: get("notes"), whatsapp: columns.whatsapp_ok != null ? yes(get("whatsapp_ok")) : false, sms: yes(get("sms_ok")), status: !phone ? "invalid" : keys.has(phone) ? "update" : "new",
      };
    }),
  };
}

export async function runImport(db: Db, p: ImportPreview) {
  let created = 0;
  let updated = 0;
  for (const r of p.rows) {
    if (!r.phone) continue;
    const res = await captureLead(db, { name: r.name, phone: r.phone, email: r.email, birthday: r.birthday, source: "import", tags: r.tags, notes: r.notes, consent: { whatsapp: r.whatsapp, sms: r.sms } });
    if (res.created) created++;
    else updated++;
  }
  return { created, updated };
}

/** Reservations whose guest is not a customer yet → leads (source "reservation"). */
export async function leadsFromReservations(db: Db) {
  const res = await db.list("reservations");
  let n = 0;
  for (const r of res) {
    if (r.customerId || !normalizePhone(r.phone)) continue;
    const { customer, created } = await captureLead(db, { name: r.name, phone: r.phone, source: "reservation" });
    await db.update("reservations", r.id, { customerId: customer.id });
    if (created) n++;
  }
  return n;
}
