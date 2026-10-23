import { memo } from "react";
import { motion } from "motion/react";
import { Ban, Check, Crown, Flame, MoreVertical, Play, ShoppingBag, Timer, TriangleAlert, Truck, Users, UtensilsCrossed, QrCode, Hourglass } from "lucide-react";
import type { KitchenStation, OrderItem, OrderPriority } from "@/data/types";
import { useT, useDict } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, Kbd, Popover, useReduced } from "@/ui";
import { kdict } from "./dict";
import { ageLevel, ageMinutes, fmtTimer, isAllergy, type Age, type KdsSettings, type Ticket } from "./kds";

export const AGE_BORDER: Record<Age, string> = {
  ok: "border-ok/55",
  amber: "border-warn",
  red: "border-danger",
};
export const AGE_HEAD: Record<Age, string> = {
  ok: "bg-ok-soft text-ok",
  amber: "bg-warn-soft text-warn",
  red: "bg-danger text-white",
};

export interface TicketCardProps {
  ticket: Ticket;
  index: number;
  now: number;
  settings: KdsSettings;
  stationById: Map<string, KitchenStation>;
  tableLabel: Map<string, string>;
  staffName: Map<string, string>;
  /** show station headers (all-stations view) */
  showStations: boolean;
  highlight?: boolean;
  onItem: (item: OrderItem) => void;
  onStart: (t: Ticket) => void;
  onBump: (t: Ticket) => void;
  onPriority: (t: Ticket, p: OrderPriority) => void;
}

export const TicketCard = memo(function TicketCard({ ticket, index, now, settings, stationById, tableLabel, staffName, showStations, highlight, onItem, onStart, onBump, onPriority }: TicketCardProps) {
  const { loc, lang } = useT();
  const k = useDict(kdict);
  const reduced = useReduced();
  const o = ticket.order;
  const mins = ageMinutes(ticket.firedAt, now);
  const age = ageLevel(mins, settings);
  const tables = o.tableIds.map((t) => tableLabel.get(t) ?? "?").join("+");
  const KindIcon = ticket.kind === "takeaway" ? ShoppingBag : ticket.kind === "delivery" ? Truck : ticket.kind === "qr" ? QrCode : UtensilsCrossed;
  const kindLabel = ticket.kind === "takeaway" ? k("k.takeaway") : ticket.kind === "delivery" ? k("k.delivery") : ticket.kind === "qr" ? k("k.qr", { t: tables }) : k("k.dineIn", { t: tables || "—" });
  const prio = o.priority ?? "normal";
  const held = groupBy(ticket.held, (i) => i.course);

  return (
    <motion.article
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, scale: 0.96, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
      transition={{ type: "spring", stiffness: 420, damping: 36 }}
      data-ticket={o.id}
      aria-label={`#${o.number} ${kindLabel}`}
      className={cn(
        "flex flex-col overflow-hidden rounded-[18px] border-2 bg-surface shadow-sf-sm",
        AGE_BORDER[age],
        prio !== "normal" && "ring-2 ring-offset-2 ring-offset-[var(--sf-bg)]",
        prio === "rush" && "ring-danger/70",
        prio === "vip" && "ring-brass",
        highlight && "shadow-sf-lg",
      )}
    >
      {/* header: number · kind · timer */}
      <header className={cn("flex items-center gap-3 px-3.5 py-2.5", AGE_HEAD[age], age === "red" && !reduced && "kds-pulse")}>
        <span className="font-display text-[28px] font-bold leading-none tracking-tight" dir="ltr">
          #{o.number}
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14.5px] font-bold">
          <KindIcon className="size-4.5 shrink-0" aria-hidden />
          <span className="truncate">{kindLabel}</span>
        </span>
        <span className="flex items-center gap-1 font-mono text-[24px] font-semibold leading-none tabular-nums" dir="ltr" aria-label={k("k.min", { n: Math.floor(mins) })}>
          <Timer className="size-4.5 opacity-80" aria-hidden />
          {fmtTimer(now - Date.parse(ticket.firedAt))}
        </span>
      </header>

      {/* meta */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3.5 py-2 text-[13px] text-muted">
        {prio === "rush" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[12px] font-bold text-white">
            <Flame className="size-3.5" aria-hidden /> {k("k.rush")}
          </span>
        ) : null}
        {prio === "vip" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-brass px-2 py-0.5 text-[12px] font-bold text-brass-ink">
            <Crown className="size-3.5" aria-hidden /> {k("k.vip")}
          </span>
        ) : null}
        {o.mode === "dine_in" ? (
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden /> {k("k.guests", { n: o.guests })}
          </span>
        ) : null}
        {o.waiterId && staffName.get(o.waiterId) ? <span className="truncate">{k("k.waiter", { name: staffName.get(o.waiterId)!.split(" ")[0] })}</span> : null}
        {!showStations && ticket.stations.length > 1 ? <span className="ms-auto text-faint">{k("k.otherStations", { n: ticket.stations.length - 1 })}</span> : null}
      </div>

      {o.note ? <p className={cn("mx-3.5 mt-2.5 rounded-lg px-2.5 py-1.5 text-[14px] font-semibold", isAllergy(o.note) ? "bg-danger text-white" : "bg-brass-soft text-brass-text")}>{o.note}</p> : null}

      {/* items by station */}
      <div className="flex flex-1 flex-col gap-2 px-2 py-2">
        {ticket.groups.map((g) => {
          const st = g.stationId ? stationById.get(g.stationId) : null;
          return (
            <section key={g.stationId ?? "none"} aria-label={st ? loc(st.name) : undefined}>
              {showStations && st ? (
                <h4 className="mb-1 flex items-center gap-1.5 px-1.5 text-[12.5px] font-bold" style={{ color: st.color }}>
                  <span className="size-2 rounded-full" style={{ background: st.color }} aria-hidden />
                  {loc(st.name)}
                </h4>
              ) : null}
              <ul className="flex flex-col gap-1">
                {g.items.map((i) => (
                  <ItemRow key={i.id} item={i} lang={lang} onClick={() => onItem(i)} />
                ))}
              </ul>
            </section>
          );
        })}
        {ticket.voided.map((i) => (
          <div key={i.id} className="flex items-center gap-2 rounded-xl border border-dashed border-danger/50 bg-danger-soft px-2.5 py-1.5 text-danger">
            <Ban className="size-4 shrink-0" aria-hidden />
            <span className="font-mono text-[15px] font-bold">{i.qty}×</span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold line-through">{loc(i.name)}</span>
            <span className="rounded bg-danger px-1.5 text-[11.5px] font-bold text-white">{k("k.cancelled")}</span>
          </div>
        ))}
        {[...held.entries()].map(([course, its]) => (
          <div key={course} className="rounded-xl border border-dashed border-line-strong px-2.5 py-1.5 text-faint">
            <p className="flex items-center gap-1.5 text-[12px] font-bold">
              <Hourglass className="size-3.5" aria-hidden /> {k("k.held", { n: course })}
            </p>
            <p className="truncate text-[14px]">{its.map((i) => `${i.qty}× ${loc(i.name)}`).join(" · ")}</p>
          </div>
        ))}
      </div>

      {/* actions */}
      <footer className="flex items-center gap-2 border-t border-line bg-surface-2 p-2">
        {ticket.state === "new" ? (
          <Button variant="secondary" size="lg" className="px-4" icon={<Play className="size-5" />} onClick={() => onStart(ticket)}>
            {k("k.start")}
          </Button>
        ) : null}
        <Button size="lg" block className="flex-1" icon={<Check className="size-5" />} onClick={() => onBump(ticket)}>
          {k("k.bump")}
          {index < 9 ? <Kbd className="ms-1 border-white/30 bg-white/15 text-white">{index + 1}</Kbd> : null}
        </Button>
        <Popover
          align="end"
          side="top"
          width="w-56"
          trigger={({ props }) => (
            <button type="button" {...props} aria-label={k("k.options")} className="grid size-13 shrink-0 place-items-center rounded-2xl text-muted hover:bg-surface-3">
              <MoreVertical className="size-5" />
            </button>
          )}
        >
          {(close) => (
            <div className="grid gap-1 p-1">
              {prio !== "rush" ? <MenuBtn icon={<Flame />} label={k("k.markRush")} onClick={() => (onPriority(ticket, "rush"), close())} /> : null}
              {prio !== "vip" ? <MenuBtn icon={<Crown />} label={k("k.markVip")} onClick={() => (onPriority(ticket, "vip"), close())} /> : null}
              {prio !== "normal" ? <MenuBtn icon={<Ban />} label={k("k.clearFlag")} onClick={() => (onPriority(ticket, "normal"), close())} /> : null}
            </div>
          )}
        </Popover>
      </footer>
    </motion.article>
  );
});

function MenuBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-11 items-center gap-2.5 rounded-xl px-3 text-start text-[14.5px] font-semibold hover:bg-surface-2 [&_svg]:size-4.5 [&_svg]:text-muted">
      {icon}
      {label}
    </button>
  );
}

function ItemRow({ item: i, lang, onClick }: { item: OrderItem; lang: "ar" | "en"; onClick: () => void }) {
  const k = useDict(kdict);
  const name = i.name[lang] || i.name.ar;
  const allergy = isAllergy(i.notes);
  const ready = i.status === "ready";
  const preparing = i.status === "preparing";
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={ready}
        className={cn(
          "flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-start transition-colors hover:bg-surface-2 active:bg-surface-3",
          preparing && "bg-primary-soft/60",
          ready && "opacity-55",
        )}
      >
        <span className={cn("mt-0.5 grid h-8 min-w-8 shrink-0 place-items-center rounded-lg px-1 font-mono text-[17px] font-bold", i.qty > 1 ? "bg-ink text-bg" : "bg-surface-3 text-ink")} dir="ltr">
          {i.qty}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[17px] font-bold leading-snug", ready && "line-through decoration-2")}>{name}</span>
          {i.modifiers.length ? (
            <span className="mt-0.5 flex flex-wrap gap-1">
              {i.modifiers.map((m) => (
                <span key={m.modifierId} className="rounded-md bg-brass-soft px-1.5 text-[13.5px] font-semibold text-brass-text">
                  {m.name[lang] || m.name.ar}
                </span>
              ))}
            </span>
          ) : null}
          {i.notes ? (
            <span className={cn("mt-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[14px] font-semibold", allergy ? "bg-danger text-white" : "bg-warn-soft text-warn")}>
              {allergy ? <TriangleAlert className="size-4 shrink-0" aria-label={k("k.allergy")} /> : null}
              {i.notes}
            </span>
          ) : null}
          {i.seat || i.course > 1 ? (
            <span className="mt-0.5 flex gap-1.5 text-[12px] font-semibold text-muted">
              {i.seat ? <span>{k("k.seat", { n: i.seat })}</span> : null}
              {i.course > 1 ? <span>{k("k.course", { n: i.course })}</span> : null}
            </span>
          ) : null}
        </span>
        <span className="mt-1 shrink-0">
          {ready ? <Check className="size-5 text-ok" aria-label={k("k.bump")} /> : preparing ? <Flame className="size-5 text-primary" aria-label={k("k.preparing")} /> : <span className="block size-3 translate-y-1 rounded-full border-2 border-line-strong" aria-label={k("k.waiting")} />}
        </span>
      </button>
    </li>
  );
}

function groupBy<T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}
