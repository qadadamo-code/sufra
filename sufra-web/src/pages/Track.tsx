import { useEffect, useMemo, useRef, useState } from "react";
import { Bike, Receipt, RotateCcw } from "lucide-react";
import { TaskSteps, type TaskStep } from "@/components/ui/task-steps";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SufraMap } from "@/components/sufra/map/SufraMap";
import { BreakdownTable } from "@/components/sufra/Breakdown";
import { Photo } from "@/components/sufra/Photo";
import { byId, itemIndex, serviceRateOf } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { formatMoney } from "@/lib/pricing";
import { navigate } from "@/lib/router";
import { cartAdd, cartClear, useAccount, useHome } from "@/lib/store";
import { setUI } from "@/lib/ui-state";

export default function Track({ id }: { id: string }) {
  const { L, lang } = useLang();
  const acc = useAccount();
  const { home } = useHome();
  const order = acc?.orders.find((o) => o.id === id);
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const iv = window.setInterval(() => setT(Date.now()), 500);
    return () => window.clearInterval(iv);
  }, []);
  const r = order ? byId[order.rid] : null;

  const steps: TaskStep[] = useMemo(() => {
    if (!order) return [];
    const m = order.mode;
    const labels =
      m === "delivery"
        ? [L("المطعم استلم الطلب", "Order received"), L("بيتحضّر في المطبخ", "Preparing in the kitchen"), L("المندوب في الطريق", "On the way"), L("وصل — بالهنا والشفا", "Delivered — enjoy!")]
        : m === "pickup"
          ? [L("المطعم استلم الطلب", "Order received"), L("بيتحضّر في المطبخ", "Preparing in the kitchen"), L("جاهز للاستلام", "Ready for pickup"), L("اتسلّم", "Picked up")]
          : [L("المطعم استلم الطلب", "Order received"), L("بيتحضّر في المطبخ", "Preparing in the kitchen"), L("في الطريق لترابيزتك", "Coming to your table"), L("اتقدّم — بالهنا", "Served — enjoy!")];
    return labels.map((label, i) => ({ id: String(i), label, meta: order.seeded ? undefined : `${(i + 1) * order.stepSec}s` }));
  }, [order, L]);

  const elapsed = order ? (t - order.createdAt) / 1000 : 0;
  const current = order ? (order.seeded ? steps.length : Math.min(steps.length, 1 + Math.floor(elapsed / order.stepSec))) : 0;
  const lastNotified = useRef<number | null>(null);
  useEffect(() => {
    if (!order || order.seeded) return;
    if (lastNotified.current === null) {
      lastNotified.current = current;
      return;
    }
    if (current > lastNotified.current) {
      lastNotified.current = current;
      const label = current >= steps.length ? steps[steps.length - 1].label : steps[current].label;
      notify({ title: label, detail: r ? r[lang] : undefined, icon: "bell", tone: current >= steps.length ? "brass" : "primary" });
    }
  }, [current, order, steps, r, lang]);

  if (!order || !r) {
    return (
      <div className="wrap gutter grid min-h-[50vh] place-items-center text-center">
        <div>
          <p className="font-display text-3xl font-bold">{L("مش لاقيين الطلب ده", "We can't find that order")}</p>
          <a href="#/account?tab=history" className="sf-btn sf-btn-primary mt-5">{L("طلباتي", "My orders")}</a>
        </div>
      </div>
    );
  }

  const totalSec = steps.length * order.stepSec;
  const pct = order.seeded ? 100 : Math.min(100, (elapsed / totalSec) * 100);
  const done = current >= steps.length;
  // courier glides from the restaurant to home while "on the way"
  const travelP = order.mode === "delivery" ? Math.max(0, Math.min(1, (elapsed - 2 * order.stepSec) / order.stepSec)) : 0;
  const courier = { lat: r.lat + (home.lat - r.lat) * (order.seeded ? 1 : travelP), lng: r.lng + (home.lng - r.lng) * (order.seeded ? 1 : travelP) };
  const reorder = () => {
    cartClear();
    order.lines.forEach((l) => cartAdd(r.id, l.itemId, l.qty));
    setUI({ cartOpen: true });
  };

  return (
    <div className="wrap gutter pb-16 pt-6">
      <p className="sf-kicker">{L("تتبّع الطلب", "Order tracking")} · <span className="num">#{order.id.slice(-6).toUpperCase()}</span></p>
      <h1 className="text-[32px] font-bold sm:text-[44px]">{done ? L("الطلب خلص", "All done") : L("طلبك في السكة", "Your order is moving")}</h1>
      <p className="text-muted-foreground">
        {r[lang]} · {new Date(order.createdAt).toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}
      </p>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="grid content-start gap-6">
          <section className="sf-card p-5 sm:p-6">
            <ProgressBar value={pct} label={done ? L("خلص", "Complete") : L("التقدّم", "Progress")} pendingLabel={L("بنجهّز", "Preparing")} completeLabel={L("خلص", "Complete")} />
            <TaskSteps steps={steps} current={current} label={L("مراحل الطلب", "Order steps")} className="mt-5" />
            {!order.seeded && !done ? <p className="mt-4 text-xs text-muted-foreground">{L("نسخة تجريبية: المراحل متسرّعة (كل مرحلة ثواني).", "Demo: stages are sped up (seconds each).")}</p> : null}
          </section>
          {order.mode === "delivery" ? (
            <section aria-label={L("خريطة التوصيل", "Delivery map")}>
              <SufraMap
                points={[
                  { id: "rest", lat: r.lat, lng: r.lng, label: r[lang], tone: "open" },
                  ...(current >= 3 && !done ? [{ id: "courier", lat: courier.lat, lng: courier.lng, label: L("المندوب", "Courier"), tone: "courier" as const }] : []),
                ]}
                selectedId={current >= 3 && !done ? "courier" : "rest"}
                origin={home}
                user={null}
                path={[{ lat: r.lat, lng: r.lng }, home]}
                fit
                legend={false}
                className="h-[320px]"
                ariaLabel={L("خريطة التوصيل", "Delivery map")}
              />
              <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Bike className="size-4 text-brass" aria-hidden />
                {order.address}
              </p>
            </section>
          ) : null}
        </div>
        <aside className="sf-card self-start p-5">
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <Receipt className="size-5 text-brass" aria-hidden />
            {L("الفاتورة", "Receipt")}
          </h2>
          <ul className="mt-3 divide-y">
            {order.lines.map((l) => {
              const it = itemIndex[l.itemId]?.item;
              return (
                <li key={l.itemId} className="flex items-center gap-3 py-2.5">
                  <Photo k={it?.img} label={it ? it[lang] : "?"} className="size-11 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="num">{l.qty}×</span> {it ? it[lang] : l.itemId}
                  </span>
                  <span className="num text-sm">{formatMoney(l.unit * l.qty, lang)}</span>
                </li>
              );
            })}
          </ul>
          <BreakdownTable b={order.breakdown} serviceRate={serviceRateOf(r)} className="mt-3" />
          {order.code ? <p className="mt-2 text-xs text-ok">{L("كود مستخدم:", "Code used:")} <span className="num">{order.code}</span></p> : null}
          <p className="mt-1 text-xs text-muted-foreground">{order.payment === "cash" ? L("الدفع كاش", "Paying cash") : L("الدفع بالكارت عند الاستلام", "Paying by card on delivery")}</p>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={reorder} className="sf-btn sf-btn-ghost flex-1 bg-card">
              <RotateCcw className="size-4" aria-hidden />
              {L("اطلبه تاني", "Reorder")}
            </button>
            <button type="button" onClick={() => navigate(`/r/${r.slug}`)} className="sf-btn sf-btn-primary flex-1">{L("صفحة المطعم", "Restaurant")}</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
