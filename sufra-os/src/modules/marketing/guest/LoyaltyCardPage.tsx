/**
 * /r/:slug/me — the guest's loyalty card: points, tier, QR to scan at the POS, stamps, rewards, coupons, history,
 * refer-a-friend. Sign-in for the demo is OTP-less (phone + the number of any past order); production sends a
 * one-time code over WhatsApp (marketing/DESIGN.md → "Guest sign-in").
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Crown, Gift, LogOut, Share2, Sparkles, Ticket, Wallet } from "lucide-react";
import { useRepo } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { loadJSON, saveJSON } from "@/lib/storage";
import { dayLabel } from "@/lib/time";
import { referralShareText } from "@/lib/promo";
import { clickToChatUrl } from "@/lib/notify/core";
import { Badge, Button, Input, Meter, Money, Spinner, Switch, useToast } from "@/ui";
import { Mark } from "@/shell/Logo";
import { GuestToggles } from "@/modules/guest/ui/bits";
import { FeedbackCard } from "@/modules/guest/ui/AfterMeal";
import { useGuestService } from "@/modules/guest/ui/context";
import { QrSvg } from "@/modules/guest/qr/QrSvg";
import { PromoPublic, PromoError, type LoyaltyCard } from "./api";

const KEY = (slug: string) => `sufra-guest.card.${slug}`;

export default function LoyaltyCardPage() {
  const { restaurantSlug = "" } = useParams();
  const [params] = useSearchParams();
  const repo = useRepo();
  const api = useMemo(() => new PromoPublic(repo), [repo]);
  const svc = useGuestService();
  const { L, loc } = useT();
  const [card, setCard] = useState<LoyaltyCard | null | undefined>(undefined);
  const [venue, setVenue] = useState<{ name: string; color: string } | null>(null);

  useEffect(() => {
    svc.venue(restaurantSlug).then((v) => v && setVenue({ name: loc(v.name), color: v.brandColor }), () => undefined);
    const saved = loadJSON<{ customerId: string; phone: string } | null>(KEY(restaurantSlug), null);
    if (!saved) return setCard(null);
    api.cardById(restaurantSlug, saved.customerId, saved.phone).then((c) => setCard(c), () => setCard(null));
  }, [api, svc, restaurantSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.title = `${venue?.name ?? "Sufra"} · ${L("كارت الولاء", "Loyalty card")}`;
  }, [venue, L]);

  const signedIn = (c: LoyaltyCard) => {
    saveJSON(KEY(restaurantSlug), { customerId: c.customer.id, phone: c.customer.phone });
    setCard(c);
  };

  return (
    <div className="min-h-dvh bg-bg pb-16">
      <header className="mx-auto flex max-w-xl items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+14px)]">
        <Link to={`/r/${restaurantSlug}`} className="inline-flex items-center gap-2 text-[14px] font-semibold text-muted hover:text-ink">
          <ArrowLeft className="size-4 flip-rtl" />
          <Mark className="size-7" />
          <span className="max-w-[12rem] truncate">{venue?.name}</span>
        </Link>
        <GuestToggles />
      </header>
      <main className="mx-auto grid max-w-xl gap-5 px-4 pt-5">
        {card === undefined ? (
          <div className="grid h-64 place-items-center"><Spinner /></div>
        ) : card ? (
          <CardView card={card} slug={restaurantSlug} venue={venue} onSignOut={() => (saveJSON(KEY(restaurantSlug), null), setCard(null))} />
        ) : (
          <SignIn slug={restaurantSlug} api={api} onCard={signedIn} />
        )}
        {params.get("feedback") ? <FeedbackCard svc={svc} slug={restaurantSlug} /> : null}
        <p className="text-center text-[12px] text-faint">{L("بنظام سُفرة", "Powered by Sufra")}</p>
      </main>
    </div>
  );
}

function SignIn({ slug, api, onCard }: { slug: string; api: PromoPublic; onCard: (c: LoyaltyCard) => void }) {
  const { L } = useT();
  const { toast } = useToast();
  const [mode, setMode] = useState<"in" | "join">("in");
  const [f, setF] = useState({ name: "", phone: "", proof: "", ref: "", whatsapp: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (mode === "join") {
        const j = await api.join(slug, { name: f.name, phone: f.phone, whatsapp: f.whatsapp, referralCode: f.ref || null });
        const c = await api.cardById(slug, j.customerId, j.phone);
        if (c) onCard(c);
        toast({ title: j.welcome ? L(`أهلًا بيك! ${j.welcome} نقطة هدية 🎉`, `Welcome! ${j.welcome} bonus points 🎉`) : L("أهلًا بيك في النادي", "Welcome to the club"), description: j.refereeCode ? L(`كود هدية صاحبك: ${j.refereeCode}`, `Your friend's gift code: ${j.refereeCode}`) : undefined, tone: "success" });
      } else onCard(await api.loyaltyCard(slug, f.phone, f.proof));
    } catch (e) {
      const c = e instanceof PromoError ? e.code : "";
      setErr(
        c === "bad_phone" ? L("رقم موبايل مصري صحيح", "A valid Egyptian mobile")
        : c === "not_member" ? L("الرقم ده مش مسجّل — سجّل في النادي", "This number isn't a member — join below")
        : c === "bad_proof" ? L("رقم الطلب مش مظبوط", "That order number doesn't match")
        : c.startsWith("referral_") ? L("كود الترشيح مش صالح", "That referral code isn't valid")
        : L("حصلت مشكلة، جرّب تاني", "Something went wrong, try again"),
      );
      if (c === "not_member") setMode("join");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="grid gap-4 rounded-[26px] border border-line bg-surface p-5 shadow-sf">
      <div className="flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-brass-soft text-brass"><Crown className="size-6" /></span>
        <div>
          <h1 className="text-[22px] leading-tight">{mode === "in" ? L("كارت الولاء بتاعك", "Your loyalty card") : L("انضم للنادي", "Join the club")}</h1>
          <p className="text-[13.5px] text-muted">{mode === "in" ? L("نقاطك ومكافآتك والـ QR اللي بيتمسح عند الكاشير", "Your points, rewards and the QR the cashier scans") : L("٥٠ نقطة هدية أول ما تسجّل", "50 bonus points when you join")}</p>
        </div>
      </div>
      {mode === "join" ? <Input label={L("الاسم", "Name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /> : null}
      <Input label={L("الموبايل", "Mobile")} dir="ltr" inputMode="tel" autoComplete="tel" placeholder="01xxxxxxxxx" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      {mode === "in" ? (
        <Input label={L("رقم آخر طلب", "Last order number")} dir="ltr" inputMode="numeric" value={f.proof} onChange={(e) => setF({ ...f, proof: e.target.value })} hint={L("مكتوب على الإيصال (#57). لو ماطلبتش قبل كده: آخر ٤ أرقام من موبايلك (تجريبي)", "Printed on the receipt (#57). Never ordered? The last 4 digits of your phone (demo)")} />
      ) : (
        <>
          <Input label={L("كود ترشيح صاحبك (اختياري)", "Friend's referral code (optional)")} dir="ltr" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} placeholder="SUF-XXXXX" />
          <Switch checked={f.whatsapp} onChange={(v) => setF({ ...f, whatsapp: v })} label={L("ابعتولي العروض على واتساب", "Send me offers on WhatsApp")} description={L("تقدر تلغي في أي وقت برسالة «إلغاء»", "Opt out any time by replying STOP")} />
        </>
      )}
      {err ? <p className="text-[13px] font-semibold text-danger">{err}</p> : null}
      <Button size="lg" block loading={busy} onClick={go}>
        {mode === "in" ? L("افتح الكارت", "Open my card") : L("سجّلني", "Join")}
      </Button>
      <button type="button" className="text-[13.5px] font-semibold text-primary" onClick={() => (setMode(mode === "in" ? "join" : "in"), setErr(null))}>
        {mode === "in" ? L("مش عضو؟ سجّل دلوقتي", "Not a member? Join now") : L("عضو بالفعل؟ افتح كارتك", "Already a member? Open your card")}
      </button>
      <p className="text-[12px] text-faint">{L("بنسجّل موافقتك على الرسايل حسب قانون حماية البيانات الشخصية (١٥١ لسنة ٢٠٢٠).", "We record your messaging consent under Egypt's personal data protection law (151/2020).")}</p>
    </section>
  );
}

function CardView({ card, slug, venue, onSignOut }: { card: LoyaltyCard; slug: string; venue: { name: string; color: string } | null; onSignOut: () => void }) {
  const { L, lang, loc } = useT();
  const tier = card.tier;
  const color = tier?.color ?? venue?.color ?? "#0d5a53";
  const value = card.points * card.program.pointValue;
  const link = `${window.location.origin}${import.meta.env.BASE_URL}r/${slug}/me`;
  const share = card.customer.referralCode ? clickToChatUrl(null, referralShareText(lang, venue?.name ?? "", card.customer.referralCode, link, lang === "ar" ? "٥٠ ج خصم" : "EGP 50 off")) : null;
  return (
    <>
      <section className="relative overflow-hidden rounded-[28px] p-5 text-white shadow-sf-lg" style={{ background: `linear-gradient(140deg, ${color}, color-mix(in srgb, ${color} 40%, #0b1412))` }}>
        <span aria-hidden className="absolute -end-10 -top-16 size-48 rounded-full bg-white/10" />
        <span aria-hidden className="absolute -bottom-20 start-10 size-40 rounded-full bg-white/5" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold opacity-80">{loc(card.program.name)}</p>
            <p className="mt-1 text-[20px] font-bold">{card.customer.name}</p>
            {tier ? <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-white/18 px-2.5 py-1 text-[12.5px] font-bold"><Crown className="size-3.5" />{loc(tier.name)}</p> : null}
          </div>
          <div className="rounded-2xl bg-white p-2 shadow-sf">
            <QrSvg value={`SUFRA:${card.customer.phone}`} fg="#0b1412" className="size-24" title={L("امسحه عند الكاشير", "Scan at the cashier")} />
          </div>
        </div>
        <div className="relative mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-[12.5px] opacity-75">{L("نقاطك", "Your points")}</p>
            <p className="num font-display text-[44px] font-semibold leading-none">{card.points.toLocaleString("en")}</p>
            <p className="mt-1 text-[13px] opacity-85">= {formatMoney(value, { lang })}</p>
          </div>
          <p className="num text-[12px] opacity-70" dir="ltr">{card.customer.phone}</p>
        </div>
      </section>

      {card.next ? (
        <section className="grid gap-2 rounded-[22px] border border-line bg-surface p-4">
          <div className="flex justify-between text-[13.5px]">
            <span className="font-semibold">{L(`باقي ${card.next.missing} نقطة على`, `${card.next.missing} points to`)} {loc(card.next.tier.name)}</span>
            <span className="text-muted">{card.next.tier.perks.map((p) => loc(p)).filter(Boolean).slice(0, 1).join("")}</span>
          </div>
          <Meter value={card.lifetime / card.next.tier.minPoints} tone="brass" label={L("التقدم", "Progress")} />
        </section>
      ) : null}
      {card.expiringSoon ? <p className="rounded-2xl bg-warn-soft px-4 py-3 text-[13.5px] font-semibold text-warn">{L(`${card.expiringSoon.points} نقطة هتنتهي ${dayLabel(card.expiringSoon.at, "ar")} — استخدمها!`, `${card.expiringSoon.points} points expire ${dayLabel(card.expiringSoon.at, "en")} — use them!`)}</p> : null}

      {card.program.stampCards.map((s) => {
        const have = card.stamps[s.id] ?? 0;
        return (
          <section key={s.id} className="grid gap-3 rounded-[22px] border border-line bg-surface p-4">
            <p className="font-bold">{loc(s.name)}</p>
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: s.required }, (_, i) => (
                <span key={i} className={`grid aspect-square place-items-center rounded-full border-2 text-[15px] ${i < have ? "border-brass bg-brass text-brass-ink" : "border-dashed border-line-strong text-faint"}`}>{i === s.required - 1 ? "🎁" : i < have ? "☕" : ""}</span>
              ))}
            </div>
            <p className="text-[12.5px] text-muted">{L(`${have} من ${s.required}`, `${have} of ${s.required}`)}</p>
          </section>
        );
      })}

      <section className="grid gap-3 rounded-[22px] border border-line bg-surface p-4">
        <p className="inline-flex items-center gap-2 font-bold"><Gift className="size-5 text-brass" />{L("بدّل نقاطك", "Redeem your points")}</p>
        <ul className="grid gap-2">
          {card.program.rewards.map((r) => {
            const ok = card.points >= r.cost;
            return (
              <li key={r.id} className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 ${ok ? "bg-brass-soft" : "bg-surface-2 opacity-70"}`}>
                <span className="font-semibold">{loc(r.name)}</span>
                <Badge tone={ok ? "brass" : "neutral"}>{r.cost} {L("نقطة", "pts")}</Badge>
              </li>
            );
          })}
        </ul>
        <p className="text-[12.5px] text-muted">{L("قول للكاشير أو الجرسون ورّيه الـ QR — أو استخدم نقاطك وانت بتطلب أونلاين.", "Tell the cashier or waiter and show the QR — or use your points when ordering online.")}</p>
      </section>

      {card.codes.filter((c) => !c.usedAt).length ? (
        <section className="grid gap-2 rounded-[22px] border border-line bg-surface p-4">
          <p className="inline-flex items-center gap-2 font-bold"><Ticket className="size-5 text-primary" />{L("كوبوناتك", "Your coupons")}</p>
          {card.codes.filter((c) => !c.usedAt).map((c) => (
            <div key={c.code} className="flex items-center justify-between gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary-soft/50 px-3 py-2.5">
              <span className="text-[13.5px] font-semibold">{loc(c.name)}</span>
              <span className="num font-bold text-primary" dir="ltr">{c.code}</span>
            </div>
          ))}
        </section>
      ) : null}

      {share ? (
        <section className="grid gap-3 rounded-[22px] border border-line bg-surface p-4">
          <p className="inline-flex items-center gap-2 font-bold"><Share2 className="size-5 text-primary" />{L("هات صاحبك", "Refer a friend")}</p>
          <p className="text-[13.5px] text-muted">{L("صاحبك ياخد ٥٠ ج خصم على أول طلب، وانت تاخد نقاط لما ييجي.", "Your friend gets EGP 50 off their first order; you get points when they visit.")}</p>
          <div className="flex items-center gap-2">
            <span className="num flex-1 rounded-xl bg-surface-2 px-3 py-2.5 text-center text-[17px] font-bold tracking-wider" dir="ltr">{card.customer.referralCode}</span>
            <a href={share} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1fa855] px-4 font-semibold text-white">{L("ابعت", "Share")}</a>
          </div>
        </section>
      ) : null}

      <section className="grid gap-2 rounded-[22px] border border-line bg-surface p-4">
        <p className="inline-flex items-center gap-2 font-bold"><Sparkles className="size-5 text-brass" />{L("آخر الحركات", "Recent activity")}</p>
        <ul className="grid gap-1 text-[13.5px]">
          {card.history.map((h, i) => (
            <li key={i} className="flex items-center justify-between gap-2 py-1">
              <span>{h.kind === "earn" ? L("زيارة", "Visit") : h.kind === "redeem" ? L("استبدال", "Redeemed") : h.kind === "bonus" ? L("هدية", "Bonus") : h.kind === "expire" ? L("انتهت", "Expired") : L("تعديل", "Adjusted")} · <span className="text-muted">{dayLabel(h.at, lang)}</span>{h.spend ? <span className="text-muted"> · <Money value={h.spend} compact /></span> : null}</span>
              <span className={`num font-semibold ${h.points > 0 ? "text-ok" : "text-muted"}`}>{h.points > 0 ? "+" : ""}{h.points}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid gap-2 rounded-[22px] border border-line bg-surface p-4">
        <p className="inline-flex items-center gap-2 font-bold"><Wallet className="size-5" />{L("ضيفه للمحفظة", "Add to wallet")}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled>Apple Wallet · {L("قريبًا", "soon")}</Button>
          <Button variant="secondary" disabled>Google Wallet · {L("قريبًا", "soon")}</Button>
        </div>
      </section>

      {card.program.terms[lang] ? <p className="px-1 text-[12px] text-muted">{loc(card.program.terms)}</p> : null}
      <Button variant="ghost" icon={<LogOut className="size-4" />} onClick={onSignOut}>{L("خروج من الكارت", "Sign out of the card")}</Button>
    </>
  );
}
