/** Mini floor map to pick a table (dine-in, move a check). Live table colours; tables with an open check show its total. */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Check, DiningTable, TableStatus, Zone } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { Dialog, Segmented, spring, useReduced } from "@/ui";

const TONE: Record<TableStatus, string> = {
  free: "border-line-strong bg-surface text-ink-2",
  seated: "border-info bg-info-soft text-info",
  ordered: "border-primary bg-primary-soft text-primary",
  bill: "border-brass bg-brass-soft text-brass-text",
  dirty: "border-warn bg-warn-soft text-warn",
  reserved: "border-dashed border-line-strong bg-surface-2 text-ink-2",
  blocked: "border-line bg-surface-3 text-faint",
};
export const TABLE_STATUS_LABEL: Record<TableStatus, { ar: string; en: string }> = {
  free: { ar: "فاضية", en: "Free" },
  seated: { ar: "قاعدين", en: "Seated" },
  ordered: { ar: "طلبوا", en: "Ordered" },
  bill: { ar: "طالبين الحساب", en: "Bill" },
  dirty: { ar: "محتاجة تنضيف", en: "Dirty" },
  reserved: { ar: "محجوزة", en: "Reserved" },
  blocked: { ar: "مقفولة", en: "Blocked" },
};

export function TablePicker({ open, onClose, tables, zones, checks, current, title, onPick, allowBusy = true }: {
  open: boolean;
  onClose: () => void;
  tables: DiningTable[];
  zones: Zone[];
  checks: Check[];
  current?: string | null;
  title: string;
  onPick: (t: DiningTable, check: Check | null) => void;
  allowBusy?: boolean;
}) {
  const { L, loc, lang } = useT();
  const reduced = useReduced();
  const [zone, setZone] = useState<string>("");
  useEffect(() => {
    if (open && !zone && zones[0]) setZone(zones[0].id);
  }, [open, zones, zone]);
  const z = zones.find((x) => x.id === zone) ?? zones[0];
  const list = useMemo(() => tables.filter((t) => t.zoneId === z?.id && t.active), [tables, z]);
  const checkOf = (t: DiningTable) => checks.find((c) => c.tableIds.includes(t.id) && (c.status === "open" || c.status === "bill_requested")) ?? null;
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={title}>
      {zones.length > 1 ? <Segmented label={L("المنطقة", "Zone")} value={z?.id ?? ""} onChange={setZone} options={zones.map((x) => ({ value: x.id, label: loc(x.name) }))} /> : null}
      {z ? (
        <div className="relative mt-4 w-full overflow-hidden rounded-2xl border border-line bg-surface-2 paper-grain" style={{ aspectRatio: `${z.width} / ${z.height}` }}>
          {list.map((t, i) => {
            const c = checkOf(t);
            const busy = !!c;
            const disabled = t.status === "blocked" || (!allowBusy && busy && t.id !== current);
            const round = t.shape === "round" || t.shape === "oval";
            return (
              <motion.button
                key={t.id}
                type="button"
                disabled={disabled}
                initial={reduced ? false : { opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...spring.snappy, delay: reduced ? 0 : i * 0.015 }}
                whileTap={reduced ? undefined : { scale: 0.94 }}
                onClick={() => onPick(t, c)}
                className={cn(
                  "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center border-2 text-center shadow-sf-sm transition-shadow hover:shadow-sf disabled:opacity-50",
                  round ? "rounded-full" : "rounded-xl",
                  TONE[t.status],
                  t.id === current && "ring-4 ring-primary/40",
                )}
                style={{
                  left: `${(t.x / z.width) * 100}%`,
                  top: `${(t.y / z.height) * 100}%`,
                  width: `max(${(Math.max(t.w, t.rotation % 180 ? t.h : t.w) / z.width) * 100}%, 56px)`,
                  height: `max(${(Math.max(t.h, t.rotation % 180 ? t.w : t.h) / z.height) * 100}%, 56px)`,
                }}
                aria-label={`${L("ترابيزة", "Table")} ${t.label} · ${TABLE_STATUS_LABEL[t.status][lang]}${c ? ` · ${formatMoney(c.total, { lang })}` : ""}`}
              >
                <span className="num text-[17px] font-bold leading-none">{t.label}</span>
                {c ? (
                  <span className="num mt-0.5 text-[10.5px] font-semibold leading-none opacity-90" dir="ltr">
                    {formatMoney(c.total, { lang, whole: true, bare: true })}
                  </span>
                ) : null}
              </motion.button>
            );
          })}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3 text-[12.5px] text-muted">
        {(["free", "seated", "ordered", "bill", "dirty", "reserved"] as TableStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded border-2", TONE[s])} /> {TABLE_STATUS_LABEL[s][lang]}
          </span>
        ))}
      </div>
    </Dialog>
  );
}
