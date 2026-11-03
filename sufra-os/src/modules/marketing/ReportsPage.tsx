import { useMemo } from "react";
import { Link } from "react-router-dom";
import { BadgePercent, Coins, Megaphone, Repeat, Users } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney, sumUnits } from "@/lib/money";
import { StatTile } from "@/ui";
import { useCrm } from "@/modules/customers/useCrm";
import { campaignRoi, lastMonths, newVsReturning, redemptionStats, retentionCohorts } from "./reports";
import { pct, Section } from "./ui";

export default function ReportsPage() {
  const { L, lang, loc } = useT();
  const crm = useCrm();
  const promos = useLive("promotions").data;
  const reds = useLive("promoRedemptions").data;
  const codes = useLive("couponCodes").data;
  const campaigns = useLive("campaigns").data;
  const months = useMemo(() => lastMonths(6), []);
  const nvr = useMemo(() => newVsReturning(crm.ledger, months), [crm.ledger, months]);
  const cohorts = useMemo(() => retentionCohorts(crm.ledger, months, 5), [crm.ledger, months]);
  const red = useMemo(() => redemptionStats(promos, reds, codes), [promos, reds, codes]);
  const roi = useMemo(() => campaignRoi(campaigns), [campaigns]);
  const mLabel = (m: string) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { month: "short", year: "2-digit" });
  const maxV = Math.max(1, ...nvr.map((x) => x.new + x.returning));
  const earned = sumUnits(crm.ledger.filter((e) => e.points > 0).map((e) => e.points));
  const spent = -sumUnits(crm.ledger.filter((e) => e.kind === "redeem").map((e) => e.points));
  const thisMonth = nvr[nvr.length - 1];
  const returningRate = thisMonth && thisMonth.new + thisMonth.returning ? thisMonth.returning / (thisMonth.new + thisMonth.returning) : 0;
  const totalDisc = sumUnits(reds.filter((r) => r.status === "redeemed").map((r) => r.discount + r.deliveryDiscount));
  const totalRev = sumUnits(reds.filter((r) => r.status === "redeemed").map((r) => r.revenue));

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={<Repeat />} label={L("نسبة الراجعين (الشهر ده)", "Returning share (this month)")} value={pct(returningRate)} sub={L(`${thisMonth?.new ?? 0} جديد · ${thisMonth?.returning ?? 0} راجع`, `${thisMonth?.new ?? 0} new · ${thisMonth?.returning ?? 0} returning`)} />
        <StatTile index={1} tone="brass" icon={<Coins />} label={L("نقاط اتصرفت", "Points redeemed")} value={earned ? pct(spent / earned) : "—"} sub={L(`${spent.toLocaleString("en")} من ${earned.toLocaleString("en")}`, `${spent.toLocaleString("en")} of ${earned.toLocaleString("en")}`)} />
        <StatTile index={2} tone="primary" icon={<BadgePercent />} label={L("خصومات العروض", "Offer discounts")} value={formatMoney(totalDisc, { lang, whole: true })} sub={L(`على إيراد ${formatMoney(totalRev, { lang, whole: true })}`, `on revenue ${formatMoney(totalRev, { lang, whole: true })}`)} />
        <StatTile index={3} tone="ok" icon={<Megaphone />} label={L("عائد الحملات", "Campaign return")} value={(() => { const c = sumUnits(roi.map((x) => x.cost)); return c ? `${(sumUnits(roi.map((x) => x.revenue)) / c).toFixed(1)}×` : "—"; })()} sub={L(`${roi.length} حملة`, `${roi.length} campaigns`)} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title={L("جداد وراجعين بالشهر", "New vs returning by month")} icon={<Users />}>
          <div className="flex h-48 items-stretch gap-3" dir="ltr" role="img" aria-label={L("زباين جداد وراجعين", "New and returning guests")}>
            {nvr.map((x) => (
              <div key={x.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <div className="flex w-full flex-1 flex-col justify-end overflow-hidden rounded-t-md">
                  <div className="bg-primary/35" style={{ height: `${(x.returning / maxV) * 100}%` }} title={`${x.returning}`} />
                  <div className="bg-primary" style={{ height: `${(x.new / maxV) * 100}%` }} title={`${x.new}`} />
                </div>
                <span className="num text-[11.5px] text-muted">{mLabel(x.month)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-primary" />{L("جداد", "New")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-primary/35" />{L("راجعين", "Returning")}</span>
          </div>
        </Section>

        <Section title={L("الاحتفاظ بالزباين (cohorts)", "Retention cohorts")} subtitle={L("من أول زيارة: كام في المية رجع في الشهر التالت…", "From the first visit: share that came back in month +1, +2…")} icon={<Repeat />}>
          <div className="overflow-x-auto thin-scrollbar">
            <table className="w-full min-w-[420px] border-separate border-spacing-1 text-center text-[12.5px]">
              <thead>
                <tr className="text-muted">
                  <th className="text-start font-semibold">{L("أول زيارة", "First visit")}</th>
                  <th className="font-semibold">{L("عدد", "Size")}</th>
                  {[1, 2, 3, 4, 5].map((i) => <th key={i} className="font-semibold">+{i}</th>)}
                </tr>
              </thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.month}>
                    <td className="num text-start font-semibold">{mLabel(c.month)}</td>
                    <td className="num">{c.size}</td>
                    {c.cells.map((v, i) => (
                      <td key={i} className="num rounded-md py-1.5" style={v == null ? undefined : { background: `color-mix(in srgb, var(--sf-primary) ${Math.round(v * 85) + 6}%, transparent)`, color: v > 0.45 ? "var(--sf-primary-ink)" : undefined }}>
                        {v == null ? "" : pct(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <Section title={L("استخدام العروض والكوبونات", "Offer & coupon redemption")} icon={<BadgePercent />}>
        <div className="overflow-x-auto thin-scrollbar">
          <table className="w-full min-w-[560px] text-[13.5px]">
            <thead className="text-[12px] text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-start font-semibold">{L("العرض", "Offer")}</th>
                <th className="text-end font-semibold">{L("استخدام", "Uses")}</th>
                <th className="text-end font-semibold">{L("نسبة استخدام الأكواد", "Code redemption")}</th>
                <th className="text-end font-semibold">{L("الخصم", "Discount")}</th>
                <th className="text-end font-semibold">{L("إيراد الشيكات", "Check revenue")}</th>
              </tr>
            </thead>
            <tbody>
              {red.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="py-2 font-semibold">{loc(r.name)}</td>
                  <td className="num text-end">{r.uses}</td>
                  <td className="num text-end">{r.rate == null ? "—" : `${pct(r.rate)} (${r.issued})`}</td>
                  <td className="num text-end">{formatMoney(r.discount, { lang, whole: true })}</td>
                  <td className="num text-end">{formatMoney(r.revenue, { lang, whole: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={L("عائد الحملات", "Campaign ROI")} icon={<Megaphone />}>
        <div className="overflow-x-auto thin-scrollbar">
          <table className="w-full min-w-[560px] text-[13.5px]">
            <thead className="text-[12px] text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-start font-semibold">{L("الحملة", "Campaign")}</th>
                <th className="text-end font-semibold">{L("اتبعت", "Sent")}</th>
                <th className="text-end font-semibold">{L("تحويل", "Conversion")}</th>
                <th className="text-end font-semibold">{L("إيراد", "Revenue")}</th>
                <th className="text-end font-semibold">{L("تكلفة", "Cost")}</th>
                <th className="text-end font-semibold">ROI</th>
              </tr>
            </thead>
            <tbody>
              {roi.map((r) => (
                <tr key={r.id} className="border-b border-line/60">
                  <td className="py-2 font-semibold"><Link to={`/marketing/campaigns/${r.id}`} className="hover:underline">{r.name}</Link></td>
                  <td className="num text-end">{r.sent}</td>
                  <td className="num text-end">{r.conv == null ? "—" : pct(r.conv, 1)}</td>
                  <td className="num text-end">{formatMoney(r.revenue, { lang, whole: true })}</td>
                  <td className="num text-end">{formatMoney(r.cost, { lang, whole: true })}</td>
                  <td className="num text-end font-semibold">{r.roi == null ? "—" : `${r.roi.toFixed(1)}×`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
