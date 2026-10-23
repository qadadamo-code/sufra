export const nowIso = () => new Date().toISOString();
export const minutesSince = (iso: string, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));

/** "منذ ٥ د" / "5m ago" style short durations (Latin digits, isolated). */
export function ago(iso: string, lang: "ar" | "en", now = Date.now()): string {
  const m = minutesSince(iso, now);
  if (m < 1) return lang === "ar" ? "دلوقتي" : "now";
  if (m < 60) return lang === "ar" ? `من ${m} د` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === "ar" ? `من ${h} س` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return lang === "ar" ? `من ${d} يوم` : `${d}d ago`;
}

export function clock(iso: string, lang: "ar" | "en"): string {
  return new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(iso: string, lang: "ar" | "en"): string {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export const startOfDay = (d = new Date()) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
