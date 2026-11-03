import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CalendarRange, CreditCard, Eye, FileText, MousePointerClick, Rocket, ShoppingBag } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive, useRepo } from "@/data/hooks";
import type { AdBooking, AdSlot } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, major } from "@/lib/money";
import { dayLabel } from "@/lib/time";
import { BookingError, ctr, daysBetween, quote, spend } from "@/lib/promo";
import { Badge, Button, Card, Dialog, EmptyState, Input, Segmented, Select, useToast, type Tone } from "@/ui";
import { requestBooking, slotAvailability, today } from "@/modules/platform/ads";
import { LocalizedInput, MoneyInput, pct, Section } from "./ui";

export const BOOKING_TONE: Record<AdBooking["status"], Tone> = { requested: "warn", pending_payment: "warn", approved: "info", live: "ok", paused: "neutral", rejected: "danger", cancelled: "neutral", ended: "neutral" };
export const BOOKING_LABEL: Record<AdBooking["status"], { ar: string; en: string }> = {
  requested: { ar: "مستني موافقة سُفرة", en: "Awaiting Sufra review" },
  pending_payment: { ar: "مستني الدفع", en: "Awaiting payment" },
  approved: { ar: "اتوافق عليه", en: "Approved" },
  live: { ar: "شغّال", en: "Live" },
  paused: { ar: "متوقف", en: "Paused" },
  rejected: { ar: "اترفض", en: "Rejected" },
  cancelled: { ar: "اتلغى", en: "Cancelled" },
  ended: { ar: "خلص", en: "Ended" },
};
export const MODEL_LABEL = { day: { ar: "باليوم", en: "per day" }, cpm: { ar: "لكل ١٠٠٠ ظهور", en: "per 1,000 views" }, cpc: { ar: "لكل ضغطة", en: "per click" } };
export const CITIES = ["cairo", "giza", "alexandria", "mansoura", "hurghada"];
export const CUISINES = ["egyptian", "grills", "koshary", "seafood", "pizza", "italian", "burgers", "desserts", "cafe"];
const CITY_AR: Record<string, string> = { cairo: "القاهرة", giza: "الجيزة", alexandria: "إسكندرية", mansoura: "المنصورة", hurghada: "الغردقة" };
const CUISINE_AR: Record<string, string> = { egyptian: "مصري", grills: "مشويات", koshary: "كشري", seafood: "سمك", pizza: "بيتزا", italian: "إيطالي", burgers: "برجر", desserts: "حلويات", cafe: "كافيه" };
export const cityLabel = (c: string | null, lang: "ar" | "en") => (c ? (lang === "ar" ? (CITY_AR[c] ?? c) : c[0].toUpperCase() + c.slice(1)) : lang === "ar" ? "كل المدن" : "All cities");
export const cuisineLabel = (c: string | null, lang: "ar" | "en") => (c ? (lang === "ar" ? (CUISINE_AR[c] ?? c) : c[0].toUpperCase() + c.slice(1)) : lang === "ar" ? "كل الأنواع" : "All cuisines");

/** The sponsored card as guests see it in the Sufra app ("مُموَّل"). */
export function SponsoredPreview({ name, headline, color, cta }: { name: string; headline: string; color: string; cta: string }) {
  const { L } = useT();
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
      <div className="h-24" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 45%, black))` }} />
      <span className="absolute start-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] font-bold text-white backdrop-blur">{L("مُموَّل", "Sponsored")}</span>
      <div className="p-4">
        <p className="font-bold">{name}</p>
        <p className="mt-0.5 text-[13.5px] text-muted">{headline || "—"}</p>
        <span className="mt-3 inline-flex h-9 items-center rounded-full px-4 text-[13px] font-bold text-white" style={{ background: color }}>{cta || L("اطلب", "Order")}</span>
      </div>
    </div>
  );
}

export default function AdsPage() {
  const { L, lang, loc } = useT();
  const { can, restaurant } = useSession();
  const slots = useLive("adSlots", { orderBy: [{ field: "sort" }] }, { unscoped: true }).data.filter((s) => s.active);
  const mine = useLive("adBookings", { orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const [buy, setBuy] = useState<AdSlot | null>(null);
  const t = today();
  return (
    <div className="grid gap-5">
      <Card className="overflow-hidden">
        <div className="grid gap-4 bg-[linear-gradient(135deg,var(--sf-primary),color-mix(in_srgb,var(--sf-primary)_40%,var(--sf-brass)))] p-6 text-white md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="text-[13px] font-semibold opacity-80">{L("إعلانات سُفرة", "Sufra Ads")}</p>
            <h2 className="mt-1 text-[26px] leading-tight text-white">{L("خلّي مطعمك أول حاجة الزبون يشوفها في تطبيق سُفرة", "Put your restaurant first in the Sufra app")}</h2>
            <p className="mt-1 text-[14px] opacity-85">{L("أماكن مُموَّلة في الرئيسية وأول القائمة وأول مدينتك ونوع أكلك — بتدفع باليوم أو بالظهور أو بالضغطة.", "Sponsored spots on the home screen, top of the list, your city and your cuisine — pay per day, per view or per click.")}</p>
          </div>
          <Rocket className="hidden size-20 opacity-60 md:block" />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {slots.map((s) => (
          <Card key={s.id} className="grid content-between gap-3 p-4">
            <div>
              <p className="font-bold">{loc(s.name)}</p>
              <p className="mt-1 text-[13px] text-muted">{loc(s.description)}</p>
            </div>
            <div>
              <p className="num text-[22px] font-semibold">{formatMoney(s.pricing.rate, { lang, compact: true })}</p>
              <p className="text-[12.5px] text-muted">{MODEL_LABEL[s.pricing.model][lang]} · {L(`${s.capacity} أماكن`, `${s.capacity} spots`)}</p>
            </div>
            {can("ads.buy") ? (
              <Button icon={<Rocket className="size-4" />} onClick={() => setBuy(s)}>{L("اشتري إعلان", "Buy this spot")}</Button>
            ) : (
              <p className="text-[12.5px] text-muted">{L("صاحب المطعم بس يقدر يشتري", "Only the owner can buy")}</p>
            )}
          </Card>
        ))}
      </div>

      <Section title={L("إعلاناتك", "Your ads")} icon={<CalendarRange />}>
        {mine.length ? (
          <ul className="grid gap-3">
            {mine.map((b) => {
              const s = slots.find((x) => x.id === b.slotId);
              return (
                <li key={b.id} className="grid gap-3 rounded-2xl border border-line p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold">{s ? loc(s.name) : "—"}</p>
                      <Badge size="sm" tone={BOOKING_TONE[b.status]} dot={b.status === "live"} pulse={b.status === "live"}>{BOOKING_LABEL[b.status][lang]}</Badge>
                      {b.payment.paidAt ? <Badge size="sm" tone="ok" icon={<BadgeCheck className="size-3" />}>{L("مدفوع", "Paid")}</Badge> : b.payment.invoiceNo ? <Badge size="sm" icon={<FileText className="size-3" />}>{b.payment.invoiceNo}</Badge> : null}
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{dayLabel(`${b.startsOn}T12:00:00Z`, lang)} → {dayLabel(`${b.endsOn}T12:00:00Z`, lang)} · {cityLabel(b.targeting.city, lang)} · {cuisineLabel(b.targeting.cuisine, lang)}</p>
                    <p className="mt-1 truncate text-[13.5px]">“{loc(b.creative.headline)}”</p>
                  </div>
                  <dl className="grid grid-cols-4 gap-2 text-center text-[12px]">
                    <Stat icon={<Eye className="size-3.5" />} k={L("ظهور", "Views")} v={b.stats.impressions.toLocaleString("en")} />
                    <Stat icon={<MousePointerClick className="size-3.5" />} k={L("ضغطات", "Clicks")} v={`${b.stats.clicks} · ${pct(ctr(b.stats), 1)}`} />
                    <Stat icon={<ShoppingBag className="size-3.5" />} k={L("طلبات", "Orders")} v={String(b.stats.orders)} />
                    <Stat k={L("اتصرف", "Spent")} v={formatMoney(spend(b, t), { lang, whole: true, bare: true })} />
                  </dl>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={<Rocket />} title={L("لسه مااشتريتش إعلانات", "No ads yet")} />
        )}
      </Section>
      <BuyDialog slot={buy} onClose={() => setBuy(null)} restaurantName={restaurant ? loc(restaurant.name) : ""} color={restaurant?.brandColor ?? "#0d5a53"} />
    </div>
  );
}

function Stat({ k, v, icon }: { k: string; v: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-1.5">
      <dt className="inline-flex items-center gap-1 text-muted">{icon}{k}</dt>
      <dd className="num font-semibold">{v}</dd>
    </div>
  );
}

function BuyDialog({ slot, onClose, restaurantName, color }: { slot: AdSlot | null; onClose: () => void; restaurantName: string; color: string }) {
  const { L, lang } = useT();
  const db = useDb();
  const repo = useRepo();
  const { toast } = useToast();
  const { restaurant } = useSession();
  const profile = useLive("marketProfiles").data[0] ?? null;
  const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const [f, setF] = useState({ startsOn: addDays(1), endsOn: addDays(7), city: "cairo" as string | null, cuisine: "grills" as string | null, budget: major(2000), headline: { ar: "", en: "" }, cta: { ar: "اطلب دلوقتي", en: "Order now" }, payment: "online" as "online" | "invoice" });
  const [taken, setTaken] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (profile) setF((x) => ({ ...x, city: profile.city, cuisine: profile.cuisines[0] ?? null }));
  }, [profile]);
  const targeting = useMemo(() => ({ city: slot?.type === "city_top" || slot?.type === "marketplace_top" ? f.city : null, cuisine: slot?.type === "cuisine_top" ? f.cuisine : null }), [slot, f.city, f.cuisine]);
  useEffect(() => {
    if (!slot || f.endsOn < f.startsOn) return;
    let off = false;
    slotAvailability(repo, slot, f.startsOn, f.endsOn, targeting).then((d) => !off && setTaken(d), () => undefined);
    return () => {
      off = true;
    };
  }, [repo, slot, f.startsOn, f.endsOn, targeting]);
  if (!slot) return <Dialog open={false} onClose={onClose} />;
  const price = quote(slot, f.startsOn, f.endsOn, f.budget);
  const days = f.endsOn >= f.startsOn ? daysBetween(f.startsOn, f.endsOn) : 0;
  const submit = async () => {
    setBusy(true);
    try {
      await requestBooking(db, { slot, startsOn: f.startsOn, endsOn: f.endsOn, targeting, budget: f.budget, creative: { headline: f.headline.ar ? f.headline : { ar: restaurantName, en: restaurantName }, imageUrl: null, cta: f.cta }, payment: f.payment }, { slug: restaurant?.slug ?? "", lang });
      toast({ title: L("طلب الإعلان اتبعت لسُفرة", "Ad request sent to Sufra"), description: f.payment === "online" ? L("الدفع تم — هيتفعّل بعد المراجعة", "Paid — goes live after review") : L("هتوصلك فاتورة", "An invoice is on its way"), tone: "success" });
      onClose();
    } catch (e) {
      const code = e instanceof BookingError ? e.code : (e as Error).message;
      toast({ title: code === "full" ? L("المكان محجوز في الأيام دي", "The spot is booked on those days") : code === "past" ? L("التاريخ فات", "That date has passed") : code === "budget" ? L("الميزانية أقل من سعر الوحدة", "Budget below the unit price") : L("فيه مشكلة في البيانات", "Please check the details"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!slot} onClose={onClose} size="xl" title={`${L("اشتري إعلان", "Buy an ad")} — ${slot.name[lang]}`} description={`${formatMoney(slot.pricing.rate, { lang })} ${MODEL_LABEL[slot.pricing.model][lang]}`} footer={
      <div className="flex w-full flex-wrap items-center gap-3">
        <div>
          <p className="text-[12.5px] text-muted">{L("الإجمالي", "Total")}</p>
          <p className="num text-[22px] font-semibold">{formatMoney(price, { lang })}</p>
        </div>
        <span className="flex-1" />
        <Button size="lg" icon={f.payment === "online" ? <CreditCard className="size-5" /> : <FileText className="size-5" />} loading={busy} disabled={!!taken.length || !days} onClick={submit}>
          {f.payment === "online" ? L("ادفع واطلب", "Pay & request") : L("اطلب بفاتورة", "Request with invoice")}
        </Button>
      </div>
    }>
      <div className="grid gap-5 pb-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input type="date" label={L("من", "From")} value={f.startsOn} min={today()} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
            <Input type="date" label={L("لحد", "To")} value={f.endsOn} min={f.startsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
            {slot.type === "city_top" || slot.type === "marketplace_top" ? <Select label={L("المدينة", "City")} value={f.city ?? ""} onChange={(e) => setF({ ...f, city: e.target.value || null })} options={[...(slot.type === "marketplace_top" ? [{ value: "", label: cityLabel(null, lang) }] : []), ...CITIES.map((c) => ({ value: c, label: cityLabel(c, lang) }))]} /> : null}
            {slot.type === "cuisine_top" ? <Select label={L("نوع الأكل", "Cuisine")} value={f.cuisine ?? ""} onChange={(e) => setF({ ...f, cuisine: e.target.value || null })} options={CUISINES.map((c) => ({ value: c, label: cuisineLabel(c, lang) }))} /> : null}
            {slot.pricing.model !== "day" ? <MoneyInput label={L("الميزانية", "Budget")} value={f.budget} onChange={(u) => setF({ ...f, budget: u })} hint={L(`حوالي ${Math.floor((f.budget / slot.pricing.rate) * (slot.pricing.model === "cpm" ? 1000 : 1)).toLocaleString("en")} ${slot.pricing.model === "cpm" ? "ظهور" : "ضغطة"}`, `≈ ${Math.floor((f.budget / slot.pricing.rate) * (slot.pricing.model === "cpm" ? 1000 : 1)).toLocaleString("en")} ${slot.pricing.model === "cpm" ? "views" : "clicks"}`)} /> : null}
          </div>
          {taken.length ? <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13px] font-semibold text-danger">{L("محجوز في:", "Fully booked on:")} {taken.slice(0, 6).join("، ")}{taken.length > 6 ? "…" : ""}</p> : days ? <p className="rounded-xl bg-ok-soft px-3 py-2 text-[13px] font-semibold text-ok">{L(`متاح — ${days} يوم`, `Available — ${days} days`)}</p> : null}
          <LocalizedInput label={L("جملة الإعلان", "Headline")} value={f.headline} onChange={(v) => setF({ ...f, headline: v })} />
          <LocalizedInput label={L("الزرار", "Button")} value={f.cta} onChange={(v) => setF({ ...f, cta: v })} />
          <Segmented block label={L("الدفع", "Payment")} value={f.payment} onChange={(p) => setF({ ...f, payment: p })} options={[{ value: "online", label: L("ادفع أونلاين", "Pay online"), icon: <CreditCard /> }, { value: "invoice", label: L("فاتورة", "Invoice"), icon: <FileText /> }]} />
          <p className="text-[12.5px] text-muted">{L("كل إعلان بيتراجع من فريق سُفرة قبل ما يظهر. لو اترفض الفلوس بترجع.", "Every ad is reviewed by the Sufra team before it shows. Rejected ads are refunded.")}</p>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-[13px] font-semibold text-muted">{L("معاينة", "Preview")}</p>
          <SponsoredPreview name={restaurantName} headline={f.headline[lang] || f.headline.ar} color={color} cta={f.cta[lang]} />
        </div>
      </div>
    </Dialog>
  );
}
