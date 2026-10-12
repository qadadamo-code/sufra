/** Screenshot-like mockups of the Sufra system, built as live UI (no images). Sample numbers only. */
import type { ReactNode } from "react";
import { Bot, Check, ChefHat, Clock, CloudOff, Merge, QrCode, Sparkles, Users, Wifi } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { priceBreakdown, egp } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { Photo } from "@/components/sufra/Photo";
import { Money } from "./kit";

export function MockFrame({ title, children, className, dark }: { title: string; children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border shadow-sf", dark ? "border-white/10 bg-[#0f1714] text-[#eef3ef]" : "bg-card", className)} aria-hidden>
      <div className={cn("flex items-center gap-2 border-b px-3 py-2", dark ? "border-white/10" : "bg-surface-2")}>
        <span className="flex gap-1" dir="ltr">
          <i className="size-2.5 rounded-full bg-danger/70" />
          <i className="size-2.5 rounded-full bg-warn/70" />
          <i className="size-2.5 rounded-full bg-ok/70" />
        </span>
        <span className="truncate text-[12px] font-semibold opacity-70">{title}</span>
      </div>
      <div className="p-3 text-[12.5px]">{children}</div>
    </div>
  );
}

export function PosMockup() {
  const { L, lang } = useLang();
  const items = [
    { ar: "كفتة مشوية", en: "Kofta", p: 260, img: "dish-kofta" },
    { ar: "فتة لحمة", en: "Fatta", p: 290, img: "dish-fattah" },
    { ar: "حمص", en: "Hummus", p: 85, img: "dish-hummus" },
    { ar: "شيش طاووق", en: "Tawook", p: 230, img: "dish-shish-tawook" },
    { ar: "كنافة", en: "Kunafa", p: 110, img: "dish-kunafa" },
    { ar: "ليمون نعناع", en: "Lemon mint", p: 65, img: "dish-lemonade" },
  ];
  const lines = [{ unitPrice: egp(260), qty: 2 }, { unitPrice: egp(85), qty: 1 }, { unitPrice: egp(65), qty: 3 }];
  const b = priceBreakdown({ lines, mode: "dine-in" });
  return (
    <MockFrame title={L("الكاشير · طاولة 7", "POS · Table 7")}>
      <div className="grid grid-cols-[1fr_44%] gap-3">
        <div>
          <div className="mb-2 flex gap-1 overflow-hidden">
            {[L("الكل", "All"), L("مشويات", "Grills"), L("مقبلات", "Starters"), L("مشروبات", "Drinks")].map((c, i) => (
              <span key={c} className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", i === 1 ? "bg-primary text-primary-foreground" : "bg-muted")}>{c}</span>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {items.map((it) => (
              <div key={it.ar} className="overflow-hidden rounded-lg border bg-background">
                <Photo k={it.img} label={it[lang]} className="aspect-[4/3]" />
                <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                  <span className="truncate text-[11px] font-semibold">{it[lang]}</span>
                  <span className="num text-[10px] text-muted-foreground">{it.p}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col rounded-xl bg-surface-2 p-2">
          {[[L("2× كفتة", "2× Kofta"), egp(520)], [L("1× حمص", "1× Hummus"), egp(85)], [L("3× ليمون", "3× Lemon"), egp(195)]].map(([n, v]) => (
            <div key={n as string} className="flex justify-between gap-2 py-0.5">
              <span className="truncate">{n}</span>
              <Money v={v as number} className="text-[11px]" />
            </div>
          ))}
          <div className="mt-auto grid gap-0.5 border-t pt-1.5 text-[11px] text-muted-foreground">
            <div className="flex justify-between"><span>{L("خدمة 12%", "Service 12%")}</span><Money v={b.service} /></div>
            <div className="flex justify-between"><span>{L("ضريبة 14%", "VAT 14%")}</span><Money v={b.vat} /></div>
          </div>
          <div className="mt-1 flex justify-between font-bold"><span>{L("الإجمالي", "Total")}</span><Money v={b.total} /></div>
          <span className="mt-1.5 grid h-7 place-items-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">{L("ادفع", "Pay")}</span>
        </div>
      </div>
    </MockFrame>
  );
}

/** Floor plan: tables with auto-placed chairs; T9+T10 merged by pushing, their bills merged. */
export function FloorMockup() {
  const { L } = useLang();
  const tables = [
    { id: "T1", x: 20, y: 20, w: 60, h: 40, seats: 4, st: "busy" },
    { id: "T2", x: 110, y: 20, w: 40, h: 40, seats: 2, st: "free", round: true },
    { id: "T3", x: 180, y: 20, w: 60, h: 40, seats: 4, st: "reserved" },
    { id: "T4", x: 20, y: 100, w: 40, h: 40, seats: 2, st: "bill", round: true },
    { id: "T9+T10", x: 100, y: 95, w: 140, h: 50, seats: 10, st: "busy", merged: true },
    { id: "T5", x: 20, y: 175, w: 90, h: 40, seats: 6, st: "free" },
    { id: "T6", x: 150, y: 175, w: 90, h: 40, seats: 6, st: "busy" },
  ];
  const tone: Record<string, string> = { busy: "var(--sf-primary)", free: "var(--sf-ok)", reserved: "var(--sf-brass)", bill: "var(--sf-danger)" };
  const chairs = (t: (typeof tables)[number]) => {
    const out: { x: number; y: number }[] = [];
    if (t.round) {
      for (let i = 0; i < t.seats; i++) {
        const a = (i / t.seats) * Math.PI * 2 - Math.PI / 2;
        out.push({ x: t.x + t.w / 2 + Math.cos(a) * (t.w / 2 + 8), y: t.y + t.h / 2 + Math.sin(a) * (t.h / 2 + 8) });
      }
    } else {
      const per = Math.ceil(t.seats / 2);
      for (let i = 0; i < per; i++) {
        const x = t.x + ((i + 0.5) * t.w) / per;
        out.push({ x, y: t.y - 7 }, { x, y: t.y + t.h + 7 });
      }
    }
    return out.slice(0, t.seats);
  };
  return (
    <MockFrame title={L("محرر الصالة · الدور الأرضي", "Floor editor · Ground floor")}>
      <svg viewBox="0 0 260 235" className="w-full" direction="ltr">
        <defs>
          <pattern id="fl-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="currentColor" strokeOpacity=".07" />
          </pattern>
        </defs>
        <rect width="260" height="235" fill="url(#fl-grid)" />
        {tables.map((t) => (
          <g key={t.id}>
            {chairs(t).map((c, i) => (
              <rect key={i} x={c.x - 5} y={c.y - 4} width="10" height="8" rx="3" fill="var(--muted-foreground)" opacity=".35" />
            ))}
            {t.round ? <circle cx={t.x + t.w / 2} cy={t.y + t.h / 2} r={t.w / 2} fill="var(--card)" stroke={tone[t.st]} strokeWidth="2.5" /> : <rect x={t.x} y={t.y} width={t.w} height={t.h} rx="6" fill="var(--card)" stroke={tone[t.st]} strokeWidth="2.5" strokeDasharray={t.merged ? "5 3" : undefined} />}
            <text x={t.x + t.w / 2} y={t.y + t.h / 2 + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--foreground)" fontFamily="var(--font-mono)">{t.id}</text>
          </g>
        ))}
        <rect x="236" y="138" width="9" height="9" fill="var(--sf-brass)" rx="2" />
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-brass-soft px-2 py-0.5 text-[11px] font-semibold text-accent-foreground"><Merge className="size-3" aria-hidden />{L("T9+T10 اتدمجوا بالزق · الفاتورتين اتدمجوا", "T9+T10 merged by pushing · bills merged")}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{L("الكراسي بتتوزع لوحدها", "Chairs auto-placed")}</span>
      </div>
    </MockFrame>
  );
}

export function ReservationsMockup() {
  const { L } = useLang();
  const hours = ["18", "19", "20", "21", "22", "23"];
  const rows = [
    { t: "T2 · 2", blocks: [{ s: 0.5, e: 2, n: "Laila", c: "primary" }, { s: 3, e: 4.5, n: "—", c: "muted" }] },
    { t: "T4 · 4", blocks: [{ s: 1.5, e: 3.5, n: L("أ. شريف", "Sherif"), c: "primary" }] },
    { t: "T6 · 6", blocks: [{ s: 0, e: 1.5, n: L("منصور", "Mansour"), c: "primary" }, { s: 2.5, e: 4.5, n: L("هشام", "Hesham"), c: "brass" }] },
    { t: "T11+12", blocks: [{ s: 2, e: 5, n: L("عيد ميلاد", "Birthday"), c: "brass" }] },
  ];
  return (
    <MockFrame title={L("الحجوزات · الخميس", "Reservations · Thursday")}>
      <div className="grid grid-cols-[52px_1fr] gap-y-1.5" dir="ltr">
        <span />
        <div className="grid grid-cols-6 text-[10px] text-muted-foreground">
          {hours.map((h) => <span key={h} className="num">{h}:00</span>)}
        </div>
        {rows.map((r) => (
          <div key={r.t} className="contents">
            <span className="num self-center text-[10px] font-semibold">{r.t}</span>
            <div className="relative h-7 rounded-md bg-surface-2">
              {r.blocks.map((b, i) => (
                <span key={i} className={cn("absolute inset-y-0.5 truncate rounded px-1.5 text-[10px] font-semibold leading-6", b.c === "primary" ? "bg-primary text-primary-foreground" : b.c === "brass" ? "bg-brass text-brass-ink" : "border border-dashed")} style={{ left: `${(b.s / 6) * 100}%`, width: `${((b.e - b.s) / 6) * 100}%` }}>
                  {b.n}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-start gap-2 rounded-xl bg-primary-soft p-2 text-primary">
        <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="text-[11.5px] font-semibold">{L("اقتراح: مجموعة 5 أشخاص 20:30 ← T4 + كرسي إضافي (أقل هدر في الكراسي)", "Suggestion: party of 5 at 20:30 → T4 + one chair (least seats wasted)")}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Users className="size-3" aria-hidden />{L("قايمة الانتظار: 3 · أول واحد بيستنى 12 د", "Waitlist: 3 · first waiting 12 min")}</div>
    </MockFrame>
  );
}

export function KdsMockup() {
  const { L } = useLang();
  const tickets = [
    { n: "#1042", t: "T7", m: "04:12", items: [L("2× كفتة", "2× Kofta"), L("1× فتة", "1× Fatta")], late: false },
    { n: "#1043", t: L("توصيل", "Delivery"), m: "09:40", items: [L("3× شاورما", "3× Shawarma"), L("بطاطس", "Fries")], late: true },
    { n: "#1044", t: "T3", m: "01:05", items: [L("مشويات مشكلة", "Mixed grill")], late: false },
  ];
  return (
    <MockFrame title={L("شاشة المطبخ · المشويات", "Kitchen display · Grill")} dark>
      <div className="grid grid-cols-3 gap-2">
        {tickets.map((k) => (
          <div key={k.n} className="overflow-hidden rounded-lg bg-white/5">
            <div className={cn("flex items-center justify-between px-2 py-1 text-[11px] font-bold", k.late ? "bg-[#e5664f] text-white" : "bg-[#e2a93c] text-[#241703]")}>
              <span className="num">{k.n}</span>
              <span className="num">{k.m}</span>
            </div>
            <div className="grid gap-1 p-2">
              <span className="text-[10px] opacity-70">{k.t}</span>
              {k.items.map((i) => <span key={i} className="text-[11.5px] font-semibold">{i}</span>)}
              <span className="mt-1 grid h-6 place-items-center rounded bg-[#3db3a3] text-[10px] font-bold text-[#04201c]">{L("جاهز", "Bump")}</span>
            </div>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}

export function QrMenuMockup() {
  const { L, lang } = useLang();
  const items = [
    { ar: "حمص بالطحينة", en: "Hummus", p: 85, img: "dish-hummus" },
    { ar: "كفتة مشوية", en: "Grilled kofta", p: 260, img: "dish-kofta" },
    { ar: "أم علي", en: "Om Ali", p: 95, img: "dish-om-ali" },
  ];
  return (
    <div className="mx-auto w-[220px] rounded-[30px] border-[6px] border-[#16211e] bg-background shadow-sf" aria-hidden>
      <div className="mx-auto mt-1.5 h-1.5 w-14 rounded-full bg-[#16211e]" />
      <div className="p-3">
        <div className="flex items-center justify-between">
          <span className="font-display text-[15px] font-bold">{L("منيو طاولة 7", "Table 7 menu")}</span>
          <QrCode className="size-4 text-primary" />
        </div>
        <div className="mt-2 grid gap-2">
          {items.map((i) => (
            <div key={i.ar} className="flex items-center gap-2 rounded-xl border bg-card p-1.5">
              <Photo k={i.img} label={i[lang]} className="size-11 shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11.5px] font-semibold">{i[lang]}</span>
                <span className="num text-[10.5px] text-muted-foreground">{i.p} {L("ج.م", "EGP")}</span>
              </span>
              <span className="grid size-6 place-items-center rounded-full bg-primary text-[14px] font-bold text-primary-foreground">+</span>
            </div>
          ))}
        </div>
        <span className="mt-3 grid h-8 place-items-center rounded-full bg-brass text-[11.5px] font-bold text-brass-ink">{L("ابعت الطلب للمطبخ · 3", "Send to kitchen · 3")}</span>
      </div>
    </div>
  );
}

export function InventoryMockup() {
  const { L } = useLang();
  const rows = [
    { n: L("لحم مفروم", "Minced beef"), q: "180 g", c: egp(70.2) },
    { n: L("بصل", "Onion"), q: "30 g", c: egp(0.54) },
    { n: L("بهارات كفتة", "Kofta spice"), q: "6 g", c: egp(2.28) },
    { n: L("عيش + سلطة", "Bread + salad"), q: "1", c: egp(9) },
  ];
  const total = rows.reduce((s, r) => s + r.c, 0);
  return (
    <MockFrame title={L("الوصفة · كفتة مشوية", "Recipe · Grilled kofta")}>
      <table className="w-full">
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} className="border-b last:border-0">
              <td className="py-1">{r.n}</td>
              <td className="num py-1 text-muted-foreground">{r.q}</td>
              <td className="py-1 text-end"><Money v={r.c} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-surface-2 p-1.5"><span className="block text-[10px] text-muted-foreground">{L("تكلفة", "Cost")}</span><Money v={total} className="font-bold" /></div>
        <div className="rounded-lg bg-surface-2 p-1.5"><span className="block text-[10px] text-muted-foreground">{L("السعر", "Price")}</span><Money v={egp(260)} className="font-bold" /></div>
        <div className="rounded-lg bg-ok-soft p-1.5 text-ok"><span className="block text-[10px]">{L("تكلفة الأكل", "Food cost")}</span><span className="num font-bold">31.6%</span></div>
      </div>
      <p className="mt-2 text-[10.5px] text-muted-foreground">{L("متوسط مرجّح: آخر استلام 390 ج.م/كجم × 12 كجم + رصيد 8 كجم بـ 380", "Weighted average: last receipt 390 EGP/kg × 12 kg + 8 kg on hand at 380")}</p>
    </MockFrame>
  );
}

export function LedgerMockup() {
  const { L } = useLang();
  const rows = [
    { a: L("الخزينة", "Cash"), dr: egp(18500), cr: 0 },
    { a: L("المبيعات", "Sales"), dr: 0, cr: egp(14445.6) },
    { a: L("خدمة مستحقة", "Service payable"), dr: 0, cr: egp(1733.47) },
    { a: L("ضريبة قيمة مضافة مستحقة", "VAT payable"), dr: 0, cr: egp(2320.93) },
  ];
  return (
    <MockFrame title={L("دفتر اليومية · قيد Z-0193", "Journal · entry Z-0193")}>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1">
        <span className="text-[10.5px] font-semibold text-muted-foreground">{L("الحساب", "Account")}</span>
        <span className="text-end text-[10.5px] font-semibold text-muted-foreground">{L("مدين", "Dr")}</span>
        <span className="text-end text-[10.5px] font-semibold text-muted-foreground">{L("دائن", "Cr")}</span>
        {rows.map((r) => (
          <div key={r.a} className="contents">
            <span className={cn("truncate", r.cr && "ps-3")}>{r.a}</span>
            <span className="text-end">{r.dr ? <Money v={r.dr} /> : "—"}</span>
            <span className="text-end">{r.cr ? <Money v={r.cr} /> : "—"}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-ok-soft px-2 py-1 text-[11px] font-semibold text-ok"><Check className="size-3.5" aria-hidden />{L("القيد متوازن: مدين = دائن", "Balanced: debits = credits")}</div>
    </MockFrame>
  );
}

export function ReceiptMockup() {
  const { L } = useLang();
  const b = priceBreakdown({ lines: [{ unitPrice: egp(260), qty: 2 }, { unitPrice: egp(85), qty: 1 }], mode: "dine-in" });
  return (
    <div className="mx-auto w-[230px] rounded-b-xl bg-[#f6f3ea] p-4 font-mono text-[11px] text-[#24302b] shadow-sf [clip-path:polygon(0_6px,6%_0,12%_6px,18%_0,24%_6px,30%_0,36%_6px,42%_0,48%_6px,54%_0,60%_6px,66%_0,72%_6px,78%_0,84%_6px,90%_0,96%_6px,100%_0,100%_100%,0_100%)]" aria-hidden>
      <p className="text-center font-display text-[15px] font-bold">{L("سُفرة · الزمالك", "Sufra · Zamalek")}</p>
      <p className="text-center text-[10px] opacity-70">{L("إيصال إلكتروني مبسّط · RC v1.2", "Simplified e-receipt · RC v1.2")}</p>
      <div className="my-2 border-t border-dashed border-[#8a9189]" />
      <div className="grid gap-0.5">
        <div className="flex justify-between"><span>{L("2× كفتة", "2× Kofta")}</span><Money v={egp(520)} /></div>
        <div className="flex justify-between"><span>{L("1× حمص", "1× Hummus")}</span><Money v={egp(85)} /></div>
        <div className="flex justify-between opacity-75"><span>{L("خدمة 12%", "Service 12%")}</span><Money v={b.service} /></div>
        <div className="flex justify-between opacity-75"><span>{L("ضريبة 14%", "VAT 14%")}</span><Money v={b.vat} /></div>
      </div>
      <div className="my-2 border-t border-dashed border-[#8a9189]" />
      <div className="flex justify-between text-[13px] font-bold"><span>{L("الإجمالي", "Total")}</span><Money v={b.total} /></div>
      <svg viewBox="0 0 21 21" className="mx-auto mt-3 size-24" shapeRendering="crispEdges">
        {Array.from({ length: 21 * 21 }, (_, i) => {
          const x = i % 21;
          const y = Math.floor(i / 21);
          const f = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
          const fx = x < 7 ? x : x - 14;
          const fy = y < 7 ? y : y - 14;
          const on = f ? fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx > 1 && fx < 5 && fy > 1 && fy < 5) : ((x * 7 + y * 13 + x * y) % 5) < 2;
          return on ? <rect key={i} x={x} y={y} width="1" height="1" fill="#24302b" /> : null;
        })}
      </svg>
      <p className="mt-2 break-all text-center text-[9px] opacity-70" dir="ltr">UUID 7f3c2a…e91a · prev 51d0…a7c4</p>
    </div>
  );
}

export function ZReportMockup() {
  const { L } = useLang();
  return (
    <MockFrame title={L("تقرير Z · الوردية المسائية", "Z-report · evening shift")}>
      <div className="grid grid-cols-2 gap-1.5">
        {[[L("مبيعات صافية", "Net sales"), egp(48210)], [L("خدمة", "Service"), egp(5785.2)], [L("ضريبة", "VAT"), egp(7559.33)], [L("خصومات", "Discounts"), egp(1240)]].map(([k, v]) => (
          <div key={k as string} className="rounded-lg bg-surface-2 p-1.5">
            <span className="block text-[10px] text-muted-foreground">{k}</span>
            <Money v={v as number} className="font-semibold" />
          </div>
        ))}
      </div>
      <div className="mt-2 rounded-lg border p-2">
        <div className="flex justify-between"><span>{L("المتوقع في الدرج", "Expected in drawer")}</span><Money v={egp(19800)} /></div>
        <div className="flex justify-between"><span>{L("المعدود", "Counted")}</span><Money v={egp(19750)} /></div>
        <div className="flex justify-between font-bold text-warn"><span>{L("عجز", "Short")}</span><Money v={-egp(50)} /></div>
      </div>
    </MockFrame>
  );
}

export function VatReturnMockup() {
  const { L } = useLang();
  return (
    <MockFrame title={L("إقرار القيمة المضافة · سبتمبر", "VAT return · September")}>
      <div className="grid gap-1">
        {[[L("ضريبة المخرجات (مبيعات)", "Output VAT (sales)"), egp(212480)], [L("ضريبة المدخلات (مشتريات)", "Input VAT (purchases)"), -egp(61230)], [L("الصافي المستحق", "Net payable"), egp(151250)]].map(([k, v], i) => (
          <div key={k as string} className={cn("flex justify-between rounded-lg px-2 py-1", i === 2 ? "bg-primary text-primary-foreground font-bold" : "bg-surface-2")}>
            <span>{k}</span>
            <Money v={v as number} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-muted-foreground">{L("آخر ميعاد للتقديم: نهاية الشهر التالي · مطابق للإيصالات الإلكترونية", "Due by end of next month · reconciled to e-receipts")}</p>
    </MockFrame>
  );
}

export function AiMockup() {
  const { L } = useLang();
  return (
    <MockFrame title={L("مساعد سُفرة الذكي", "Sufra AI assistant")}>
      <div className="grid gap-2">
        <div className="ms-auto max-w-[85%] rounded-2xl rounded-ee-sm bg-primary px-3 py-1.5 text-primary-foreground">{L("إيه أكتر صنف بيخسّرنا الأسبوع ده؟", "Which dish lost us the most this week?")}</div>
        <div className="flex max-w-[92%] gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brass-soft text-brass"><Bot className="size-3.5" aria-hidden /></span>
          <div className="rounded-2xl rounded-ss-sm bg-surface-2 px-3 py-1.5">{L("ستيك الريب آي: تكلفة الأكل 41% بعد زيادة سعر اللحمة 6%. أقترح ترفع السعر لـ 740 ج.م أو تغيّر المورّد — عندي عرضين أرخص.", "Rib-eye: food cost 41% after beef went up 6%. Raise it to EGP 740 or switch supplier — I found two cheaper offers.")}</div>
        </div>
      </div>
    </MockFrame>
  );
}

export function BranchesMockup() {
  const { L } = useLang();
  const rows = [
    { n: L("الزمالك", "Zamalek"), s: 48210, d: 6 },
    { n: L("المعادي", "Maadi"), s: 39880, d: -3 },
    { n: L("التجمع", "New Cairo"), s: 52740, d: 11 },
  ];
  const max = Math.max(...rows.map((r) => r.s));
  return (
    <MockFrame title={L("كل الفروع · النهارده", "All branches · today")}>
      <div className="grid gap-2">
        {rows.map((r) => (
          <div key={r.n} className="grid grid-cols-[70px_1fr_auto] items-center gap-2">
            <span className="truncate font-semibold">{r.n}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${(r.s / max) * 100}%` }} /></span>
            <span className={cn("num text-[11px]", r.d >= 0 ? "text-ok" : "text-danger")} dir="ltr">{r.d >= 0 ? "+" : ""}{r.d}%</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {[L("مالك", "Owner"), L("مدير", "Manager"), L("كاشير", "Cashier"), L("مطبخ", "Kitchen")].map((r, i) => (
          <span key={r} className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", i === 0 ? "bg-primary-soft text-primary" : "bg-muted")}>{r}</span>
        ))}
      </div>
    </MockFrame>
  );
}

export function OfflineMockup() {
  const { L } = useLang();
  return (
    <MockFrame title={L("وضع بدون نت", "Offline mode")}>
      <div className="flex items-center gap-2 rounded-lg bg-warn-soft px-2 py-1.5 text-warn"><CloudOff className="size-4" aria-hidden /><span className="font-semibold">{L("النت فاصل · الكاشير شغال عادي", "Offline · POS keeps working")}</span></div>
      <div className="mt-2 grid gap-1">
        <div className="flex justify-between"><span>{L("فواتير مستنية مزامنة", "Bills awaiting sync")}</span><span className="num font-bold">14</span></div>
        <div className="flex justify-between"><span>{L("إيصالات ETA في الطابور", "ETA receipts queued")}</span><span className="num font-bold">14</span></div>
        <div className="flex justify-between text-muted-foreground"><span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden />{L("أقدم إيصال", "Oldest")}</span><span className="num">00:42 / 24:00</span></div>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-ok"><Wifi className="size-3.5" aria-hidden />{L("هيتبعتوا أول ما النت يرجع", "Sent as soon as you're back online")}</div>
    </MockFrame>
  );
}

export function PurchasingMockup() {
  const { L } = useLang();
  return (
    <MockFrame title={L("اطلب من الموردين", "Order from suppliers")}>
      <div className="grid gap-1.5">
        {[[L("طماطم · قفص 20 كجم", "Tomatoes · 20 kg"), L("وادي النيل", "Nile Valley"), egp(325), true], [L("طماطم · قفص 20 كجم", "Tomatoes · 20 kg"), L("العبور", "Obour Greens"), egp(348), false], [L("طماطم · قفص 20 كجم", "Tomatoes · 20 kg"), L("الريف الطازج", "Rif Fresh"), egp(361), false]].map(([n, s, p, best], i) => (
          <div key={i} className={cn("flex items-center justify-between gap-2 rounded-lg border px-2 py-1", best ? "border-primary bg-primary-soft" : "")}>
            <span className="min-w-0"><span className="block truncate font-semibold">{s as string}</span><span className="block truncate text-[10.5px] text-muted-foreground">{n as string}</span></span>
            <Money v={p as number} className="font-semibold" />
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><ChefHat className="size-3.5" aria-hidden />{L("الاستلام بيزوّد المخزن ويحدّث متوسط التكلفة", "Receiving updates stock & average cost")}</div>
    </MockFrame>
  );
}
