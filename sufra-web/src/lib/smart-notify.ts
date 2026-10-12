/**
 * Smart in-app notifications (no push, no server): booking reminders, offers at your favourite places, and
 * "it's busy now — usually quieter at 5pm" from each place's (estimated) busy-by-hour curve.
 * Items land in a small inbox (bell in the header); the newest also shows as a toast. Deduped per day/offer.
 */
import { useEffect, useSyncExternalStore } from "react";
import { byId, type Restaurant } from "./data";
import { fmtTime, openState } from "./hours";
import { notify } from "./notify";
import { load, save } from "./storage";
import { type Account, todayYmd, useAccount } from "./store";

export interface InboxItem {
  id: string;
  kind: "booking" | "offer" | "busy";
  ar: string;
  en: string;
  detailAr: string;
  detailEn: string;
  href?: string;
  at: number;
  read: boolean;
}
const KEY = "sufra.inbox.v1";
let inbox: { items: InboxItem[]; seen: string[] } = load(KEY, { items: [], seen: [] as string[] });
if (!Array.isArray(inbox.items) || !Array.isArray(inbox.seen)) inbox = { items: [], seen: [] };
const ls = new Set<() => void>();
const emit = () => {
  save(KEY, inbox);
  ls.forEach((l) => l());
};
export function useInbox() {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => inbox,
    () => inbox,
  );
}
export function markAllRead() {
  inbox = { ...inbox, items: inbox.items.map((i) => ({ ...i, read: true })) };
  emit();
}
export function clearInbox() {
  inbox = { ...inbox, items: [] };
  emit();
}

/** Add once per dedupe key; returns the item when it is new. */
function push(key: string, item: Omit<InboxItem, "id" | "at" | "read">): InboxItem | null {
  if (inbox.seen.includes(key)) return null;
  const it: InboxItem = { ...item, id: key, at: Date.now(), read: false };
  inbox = { items: [it, ...inbox.items].slice(0, 30), seen: [key, ...inbox.seen].slice(0, 200) };
  emit();
  return it;
}

/* ── busy curve ── */
export interface BusyHint {
  now: number;
  level: "quiet" | "normal" | "busy";
  /** the quietest upcoming hour today while open (minutes since midnight), when it's busy now */
  quietAt: number | null;
}
export function busyHint(r: Restaurant, now = new Date()): BusyHint | null {
  if (!Array.isArray(r.busy) || r.busy.length < 24) return null;
  const st = openState(r.hours, now);
  if (!st.open) return null;
  const h = now.getHours();
  const cur = r.busy[h] ?? 0;
  const level = cur >= 70 ? "busy" : cur <= 30 ? "quiet" : "normal";
  let quietAt: number | null = null;
  if (level === "busy") {
    const closeH = st.in != null ? Math.floor((now.getHours() * 60 + now.getMinutes() + st.in) / 60) : h + 6;
    let best = cur;
    for (let k = h + 1; k < Math.min(closeH, h + 10); k++) {
      const v = r.busy[k % 24] ?? 100;
      if (v < best - 20 && v <= 50) {
        best = v;
        quietAt = (k % 24) * 60;
        break; // the first clearly quieter hour is the useful one
      }
    }
  }
  return { now: cur, level, quietAt };
}

/** Run the checks for the signed-in account. Toasts only the most important new item. */
export function runSmartChecks(acc: Account | null, lang: "ar" | "en", now = new Date()) {
  if (!acc) return;
  const fresh: InboxItem[] = [];
  const day = todayYmd();
  // 1) booking reminders: confirmed bookings in the next 48 h (once per booking per day)
  for (const b of acc.bookings) {
    if (b.status !== "confirmed") continue;
    const r = byId[b.rid];
    if (!r) continue;
    const [y, m, d] = b.date.split("-").map(Number);
    const when = new Date(y, m - 1, d, Math.floor(b.time / 60), b.time % 60);
    const hrs = (when.getTime() - now.getTime()) / 3600000;
    if (hrs < 0 || hrs > 48) continue;
    const dayWord = when.toDateString() === now.toDateString() ? ["النهارده", "today"] : ["بكرة", "tomorrow"];
    const it = push(`bk:${b.id}:${day}`, {
      kind: "booking",
      ar: `فاكرك: حجزك في ${r.ar} ${dayWord[0]} الساعة ${fmtTime(b.time, "ar")}`,
      en: `Reminder: your table at ${r.en} ${dayWord[1]} at ${fmtTime(b.time, "en")}`,
      detailAr: `${b.party} أفراد · كود ${b.code}`,
      detailEn: `Party of ${b.party} · code ${b.code}`,
      href: `#/account?tab=history`,
    });
    if (it) fresh.push(it);
  }
  // 2) offers at favourite places (once per offer)
  for (const id of acc.favourites) {
    const r = byId[id];
    const o = r?.offers?.[0];
    if (!r || !o) continue;
    const it = push(`of:${r.id}:${o.id}`, {
      kind: "offer",
      ar: `مكانك المفضل ${r.ar} عليه عرض`,
      en: `${r.en}, one of your favourites, has an offer`,
      detailAr: o.ar,
      detailEn: o.en,
      href: `#/r/${r.slug}`,
    });
    if (it) fresh.push(it);
  }
  const top = fresh.find((x) => x.kind === "booking") ?? fresh[0];
  if (top) notify({ title: lang === "ar" ? top.ar : top.en, detail: lang === "ar" ? top.detailAr : top.detailEn, tone: top.kind === "offer" ? "brass" : undefined, icon: "bell", ttl: 7000 });
}

/** "زحمة دلوقتي — عادةً أهدى الساعة 5" for a place you're looking at (once per place per day). */
export function noteBusy(r: Restaurant, lang: "ar" | "en", now = new Date()) {
  const h = busyHint(r, now);
  if (!h || h.level !== "busy" || h.quietAt == null) return;
  const it = push(`busy:${r.id}:${todayYmd()}`, {
    kind: "busy",
    ar: `${r.ar} زحمة دلوقتي`,
    en: `${r.en} is busy right now`,
    detailAr: `عادةً بيبقى أهدى الساعة ${fmtTime(h.quietAt, "ar")} (تقدير)`,
    detailEn: `Usually quieter at ${fmtTime(h.quietAt, "en")} (estimate)`,
    href: `#/r/${r.slug}`,
  });
  if (it) notify({ title: lang === "ar" ? it.ar : it.en, detail: lang === "ar" ? it.detailAr : it.detailEn, tone: "brass", icon: "bell", ttl: 6000 });
}

/** Mount once (App): checks now and every 10 minutes while the tab is open. */
export function useSmartNotifications(lang: "ar" | "en", enabled = true) {
  const acc = useAccount();
  useEffect(() => {
    if (!enabled) return;
    const t0 = window.setTimeout(() => runSmartChecks(acc, lang), 2500); // let the page settle first
    const id = window.setInterval(() => runSmartChecks(acc, lang), 10 * 60 * 1000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(id);
    };
  }, [acc, lang, enabled]);
}
