import { useEffect, useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { BarChart3, Building2, CalendarRange, Check, Eye, Globe2, LayoutGrid, MousePointerClick, Pause, Play, Search, ShoppingBag, X } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive, useRepo } from "@/data/hooks";
import type { AdBooking, AdSlot } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, sumUnits } from "@/lib/money";
import { dayLabel } from "@/lib/time";
import { ctr, eachDay, HOLDS, isServing, spend } from "@/lib/promo";
import { Badge, BarChart, Button, Card, Dialog, EmptyState, Input, Select, StatTile, Textarea, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { BOOKING_LABEL, BOOKING_TONE, CITIES, cityLabel, CUISINES, cuisineLabel, MODEL_LABEL, SponsoredPreview } from "@/modules/marketing/AdsPage";
import { MoneyInput, NumberInput, pct, RouteTabs, Section } from "@/modules/marketing/ui";
import { PromoPublic } from "@/modules/marketing/guest/api";
import { reviewBooking, today } from "./ads";

export default function PlatformPage() {
  const { L } = useT();
  const pending = useLive("adBookings", { where: { status: "requested" } }, { unscoped: true }).data.length;
  return (
    <div className="grid gap-5">
      <PageHeader icon={<Globe2 />} kicker={L("فريق سُفرة فقط", "Sufra staff only")} title={L("منصة سُفرة", "Sufra platform")} subtitle={L("المطاعم على المنصة والأماكن المُموَّلة اللي بنبيعها", "Restaurants on the platform and the sponsored spots we sell")} />
      <RouteTabs
        label={L("أقسام المنصة", "Platform sections")}
        items={[
          { to: "/platform", end: true, label: L("الإعلانات المُموَّلة", "Sponsored"), icon: <CalendarRange />, count: pending || null },
          { to: "/platform/performance", label: L("الأداء", "Performance"), icon: <BarChart3 /> },
          { to: "/platform/restaurants", label: L("المطاعم", "Restaurants"), icon: <Building2 /> },
          { to: "/platform/slots", label: L("الأماكن والأسعار", "Slots & pricing"), icon: <LayoutGrid /> },
        ]}
      />
      <Routes>
        <Route index element={<Sponsored />} />
        <Route path="performance" element={<Performance />} />
        <Route path="restaurants" element={<Restaurants />} />
        <Route path="slots" element={<Slots />} />
      </Routes>
    </div>
  );
}

function usePlatform() {
  const slots = useLive("adSlots", { orderBy: [{ field: "sort" }] }, { unscoped: true }).data;
  const bookings = useLive("adBookings", { orderBy: [{ field: "startsOn" }] }, { unscoped: true }).data;
  const restaurants = useLive("restaurants", undefined, { unscoped: true }).data;
  const profiles = useLive("marketProfiles", undefined, { unscoped: true }).data;
  return { slots, bookings, restaurants, profiles, name: (id: string) => restaurants.find((r) => r.id === id)?.name ?? { ar: "—", en: "—" } };
}

function Sponsored() {
  const { L, lang, loc } = useT();
  const repo = useRepo();
  const { toast } = useToast();
  const { staff } = useSession();
  const p = usePlatform();
  const t = today();
  const days = useMemo(() => eachDay(t, new Date(Date.parse(`${t}T00:00:00Z`) + 27 * 86_400_000).toISOString().slice(0, 10)), [t]);
  const [review, setReview] = useState<AdBooking | null>(null);
  const [note, setNote] = useState("");
  const requests = p.bookings.filter((b) => b.status === "requested");
  const live = p.bookings.filter((b) => isServing(b, t));
  const act = async (b: AdBooking, next: AdBooking["status"]) => {
    try {
      await reviewBooking(repo, b, next, staff?.id ?? null, note);
      toast({ title: BOOKING_LABEL[next === "approved" && b.startsOn <= t ? "live" : next][lang], tone: "success" });
      setReview(null);
      setNote("");
    } catch {
      toast({ title: L("المكان اتملى في الأيام دي", "The slot is full on those days"), tone: "error" });
    }
  };
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} tone="ok" icon={<Play />} label={L("شغّال دلوقتي", "Live now")} value={live.length} />
        <StatTile index={1} tone="warn" label={L("طلبات مستنية", "Pending requests")} value={requests.length} />
        <StatTile index={2} tone="brass" label={L("مبيعات الإعلانات", "Ad sales")} value={formatMoney(sumUnits(p.bookings.filter((b) => HOLDS.includes(b.status) || b.status === "ended").map((b) => b.price)), { lang, whole: true })} />
        <StatTile index={3} label={L("اتصرف لحد دلوقتي", "Delivered so far")} value={formatMoney(sumUnits(p.bookings.map((b) => spend(b, t))), { lang, whole: true })} />
      </div>

      <Section title={L("طلبات محتاجة مراجعة", "Requests to review")} icon={<Check />}>
        {requests.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {requests.map((b) => {
              const s = p.slots.find((x) => x.id === b.slotId);
              return (
                <li key={b.id} className="grid gap-3 rounded-2xl border border-warn/40 bg-warn-soft/40 p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{loc(p.name(b.restaurantId))}</p>
                      <p className="text-[13px] text-muted">{s ? loc(s.name) : "—"} · {dayLabel(`${b.startsOn}T12:00:00Z`, lang)} → {dayLabel(`${b.endsOn}T12:00:00Z`, lang)}</p>
                      <p className="mt-1 text-[13.5px]">“{loc(b.creative.headline)}”</p>
                    </div>
                    <span className="text-end">
                      <span className="num block font-semibold">{formatMoney(b.price, { lang, whole: true })}</span>
                      <Badge size="sm" tone={b.payment.paidAt ? "ok" : "neutral"}>{b.payment.paidAt ? L("مدفوع", "Paid") : L("فاتورة", "Invoice")}</Badge>
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" icon={<Check className="size-4" />} onClick={() => act(b, "approved")}>{L("وافق", "Approve")}</Button>
                    <Button size="sm" variant="danger-soft" icon={<X className="size-4" />} onClick={() => setReview(b)}>{L("ارفض", "Reject")}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13.5px] text-muted">{L("مفيش طلبات جديدة", "No new requests")}</p>
        )}
      </Section>

      <Section title={L("جدول الحجوزات (٤ أسابيع)", "Bookings calendar (4 weeks)")} icon={<CalendarRange />}>
        <div className="overflow-x-auto thin-scrollbar">
          <div className="min-w-[860px]" dir="ltr">
            <div className="grid" style={{ gridTemplateColumns: `14rem repeat(${days.length}, minmax(0,1fr))` }}>
              <div />
              {days.map((d) => (
                <div key={d} className={`num pb-1 text-center text-[10.5px] ${new Date(`${d}T12:00:00Z`).getUTCDay() === 5 ? "font-bold text-brass-text" : "text-muted"}`}>{d.slice(8)}</div>
              ))}
            </div>
            {p.slots.map((s) => {
              const bs = p.bookings.filter((b) => b.slotId === s.id && (HOLDS.includes(b.status) || b.status === "requested") && b.endsOn >= days[0] && b.startsOn <= days[days.length - 1]);
              return (
                <div key={s.id} className="border-t border-line py-2">
                  <div className="grid items-center" style={{ gridTemplateColumns: `14rem repeat(${days.length}, minmax(0,1fr))` }}>
                    <div className="pe-3">
                      <p className="truncate text-[13.5px] font-bold">{loc(s.name)}</p>
                      <p className="text-[11.5px] text-muted">{L(`سعة ${s.capacity}`, `capacity ${s.capacity}`)}</p>
                    </div>
                    {days.map((d) => {
                      const n = bs.filter((b) => b.status !== "requested" && b.startsOn <= d && d <= b.endsOn).length;
                      return <div key={d} title={`${d}: ${n}/${s.capacity}`} className="mx-px h-5 rounded-sm" style={{ background: n >= s.capacity ? "var(--sf-danger)" : n ? `color-mix(in srgb, var(--sf-primary) ${25 + (n / s.capacity) * 50}%, transparent)` : "var(--sf-surface-3)" }} />;
                    })}
                  </div>
                  {bs.map((b) => {
                    const a = Math.max(0, days.indexOf(b.startsOn < days[0] ? days[0] : b.startsOn));
                    const z = days.indexOf(b.endsOn > days[days.length - 1] ? days[days.length - 1] : b.endsOn);
                    return (
                      <div key={b.id} className="mt-1 grid items-center" style={{ gridTemplateColumns: `14rem repeat(${days.length}, minmax(0,1fr))` }}>
                        <p className="truncate pe-3 text-[12px] text-muted">{loc(p.name(b.restaurantId))}{b.targeting.city ? ` · ${cityLabel(b.targeting.city, lang)}` : ""}{b.targeting.cuisine ? ` · ${cuisineLabel(b.targeting.cuisine, lang)}` : ""}</p>
                        <button type="button" onClick={() => setReview(b)} style={{ gridColumn: `${a + 2} / ${z + 3}` }} className={`h-6 truncate rounded-full px-2 text-start text-[11px] font-bold ${b.status === "requested" ? "border border-dashed border-warn bg-warn-soft text-warn" : b.status === "paused" ? "bg-surface-3 text-muted" : "bg-primary text-primary-ink"}`}>
                          {BOOKING_LABEL[b.status][lang]}
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      <Section title={L("كل الحجوزات", "All bookings")}>
        <ul className="grid gap-2">
          {[...p.bookings].reverse().map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setReview(b)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-line px-4 py-3 text-start hover:bg-surface-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto]">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{loc(p.name(b.restaurantId))}</span>
                  <span className="block truncate text-[12.5px] text-muted">{loc(p.slots.find((s) => s.id === b.slotId)?.name)}</span>
                </span>
                <span className="text-[12.5px] text-muted max-sm:hidden">{b.startsOn} → {b.endsOn}</span>
                <span className="num text-[13px] max-sm:hidden">{b.stats.impressions.toLocaleString("en")} / {b.stats.clicks}</span>
                <Badge size="sm" tone={BOOKING_TONE[b.status]}>{BOOKING_LABEL[b.status][lang]}</Badge>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <FeedPreview />

      <Dialog open={!!review} onClose={() => setReview(null)} size="lg" title={review ? loc(p.name(review.restaurantId)) : ""} description={review ? `${loc(p.slots.find((s) => s.id === review.slotId)?.name)} · ${review.startsOn} → ${review.endsOn}` : ""}>
        {review ? (
          <div className="grid gap-4 pb-1">
            <SponsoredPreview name={loc(p.name(review.restaurantId))} headline={loc(review.creative.headline)} color={p.restaurants.find((r) => r.id === review.restaurantId)?.brandColor ?? "#0d5a53"} cta={loc(review.creative.cta)} />
            <dl className="grid grid-cols-2 gap-2 text-[13.5px] sm:grid-cols-4">
              <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted">{L("السعر", "Price")}</dt><dd className="num font-semibold">{formatMoney(review.price, { lang, whole: true })}</dd></div>
              <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted">{L("التسعير", "Pricing")}</dt><dd className="font-semibold">{MODEL_LABEL[review.pricing.model][lang]}</dd></div>
              <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted">{L("الدفع", "Payment")}</dt><dd className="font-semibold">{review.payment.paidAt ? `✓ ${review.payment.reference ?? ""}` : (review.payment.invoiceNo ?? "—")}</dd></div>
              <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted">CTR</dt><dd className="num font-semibold">{pct(ctr(review.stats), 1)}</dd></div>
            </dl>
            <Textarea label={L("ملاحظة للمطعم", "Note to the restaurant")} value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {review.status === "requested" || review.status === "pending_payment" ? <Button icon={<Check className="size-4" />} onClick={() => act(review, "approved")}>{L("وافق", "Approve")}</Button> : null}
              {review.status === "live" || review.status === "approved" ? <Button variant="secondary" icon={<Pause className="size-4" />} onClick={() => act(review, "paused")}>{L("وقّف مؤقتًا", "Pause")}</Button> : null}
              {review.status === "paused" ? <Button icon={<Play className="size-4" />} onClick={() => act(review, "live")}>{L("كمّل", "Resume")}</Button> : null}
              {review.status !== "rejected" && review.status !== "ended" && review.status !== "cancelled" ? <Button variant="danger-soft" icon={<X className="size-4" />} onClick={() => act(review, review.status === "requested" ? "rejected" : "ended")}>{review.status === "requested" ? L("ارفض", "Reject") : L("أنهي", "End")}</Button> : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

/** What the marketplace gets from public_sponsored(city, cuisine) right now. */
function FeedPreview() {
  const { L, lang, loc } = useT();
  const repo = useRepo();
  const api = useMemo(() => new PromoPublic(repo), [repo]);
  const [city, setCity] = useState("cairo");
  const [cuisine, setCuisine] = useState("");
  const [feed, setFeed] = useState<Awaited<ReturnType<PromoPublic["sponsored"]>> | null>(null);
  const bookings = useLive("adBookings", undefined, { unscoped: true }).data;
  useEffect(() => {
    let off = false;
    api.sponsored(city || null, cuisine || null).then((f) => !off && setFeed(f), () => !off && setFeed([]));
    return () => {
      off = true;
    };
  }, [api, city, cuisine, bookings]);
  return (
    <Section title={L("الـ feed العام (public_sponsored)", "Public feed (public_sponsored)")} subtitle={L("اللي تطبيق سُفرة والموقع بيعرضوه — بتسمية «مُموَّل»", "What the Sufra app and website show — labelled “Sponsored”")} icon={<Search />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={L("المدينة", "City")} value={city} onChange={(e) => setCity(e.target.value)} options={[{ value: "", label: cityLabel(null, lang) }, ...CITIES.map((c) => ({ value: c, label: cityLabel(c, lang) }))]} />
        <Select label={L("نوع الأكل", "Cuisine")} value={cuisine} onChange={(e) => setCuisine(e.target.value)} options={[{ value: "", label: cuisineLabel(null, lang) }, ...CUISINES.map((c) => ({ value: c, label: cuisineLabel(c, lang) }))]} />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {feed?.length ? feed.map((f) => <div key={f.bookingId}><p className="mb-1 text-[11.5px] font-semibold text-muted">{f.slot}</p><SponsoredPreview name={loc(f.name)} headline={loc(f.headline)} color={f.brandColor} cta={L("اطلب", "Order")} /></div>) : <EmptyState compact title={L("مفيش إعلانات للفلتر ده", "No placements for this filter")} />}
      </div>
      <pre className="mt-4 max-h-48 overflow-auto rounded-xl bg-surface-3 p-3 text-[11.5px] thin-scrollbar" dir="ltr">{`select * from public.public_sponsored('${city || "null"}', ${cuisine ? `'${cuisine}'` : "null"});\n` + JSON.stringify(feed?.slice(0, 2) ?? [], null, 1).slice(0, 900)}</pre>
    </Section>
  );
}

function Performance() {
  const { L, lang, loc } = useT();
  const p = usePlatform();
  const t = today();
  const days = useMemo(() => eachDay(new Date(Date.parse(`${t}T00:00:00Z`) - 13 * 86_400_000).toISOString().slice(0, 10), t), [t]);
  const daily = days.map((d) => {
    const v = p.bookings.reduce((a, b) => ({ i: a.i + (b.daily[d]?.impressions ?? 0), c: a.c + (b.daily[d]?.clicks ?? 0), o: a.o + (b.daily[d]?.orders ?? 0) }), { i: 0, c: 0, o: 0 });
    return { d, ...v };
  });
  const tot = { i: sumUnits(p.bookings.map((b) => b.stats.impressions)), c: sumUnits(p.bookings.map((b) => b.stats.clicks)), o: sumUnits(p.bookings.map((b) => b.stats.orders)), r: sumUnits(p.bookings.map((b) => b.stats.revenue)) };
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={<Eye />} label={L("ظهور", "Impressions")} value={tot.i.toLocaleString("en")} />
        <StatTile index={1} tone="info" icon={<MousePointerClick />} label={L("ضغطات", "Clicks")} value={tot.c.toLocaleString("en")} sub={`CTR ${pct(tot.i ? tot.c / tot.i : 0, 1)}`} />
        <StatTile index={2} tone="ok" icon={<ShoppingBag />} label={L("طلبات من الإعلانات", "Orders from ads")} value={tot.o} sub={L(`تحويل ${pct(tot.c ? tot.o / tot.c : 0, 1)}`, `conv. ${pct(tot.c ? tot.o / tot.c : 0, 1)}`)} />
        <StatTile index={3} tone="brass" label={L("إيراد المطاعم من الإعلانات", "Restaurant revenue from ads")} value={formatMoney(tot.r, { lang, whole: true })} />
      </div>
      <Section title={L("ظهور يومي (١٤ يوم)", "Daily impressions (14 days)")}>
        <BarChart data={daily.map((x) => ({ key: x.d, label: x.d.slice(8), value: x.i, tip: `${x.d} · ${x.i.toLocaleString("en")} / ${x.c} / ${x.o}` }))} height={180} ariaLabel={L("ظهور يومي", "Daily impressions")} />
      </Section>
      <Section title={L("حسب الحجز", "By booking")}>
        <div className="overflow-x-auto thin-scrollbar">
          <table className="w-full min-w-[640px] text-[13.5px]">
            <thead className="text-[12px] text-muted">
              <tr className="border-b border-line">
                <th className="py-2 text-start font-semibold">{L("المطعم", "Restaurant")}</th>
                <th className="text-start font-semibold">{L("المكان", "Slot")}</th>
                <th className="text-end font-semibold">{L("ظهور", "Views")}</th>
                <th className="text-end font-semibold">CTR</th>
                <th className="text-end font-semibold">{L("طلبات", "Orders")}</th>
                <th className="text-end font-semibold">{L("اتصرف", "Spend")}</th>
                <th className="text-end font-semibold">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {p.bookings.filter((b) => b.stats.impressions).map((b) => {
                const sp = spend(b, t);
                return (
                  <tr key={b.id} className="border-b border-line/60">
                    <td className="py-2 font-semibold">{loc(p.name(b.restaurantId))}</td>
                    <td>{loc(p.slots.find((s) => s.id === b.slotId)?.name)}</td>
                    <td className="num text-end">{b.stats.impressions.toLocaleString("en")}</td>
                    <td className="num text-end">{pct(ctr(b.stats), 1)}</td>
                    <td className="num text-end">{b.stats.orders}</td>
                    <td className="num text-end">{formatMoney(sp, { lang, whole: true })}</td>
                    <td className="num text-end font-semibold">{sp ? `${(b.stats.revenue / sp).toFixed(1)}×` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Restaurants() {
  const { L, lang, loc } = useT();
  const p = usePlatform();
  const t = today();
  const [q, setQ] = useState("");
  const rows = p.restaurants.filter((r) => !q || loc(r.name).includes(q) || r.slug.includes(q.toLowerCase()));
  return (
    <div className="grid gap-4">
      <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("اسم أو slug", "Name or slug")} aria-label={L("بحث", "Search")} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const prof = p.profiles.find((x) => x.restaurantId === r.id);
          const bs = p.bookings.filter((b) => b.restaurantId === r.id);
          return (
            <Card key={r.id} className="grid gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-2xl text-[18px] font-bold text-white" style={{ background: r.brandColor }}>{loc(r.name).slice(0, 1)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{loc(r.name)}</p>
                  <p className="num truncate text-[12.5px] text-muted" dir="ltr">/{r.slug}</p>
                </div>
                <Badge size="sm" tone={r.active ? "ok" : "neutral"}>{r.plan}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[12.5px]">
                {prof ? (
                  <>
                    <Badge size="sm">{cityLabel(prof.city, lang)} · {prof.area}</Badge>
                    {prof.cuisines.map((c) => <Badge key={c} size="sm" tone="brass">{cuisineLabel(c, lang)}</Badge>)}
                    <Badge size="sm" tone="info">★ {prof.rating.toFixed(1)}</Badge>
                  </>
                ) : (
                  <Badge size="sm" tone="warn">{L("مش في الدليل", "Not listed")}</Badge>
                )}
              </div>
              <p className="text-[12.5px] text-muted">
                {L(`${bs.length} حجز إعلان · ${bs.filter((b) => isServing(b, t)).length} شغّال · ${formatMoney(sumUnits(bs.map((b) => b.price)), { lang, whole: true })}`, `${bs.length} ad bookings · ${bs.filter((b) => isServing(b, t)).length} live · ${formatMoney(sumUnits(bs.map((b) => b.price)), { lang, whole: true })}`)}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Slots() {
  const { L, lang, loc } = useT();
  const repo = useRepo();
  const { toast } = useToast();
  const p = usePlatform();
  const [edit, setEdit] = useState<AdSlot | null>(null);
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {p.slots.map((s) => (
        <Card key={s.id} className="grid content-between gap-3 p-4">
          <div>
            <p className="font-bold">{loc(s.name)}</p>
            <p className="mt-1 text-[13px] text-muted">{loc(s.description)}</p>
          </div>
          <p><span className="num text-[22px] font-semibold">{formatMoney(s.pricing.rate, { lang, compact: true })}</span> <span className="text-[12.5px] text-muted">{MODEL_LABEL[s.pricing.model][lang]}</span></p>
          <p className="text-[12.5px] text-muted">{L(`سعة ${s.capacity} في اليوم`, `${s.capacity} per day`)} · {s.active ? L("متاح", "on sale") : L("متوقف", "off")}</p>
          <Button variant="secondary" onClick={() => setEdit({ ...s })}>{L("عدّل", "Edit")}</Button>
        </Card>
      ))}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title={edit ? loc(edit.name) : ""} footer={<Button block onClick={async () => {
        if (!edit) return;
        await repo.update("adSlots", edit.id, { pricing: edit.pricing, capacity: edit.capacity, active: edit.active });
        toast({ title: L("اتحفظ", "Saved"), tone: "success" });
        setEdit(null);
      }}>{L("احفظ", "Save")}</Button>}>
        {edit ? (
          <div className="grid gap-3 pb-1">
            <Select label={L("التسعير", "Pricing model")} value={edit.pricing.model} onChange={(e) => setEdit({ ...edit, pricing: { ...edit.pricing, model: e.target.value as AdSlot["pricing"]["model"] } })} options={(["day", "cpm", "cpc"] as const).map((m) => ({ value: m, label: MODEL_LABEL[m][lang] }))} />
            <MoneyInput label={L("السعر", "Rate")} value={edit.pricing.rate} onChange={(u) => setEdit({ ...edit, pricing: { ...edit.pricing, rate: u } })} />
            <NumberInput label={L("السعة في اليوم", "Capacity per day")} value={edit.capacity} onChange={(n) => setEdit({ ...edit, capacity: Math.max(1, Math.round(n)) })} />
            <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />{L("متاح للبيع", "On sale")}</label>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
