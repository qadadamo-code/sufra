/** Shared bits for the accounting + reports screens: live books, period picker, estimate note, CSV + print. */
import { useMemo, useState, type ReactNode } from "react";
import { Download, Info, Printer } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, type Units } from "@/lib/money";
import { Button, Input, Select } from "@/ui";
import { DEFAULT_ACCOUNTING_SETTINGS } from "./api";
import { addDays, businessDay, mergeChart, monthEnd, monthStart, type ChartInfo } from "./core";
import "./print.css";

/** The journal + chart + settings, live. */
export function useBooks() {
  const { data: entries, loading } = useLive("ledgerEntries", { orderBy: [{ field: "date" }] });
  const { data: gl } = useLive("glAccounts");
  const { data: settingsRows } = useLive("accountingSettings");
  const chart = useMemo(() => mergeChart(gl), [gl]);
  const settings = settingsRows[0] ?? ({ ...DEFAULT_ACCOUNTING_SETTINGS, id: "", createdAt: "", updatedAt: "", restaurantId: "" } as (typeof settingsRows)[number]);
  return { entries, chart, settings, settingsRow: settingsRows[0] ?? null, loading };
}

export function useMoney() {
  const { lang } = useT();
  return useMemo(
    () => ({
      m: (u: Units) => formatMoney(u, { lang }),
      w: (u: Units) => formatMoney(u, { lang, whole: true }),
      pct: (bp: number) => `${(bp / 100).toFixed(1)}%`,
    }),
    [lang],
  );
}

export const accName = (chart: Map<string, ChartInfo>, code: string, lang: "ar" | "en") => chart.get(code)?.name[lang] ?? code;

/** "تقديري — يراجعه المحاسب" on every tax / forecast figure. */
export function EstimateNote({ className, children }: { className?: string; children?: ReactNode }) {
  const { L } = useT();
  return (
    <p className={cn("flex items-start gap-1.5 text-[12.5px] text-brass-text", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        <b className="font-semibold">{L("تقديري — يراجعه المحاسب", "Estimate — to be reviewed by the accountant")}</b>
        {children ? <> · {children}</> : null}
      </span>
    </p>
  );
}

export type PeriodPreset = "today" | "7d" | "30d" | "month" | "last_month" | "quarter" | "ytd" | "custom";
export interface Period {
  from: string;
  to: string;
  preset: PeriodPreset;
}

export function periodFor(p: PeriodPreset, today = businessDay()): { from: string; to: string } {
  switch (p) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "month":
      return { from: monthStart(today), to: today };
    case "last_month": {
      const end = addDays(monthStart(today), -1);
      return { from: monthStart(end), to: end };
    }
    case "quarter": {
      const s = monthStart(addDays(monthStart(addDays(monthStart(today), -1)), -1));
      return { from: s, to: today };
    }
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:
      return { from: monthStart(today), to: monthEnd(today) };
  }
}

export function usePeriod(initial: PeriodPreset = "month") {
  const [p, setP] = useState<Period>(() => ({ ...periodFor(initial), preset: initial }));
  return [p, setP] as const;
}

/** Previous period of the same length (for "compare"). */
export function previousPeriod(p: { from: string; to: string }) {
  // whole calendar month → the previous calendar month
  if (p.from.endsWith("-01") && p.to === monthEnd(p.from)) {
    const end = addDays(p.from, -1);
    return { from: monthStart(end), to: end };
  }
  const len = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

export function PeriodPicker({ value, onChange, presets = ["today", "7d", "30d", "month", "last_month", "quarter", "ytd", "custom"], className }: { value: Period; onChange: (p: Period) => void; presets?: PeriodPreset[]; className?: string }) {
  const { L } = useT();
  const label: Record<PeriodPreset, string> = {
    today: L("النهارده", "Today"), "7d": L("آخر ٧ أيام", "Last 7 days"), "30d": L("آخر ٣٠ يوم", "Last 30 days"), month: L("الشهر ده", "This month"), last_month: L("الشهر اللي فات", "Last month"),
    quarter: L("آخر ٣ شهور", "Last 3 months"), ytd: L("من أول السنة", "Year to date"), custom: L("فترة مخصصة", "Custom"),
  };
  return (
    <div className={cn("flex flex-wrap items-end gap-2", className)} data-noprint>
      <Select aria-label={L("الفترة", "Period")} value={value.preset} onChange={(e) => {
        const preset = e.target.value as PeriodPreset;
        onChange(preset === "custom" ? { ...value, preset } : { ...periodFor(preset), preset });
      }} options={presets.map((p) => ({ value: p, label: label[p] }))} className="min-w-40" />
      {value.preset === "custom" ? (
        <>
          <Input type="date" aria-label={L("من", "From")} value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className="w-40" />
          <Input type="date" aria-label={L("إلى", "To")} value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className="w-40" />
        </>
      ) : null}
    </div>
  );
}

/* ───────── CSV + print ───────── */

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: unknown[][]) => "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
/** Units → "1234.50" */
export const dec = (u: Units) => (u / 100_000).toFixed(2);

export function downloadCsv(name: string, header: string[], rows: unknown[][]) {
  const blob = new Blob([toCsv(header, rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name.endsWith(".csv") ? name : `${name}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ExportButtons({ onCsv, className }: { onCsv?: () => void; className?: string }) {
  const { L } = useT();
  return (
    <div className={cn("flex gap-2", className)} data-noprint>
      {onCsv ? (
        <Button size="sm" variant="outline" icon={<Download />} onClick={onCsv}>
          CSV
        </Button>
      ) : null}
      <Button size="sm" variant="outline" icon={<Printer />} onClick={() => window.print()}>
        {L("طباعة / PDF", "Print / PDF")}
      </Button>
    </div>
  );
}

/** Two-column statement row. */
export function Row({ label, value, strong, indent, tone, sub }: { label: ReactNode; value: ReactNode; strong?: boolean; indent?: boolean; tone?: "ok" | "danger" | "muted"; sub?: ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 border-b border-line/70 px-5 py-2.5 text-[14px] last:border-b-0", strong && "bg-surface-2/70 font-semibold", indent && "ps-9 text-ink-2")}>
      <span className="min-w-0">
        {label}
        {sub ? <span className="ms-2 text-[12px] text-muted">{sub}</span> : null}
      </span>
      <span className={cn("shrink-0 font-mono tabular-nums", tone === "ok" && "text-ok", tone === "danger" && "text-danger", tone === "muted" && "text-muted")} dir="ltr">
        {value}
      </span>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
      <h3 className="text-[15px] font-semibold">{children}</h3>
      {action}
    </div>
  );
}

/** Downscales a photo (phone camera) to a small JPEG data URL for the receipt attachment. */
export function fileToSmallJpeg(file: File, max = 900, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not an image"));
    };
    img.src = url;
  });
}

/** Money input in EGP (string) ↔ units. */
export const parseEgp = (s: string): Units | null => {
  const t = s.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100) * 1000;
};

/** Amount without currency label (statement columns). */
export function Num({ value, whole }: { value: Units; whole?: boolean }) {
  const { lang } = useT();
  return <>{formatMoney(value, { lang, bare: true, whole })}</>;
}
