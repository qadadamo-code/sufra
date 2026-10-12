import { useMemo, useState } from "react";
import { ArrowUpRight, Banknote, ChefHat, Clock, FileCheck2, LayoutGrid, Percent, ReceiptText, RotateCcw, Star, TrendingUp, Users, AlertTriangle, CalendarDays, PackageOpen, Pencil, Check } from "lucide-react";
import { Blobatar } from "@blobatar/react";
import { useLang } from "@/lib/i18n";
import { load, save } from "@/lib/storage";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { DraggableWidgetGrid, type WidgetItem, type WidgetSize } from "@/components/business/DraggableWidgetGrid";
import { ContributionSkyline } from "@/components/business/ContributionSkyline";
import { BarChart, Meter } from "@/components/business/charts";
import { Money, Pill } from "@/components/business/kit";
import { MatteAlertFeedback } from "@/components/ui/matte-stack-feedback";
import { CASH_DRAWER, ERECEIPTS, FLOOR, FLOOR_DEMO_URL, HOURLY_TODAY, LOW_STOCK, MENU, RESERVATIONS_TODAY, REVIEWS, STAFF, TOP_DISHES, yearOfDays, ROLE_NAMES } from "@/data/business/demo";
import { egp } from "@/data/business/plans";

const LAYOUT_KEY = "sufra.biz.layout.v1";
export const DEFAULT_LAYOUT: WidgetItem[] = [
  { id: "sales", size: "wide" },
  { id: "covers", size: "sm" },
  { id: "foodcost", size: "sm" },
  { id: "floor", size: "lg" },
  { id: "reservations", size: "tall" },
  { id: "top", size: "tall" },
  { id: "ereceipts", size: "wide" },
  { id: "vat", size: "sm" },
  { id: "drawer", size: "sm" },
  { id: "stock", size: "wide" },
  { id: "staff", size: "sm" },
  { id: "reviews", size: "sm" },
];

function W({ icon: Icon, title, children, action, className }: { icon: typeof Users; title: string; children: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col p-3.5 sm:p-4", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 font-sans text-[13px] font-semibold text-muted-foreground">
          <Icon className="size-4 shrink-0 text-primary" aria-hidden />
          <span className="truncate">{title}</span>
        </h3>
        {action}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export default function Overview() {
  const { L, lang, dir } = useLang();
  const [layout, setLayout] = useState<WidgetItem[]>(() => {
    const saved = load<WidgetItem[] | null>(LAYOUT_KEY, null);
    if (!saved || saved.length !== DEFAULT_LAYOUT.length || !saved.every((s) => DEFAULT_LAYOUT.some((d) => d.id === s.id))) return DEFAULT_LAYOUT;
    return saved;
  });
  const [gridKey, setGridKey] = useState(0);
  const [editing, setEditing] = useState(true);
  const year = useMemo(() => yearOfDays(), []);
  const today = year[year.length - 1];
  const lastWeek = year[year.length - 8];
  const delta = lastWeek.sales ? Math.round(((today.sales - lastWeek.sales) / lastWeek.sales) * 100) : 0;
  const itemById = useMemo(() => Object.fromEntries(MENU.flatMap((s) => s.items).map((i) => [i.id, i])), []);
  const onShift = STAFF.filter((s) => s.status === "on" || s.status === "break");
  const vatDue = egp(151250);
  const labels: Record<string, string> = {
    sales: L("مبيعات النهارده", "Today's sales"),
    covers: L("الضيوف ودوران الترابيزات", "Covers & turnover"),
    foodcost: L("تكلفة الأكل", "Food cost"),
    floor: L("الصالة دلوقتي", "Live floor"),
    reservations: L("حجوزات النهارده", "Today's reservations"),
    top: L("الأكثر مبيعًا", "Top dishes"),
    ereceipts: L("الإيصالات الإلكترونية", "E-receipts"),
    vat: L("ضريبة الشهر", "VAT this month"),
    drawer: L("درج الكاشير", "Cash drawer"),
    stock: L("نقص المخزون", "Low stock"),
    staff: L("في الوردية", "On shift"),
    reviews: L("التقييمات", "Reviews"),
  };
  const items = layout.map((l) => ({ ...l, label: labels[l.id] }));

  const render = (item: WidgetItem, size: WidgetSize) => {
    const big = size === "lg" || size === "tall";
    switch (item.id) {
      case "sales":
        return (
          <W icon={TrendingUp} title={labels.sales}>
            <div className="flex h-full flex-col">
              <div className="flex items-baseline justify-between gap-2">
                <Money v={today.sales} className="font-display text-[26px] font-bold" />
                <Pill tone={delta >= 0 ? "ok" : "danger"}><span className="num" dir="ltr">{delta >= 0 ? "+" : ""}{delta}%</span></Pill>
              </div>
              <p className="text-[12px] text-muted-foreground">{L("مقارنة بنفس اليوم الأسبوع اللي فات · قبل الضريبة", "vs same day last week · before VAT")}</p>
              <BarChart className="mt-auto pt-2" height={size === "sm" ? 40 : size === "wide" ? 72 : 150} ariaLabel={L("الطلبات بالساعة النهارده", "Orders by hour today")} data={HOURLY_TODAY.slice(8).map((v, i) => ({ key: String(i), label: `${i + 8}`, value: v, tip: `${String(i + 8).padStart(2, "0")}:00 · ${v} ${L("طلب", "orders")}` }))} />
            </div>
          </W>
        );
      case "covers":
        return (
          <W icon={Users} title={labels.covers}>
            <p className="num font-display text-[28px] font-bold">{today.covers}</p>
            <p className="text-[12px] text-muted-foreground">{L("ضيف النهارده", "covers today")}</p>
            <p className="mt-1 text-[13px]"><span className="num font-semibold">2.6×</span> {L("دوران/ترابيزة", "turns/table")}</p>
            <p className="text-[12px] text-muted-foreground"><span className="num">54</span> {L("د متوسط القعدة", "min avg stay")}</p>
          </W>
        );
      case "foodcost":
        return (
          <W icon={Percent} title={labels.foodcost}>
            <p className="num font-display text-[28px] font-bold">31.4%</p>
            <Meter value={31.4} max={45} tone="ok" label={L("تكلفة الأكل 31.4%", "Food cost 31.4%")} className="mt-1" />
            <p className="mt-1.5 text-[12px] text-muted-foreground">{L("الهدف أقل من 33%", "Target under 33%")}</p>
            <p className="text-[12px] text-warn">{L("الستيك 41% ↑", "Steak 41% ↑")}</p>
          </W>
        );
      case "floor":
        return (
          <W icon={LayoutGrid} title={labels.floor} action={<a href={FLOOR_DEMO_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-primary hover:underline">{L("افتح الصالة", "Open floor")}<ArrowUpRight className="size-3.5" aria-hidden /></a>}>
            <div className={cn("grid gap-1.5", size === "lg" ? "grid-cols-5" : "grid-cols-4")} role="list" aria-label={labels.floor}>
              {FLOOR.slice(0, size === "lg" ? 15 : 8).map((t) => (
                <span key={t.id} role="listitem" className={cn("grid aspect-square place-items-center rounded-xl border-2 text-center", t.state === "busy" ? "border-primary bg-primary-soft text-primary" : t.state === "free" ? "border-ok/50 text-ok" : t.state === "reserved" ? "border-brass bg-brass-soft text-accent-foreground" : "border-danger bg-danger-soft text-danger")} title={t.state}>
                  <span className="num text-[12px] font-bold leading-none">{t.id}<span className="block text-[10px] font-normal opacity-70">{t.seats}</span></span>
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]">
              <span className="text-primary">● {L("مشغولة", "Busy")} {FLOOR.filter((t) => t.state === "busy").length}</span>
              <span className="text-ok">● {L("فاضية", "Free")} {FLOOR.filter((t) => t.state === "free").length}</span>
              <span className="text-accent-foreground">● {L("محجوزة", "Reserved")} {FLOOR.filter((t) => t.state === "reserved").length}</span>
              <span className="text-danger">● {L("طالبة الحساب", "Bill asked")} {FLOOR.filter((t) => t.state === "bill").length}</span>
            </div>
          </W>
        );
      case "reservations":
        return (
          <W icon={CalendarDays} title={labels.reservations}>
            <ul className="grid gap-1.5 overflow-hidden">
              {RESERVATIONS_TODAY.slice(0, big ? 6 : 2).map((r) => (
                <li key={r.time + r.name} className="flex items-center gap-2 text-[13px]">
                  <span className="num w-11 shrink-0 font-semibold">{r.time}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"><span className="num">{r.size}</span><Users className="size-3" aria-label={L("أشخاص", "guests")} /></span>
                  <Pill tone={r.status === "seated" ? "primary" : r.status === "confirmed" ? "ok" : r.status === "waitlist" ? "warn" : "brass"} className="shrink-0 px-1.5 text-[10.5px]">
                    {r.status === "seated" ? L("قاعدين", "Seated") : r.status === "confirmed" ? L("مؤكد", "Confirmed") : r.status === "waitlist" ? L("انتظار", "Waitlist") : L("منتظر", "Pending")}
                  </Pill>
                </li>
              ))}
            </ul>
          </W>
        );
      case "top":
        return (
          <W icon={ChefHat} title={labels.top}>
            <ol className="grid gap-2">
              {TOP_DISHES.slice(0, big ? 5 : 2).map((d, i) => {
                const it = itemById[d.id];
                return (
                  <li key={d.id} className="grid gap-1">
                    <div className="flex justify-between gap-2 text-[13px]">
                      <span className="truncate"><span className="num text-brass">{i + 1}</span> {lang === "ar" ? it.ar : it.en}</span>
                      <span className="num shrink-0 font-semibold">{d.qty}</span>
                    </div>
                    <Meter value={d.qty} max={TOP_DISHES[0].qty} label={`${d.qty}`} />
                  </li>
                );
              })}
            </ol>
          </W>
        );
      case "ereceipts": {
        const pct = (ERECEIPTS.oldestPendingMin / (24 * 60)) * 100;
        return (
          <W icon={FileCheck2} title={labels.ereceipts} action={<Pill tone={ERECEIPTS.overdue ? "danger" : "ok"}>{ERECEIPTS.overdue ? L("فيه متأخر", "Overdue") : L("في المعاد", "On time")}</Pill>}>
            <div className="grid grid-cols-4 gap-1.5 text-center">
              {[
                { k: L("مستني", "Pending"), v: ERECEIPTS.pending, t: "text-warn" },
                { k: L("اتبعت", "Submitted"), v: ERECEIPTS.submitted, t: "text-primary" },
                { k: L("مقبول", "Valid"), v: ERECEIPTS.valid, t: "text-ok" },
                { k: L("متأخر", "Overdue"), v: ERECEIPTS.overdue, t: "text-danger" },
              ].map((x) => (
                <div key={x.k} className="rounded-xl bg-surface-2 py-1.5">
                  <p className={cn("num text-[18px] font-bold", x.t)}>{x.v}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{x.k}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 text-[12px] text-muted-foreground">
              <Clock className="size-3.5 shrink-0" aria-hidden />
              <span className="shrink-0">{L("أقدم إيصال", "Oldest")} <span className="num">{ERECEIPTS.oldestPendingMin}</span> {L("د من 24 س", "min of 24 h")}</span>
              <Meter value={pct} max={100} tone={pct > 75 ? "danger" : pct > 50 ? "warn" : "ok"} label={L("المهلة", "Deadline")} className="flex-1" />
            </div>
          </W>
        );
      }
      case "vat":
        return (
          <W icon={ReceiptText} title={labels.vat}>
            <Money v={vatDue} className="font-display text-[22px] font-bold" />
            <p className="text-[12px] text-muted-foreground">{L("صافي مستحق (مخرجات − مدخلات)", "Net payable (output − input)")}</p>
            <p className="mt-1 text-[12px]">{L("الإقرار قبل", "Return due")} <span className="num font-semibold">30/11</span></p>
          </W>
        );
      case "drawer":
        return (
          <W icon={Banknote} title={labels.drawer}>
            <Money v={CASH_DRAWER.expected} className="font-display text-[22px] font-bold" />
            <p className="text-[12px] text-muted-foreground">{L("المتوقع في الدرج", "Expected in drawer")}</p>
            <div className="mt-1 grid text-[11.5px] text-muted-foreground">
              <span>{L("افتتاح", "Float")} <Money v={CASH_DRAWER.opening} /></span>
              <span>{L("مصروفات", "Payouts")} <Money v={-CASH_DRAWER.payouts} /></span>
            </div>
          </W>
        );
      case "stock":
        return (
          <W icon={PackageOpen} title={labels.stock} action={<a href="#/business/dashboard?tab=purchasing" className="text-[12px] font-semibold text-primary hover:underline">{L("اطلب من الموردين", "Order supplies")}</a>}>
            <ul className={cn("grid gap-1.5", size === "lg" || size === "wide" ? "sm:grid-cols-2" : "")}>
              {LOW_STOCK.slice(0, size === "sm" ? 2 : 4).map((s) => (
                <li key={s.key} className="flex items-center gap-2 rounded-xl bg-surface-2 px-2 py-1.5 text-[13px]">
                  <AlertTriangle className="size-3.5 shrink-0 text-warn" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{lang === "ar" ? s.ar : s.en}</span>
                  <span className="num shrink-0 text-[11.5px] text-muted-foreground">{s.left}/{s.par} {lang === "ar" ? s.unitAr : s.unitEn}</span>
                  <a href={`#/business/dashboard?tab=purchasing&key=${s.key}`} className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">{L("اطلب", "Order")}</a>
                </li>
              ))}
            </ul>
          </W>
        );
      case "staff":
        return (
          <W icon={Users} title={labels.staff}>
            <p className="num font-display text-[28px] font-bold">{onShift.length}</p>
            <div className="flex">
              {onShift.slice(0, 5).map((s) => (
                <Blobatar key={s.id} name={s.id} background="circle" className="-ms-2 size-7 rounded-full ring-2 ring-card first:ms-0" aria-hidden />
              ))}
            </div>
            <p className="mt-1 truncate text-[12px] text-muted-foreground">{onShift.filter((s) => s.status === "break").length} {L("في بريك", "on break")} · {ROLE_NAMES.chef[lang]} ✓</p>
          </W>
        );
      case "reviews":
        return (
          <W icon={Star} title={labels.reviews}>
            <p className="flex items-center gap-1"><Star className="size-5 fill-brass text-brass" aria-hidden /><span className="num font-display text-[26px] font-bold">4.6</span></p>
            <p className="text-[12px] text-muted-foreground"><span className="num">318</span> {L("تقييم", "reviews")}</p>
            <p className="mt-1 line-clamp-2 text-[12px]">“{lang === "ar" ? REVIEWS[0].text : REVIEWS[0].textEn}”</p>
          </W>
        );
    }
    return null;
  };

  return (
    <div className="grid gap-6">
      <MatteAlertFeedback
        heading={L("تنبيهات النهارده", "Today's alerts")}
        pill={L("2 جديد", "2 new")}
        text={L("4 خامات تحت الحد الأدنى، و7 إيصالات إلكترونية مستنية تتبعت (أقدمها من 18 دقيقة — قدامها وقت كتير قبل مهلة الـ24 ساعة).", "4 ingredients below par, and 7 e-receipts waiting to be sent (oldest 18 minutes — well inside the 24-hour window).")}
        alertTitle={L("صدور الفراخ هتخلص قبل العشا", "Chicken breast will run out before dinner")}
        alertDetail={L("3.5 كجم فاضلين من 12 — اطلب من دواجن الدلتا قبل الساعة 7.", "3.5 kg left of 12 — order from Delta Poultry before 7 pm.")}
        showLabel={L("اظهر التنبيه", "Show alert")}
        closeLabel={L("اقفل التنبيه", "Dismiss alert")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">{editing ? L("اسحب أي كارت لترتيبه (على الموبايل: اضغط مطوّل). الترتيب بيتحفظ على الجهاز ده.", "Drag any card to rearrange (long-press on touch). Layout is saved on this device.") : L("الترتيب مقفول.", "Layout locked.")}</p>
        <div className="flex gap-2">
          <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm" aria-pressed={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? <Check className="size-4" aria-hidden /> : <Pencil className="size-4" aria-hidden />}
            {editing ? L("خلّصت", "Done") : L("رتّب", "Arrange")}
          </button>
          <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm" onClick={() => { setLayout(DEFAULT_LAYOUT); save(LAYOUT_KEY, DEFAULT_LAYOUT); setGridKey((k) => k + 1); notify({ title: L("رجّعنا الترتيب الأصلي", "Layout reset"), ttl: 2200 }); }}>
            <RotateCcw className="size-4" aria-hidden />
            {L("الترتيب الأصلي", "Reset")}
          </button>
        </div>
      </div>
      <DraggableWidgetGrid
        key={gridKey + dir}
        items={items}
        editable={editing}
        contentDir={dir}
        maxColumns={6}
        cellSize={215}
        gap={12}
        radius={22}
        hint={L("اسحب لإعادة الترتيب. على شاشات اللمس اضغط مطوّل الأول. بالكيبورد: Alt مع الأسهم.", "Drag to rearrange. On touch screens, press and hold first. With a keyboard, hold Alt and press the arrow keys.")}
        onChange={(next) => {
          const clean = next.map(({ id, size }) => ({ id, size }));
          setLayout(clean);
          save(LAYOUT_KEY, clean);
        }}
        renderItem={render}
      />
      <section className="sf-card p-4 sm:p-6" aria-labelledby="sky-h">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="sf-kicker">{L("سنة من الطلبات", "A year of orders")}</p>
            <h2 id="sky-h" className="text-2xl font-bold">{L("كل يوم كام طلب", "Orders, day by day")}</h2>
          </div>
        </div>
        <ContributionSkyline days={year.map((d) => ({ date: d.date, count: d.orders }))} unit={{ one: L("طلب", "order"), other: L("طلب", "orders") }} />
      </section>
    </div>
  );
}
