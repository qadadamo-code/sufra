/** /delivery/reports — channels, zones, hours, prep/ride times, late %, riders, aggregator commission. */
import { useMemo, useState } from "react";
import { BarChart3, Bike, Clock, Hourglass, Percent, Receipt, Star, TimerOff, XCircle } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { Avatar, BarChart, Card, CardHeader, EmptyState, Meter, Money, Segmented, StatTile } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { aggregatorInfo } from "./aggregators";
import { deliveryReport } from "./report";
import { useDeliveryData } from "./useDelivery";
import { CHANNEL, DeliveryTabs } from "./ui";

export default function ReportsPage() {
  const { L, loc, lang } = useT();
  const [range, setRange] = useState<"0" | "6" | "29">("0");
  const data = useDeliveryData({ days: Number(range) });
  const fb = useLive("auditLog", { where: { action: "guest.feedback" } });
  const ratings = useMemo(() => new Map(fb.data.filter((a) => a.entityId && typeof a.data.stars === "number").map((a) => [a.entityId!, a.data.stars as number])), [fb.data]);
  const tz = data.settings?.locale.timezone ?? "Africa/Cairo";
  const hourOf = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" });
    return (iso: string) => Number(f.format(new Date(iso))) % 24;
  }, [tz]);
  const r = useMemo(() => {
    const checks = new Map(data.views.filter((v) => v.check).map((v) => [v.check!.id, v.check!]));
    return deliveryReport(data.views.filter((v) => v.order.source !== "qr").map((v) => v.order), checks, { graceMin: data.cfg.lateGraceMin, ratings, hourOf });
  }, [data, ratings, hourOf]);
  const zoneName = (slug: string) => {
    const z = data.zones.find((x) => x.slug === slug || x.name.ar === slug);
    return z ? loc(z.name) : slug === "takeaway" ? L("استلام من الفرع", "Pickup") : slug === "app_rider" ? L("مندوب التطبيق", "App rider") : slug;
  };
  const fmt = (n: number | null, unit: "min" | "sec" = "min") => (n === null ? "—" : unit === "sec" ? (n < 90 ? L(`${Math.round(n)} ث`, `${Math.round(n)}s`) : L(`${(n / 60).toFixed(1)} د`, `${(n / 60).toFixed(1)}m`)) : L(`${n.toFixed(0)} د`, `${n.toFixed(0)} min`));
  // continuous axis: from the first busy hour (or noon) to the last (or 23:00)
  const busy = r.byHour.map((v, h) => (v ? h : -1)).filter((h) => h >= 0);
  const from = Math.min(12, ...busy);
  const to = Math.max(23, ...busy);
  const hours = r.byHour.slice(from, to + 1).map((v, i) => ({ key: String(from + i), label: String(from + i), value: v, tip: `${from + i}:00 · ${v}` }));

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader
        icon={<BarChart3 />}
        title={L("تقارير الدليفري", "Delivery reports")}
        actions={
          <Segmented
            label={L("الفترة", "Period")}
            value={range}
            onChange={setRange}
            options={[
              { value: "0", label: L("النهارده", "Today") },
              { value: "6", label: L("٧ أيام", "7 days") },
              { value: "29", label: L("٣٠ يوم", "30 days") },
            ]}
          />
        }
      />
      <DeliveryTabs />
      {r.orders === 0 && r.rejected === 0 ? (
        <EmptyState icon={<BarChart3 />} title={L("مفيش طلبات في الفترة دي", "No orders in this period")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile index={0} label={L("الطلبات", "Orders")} value={<span className="num">{r.orders}</span>} sub={<Money value={r.revenue} compact />} icon={<Receipt />} />
            <StatTile index={1} label={L("وقت القبول", "Time to accept")} value={fmt(r.avgAcceptSec, "sec")} icon={<Clock />} tone="info" />
            <StatTile index={2} label={L("متوسط التجهيز", "Avg prep")} value={fmt(r.avgPrepMin)} icon={<Hourglass />} tone="warn" />
            <StatTile index={3} label={L("متوسط التوصيل", "Avg ride")} value={fmt(r.avgRideMin)} sub={L(`من الطلب للباب ${fmt(r.avgTotalMin)}`, `order → door ${fmt(r.avgTotalMin)}`)} icon={<Bike />} tone="primary" />
            <StatTile index={4} label={L("نسبة التأخير", "Late")} value={r.latePct === null ? "—" : <span className="num">{Math.round(r.latePct * 100)}%</span>} sub={L(`${r.late} من ${r.onTimeBase}`, `${r.late} of ${r.onTimeBase}`)} icon={<TimerOff />} tone={r.latePct && r.latePct > 0.15 ? "danger" : "ok"} />
            <StatTile index={5} label={L("اترفض / فشل", "Rejected / failed")} value={<span className="num">{r.rejected} / {r.failed}</span>} icon={<XCircle />} tone="danger" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={L("الطلبات بالساعة", "Orders by hour")} icon={<Clock />} />
              <div className="px-4 pb-4">
                <BarChart data={hours} height={180} ariaLabel={L("الطلبات بالساعة", "Orders by hour")} />
              </div>
            </Card>
            <Card>
              <CardHeader title={L("حسب القناة", "By channel")} icon={<Percent />} />
              <ul className="grid gap-3 px-5 pb-5">
                {r.byChannel.map((c) => (
                  <li key={c.channel} className="grid gap-1">
                    <div className="flex items-center gap-2 text-[14px]">
                      <span className="text-muted [&_svg]:size-4">{CHANNEL[c.channel].icon}</span>
                      <span className="flex-1 font-semibold">{loc(CHANNEL[c.channel].label)}</span>
                      <span className="num text-muted">{c.count}</span>
                      <Money value={c.revenue} compact className="w-24 text-end font-semibold" />
                    </div>
                    <Meter value={c.count} max={r.orders || 1} label={loc(CHANNEL[c.channel].label)} />
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title={L("حسب المنطقة", "By zone")} />
              <ul className="grid gap-2 px-5 pb-5 text-[14px]">
                {r.byZone.map((z) => (
                  <li key={z.zone} className="flex items-center gap-3">
                    <span className="flex-1 font-semibold">{zoneName(z.zone)}</span>
                    <span className="num text-muted">{z.count}</span>
                    <Money value={z.revenue} compact className="w-24 text-end" />
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title={L("عمولة تطبيقات التوصيل", "Delivery-app commission")} subtitle={L("من الطلبات اللي اتسجلت يدوي", "From manually keyed app orders")} />
              {r.aggregators.length ? (
                <table className="mx-5 mb-5 w-[calc(100%-2.5rem)] text-[14px]">
                  <thead className="text-[12px] text-muted">
                    <tr>
                      <th className="py-1 text-start font-semibold">{L("التطبيق", "App")}</th>
                      <th className="py-1 text-end font-semibold">{L("طلبات", "Orders")}</th>
                      <th className="py-1 text-end font-semibold">{L("الإجمالي", "Gross")}</th>
                      <th className="py-1 text-end font-semibold">{L("العمولة", "Commission")}</th>
                      <th className="py-1 text-end font-semibold">{L("الصافي", "Net")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.aggregators.map((a) => (
                      <tr key={a.id} className="border-t border-line">
                        <td className="py-2 font-semibold">{aggregatorInfo(a.id)?.name[lang] ?? a.id}</td>
                        <td className="num py-2 text-end">{a.count}</td>
                        <td className="py-2 text-end"><Money value={a.gross} compact /></td>
                        <td className="py-2 text-end text-danger"><Money value={-a.commission} compact signed /></td>
                        <td className="py-2 text-end font-bold"><Money value={a.net} compact /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-5 pb-5 text-[13.5px] text-muted">{L("مفيش طلبات تطبيقات", "No app orders")}</p>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title={L("أداء الطيارين", "Rider performance")} icon={<Bike />} />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[560px] text-[14px]">
                <thead className="text-[12px] text-muted">
                  <tr>
                    <th className="py-1 text-start font-semibold">{L("الطيار", "Rider")}</th>
                    <th className="py-1 text-end font-semibold">{L("توصيلات", "Deliveries")}</th>
                    <th className="py-1 text-end font-semibold">{L("متوسط الوقت", "Avg time")}</th>
                    <th className="py-1 text-end font-semibold">{L("متأخر", "Late")}</th>
                    <th className="py-1 text-end font-semibold">{L("كاش اتحصّل", "Cash collected")}</th>
                    <th className="py-1 text-end font-semibold">{L("التقييم", "Rating")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.drivers.map((m) => {
                    const x = r.riders.find((y) => y.driverId === m.id);
                    return (
                      <tr key={m.id} className="border-t border-line">
                        <td className="py-2">
                          <span className="flex items-center gap-2 font-semibold">
                            <Avatar name={m.name} color={m.color} size="xs" /> {m.name}
                          </span>
                        </td>
                        <td className="num py-2 text-end">{x?.deliveries ?? 0}</td>
                        <td className="py-2 text-end">{fmt(x?.avgRideMin ?? null)}</td>
                        <td className="num py-2 text-end">{x?.late ?? 0}</td>
                        <td className="py-2 text-end">{formatMoney(x?.cash ?? 0, { lang, compact: true })}</td>
                        <td className="py-2 text-end">
                          {x?.rating ? (
                            <span className="inline-flex items-center gap-1 font-semibold">
                              <Star className="size-4 fill-brass text-brass" /> <span className="num">{x.rating.toFixed(1)}</span> <span className="text-[11.5px] text-muted">({x.ratings})</span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
