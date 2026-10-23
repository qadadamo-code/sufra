import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, CheckCheck, Flame, Hand, Hourglass, Minus, Plus, QrCode, Receipt, Sparkles, UserMinus, Users, UtensilsCrossed } from "lucide-react";
import { useDb } from "@/data/hooks";
import type { OrderItem, OrderItemStatus } from "@/data/types";
import { useDict, useT, type TKey } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { Badge, Button, EmptyState, IconButton, Money, useToast, type Tone } from "@/ui";
import { type Sla } from "@/lib/service-calls";
import { applyAction } from "@/modules/kitchen/ops";
import { CallCard } from "./CallsTab";
import { wdict, type WKey } from "./dict";
import { MenuSheet } from "./MenuSheet";
import { claimTable, confirmQrOrder, fireItems, markTableClean, requestBill, seatTable } from "./orderOps";
import { STATUS_TONE } from "./TablesTab";
import type { WaiterData } from "./useWaiter";

const ORDER: OrderItemStatus[] = ["ready", "preparing", "sent", "new", "served"];
const TONE: Record<OrderItemStatus, Tone> = { ready: "ok", preparing: "primary", sent: "info", new: "neutral", served: "neutral", void: "danger" };

export function TableDetail({ data, now, sla }: { data: WaiterData; now: number; sla: Sla }) {
  const { tableId } = useParams();
  const nav = useNavigate();
  const w = useDict(wdict);
  const { t, loc, lang, dir } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [menu, setMenu] = useState(false);
  const [guests, setGuests] = useState(2);
  const v = data.views.find((x) => x.table.id === tableId);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  if (!v) return data.loading ? null : <EmptyState title="404" action={<Button onClick={() => nav("/waiter")}>{w("w.back")}</Button>} />;
  const tb = v.table;
  const live = v.items.filter((i) => i.status !== "void");
  const byStatus = ORDER.map((s) => [s, live.filter((i) => i.status === s)] as const).filter(([, xs]) => xs.length);
  const ready = live.filter((i) => i.status === "ready");
  const held = live.filter((i) => i.status === "new");
  const nextCourse = held.length ? Math.min(...held.map((i) => i.course)) : null;
  const qrOrders = v.orders.filter((o) => o.source === "qr" && live.some((i) => i.orderId === o.id && i.status === "new"));
  const isFree = tb.status === "free" || tb.status === "reserved";
  const label = w("w.table", { n: tb.label });

  return (
    <div className="mx-auto grid max-w-3xl gap-4 pb-28 md:pb-6">
      {/* header */}
      <div className="flex items-center gap-3">
        <IconButton label={w("w.back")} variant="secondary" onClick={() => nav("/waiter")}>
          <Back />
        </IconButton>
        <span className={cn("grid size-14 shrink-0 place-items-center rounded-2xl border-2 font-mono text-[24px] font-bold", STATUS_TONE[tb.status])}>{tb.label}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px]">{label}</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted">
            <span className="font-semibold">{w(`w.status.${tb.status}` as WKey)}</span>
            {tb.statusSince && !isFree ? <span>{ago(tb.statusSince, lang)}</span> : null}
            {v.guests ? (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden /> {v.guests}
              </span>
            ) : null}
            {v.check ? <Money value={v.check.total} className="font-semibold text-ink-2" /> : null}
          </p>
        </div>
        {v.mine ? (
          <Button variant="ghost" size="sm" icon={<UserMinus className="size-4" />} onClick={() => void claimTable(db, tb, null)}>
            {w("w.releaseTable")}
          </Button>
        ) : (
          <Button variant="soft" size="sm" icon={<Hand className="size-4" />} onClick={() => void claimTable(db, tb, data.me)}>
            {w("w.takeTable")}
          </Button>
        )}
      </div>
      {v.owner && !v.mine ? <p className="-mt-2 text-[13px] text-muted">{data.staffName.get(v.owner)}</p> : null}

      {/* calls on this table */}
      {v.calls.filter((c) => c.type !== "pickup").length ? (
        <ul className="grid gap-2">
          {v.calls
            .filter((c) => c.type !== "pickup")
            .map((c) => (
              <li key={c.id}>
                <CallCard call={c} data={data} now={now} sla={sla} />
              </li>
            ))}
        </ul>
      ) : null}

      {/* QR order waiting for confirmation */}
      {qrOrders.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-info/50 bg-info-soft p-3">
          <QrCode className="size-6 text-info" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-info">{w("w.qrWaiting")}</p>
            <p className="text-[13px] text-ink-2">
              {live
                .filter((i) => i.orderId === o.id && i.status === "new")
                .map((i) => `${i.qty}× ${loc(i.name)}`)
                .join(" · ")}
            </p>
          </div>
          <Button
            icon={<Check className="size-4.5" />}
            onClick={async () => {
              await confirmQrOrder(db, o, live.filter((i) => i.orderId === o.id));
              toast({ title: w("w.sent", { t: label }), tone: "success" });
            }}
          >
            {w("w.confirmQr")}
          </Button>
        </div>
      ))}

      {/* seat guests */}
      {isFree && !live.length ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3 shadow-sf-sm">
          <Users className="size-5 text-muted" aria-hidden />
          <span className="font-semibold">{w("w.guestsLabel")}</span>
          <div className="inline-flex items-center gap-1 rounded-xl border border-line p-1">
            <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-surface-2" onClick={() => setGuests((g) => Math.max(1, g - 1))} aria-label="−">
              <Minus className="size-4.5" />
            </button>
            <span className="min-w-8 text-center font-mono text-[18px] font-bold">{guests}</span>
            <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-surface-2" onClick={() => setGuests((g) => Math.min(30, g + 1))} aria-label="+">
              <Plus className="size-4.5" />
            </button>
          </div>
          <Button className="ms-auto" onClick={async () => (await seatTable(db, tb, guests), toast({ title: `${label} · ${w("w.seated")}`, tone: "success" }))}>
            {w("w.seat")}
          </Button>
        </div>
      ) : null}
      {tb.status === "dirty" ? (
        <Button variant="secondary" icon={<Sparkles className="size-4.5" />} onClick={() => void markTableClean(db, tb)}>
          {w("w.clean")}
        </Button>
      ) : null}

      {/* items */}
      <section className="rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <h2 className="flex items-center gap-2 px-4 pt-3.5 pb-2 text-[16px]">
          <UtensilsCrossed className="size-4.5 text-muted" aria-hidden /> {w("w.items")}
          {v.orders.length ? <bdi className="font-mono text-[13px] text-muted" dir="ltr">#{v.orders.map((o) => o.number).join(", #")}</bdi> : null}
        </h2>
        {!live.length ? <p className="px-4 pb-5 text-center text-muted">{w("w.noItems")}</p> : null}
        {byStatus.map(([s, xs]) => (
          <div key={s} className="border-t border-line px-2 py-2">
            <div className="flex items-center gap-2 px-2 pb-1">
              <Badge tone={TONE[s]} dot pulse={s === "ready"}>
                {s === "new" ? w("w.held") : t(`item.${s}` as TKey)}
              </Badge>
              {s === "new" && nextCourse !== null && !qrOrders.length ? (
                <Button size="sm" variant="soft" className="ms-auto" icon={<Flame className="size-4" />} onClick={() => void fireItems(db, held.filter((i) => i.course === nextCourse))}>
                  {w("w.fireCourse", { n: nextCourse })}
                </Button>
              ) : null}
            </div>
            <ul>
              {xs.map((i) => (
                <ItemLine key={i.id} item={i} onServe={s === "ready" ? () => void applyAction(db, [i], "serve") : undefined} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* actions */}
      <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 px-4 md:static md:px-0">
        <div className="mx-auto flex max-w-3xl gap-2 rounded-[22px] border border-line bg-surface/95 p-2 shadow-sf-lg backdrop-blur-xl md:shadow-sf-sm">
          <Button size="lg" className="flex-1" icon={<Plus className="size-5" />} onClick={() => setMenu(true)}>
            {w("w.addItems")}
          </Button>
          {ready.length ? (
            <Button size="lg" variant="soft" icon={<CheckCheck className="size-5" />} onClick={() => void applyAction(db, ready, "serve")} aria-label={w("w.markServed")}>
              <span className="max-sm:sr-only">{w("w.markServed")}</span>
            </Button>
          ) : null}
          {live.length && tb.status !== "bill" ? (
            <Button
              size="lg"
              variant="brass"
              icon={<Receipt className="size-5" />}
              onClick={async () => {
                await requestBill(db, tb, v.check);
                toast({ title: `${label} · ${w("w.billRequested")}`, tone: "success" });
              }}
              aria-label={w("w.requestBill")}
            >
              <span className="max-sm:sr-only">{w("w.requestBill")}</span>
            </Button>
          ) : tb.status === "bill" ? (
            <Badge tone="brass" className="self-center px-3" icon={<Hourglass />}>
              {w("w.billRequested")}
            </Badge>
          ) : null}
        </div>
      </div>
      <MenuSheet open={menu} onClose={() => setMenu(false)} table={tb} guests={v.guests || guests} />
    </div>
  );
}

function ItemLine({ item: i, onServe }: { item: OrderItem; onServe?: () => void }) {
  const { loc } = useT();
  const w = useDict(wdict);
  return (
    <li className="flex items-start gap-2.5 rounded-xl px-2 py-1.5">
      <span className="mt-0.5 grid h-7 min-w-7 place-items-center rounded-lg bg-surface-3 px-1 font-mono text-[14px] font-bold">{i.qty}</span>
      <div className="min-w-0 flex-1">
        <p className={cn("font-semibold", i.status === "served" && "text-muted")}>{loc(i.name)}</p>
        {i.modifiers.length ? <p className="text-[13px] text-brass-text">{i.modifiers.map((m) => loc(m.name)).join(" · ")}</p> : null}
        {i.notes ? <p className="text-[13px] text-warn">{i.notes}</p> : null}
        {i.seat || i.course > 1 ? (
          <p className="text-[12px] text-muted">
            {i.seat ? `${w("w.seatN")} ${i.seat}` : ""}
            {i.seat && i.course > 1 ? " · " : ""}
            {i.course > 1 ? `${w("w.courseN")} ${i.course}` : ""}
          </p>
        ) : null}
      </div>
      <Money value={i.qty * (i.unitPrice + i.modifiers.reduce((a, m) => a + m.price, 0))} className="mt-0.5 text-[13px] text-muted" />
      {onServe ? (
        <Button size="sm" variant="soft" icon={<Check className="size-4" />} onClick={onServe}>
          {w("w.done")}
        </Button>
      ) : null}
    </li>
  );
}
