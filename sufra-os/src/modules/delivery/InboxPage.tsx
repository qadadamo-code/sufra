/** /delivery — incoming orders that need a decision: accept with a prep time, or reject with a reason. */
import { useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, Check, ChefHat, Clock, MapPin, PhoneCall, QrCode, Receipt, Settings2, StickyNote, Volume2, VolumeX, X } from "lucide-react";
import { useDb } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { Badge, Button, Card, Dialog, EmptyState, Money, Switch, Textarea, useReduced, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { acceptOrder, rejectOrder } from "./stages";
import { dispatchOf } from "./settings";
import { useDeliveryData, useNow, type OrderView } from "./useDelivery";
import { ChannelBadge, Countdown, DeliveryTabs, ItemLines } from "./ui";
import { PhoneOrderDialog } from "./PhoneOrderDialog";
import { AggregatorOrderDialog } from "./AggregatorOrderDialog";
import { chime } from "./watch";

const PREP = [10, 15, 20, 30, 45];

export default function InboxPage() {
  const { L } = useT();
  const data = useDeliveryData();
  const now = useNow(1000);
  const [phone, setPhone] = useState(false);
  const [agg, setAgg] = useState(false);
  const [rules, setRules] = useState(false);
  const reduced = useReduced();
  const live = data.views.filter((v) => ["preparing", "ready", "assigned", "out"].includes(v.column));
  const counts = { preparing: 0, ready: 0, assigned: 0, out: 0 } as Record<string, number>;
  for (const v of live) counts[v.column]++;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader
        icon={<BellRing />}
        title={L("الطلبات الواردة", "Incoming orders")}
        subtitle={L("اقبل الطلب وحدد وقت التجهيز، أو ارفضه بسبب — العميل بيوصله إشعار", "Accept with a prep time or reject with a reason — the customer is notified")}
        actions={
          <>
            <Button variant="secondary" icon={<Receipt />} onClick={() => setAgg(true)}>
              {L("طلب تطبيق", "App order")}
            </Button>
            <Button icon={<PhoneCall />} onClick={() => setPhone(true)}>
              {L("طلب تليفون", "Phone order")}
            </Button>
          </>
        }
      />
      <DeliveryTabs />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="grid content-start gap-3" aria-label={L("مستني رد", "Waiting for a decision")}>
          <div className="flex items-center gap-2">
            <h2 className="font-sans text-[17px] font-bold">{L("مستني رد", "Waiting for you")}</h2>
            {data.inbox.length ? <Badge tone="danger" pulse dot>{data.inbox.length}</Badge> : null}
            <button type="button" onClick={() => setRules(true)} className="ms-auto inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-muted hover:bg-surface-3 hover:text-ink">
              <Settings2 className="size-4" /> {autoSummary(data, L)}
            </button>
          </div>
          {data.inbox.length === 0 ? (
            <EmptyState
              icon={<Check />}
              title={L("مفيش طلبات مستنية", "Nothing waiting")}
              body={L("أول ما طلب أونلاين يوصل هيظهر هنا بصوت تنبيه", "New online orders appear here with a chime")}
              className="rounded-[22px] border border-dashed border-line"
            />
          ) : (
            <ul className="grid gap-3 2xl:grid-cols-2">
              <AnimatePresence initial={false}>
                {data.inbox.map((v) => (
                  <motion.li key={v.order.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}>
                    <PendingCard v={v} now={now} autoRejectMin={data.cfg.autoRejectMin} defaultPrep={data.cfg.defaultPrepMin} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}

          {data.qrWaiting.length ? (
            <>
              <h2 className="mt-3 flex items-center gap-2 font-sans text-[15.5px] font-bold">
                <QrCode className="size-4.5 text-muted" /> {L("طلبات QR مستنية تأكيد الجرسون", "QR orders waiting for the waiter")}
              </h2>
              <ul className="grid gap-2 md:grid-cols-2">
                {data.qrWaiting.map((v) => (
                  <li key={v.order.id}>
                    <QrCard v={v} />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <aside className="grid content-start gap-3">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[15px] font-bold">{L("شغال دلوقتي", "In progress")}</p>
              <Link to="/delivery/dispatch" className="text-[13px] font-semibold text-primary">
                {L("لوحة التوزيع ←", "Dispatch →")}
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              {(
                [
                  ["preparing", L("بيتجهز", "Preparing"), "text-warn"],
                  ["ready", L("جاهز", "Ready"), "text-ok"],
                  ["assigned", L("مع طيار", "Assigned"), "text-info"],
                  ["out", L("في الطريق", "On the road"), "text-primary"],
                ] as const
              ).map(([k, label, tone]) => (
                <div key={k} className="rounded-2xl bg-surface-2 p-3">
                  <dt className="text-[12.5px] text-muted">{label}</dt>
                  <dd className={cn("num text-[26px] font-bold leading-tight", tone)}>{counts[k]}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <RecentlyClosed data={data} />
        </aside>
      </div>

      <PhoneOrderDialog open={phone} onClose={() => setPhone(false)} zones={data.zones} />
      <AggregatorOrderDialog open={agg} onClose={() => setAgg(false)} />
      <RulesDialog open={rules} onClose={() => setRules(false)} />
    </div>
  );
}

function autoSummary(data: ReturnType<typeof useDeliveryData>, L: (a: string, b: string) => string) {
  const a = data.cfg.autoAccept;
  const on = [a.online_delivery && L("توصيل أونلاين", "online delivery"), a.online_takeaway && L("استلام أونلاين", "online pickup")].filter(Boolean);
  const reject = data.cfg.autoRejectMin ? L(`رفض تلقائي بعد ${data.cfg.autoRejectMin} د`, `auto-reject after ${data.cfg.autoRejectMin} min`) : L("مفيش رفض تلقائي", "no auto-reject");
  return `${on.length ? L("قبول تلقائي: ", "Auto-accept: ") + on.join("، ") : L("القبول يدوي", "Manual accept")} · ${reject}`;
}

function PendingCard({ v, now, autoRejectMin, defaultPrep }: { v: OrderView; now: number; autoRejectMin: number; defaultPrep: number }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const d = dispatchOf(v.order);
  const [prep, setPrep] = useState(defaultPrep);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const paid = v.check ? v.check.paid >= v.check.total && v.check.total > 0 : false;
  const accept = async () => {
    setBusy(true);
    try {
      await acceptOrder(db, v.order.id, prep);
      toast({ title: L(`#${v.order.number} اتقبل — في المطبخ`, `#${v.order.number} accepted — in the kitchen`), description: L(`العميل اتبلغ بوقت ${prep} د`, `Customer told ~${prep} min`), tone: "success", duration: 2500 });
    } catch (e) {
      toast({ title: L("ماقدرناش نقبل الطلب", "Couldn't accept"), description: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="overflow-hidden border-2 border-primary/30">
      <div className="flex items-start gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="num text-[22px] font-bold leading-none">#{v.order.number}</span>
            <ChannelBadge v={v} />
            {v.order.mode === "takeaway" ? <Badge tone="info">{v.order.pickupAt ? L("استلام بميعاد", "Scheduled pickup") : L("استلام", "Pickup")}</Badge> : null}
            <span className="text-[12.5px] text-muted">{ago(v.order.openedAt, lang, now)}</span>
          </div>
          <p className="mt-2 flex items-center gap-2 text-[15.5px] font-bold">
            {v.customer?.name ?? L("عميل", "Guest")}
            <span className="num text-[13px] font-medium text-muted" dir="ltr">
              {v.customer?.phone}
            </span>
          </p>
          {v.order.mode === "delivery" && v.order.delivery ? (
            <p className="mt-1 flex items-start gap-1.5 text-[13.5px] text-ink-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <b>{v.order.delivery.area}</b> — {v.order.delivery.address}
                {v.approx ? <span className="text-muted"> · {L("موقع تقريبي", "approx. pin")}</span> : null}
              </span>
            </p>
          ) : null}
        </div>
        {d.expiresAt ? <Countdown until={d.expiresAt} total={Math.max(1, autoRejectMin) * 60_000} now={now} label={L("وقت الرفض التلقائي", "Auto-reject countdown")} /> : null}
      </div>
      <div className="grid gap-3 border-t border-line px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <ItemLines items={v.items} />
        <div className="text-end">
          <Money value={v.check?.total ?? 0} className="text-[18px] font-bold" />
          <div className="mt-1">{paid ? <Badge tone="ok">{L("مدفوع أونلاين", "Paid online")}</Badge> : <Badge tone="brass">{/card/.test(v.order.note) ? L("كارت عند الاستلام", "Card on delivery") : L("كاش عند الاستلام", "Cash on delivery")}</Badge>}</div>
        </div>
        {v.order.note.replace(/^[💵💳][^·]*(· )?/u, "").trim() ? (
          <p className="flex items-start gap-1.5 rounded-xl bg-brass-soft px-3 py-2 text-[13px] text-brass-text sm:col-span-2">
            <StickyNote className="mt-0.5 size-4 shrink-0" /> {v.order.note.replace(/^[💵💳][^·]*(· )?/u, "")}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2 border-t border-line bg-surface-2/60 p-3">
        <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={L("وقت التجهيز", "Prep time")}>
          <Clock className="me-1 size-4 text-muted" aria-hidden />
          {PREP.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={prep === m} onClick={() => setPrep(m)} className={cn("num h-10 min-w-12 rounded-full border px-3 text-[14px] font-bold transition-colors", prep === m ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:border-line-strong")}>
              {m}′
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" icon={<X />} onClick={() => setRejecting(true)} className="text-danger">
            {L("رفض", "Reject")}
          </Button>
          <Button block size="lg" icon={<ChefHat />} loading={busy} onClick={accept} className="flex-1">
            {L(`اقبل · جاهز خلال ${prep} د`, `Accept · ready in ${prep} min`)}
          </Button>
        </div>
      </div>
      <RejectDialog open={rejecting} onClose={() => setRejecting(false)} v={v} />
    </Card>
  );
}

const REASONS: { ar: string; en: string }[] = [
  { ar: "ضغط في المطبخ", en: "Kitchen is too busy" },
  { ar: "صنف خلص", en: "An item is sold out" },
  { ar: "العنوان برّه مناطق التوصيل", en: "Address outside our delivery area" },
  { ar: "الفرع هيقفل", en: "Branch is closing" },
  { ar: "مش قادرين نوصل للعميل", en: "Couldn't reach the customer" },
];

function RejectDialog({ open, onClose, v }: { open: boolean; onClose: () => void; v: OrderView }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await rejectOrder(db, v.order.id, reason);
      toast({ title: L(`#${v.order.number} اترفض`, `#${v.order.number} rejected`), description: L("العميل اتبلغ بالسبب", "The customer was told why"), tone: "warn" });
      onClose();
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={L(`رفض الطلب #${v.order.number}`, `Reject order #${v.order.number}`)}
      description={L("السبب بيتبعت للعميل على واتساب", "The reason is sent to the customer on WhatsApp")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {L("رجوع", "Back")}
          </Button>
          <Button variant="danger" disabled={!reason.trim()} loading={busy} onClick={go}>
            {L("ارفض وبلّغ العميل", "Reject & notify")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => {
            const t = lang === "ar" ? r.ar : r.en;
            return (
              <button key={r.en} type="button" onClick={() => setReason(t)} className={cn("rounded-full border px-3.5 py-2 text-[13.5px] font-semibold", reason === t ? "border-danger bg-danger-soft text-danger" : "border-line hover:border-line-strong")}>
                {t}
              </button>
            );
          })}
        </div>
        <Textarea label={L("السبب", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={160} />
      </div>
    </Dialog>
  );
}

function QrCard({ v }: { v: OrderView }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="flex items-center gap-3 p-3">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface-3 [&_svg]:size-5">
        <QrCode />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-bold">
          #{v.order.number} · {ago(v.order.openedAt, lang)}
        </p>
        <p className="truncate text-[12.5px] text-muted">{v.items.filter((i) => i.status === "new").map((i) => `${i.qty}× ${lang === "ar" ? i.name.ar : i.name.en}`).join("، ")}</p>
      </div>
      <Button
        size="sm"
        variant="soft"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const items = v.items.filter((i) => i.status === "new");
            const t = new Date().toISOString();
            await Promise.all(items.map((i) => db.update("orderItems", i.id, { status: "sent", firedAt: t })));
            if (v.order.status === "open") await db.update("orders", v.order.id, { status: "sent" });
            await db.audit("qr.confirm", "orders", v.order.id, { items: items.length });
            toast({ title: L("اتبعت للمطبخ", "Sent to the kitchen"), tone: "success", duration: 2000 });
          } finally {
            setBusy(false);
          }
        }}
      >
        {L("ابعت للمطبخ", "Send to kitchen")}
      </Button>
    </Card>
  );
}

function RecentlyClosed({ data }: { data: ReturnType<typeof useDeliveryData> }) {
  const { L, lang, loc } = useT();
  const recent = data.views
    .filter((v) => ["rejected", "cancelled"].includes(dispatchOf(v.order).stage))
    .slice(0, 5);
  if (!recent.length) return null;
  return (
    <Card className="p-4">
      <p className="mb-2 text-[14.5px] font-bold">{L("اترفض / اتلغى النهارده", "Rejected / cancelled today")}</p>
      <ul className="grid gap-2 text-[13px]">
        {recent.map((v) => (
          <li key={v.order.id} className="flex items-start gap-2">
            <span className="num font-bold">#{v.order.number}</span>
            <span className="min-w-0 flex-1 text-muted">{dispatchOf(v.order).rejectReason ?? "—"}</span>
            <span className="text-[12px] text-faint">{v.customer?.name ?? loc({ ar: "عميل", en: "Guest" })} · {ago(v.order.openedAt, lang)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const data = useDeliveryData();
  const s = data.settings;
  const cfg = data.cfg;
  const save = async (patch: Partial<typeof cfg>) => {
    if (!s) return;
    await db.update("settings", s.id, { delivery: { ...cfg, ...patch } });
  };
  return (
    <Dialog open={open} onClose={onClose} size="md" title={L("القبول التلقائي", "Auto-accept")} description={L("لكل قناة: يدخل المطبخ على طول، ولا يستنى حد يقبله", "Per channel: straight to the kitchen, or wait for someone to accept")}>
      <div className="grid gap-1">
        <Switch checked={cfg.autoAccept.online_delivery} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, online_delivery: v } })} label={L("توصيل أونلاين", "Online delivery")} description={L("الأفضل يدوي: تتأكد من العنوان والضغط", "Manual is safer: check the address and load")} />
        <Switch checked={cfg.autoAccept.online_takeaway} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, online_takeaway: v } })} label={L("استلام أونلاين", "Online pickup")} />
        <Switch checked={cfg.autoAccept.phone} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, phone: v } })} label={L("طلبات التليفون", "Phone orders")} description={L("اللي بياخد المكالمة هو اللي بيقبل", "Whoever takes the call accepts it")} />
        <Switch checked={cfg.autoAccept.aggregator} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, aggregator: v } })} label={L("تطبيقات التوصيل", "Delivery apps")} />
        <Switch
          checked={!(s?.qrOrdering.requireWaiterConfirm ?? true)}
          onChange={(v) => s && db.update("settings", s.id, { qrOrdering: { ...s.qrOrdering, requireWaiterConfirm: !v } })}
          label={L("طلبات QR من الترابيزة", "Table QR orders")}
          description={L("مقفول = الجرسون بيأكد الأول", "Off = the waiter confirms first")}
        />
        <div className="mt-3 rounded-2xl bg-surface-2 p-3">
          <p className="mb-2 text-[13.5px] font-semibold">{L("رفض تلقائي لو محدش رد خلال", "Auto-reject if nobody answers within")}</p>
          <div className="flex flex-wrap gap-1.5">
            {[0, 5, 8, 10, 15].map((m) => (
              <button key={m} type="button" onClick={() => save({ autoRejectMin: m })} className={cn("num h-10 rounded-full border px-3.5 text-[13.5px] font-bold", cfg.autoRejectMin === m ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface")}>
                {m ? `${m}′` : L("أبدًا", "Never")}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Switch checked={cfg.sound} onChange={(v) => save({ sound: v })} label={<span className="inline-flex items-center gap-1.5">{cfg.sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}{L("صوت تنبيه للطلب الجديد", "Chime on new orders")}</span>} />
          <Button size="sm" variant="ghost" onClick={chime}>
            {L("جرّب", "Test")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
