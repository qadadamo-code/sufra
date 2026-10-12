import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { applyRate } from "@/lib/pricing";
import { BarChart } from "@/components/business/charts";
import { Card, Field, Money, Segmented, Stat } from "@/components/business/kit";
import { yearOfDays } from "@/data/business/demo";

type RangeId = "today" | "7" | "30" | "90" | "365" | "custom";

/** Sum a slice of days into report totals (piastres). Service 12% applies to the dine-in share (assumed 70%). */
export function summarize(days: { orders: number; covers: number; sales: number }[]) {
  const sales = days.reduce((s, d) => s + d.sales, 0);
  const orders = days.reduce((s, d) => s + d.orders, 0);
  const covers = days.reduce((s, d) => s + d.covers, 0);
  const service = applyRate(applyRate(sales, 7000), 1200);
  const vat = applyRate(sales + service, 1400);
  return { sales, orders, covers, service, vat, avgTicket: orders ? Math.round(sales / orders) : 0 };
}

export default function Reports() {
  const { L, lang } = useLang();
  const year = useMemo(() => yearOfDays(), []);
  const [range, setRange] = useState<RangeId>("30");
  const [from, setFrom] = useState(year[year.length - 14].date);
  const [to, setTo] = useState(year[year.length - 1].date);
  const slice = useMemo(() => {
    if (range === "custom") {
      const [a, b] = from <= to ? [from, to] : [to, from];
      return year.filter((d) => d.date >= a && d.date <= b);
    }
    const n = range === "today" ? 1 : Number(range);
    return year.slice(-n);
  }, [range, from, to, year]);
  const prev = useMemo(() => {
    const n = slice.length;
    const start = year.indexOf(slice[0]);
    return year.slice(Math.max(0, start - n), start);
  }, [slice, year]);
  const s = summarize(slice);
  const p = summarize(prev);
  const delta = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : 0);
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short" });

  // weekly buckets when the range is long, so bars stay readable
  const bars = useMemo(() => {
    if (slice.length <= 45) return slice.map((d) => ({ key: d.date, label: d.date, value: d.sales, tip: `${fmt(d.date)} · ${(d.sales / 100).toLocaleString("en-US")} ${L("ج.م", "EGP")}` }));
    const out: { key: string; label: string; value: number; tip: string }[] = [];
    for (let i = 0; i < slice.length; i += 7) {
      const w = slice.slice(i, i + 7);
      const v = w.reduce((a, d) => a + d.sales, 0);
      out.push({ key: w[0].date, label: w[0].date, value: v, tip: `${fmt(w[0].date)} – ${fmt(w[w.length - 1].date)} · ${(v / 100).toLocaleString("en-US")} ${L("ج.م", "EGP")}` });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice, lang]);

  const csv = () => {
    const rows = [["date", "orders", "covers", "sales_egp"], ...slice.map((d) => [d.date, d.orders, d.covers, (d.sales / 100).toFixed(2)])];
    const blob = new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sufra-sales-${slice[0].date}-${slice[slice.length - 1].date}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Segmented
          label={L("الفترة", "Range")}
          value={range}
          onChange={setRange}
          options={[
            { id: "today", label: L("النهارده", "Today") },
            { id: "7", label: L("7 أيام", "7 days") },
            { id: "30", label: L("30 يوم", "30 days") },
            { id: "90", label: L("90 يوم", "90 days") },
            { id: "365", label: L("السنة", "Year") },
            { id: "custom", label: L("مخصص", "Custom") },
          ]}
        />
        <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm" onClick={csv}>
          <Download className="size-4" aria-hidden />
          CSV
        </button>
      </div>
      {range === "custom" ? (
        <div className="grid max-w-md grid-cols-2 gap-3">
          <Field label={L("من", "From")}><input type="date" className="sf-input num" dir="ltr" value={from} min={year[0].date} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label={L("لحد", "To")}><input type="date" className="sf-input num" dir="ltr" value={to} min={from} max={year[year.length - 1].date} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          { l: L("المبيعات (قبل الضريبة)", "Sales (pre-VAT)"), v: <Money v={s.sales} />, d: delta(s.sales, p.sales) },
          { l: L("الطلبات", "Orders"), v: <span className="num">{s.orders.toLocaleString("en-US")}</span>, d: delta(s.orders, p.orders) },
          { l: L("الضيوف", "Covers"), v: <span className="num">{s.covers.toLocaleString("en-US")}</span>, d: delta(s.covers, p.covers) },
          { l: L("متوسط الفاتورة", "Avg ticket"), v: <Money v={s.avgTicket} />, d: delta(s.avgTicket, p.avgTicket) },
          { l: L("خدمة 12%", "Service 12%"), v: <Money v={s.service} />, d: null },
          { l: L("ضريبة 14%", "VAT 14%"), v: <Money v={s.vat} />, d: null },
        ].map((k) => (
          <Card key={k.l} className="p-4">
            <Stat label={k.l} value={k.v} sub={k.d === null || !prev.length ? undefined : <span dir="ltr" className="num">{k.d >= 0 ? "+" : ""}{k.d}% {L("عن الفترة اللي قبلها", "vs previous")}</span>} tone={k.d === null ? undefined : k.d >= 0 ? "ok" : "danger"} />
          </Card>
        ))}
      </div>
      <Card>
        <h3 className="mb-3 font-sans text-[15px] font-semibold">{slice.length > 45 ? L("المبيعات أسبوعيًا", "Weekly sales") : L("المبيعات يوميًا", "Daily sales")}</h3>
        <BarChart data={bars} height={200} highlightLast ariaLabel={L("مخطط المبيعات", "Sales chart")} axis={{ first: fmt(slice[0].date), last: fmt(slice[slice.length - 1].date) }} />
      </Card>
      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[14px]">
            <caption className="sr-only">{L("تفاصيل الأيام", "Daily breakdown")}</caption>
            <thead>
              <tr className="border-b text-[12px] text-muted-foreground">
                <th scope="col" className="p-3 text-start">{L("اليوم", "Day")}</th>
                <th scope="col" className="p-3 text-end">{L("طلبات", "Orders")}</th>
                <th scope="col" className="p-3 text-end">{L("ضيوف", "Covers")}</th>
                <th scope="col" className="p-3 text-end">{L("مبيعات", "Sales")}</th>
              </tr>
            </thead>
            <tbody>
              {[...slice].reverse().slice(0, 14).map((d) => (
                <tr key={d.date} className="border-b last:border-0">
                  <td className="p-3">{new Date(d.date + "T00:00:00").toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "short" })}</td>
                  <td className="num p-3 text-end">{d.orders}</td>
                  <td className="num p-3 text-end">{d.covers}</td>
                  <td className="p-3 text-end"><Money v={d.sales} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {slice.length > 14 ? <p className="border-t p-3 text-[12px] text-muted-foreground">{L(`آخر 14 يوم من ${slice.length} — نزّل CSV للكل`, `Last 14 of ${slice.length} days — download CSV for all`)}</p> : null}
      </Card>
    </div>
  );
}
