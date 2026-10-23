import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, BellRing, Check, ChefHat, CircleCheck, Search, ShoppingBag, Truck, UtensilsCrossed, QrCode } from "lucide-react";
import type { KitchenStation, MenuItem, OrderItem } from "@/data/types";
import { useDb, useLive } from "@/data/hooks";
import { useT, useDict } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { Button, EmptyState, Input, useReduced, useToast } from "@/ui";
import { kdict } from "./dict";
import { ageLevel, ageMinutes, allDay, fmtTimer, type KdsSettings, type PrepStat, type Ticket } from "./kds";
import { AGE_BORDER, AGE_HEAD } from "./TicketCard";
import { setAvailability } from "./ops";
import { ThresholdsEditor, useCanEditSettings } from "@/lib/service-calls";
import { kdsSettings } from "./kds";

/* ───────── all-day ───────── */

export function AllDayView({ items, stationId, stationById, prep, now, settings }: { items: OrderItem[]; stationId: string | null; stationById: Map<string, KitchenStation>; prep: Map<string, PrepStat>; now: number; settings: KdsSettings }) {
  const { lang, loc } = useT();
  const k = useDict(kdict);
  const rows = useMemo(() => allDay(items, { stationId, lang }), [items, stationId, lang]);
  if (!rows.length) return <EmptyState icon={<ChefHat />} title={k("k.allDayEmpty")} />;
  return (
    <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]" aria-label={k("k.allDay")}>
      {rows.map((r) => {
        const st = r.stationId ? stationById.get(r.stationId) : null;
        const age = ageLevel(ageMinutes(r.oldestFiredAt, now), settings);
        const p = prep.get(r.itemId);
        return (
          <li key={r.itemId} className={cn("flex gap-3 rounded-[18px] border-2 bg-surface p-3 shadow-sf-sm", AGE_BORDER[age])}>
            <span className="grid h-16 min-w-16 place-items-center rounded-2xl bg-ink px-2 font-mono text-[34px] font-bold leading-none text-bg" dir="ltr">
              {r.total}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[18px] font-bold leading-tight">{loc(r.name)}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
                {st ? (
                  <span className="inline-flex items-center gap-1 font-semibold" style={{ color: st.color }}>
                    <span className="size-2 rounded-full" style={{ background: st.color }} aria-hidden />
                    {loc(st.name)}
                  </span>
                ) : null}
                <span>{k("k.tickets", { n: r.tickets })}</span>
                {p ? <span>{k("k.avgPrep", { n: p.avgMin })}</span> : null}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[12.5px] font-semibold">
                {r.waiting ? (
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-ink-2">
                    {k("k.waiting")} <span className="font-mono">{r.waiting}</span>
                  </span>
                ) : null}
                {r.preparing ? (
                  <span className="rounded-full bg-primary-soft px-2 py-0.5 text-primary">
                    {k("k.preparing")} <span className="font-mono">{r.preparing}</span>
                  </span>
                ) : null}
                {r.oldestFiredAt ? (
                  <span className={cn("rounded-full px-2 py-0.5 font-mono", AGE_HEAD[age])} dir="ltr">
                    {fmtTimer(now - Date.parse(r.oldestFiredAt))}
                  </span>
                ) : null}
              </div>
              {r.variants.some((v) => v.label.length) ? (
                <ul className="mt-1.5 grid gap-0.5 text-[13px]">
                  {r.variants.map((v) => (
                    <li key={v.label.join("|")} className="flex gap-1.5">
                      <span className="font-mono font-bold">{v.qty}×</span>
                      <span className="truncate text-brass-text">{v.label.join(" · ") || "—"}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ───────── expo / pass ───────── */

export function ExpoView({
  tickets,
  stationById,
  tableLabel,
  now,
  settings,
  onServe,
  onPing,
}: {
  tickets: Ticket[];
  stationById: Map<string, KitchenStation>;
  tableLabel: Map<string, string>;
  now: number;
  settings: KdsSettings;
  onServe: (t: Ticket) => void;
  onPing: (t: Ticket) => void;
}) {
  const k = useDict(kdict);
  const { loc } = useT();
  const reduced = useReduced();
  const ready = tickets.filter((t) => t.items.some((i) => i.status === "ready"));
  const complete = ready.filter((t) => t.state === "ready");
  const partial = tickets.filter((t) => t.state !== "ready");
  if (!tickets.length) return <EmptyState icon={<CircleCheck />} title={k("k.expoEmpty")} />;
  const kindIcon = (t: Ticket) => (t.kind === "takeaway" ? <ShoppingBag /> : t.kind === "delivery" ? <Truck /> : t.kind === "qr" ? <QrCode /> : <UtensilsCrossed />);
  const where = (t: Ticket) => (t.kind === "takeaway" ? k("k.takeaway") : t.kind === "delivery" ? k("k.delivery") : k("k.dineIn", { t: t.order.tableIds.map((x) => tableLabel.get(x) ?? "?").join("+") }));
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section aria-label={k("k.readyPickup")}>
        <h2 className="mb-2.5 flex items-center gap-2 text-[18px] text-ok">
          <CircleCheck className="size-5" aria-hidden /> {k("k.readyPickup")} <span className="font-mono text-[15px]">({complete.length})</span>
        </h2>
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          <AnimatePresence initial={false}>
            {complete.map((t) => (
              <motion.li key={t.key} layout={!reduced} initial={reduced ? false : { opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex flex-col rounded-[18px] border-2 border-ok bg-surface shadow-sf-sm">
                <div className="flex items-center gap-2 rounded-t-[16px] bg-ok px-3 py-2 text-white">
                  <span className="font-display text-[26px] font-bold leading-none" dir="ltr">
                    #{t.order.number}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[14px] font-bold [&_svg]:size-4">
                    {kindIcon(t)}
                    <span className="truncate">{where(t)}</span>
                  </span>
                  <span className="font-mono text-[15px]" dir="ltr">
                    {fmtTimer(now - Date.parse(t.items.reduce((m, i) => (i.readyAt && i.readyAt > m ? i.readyAt : m), t.firedAt)))}
                  </span>
                </div>
                <ul className="flex-1 px-3 py-2 text-[15px]">
                  {t.items.map((i) => (
                    <li key={i.id} className="flex gap-2 py-0.5">
                      <span className="font-mono font-bold">{i.qty}×</span>
                      <span className="truncate font-semibold">{loc(i.name)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2 border-t border-line p-2">
                  <Button size="lg" className="flex-1" icon={<Check className="size-5" />} onClick={() => onServe(t)}>
                    {k("k.served")}
                  </Button>
                  {t.order.tableIds.length ? (
                    <Button size="lg" variant="brass" icon={<BellRing className="size-5" />} onClick={() => onPing(t)} aria-label={k("k.ping")}>
                      <span className="max-lg:sr-only">{k("k.ping")}</span>
                    </Button>
                  ) : null}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        {!complete.length ? <p className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-muted">{k("k.expoEmpty")}</p> : null}
      </section>
      <section aria-label={k("k.inProgress")}>
        <h2 className="mb-2.5 flex items-center gap-2 text-[18px]">
          <ChefHat className="size-5 text-muted" aria-hidden /> {k("k.inProgress")} <span className="font-mono text-[15px] text-muted">({partial.length})</span>
        </h2>
        <ul className="grid gap-2">
          {partial.map((t) => {
            const age = ageLevel(ageMinutes(t.firedAt, now), settings);
            const per = new Map<string | null, { done: number; all: number }>();
            for (const i of t.items) {
              const p = per.get(i.stationId) ?? { done: 0, all: 0 };
              p.all += i.qty;
              if (i.status === "ready") p.done += i.qty;
              per.set(i.stationId, p);
            }
            const readyN = t.items.filter((i) => i.status === "ready").length;
            return (
              <li key={t.key} className={cn("flex items-center gap-3 rounded-2xl border-2 bg-surface px-3 py-2", AGE_BORDER[age])}>
                <span className="font-display text-[22px] font-bold" dir="ltr">
                  #{t.order.number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{where(t)}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {[...per.entries()].map(([sid, p]) => {
                      const st = sid ? stationById.get(sid) : null;
                      const done = p.done === p.all;
                      return (
                        <span key={sid ?? "x"} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold", done ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-ink-2")}>
                          <span className="size-2 rounded-full" style={{ background: st?.color ?? "var(--sf-faint)" }} aria-hidden />
                          {st ? loc(st.name) : "—"} <span className="font-mono">{p.done}/{p.all}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="text-end">
                  <p className={cn("font-mono text-[18px] font-semibold", age === "red" ? "text-danger" : age === "amber" ? "text-warn" : "text-ok")} dir="ltr">
                    {fmtTimer(now - Date.parse(t.firedAt))}
                  </p>
                  {readyN ? <p className="text-[12px] text-muted">{k("k.partReady", { a: readyN, b: t.items.length })}</p> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/* ───────── 86 ───────── */

export function EightySixView() {
  const k = useDict(kdict);
  const { loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const menu = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const cats = useLive("menuCategories", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const out = menu.filter((m) => !m.available);
  const canEdit = useCanEditSettings();
  const settingsRow = useLive("settings").data[0];
  const shown = q.trim() ? menu.filter((m) => matches(`${m.name.ar} ${m.name.en}`, q)) : menu;
  const toggle = async (m: MenuItem) => {
    await setAvailability(db, m.id, !m.available);
    toast({ title: m.available ? k("k.86done", { name: loc(m.name) }) : k("k.un86done", { name: loc(m.name) }), tone: m.available ? "warn" : "success" });
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={k("k.86search")} icon={<Search />} aria-label={k("k.86search")} wrapClassName="mb-3" />
        {cats.map((c) => {
          const its = shown.filter((m) => m.categoryId === c.id);
          if (!its.length) return null;
          return (
            <div key={c.id} className="mb-4">
              <h3 className="mb-1.5 text-[14px] font-bold text-muted">{loc(c.name)}</h3>
              <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
                {its.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m)}
                      aria-pressed={!m.available}
                      className={cn(
                        "flex min-h-13 w-full items-center gap-2 rounded-xl border px-3 py-2 text-start transition-colors",
                        m.available ? "border-line bg-surface hover:border-line-strong" : "border-danger/50 bg-danger-soft text-danger",
                      )}
                    >
                      <span className={cn("min-w-0 flex-1 truncate text-[15px] font-semibold", !m.available && "line-through")}>{loc(m.name)}</span>
                      <span className={cn("shrink-0 rounded-lg px-2 py-1 text-[12.5px] font-bold", m.available ? "bg-surface-3 text-ink-2" : "bg-danger text-white")}>{m.available ? k("k.86do") : k("k.un86")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>
      <aside className="grid gap-4 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-[20px] border border-line bg-surface p-4 shadow-sf-sm">
          <h3 className="mb-2 flex items-center gap-2 text-[16px]">
            <Ban className="size-5 text-danger" aria-hidden /> {k("k.86now")} <span className="font-mono text-[14px] text-muted">({out.length})</span>
          </h3>
          {!out.length ? <p className="py-4 text-center text-[14px] text-muted">{k("k.86none")}</p> : null}
          <ul className="grid gap-1.5">
            {out.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2">
                <span className="min-w-0 flex-1 truncate font-semibold text-danger">{loc(m.name)}</span>
                <Button size="sm" variant="secondary" onClick={() => toggle(m)}>
                  {k("k.un86")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
        {canEdit ? (
          <ThresholdsEditor
            settingsKey="kitchen"
            value={kdsSettings(settingsRow)}
            title={k("k.agingTitle")}
            fields={[
              { key: "amberMin", label: k("k.amberAfter"), unit: k("k.minUnit") },
              { key: "redMin", label: k("k.redAfter"), unit: k("k.minUnit") },
            ]}
          />
        ) : null}
      </aside>
    </div>
  );
}
