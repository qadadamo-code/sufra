/** /delivery/settle — rider cash settlement at the till: expected vs handed in, short/over, closes the delivered checks. */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, CheckCircle2, CircleAlert, HandCoins, Wallet } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { DriverShift, Order } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { major } from "@/lib/money";
import { latinDigits } from "@/lib/arabic";
import { clock } from "@/lib/time";
import { Avatar, Badge, Button, Card, EmptyState, Input, Money, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { deviceCode } from "@/modules/pos/sale";
import { dispatchOf } from "./settings";
import { settleShift, settlementDiff, shiftCash, shiftOrders } from "./settle";
import { useDeliveryData } from "./useDelivery";
import { DeliveryTabs } from "./ui";

export default function SettlePage() {
  const { L, lang } = useT();
  const data = useDeliveryData({ days: 1 });
  const [sel, setSel] = useState<string | null>(null);
  const open = data.shifts.filter((s) => s.status !== "settled");
  const settled = data.shifts.filter((s) => s.status === "settled").slice(0, 6);
  const shift = data.shifts.find((s) => s.id === sel) ?? open[0] ?? null;
  useEffect(() => {
    if (!sel && open[0]) setSel(open[0].id);
  }, [sel, open]);
  const name = (id: string) => data.drivers.find((d) => d.id === id);
  const ordersOf = (s: DriverShift) => data.views.filter((v) => v.order.driverId === s.driverId && (dispatchOf(v.order).driverShiftId === s.id)).map((v) => v.order);

  return (
    <div className="mx-auto grid max-w-[1200px] gap-5">
      <PageHeader icon={<HandCoins />} title={L("كاش الطيارين", "Rider cash")} subtitle={L("الطيار بيسلّم اللي حصّله، والفرق بيتسجل عجز أو زيادة", "Riders hand in what they collected; any difference is booked as short/over")} />
      <DeliveryTabs />
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="grid content-start gap-2" aria-label={L("الشيفتات", "Shifts")}>
          {open.length === 0 ? <EmptyState compact icon={<Wallet />} title={L("مفيش شيفتات مفتوحة", "No open rider shifts")} /> : null}
          {open.map((s) => {
            const m = name(s.driverId);
            const c = shiftCash(ordersOf(s));
            return (
              <button key={s.id} type="button" onClick={() => setSel(s.id)} className={cn("flex items-center gap-3 rounded-2xl border bg-surface p-3 text-start transition-colors", shift?.id === s.id ? "border-primary ring-2 ring-primary/20" : "border-line hover:border-line-strong")}>
                <Avatar name={m?.name ?? "?"} color={m?.color} status={s.status === "on" ? "online" : null} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] font-bold">{m?.name ?? "—"}</p>
                  <p className="text-[12px] text-muted">
                    {s.status === "on" ? L("في الشيفت", "On shift") : L("خلّص الشيفت", "Shift ended")} · {clock(s.startedAt, lang)}
                    {s.endedAt ? `–${clock(s.endedAt, lang)}` : ""} · {L(`${c.orders} طلب`, `${c.orders} orders`)}
                  </p>
                </div>
                <Money value={c.cash} compact className="font-bold text-brass-text" />
              </button>
            );
          })}
          {settled.length ? (
            <>
              <p className="mt-3 px-1 text-[13px] font-semibold text-muted">{L("اتسوّى النهارده", "Settled today")}</p>
              {settled.map((s) => {
                const m = name(s.driverId);
                const st = s.settlement!;
                return (
                  <div key={s.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px]">
                    <CheckCircle2 className="size-4.5 text-ok" />
                    <span className="min-w-0 flex-1 truncate font-semibold">{m?.name}</span>
                    <Money value={st.handedIn} compact />
                    {st.difference ? <Badge size="sm" tone={st.difference < 0 ? "danger" : "warn"}><Money value={st.difference} compact signed /></Badge> : <Badge size="sm" tone="ok">{L("مظبوط", "Exact")}</Badge>}
                  </div>
                );
              })}
            </>
          ) : null}
        </section>
        {shift ? <SettlePanel key={shift.id} shift={shift} driverName={name(shift.driverId)?.name ?? ""} /> : null}
      </div>
    </div>
  );
}

function SettlePanel({ shift, driverName }: { shift: DriverShift; driverName: string }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const live = useLive("orders", { where: { driverId: shift.driverId } });
  useEffect(() => {
    void shiftOrders(db, shift).then(setOrders);
  }, [db, shift, live.data]);
  const totals = useMemo(() => shiftCash(orders), [orders]);
  const active = orders.filter((o) => ["assigned", "picked_up", "arrived"].includes(dispatchOf(o).stage));
  const [handed, setHanded] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const handedU = handed.trim() ? major(Number(latinDigits(handed).replace(/,/g, "")) || 0) : null;
  const diff = handedU === null ? null : settlementDiff(totals.expected, handedU);
  const device = deviceCode();
  const pos = useLive("shifts", { where: { device, status: "open" } });
  const posShift = pos.data[0] ?? null;
  const checks = useLive("checks", { where: { id: orders.map((o) => o.checkId ?? "") } }, { enabled: orders.length > 0 });
  const checkBy = new Map(checks.data.map((c) => [c.id, c]));

  const go = async () => {
    if (handedU === null || !posShift) return;
    setBusy(true);
    try {
      const r = await settleShift(db, shift, handedU, { shift: posShift, device }, note);
      toast({
        title: r.state === "exact" ? L("اتسوّى — مظبوط", "Settled — exact") : r.state === "short" ? L("اتسوّى — فيه عجز", "Settled — short") : L("اتسوّى — فيه زيادة", "Settled — over"),
        description: L(`${r.closed} فاتورة اتقفلت على ${device}`, `${r.closed} checks closed on ${device}`) + (r.errors.length ? ` · ${r.errors.join(" · ")}` : ""),
        tone: r.errors.length ? "warn" : "success",
      });
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="grid content-start gap-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-sans text-[18px] font-bold">{driverName}</h2>
        <Badge tone={shift.status === "on" ? "ok" : "neutral"}>{shift.status === "on" ? L("لسه في الشيفت", "Still on shift") : L("خلّص", "Ended")}</Badge>
        <span className="ms-auto text-[13px] text-muted">
          {clock(shift.startedAt, lang)} → {shift.endedAt ? clock(shift.endedAt, lang) : L("دلوقتي", "now")}
        </span>
      </div>
      {active.length ? (
        <p className="flex items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13.5px] text-warn">
          <CircleAlert className="size-4.5" /> {L(`معاه ${active.length} طلب لسه ماتسلّمش — هيتسوّى في شيفت تاني`, `${active.length} orders still out — they settle later`)}
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        <Tile label={L("كاش اتحصّل", "Cash collected")} value={<Money value={totals.cash} />} />
        <Tile label={L("كارت", "Card")} value={<Money value={totals.card} />} />
        <Tile label={L("مدفوع أونلاين", "Prepaid")} value={<span className="num">{totals.prepaid}</span>} />
      </div>
      <div className="overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-[13.5px]">
          <thead className="bg-surface-2 text-[12px] text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-semibold">#</th>
              <th className="px-3 py-2 text-start font-semibold">{L("اتسلّم", "Delivered")}</th>
              <th className="px-3 py-2 text-start font-semibold">{L("الطريقة", "Method")}</th>
              <th className="px-3 py-2 text-end font-semibold">{L("المبلغ", "Amount")}</th>
              <th className="px-3 py-2 text-end font-semibold">{L("الفاتورة", "Check")}</th>
            </tr>
          </thead>
          <tbody>
            {orders
              .filter((o) => dispatchOf(o).stage === "delivered")
              .map((o) => {
                const d = dispatchOf(o);
                const c = o.checkId ? checkBy.get(o.checkId) : null;
                return (
                  <tr key={o.id} className="border-t border-line">
                    <td className="num px-3 py-2 font-bold">{o.number}</td>
                    <td className="num px-3 py-2">{d.deliveredAt ? clock(d.deliveredAt, lang) : "—"}</td>
                    <td className="px-3 py-2">{d.collected?.method === "cash" ? L("كاش", "Cash") : d.collected?.method === "card" ? L("كارت", "Card") : L("أونلاين", "Online")}</td>
                    <td className="px-3 py-2 text-end">{d.collected && d.collected.method !== "prepaid" ? <Money value={d.collected.amount} /> : "—"}</td>
                    <td className="px-3 py-2 text-end">{c?.status === "paid" ? <Badge size="sm" tone="ok">{c.receiptNo ?? L("مقفولة", "Closed")}</Badge> : <Badge size="sm">{L("مفتوحة", "Open")}</Badge>}</td>
                  </tr>
                );
              })}
            {!totals.orders ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">
                  {L("مفيش طلبات اتسلّمت في الشيفت ده", "No deliveries on this shift")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 rounded-2xl bg-surface-2 p-4 sm:grid-cols-[1fr_1fr]">
        <div>
          <p className="text-[12.5px] text-muted">{L("المفروض يسلّم", "Expected")}</p>
          <Money value={totals.expected} className="text-[28px] font-bold" />
        </div>
        <Input label={L("سلّم فعلًا (ج.م)", "Handed in (EGP)")} icon={<Banknote />} inputMode="decimal" dir="ltr" value={handed} onChange={(e) => setHanded(e.target.value)} placeholder={(totals.expected / 100000).toFixed(2)} size="lg" />
        {diff ? (
          <p className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-[14.5px] font-bold sm:col-span-2", diff.state === "exact" ? "bg-ok-soft text-ok" : diff.state === "short" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn")} role="status">
            {diff.state === "exact" ? L("مظبوط ✓", "Exact ✓") : diff.state === "short" ? L("عجز", "Short") : L("زيادة", "Over")}
            {diff.difference ? <Money value={diff.difference} signed className="ms-auto" /> : null}
          </p>
        ) : null}
        {diff && diff.state !== "exact" ? <Input label={L("ملاحظة", "Note")} value={note} onChange={(e) => setNote(e.target.value)} wrapClassName="sm:col-span-2" /> : null}
      </div>
      {!posShift ? (
        <p className="flex flex-wrap items-center gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13.5px] text-warn">
          <CircleAlert className="size-4.5" /> {L(`افتح شيفت كاشير على ${device} الأول — الكاش بيدخل الدرج ده`, `Open a till shift on ${device} first — the cash goes into that drawer`)}
          <Link to="/pos/shift" className="ms-auto font-bold underline">
            {L("فتح شيفت", "Open shift")}
          </Link>
        </p>
      ) : null}
      <Button size="lg" icon={<HandCoins />} disabled={handedU === null || !posShift || shift.status === "settled"} loading={busy} onClick={go}>
        {L("سوّي واقفل الفواتير", "Settle & close checks")}
      </Button>
    </Card>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line p-3">
      <p className="text-[12px] text-muted">{label}</p>
      <div className="text-[17px] font-bold">{value}</div>
    </div>
  );
}
