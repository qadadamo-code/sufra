import { useEffect, useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Bike, MapPin, MessageCircle, Phone, Smartphone, Store } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { Badge, Button, EmptyState, Money, Skeleton, useToast } from "@/ui";
import { Mark } from "@/shell/Logo";
import { PICKUP_MINUTES } from "./data/venue";
import { GuestProvider, useGuest } from "./ui/context";
import { GuestToggles, TotalsList } from "./ui/bits";
import { STAGE_COPY, Timeline } from "./ui/Tracker";
import { FeedbackCard, LoyaltyCard, ReceiptCard } from "./ui/AfterMeal";
import { useLiveFetch } from "./ui/useLiveFetch";
import { usePayment } from "./ui/usePayment";
import { getNotifier } from "./notify/notifier";
import type { NotifyStage } from "./notify/templates";
import type { Stage } from "./stages";

/** Order tracking: /r/:slug/o/:orderId — live status timeline, driver, totals, pay, rate. */
export default function TrackPage() {
  const { restaurantSlug = "" } = useParams();
  return (
    <GuestProvider slug={restaurantSlug} tableCode={null}>
      <TrackView />
    </GuestProvider>
  );
}

const NOTIFY: Partial<Record<Stage, NotifyStage>> = { accepted: "accepted", preparing: "accepted", ready: "ready_pickup", out_for_delivery: "out_for_delivery", delivered: "delivered", picked_up: "delivered", cancelled: "cancelled" };

function TrackView() {
  const { orderId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const { slug, venue, menu, svc } = useGuest();
  const { L, loc, lang } = useT();
  const { toast } = useToast();
  const { data: o, loading, refresh } = useLiveFetch(svc, venue.restaurantId, () => svc.track(slug, orderId), [svc, slug, orderId], 5000);
  const pay = usePayment(svc, slug);
  const autoPay = useRef(params.get("pay") === "1");

  const due = o ? Math.max(0, o.totals.total - o.totals.paid) : 0;
  const wantsOnline = !!o && /paid online/.test(o.note);

  // ?pay=1 right after checkout → straight to the payment page
  useEffect(() => {
    if (!o || !autoPay.current || !o.checkId || due <= 0 || !pay.available) return;
    autoPay.current = false;
    params.delete("pay");
    setParams(params, { replace: true });
    void pay.start({ purpose: "order", checkId: o.checkId, orderId: o.orderId, tableCode: null, amount: due, tip: 0, currency: venue.currency, splitLabel: `#${o.number}`, customer: o.customer, lang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, due]);

  useEffect(() => {
    if (pay.state.s === "done") {
      refresh();
      toast({ title: L("الدفع تم ✓", "Payment received ✓"), tone: "success" });
    } else if (pay.state.s === "failed" || pay.state.s === "cancelled" || pay.state.s === "expired") {
      toast({ title: L("الدفع ماتمّش — تقدر تدفع عند الاستلام", "Payment didn't go through — you can pay on arrival"), tone: "error" });
      pay.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay.state.s]);

  // WhatsApp stage messages (logged preview until the Cloud API is connected; deduped per order+stage)
  useEffect(() => {
    if (!o?.customer) return;
    const ns = NOTIFY[o.stage];
    if (!ns) return;
    const link = `${window.location.origin}${import.meta.env.BASE_URL}r/${slug}/o/${o.orderId}`;
    const base = { name: o.customer.name.split(" ")[0], number: o.number, link };
    const vars: Record<NotifyStage, Record<string, string | number>> = {
      received: {},
      accepted: { ...base, eta: etaClock(o.createdAt, o.mode === "delivery" ? 45 : PICKUP_MINUTES, lang) },
      ready_pickup: { ...base, branch: venue.branch ? loc(venue.branch.name) : loc(venue.name), map_link: `https://maps.google.com/?q=${encodeURIComponent(loc(venue.branch?.address ?? venue.name))}` },
      out_for_delivery: { ...base, driver_name: o.driver?.name ?? L("الطيار", "our driver"), driver_phone: o.driver?.phone ?? venue.phone ?? "-", eta: etaClock(new Date().toISOString(), 15, lang) },
      delivered: { ...base, receipt_link: link, rate_link: `${link}#rate` },
      cancelled: { ...base, reason: L("المطعم مش قادر يجهّز الطلب", "The restaurant can't fulfil the order"), refund: o.totals.paid ? L("هيرجعلك المبلغ خلال ٣–٥ أيام عمل", "Refund within 3–5 business days") : L("مفيش مبلغ اتخصم", "Nothing was charged"), phone: venue.phone ?? "-" },
      delayed: {},
      paid: {},
    };
    if (o.mode !== "takeaway" && ns === "ready_pickup") return;
    void getNotifier()
      .send({ restaurantId: venue.restaurantId, to: o.customer.phone, lang, template: ns === "accepted" ? "order_accepted_eta" : ns === "ready_pickup" ? "order_ready_pickup" : ns === "out_for_delivery" ? "order_out_for_delivery" : ns === "delivered" ? "order_delivered_receipt" : "order_cancelled", vars: vars[ns], dedupeKey: `${o.orderId}:${ns}` })
      .catch(() => undefined);
  }, [o?.stage, o?.orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (o) document.title = `#${o.number} · ${L(STAGE_COPY[o.stage].ar, STAGE_COPY[o.stage].en)}`;
  }, [o, L]);

  const header = (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/90 backdrop-blur-lg">
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-2.5">
        <Link to={`/r/${slug}`} aria-label={L("المنيو", "Menu")} className="grid size-10 place-items-center rounded-full hover:bg-surface-3">
          <ArrowLeft className="size-5 flip-rtl" />
        </Link>
        <Mark className="size-8" />
        <p className="min-w-0 flex-1 truncate font-display text-[17px] font-semibold">{loc(menu.restaurant.name)}</p>
        <GuestToggles />
      </div>
    </header>
  );

  if (loading && !o)
    return (
      <div className="min-h-dvh bg-bg">
        {header}
        <div className="mx-auto grid max-w-xl gap-3 p-4">
          <Skeleton className="h-40" rounded="rounded-3xl" />
          <Skeleton className="h-72" rounded="rounded-3xl" />
        </div>
      </div>
    );
  if (!o)
    return (
      <div className="min-h-dvh bg-bg">
        {header}
        <EmptyState title={L("الطلب ده مش موجود", "Order not found")} body={L("اتأكد من اللينك", "Check the link")} />
      </div>
    );

  const c = STAGE_COPY[o.stage];
  const finished = o.stage === "delivered" || o.stage === "picked_up" || o.stage === "served";
  const etaMin = o.mode === "delivery" ? 45 : PICKUP_MINUTES;
  const eta = o.pickupAt ? clockOf(o.pickupAt, lang) : etaClock(o.createdAt, etaMin, lang);

  return (
    <div className="min-h-dvh bg-bg pb-16">
      {header}
      <main className="mx-auto grid max-w-xl gap-4 px-4 pt-4">
        {/* status hero */}
        <section className={cn("relative overflow-hidden rounded-[28px] p-5 text-white shadow-sf-lg", o.stage === "cancelled" ? "bg-[linear-gradient(150deg,#8f2a1c,#4a140d)]" : "bg-[linear-gradient(150deg,#0d5a53,#062b27)]")}>
          <div className="pointer-events-none absolute -end-10 -top-10 size-48 rounded-full bg-white/8" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-white/75">
                {L("طلب", "Order")} <span className="num">#{o.number}</span> · {o.mode === "delivery" ? L("توصيل", "Delivery") : L("تيك أواي", "Takeaway")}
              </p>
              <h1 className="mt-1 text-[28px] leading-tight">{L(c.ar, c.en)}</h1>
              {!finished && o.stage !== "cancelled" ? (
                <p className="mt-1.5 text-[14px] text-white/85">
                  {o.mode === "delivery" ? L("هيوصلك حوالي", "Arriving around") : L("جاهز حوالي", "Ready around")} <span className="num font-bold">{eta}</span>
                </p>
              ) : null}
            </div>
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-white/12 [&_svg]:size-7">{c.icon}</span>
          </div>
        </section>

        {/* online payment pending */}
        {wantsOnline && due > 0 && pay.available && o.stage !== "cancelled" ? (
          <section className="flex items-center gap-3 rounded-[22px] border border-brass/40 bg-brass-soft p-4">
            <Smartphone className="size-6 shrink-0 text-brass-text" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold text-brass-text">{L("الطلب مستني الدفع", "Waiting for payment")}</p>
              <p className="text-[12.5px] text-muted">{L("ادفع أونلاين أو ادفع عند الاستلام", "Pay online, or pay on arrival")}</p>
            </div>
            <Button variant="brass" loading={pay.state.s === "creating" || pay.state.s === "verifying"} onClick={() => void pay.start({ purpose: "order", checkId: o.checkId, orderId: o.orderId, tableCode: null, amount: due, tip: 0, currency: venue.currency, splitLabel: `#${o.number}`, customer: o.customer, lang })}>
              {L("ادفع", "Pay")} {formatMoney(due, { lang, compact: true })}
            </Button>
          </section>
        ) : null}

        <section className="rounded-[24px] border border-line bg-surface p-5 shadow-sf-sm">
          <Timeline
            mode={o.mode}
            qr={o.qr}
            stage={o.stage}
            extra={{
              out_for_delivery: o.stage === "out_for_delivery" ? (
                <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
                  <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-ink">
                    <Bike className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-bold">{o.driver?.name ?? L("الطيار", "Your driver")}</p>
                    <p className="num text-[12.5px] text-muted" dir="ltr">{o.driver?.phone ?? "—"}</p>
                  </div>
                  {o.driver?.phone ? (
                    <>
                      <a href={`tel:${o.driver.phone}`} aria-label={L("كلّم الطيار", "Call driver")} className="grid size-11 place-items-center rounded-full bg-ok text-white">
                        <Phone className="size-5" />
                      </a>
                      <a href={`https://wa.me/${o.driver.phone.replace(/^0/, "20")}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="grid size-11 place-items-center rounded-full border border-line">
                        <MessageCircle className="size-5" />
                      </a>
                    </>
                  ) : null}
                </div>
              ) : undefined,
              ready: o.mode === "takeaway" && venue.branch ? (
                <a href={`https://maps.google.com/?q=${encodeURIComponent(loc(venue.branch.address))}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px] font-semibold">
                  <Store className="size-4 text-primary" />
                  {loc(venue.branch.name)} — {loc(venue.branch.address)}
                </a>
              ) : undefined,
            }}
          />
        </section>

        {o.delivery ? (
          <section className="flex items-start gap-3 rounded-[22px] border border-line bg-surface p-4 text-[14px]">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">{o.delivery.address}</p>
              <p className="text-[13px] text-muted">{[o.delivery.area, o.delivery.notes].filter(Boolean).join(" · ")}</p>
            </div>
          </section>
        ) : null}

        <section className="rounded-[24px] border border-line bg-surface p-5">
          <p className="mb-3 text-[16px] font-bold">{L("الطلب", "Items")}</p>
          <ul className="mb-4 grid gap-2 text-[14px]">
            {o.items.map((i, k) => (
              <li key={k} className="flex items-start justify-between gap-3">
                <span>
                  <span className="num text-muted">{i.qty}× </span>
                  {loc(i.name)}
                  {i.modifiers.length ? <span className="block text-[12px] text-muted">{i.modifiers.map(loc).join(" · ")}</span> : null}
                </span>
                <Money value={i.unit * i.qty} />
              </li>
            ))}
          </ul>
          <TotalsList totals={o.totals} vatRate={venue.tax.vatRate} />
          <div className="mt-3">{o.totals.paid >= o.totals.total && o.totals.total > 0 ? <Badge tone="ok">{L("مدفوع ✓", "Paid ✓")}</Badge> : <Badge tone="neutral">{wantsOnline ? L("أونلاين", "Online") : L("الدفع عند الاستلام", "Pay on arrival")}</Badge>}</div>
        </section>

        {pay.state.s === "done" ? (
          <ReceiptCard
            r={{ restaurant: menu.restaurant.name, branch: menu.branch?.name ?? null, table: null, orderNo: o.number, at: new Date().toISOString(), reference: pay.state.intent.reference, method: L("أونلاين", "Online"), splitLabel: null, amount: pay.state.intent.amount, tip: pay.state.intent.tip, lines: o.items.map((i) => ({ name: i.name, qty: i.qty, total: i.unit * i.qty })) }}
          />
        ) : null}

        {finished ? (
          <>
            <FeedbackCard svc={svc} slug={slug} orderId={o.orderId} checkId={o.checkId} />
            <LoyaltyCard svc={svc} slug={slug} checkId={o.checkId} defaultName={o.customer?.name} defaultPhone={o.customer?.phone} />
          </>
        ) : null}

        <p className="text-center text-[12.5px] text-muted">
          {L("محتاج حاجة؟", "Need anything?")}{" "}
          {venue.phone ? (
            <a className="font-semibold text-primary" href={`tel:${venue.phone}`}>
              <span className="num" dir="ltr">{venue.phone}</span>
            </a>
          ) : null}
        </p>
      </main>
    </div>
  );
}

function clockOf(iso: string, lang: "ar" | "en") {
  return new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" });
}
function etaClock(fromIso: string, minutes: number, lang: "ar" | "en") {
  return clockOf(new Date(Date.parse(fromIso) + minutes * 60_000).toISOString(), lang);
}
