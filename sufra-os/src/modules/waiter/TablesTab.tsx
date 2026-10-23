import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, ChefHat, QrCode, Users, Armchair } from "lucide-react";
import type { TableStatus } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { EmptyState, Segmented } from "@/ui";
import { callLevel, type Sla } from "@/lib/service-calls";
import { wdict, type WKey } from "./dict";
import type { TableView, WaiterData } from "./useWaiter";

export const STATUS_TONE: Record<TableStatus, string> = {
  free: "border-line bg-surface text-muted",
  seated: "border-info/50 bg-info-soft text-info",
  ordered: "border-primary/50 bg-primary-soft text-primary",
  bill: "border-brass/60 bg-brass-soft text-brass-text",
  dirty: "border-warn/50 bg-warn-soft text-warn",
  reserved: "border-dashed border-line-strong bg-surface-2 text-ink-2",
  blocked: "border-line bg-surface-3 text-faint",
};

function callTone(v: TableView, now: number, sla: Sla) {
  const open = v.calls.filter((c) => c.status === "open" && c.type !== "pickup");
  const levels = open.map((c) => callLevel(c, now, sla));
  return { n: open.length, hot: levels.some((l) => l === "escalated" || l === "critical"), warn: levels.includes("warn") };
}

export function TableCard({ v, now, sla }: { v: TableView; now: number; sla: Sla }) {
  const w = useDict(wdict);
  const { lang } = useT();
  const nav = useNavigate();
  const call = callTone(v, now, sla);
  const pickup = v.calls.some((c) => c.type === "pickup" && c.status === "open");
  return (
    <button
      type="button"
      onClick={() => nav(`/waiter/t/${v.table.id}`)}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-[18px] border-2 bg-surface p-3 text-start shadow-sf-sm transition-[transform,box-shadow] active:scale-[0.99]",
        call.hot ? "border-danger" : call.n ? "border-brass" : "border-line",
      )}
    >
      <span className={cn("grid size-14 shrink-0 place-items-center rounded-2xl border font-mono text-[22px] font-bold", STATUS_TONE[v.table.status])}>{v.table.label}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15.5px] font-bold">{w(`w.status.${v.table.status}` as WKey)}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
          {v.guests ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden /> {v.guests}
            </span>
          ) : null}
          {v.table.statusSince && v.table.status !== "free" ? <span>{ago(v.table.statusSince, lang)}</span> : null}
          {v.items.length ? (
            <span>
              {w("w.order")} <bdi dir="ltr">#{v.orders.map((o) => o.number).join(", #")}</bdi>
            </span>
          ) : null}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {call.n ? (
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold", call.hot ? "bg-danger text-white" : call.warn ? "bg-warn-soft text-warn" : "bg-brass-soft text-brass-text")}>
            <BellRing className="size-3.5" aria-hidden /> {call.n}
          </span>
        ) : null}
        {v.ready || pickup ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-ok px-2 py-0.5 text-[12px] font-bold text-white">
            <ChefHat className="size-3.5" aria-hidden /> {w("w.readyN", { n: v.ready })}
          </span>
        ) : null}
        {v.qrWaiting ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[12px] font-bold text-info">
            <QrCode className="size-3.5" aria-hidden /> QR
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function TablesTab({ data, now, sla }: { data: WaiterData; now: number; sla: Sla }) {
  const w = useDict(wdict);
  const { loc } = useT();
  const nav = useNavigate();
  const mine = data.views.filter((v) => v.mine);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const zone = data.zones.find((z) => z.id === zoneId) ?? data.zones[0];
  const inZone = data.views.filter((v) => v.table.zoneId === zone?.id);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <section aria-label={w("w.myTables")}>
        <h2 className="mb-2.5 flex items-center gap-2 text-[17px]">
          {w("w.myTables")} <span className="font-mono text-[14px] text-muted">({mine.length})</span>
        </h2>
        {mine.length ? (
          <ul className="grid gap-2.5">
            {mine.map((v) => (
              <li key={v.table.id}>
                <TableCard v={v} now={now} sla={sla} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={<Armchair />} title={w("w.noMine")} body={w("w.noMineBody")} className="rounded-2xl border border-dashed border-line" />
        )}
      </section>
      <section aria-label={w("w.allTables")}>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <h2 className="text-[17px]">{w("w.allTables")}</h2>
          {data.zones.length > 1 ? (
            <Segmented size="sm" className="ms-auto" label={w("w.allTables")} value={zone?.id ?? ""} onChange={setZoneId} options={data.zones.map((z) => ({ value: z.id, label: loc(z.name) }))} />
          ) : null}
        </div>
        {zone ? (
          <div className="relative w-full overflow-hidden rounded-[20px] border border-line bg-surface-2 paper-grain" style={{ aspectRatio: `${zone.width} / ${zone.height}` }}>
            {inZone.map((v) => {
              const tb = v.table;
              const c = callTone(v, now, sla);
              return (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => nav(`/waiter/t/${tb.id}`)}
                  aria-label={`${w("w.table", { n: tb.label })} · ${w(`w.status.${tb.status}` as WKey)}`}
                  className={cn(
                    "absolute grid place-items-center border-2 font-mono text-[13px] font-bold shadow-sf-sm transition-transform active:scale-95 sm:text-[15px]",
                    STATUS_TONE[tb.status],
                    tb.shape === "round" || tb.shape === "oval" ? "rounded-full" : "rounded-lg",
                    v.mine && "ring-2 ring-primary ring-offset-1 ring-offset-[var(--sf-surface-2)]",
                  )}
                  style={{
                    left: `${(tb.x / zone.width) * 100 - Math.max(9, (tb.w / zone.width) * 100) / 2}%`,
                    top: `${(tb.y / zone.height) * 100 - Math.max(11, (tb.h / zone.height) * 100) / 2}%`,
                    width: `${Math.max(9, (tb.w / zone.width) * 100)}%`,
                    height: `${Math.max(11, (tb.h / zone.height) * 100)}%`,
                    transform: tb.rotation ? `rotate(${tb.rotation}deg)` : undefined,
                  }}
                >
                  {tb.label}
                  {c.n ? <span className={cn("absolute -top-2 -end-2 grid size-5 place-items-center rounded-full text-[11px] text-white ring-2 ring-[var(--sf-surface-2)]", c.hot ? "bg-danger animate-pulse" : "bg-brass")}>{c.n}</span> : null}
                  {v.ready ? <span className="absolute -bottom-2 -end-2 grid size-5 place-items-center rounded-full bg-ok text-white ring-2 ring-[var(--sf-surface-2)]"><ChefHat className="size-3" aria-hidden /></span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        <ul className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted">
          {(["free", "seated", "ordered", "bill", "dirty", "reserved"] as TableStatus[]).map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5">
              <span className={cn("size-3 rounded border", STATUS_TONE[s])} aria-hidden />
              {w(`w.status.${s}` as WKey)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
