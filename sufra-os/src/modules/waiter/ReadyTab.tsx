import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, ChefHat } from "lucide-react";
import { useDb } from "@/data/hooks";
import { useDict, useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, EmptyState, useReduced, useToast } from "@/ui";
import { doneCall, fmtWait } from "@/lib/service-calls";
import { applyAction } from "@/modules/kitchen/ops";
import { wdict } from "./dict";
import type { WaiterData } from "./useWaiter";

export function useReadyGroups(data: WaiterData) {
  return data.views
    .flatMap((v) =>
      v.orders.map((o) => ({
        v,
        order: o,
        items: v.items.filter((i) => i.orderId === o.id && i.status === "ready"),
        pings: v.calls.filter((c) => c.type === "pickup" && c.status !== "done" && c.status !== "cancelled" && (!c.orderId || c.orderId === o.id)),
      })),
    )
    .filter((g) => g.items.length)
    .sort((a, b) => Number(b.v.mine) - Number(a.v.mine) || (a.items[0].readyAt ?? "").localeCompare(b.items[0].readyAt ?? ""))
    // an order on joined tables shows up under each table: keep one card
    .filter((g, i, all) => all.findIndex((x) => x.order.id === g.order.id) === i);
}

export function ReadyTab({ data, now }: { data: WaiterData; now: number }) {
  const w = useDict(wdict);
  const { loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const reduced = useReduced();
  const groups = useReadyGroups(data);
  if (!groups.length) return <EmptyState compact icon={<ChefHat />} title={w("w.readyEmpty")} className="rounded-2xl border border-dashed border-line" />;
  return (
    <ul className="grid gap-2.5 lg:grid-cols-2">
      <AnimatePresence initial={false}>
        {groups.map((g) => {
          const oldest = g.items.reduce((m, i) => (i.readyAt && i.readyAt < m ? i.readyAt : m), g.items[0].readyAt ?? new Date(now).toISOString());
          return (
            <motion.li key={g.order.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
              <div className={cn("rounded-[18px] border-2 bg-surface shadow-sf-sm", g.pings.length ? "border-ok" : "border-ok/40", !g.v.mine && "opacity-90")}>
                <div className="flex items-center gap-3 p-3">
                  <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-ok font-mono text-[22px] font-bold text-white">{g.v.table.label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[15.5px] font-bold">
                      {w("w.table", { n: g.v.table.label })} · <bdi className="font-mono" dir="ltr">#{g.order.number}</bdi>
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                      <span className="font-mono" dir="ltr">
                        {fmtWait(Math.max(0, Math.floor((now - Date.parse(oldest)) / 1000)))}
                      </span>
                      {g.pings.length ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 font-bold text-ok">
                          <BellRing className="size-3.5" aria-hidden /> {w("w.kitchenPing")}
                        </span>
                      ) : null}
                      {!g.v.mine ? <span>{g.v.owner ? data.staffName.get(g.v.owner)?.split(" ")[0] : w("w.unassigned")}</span> : null}
                    </p>
                  </div>
                </div>
                <ul className="border-t border-line px-3 py-2 text-[15px]">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex gap-2 py-0.5">
                      <span className="font-mono font-bold">{i.qty}×</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{loc(i.name)}</span>
                      {i.seat ? <span className="text-[12px] text-muted">S{i.seat}</span> : null}
                    </li>
                  ))}
                </ul>
                <div className="border-t border-line p-2">
                  <Button
                    block
                    size="lg"
                    icon={<Check className="size-5" />}
                    onClick={async () => {
                      await applyAction(db, g.items, "serve");
                      await Promise.all(g.pings.map((c) => doneCall(db, c)));
                      toast({ title: w("w.servedToast", { t: w("w.table", { n: g.v.table.label }) }), tone: "success", duration: 2500 });
                    }}
                  >
                    {w("w.pickedUp")}
                  </Button>
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
