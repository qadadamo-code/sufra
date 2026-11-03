/** /r/:slug/gift — buy an e-gift card: amount, from/to, message → pay (payments intent API) → the card with its QR. */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Gift, MessageCircle } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { GiftCard } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, major, type Units } from "@/lib/money";
import { loadJSON, saveJSON } from "@/lib/storage";
import { clickToChatUrl } from "@/lib/notify/core";
import { Button, Input, Money, Spinner, Textarea, useToast } from "@/ui";
import { Mark } from "@/shell/Logo";
import { GuestToggles } from "@/modules/guest/ui/bits";
import { useGuestService } from "@/modules/guest/ui/context";
import { QrSvg } from "@/modules/guest/qr/QrSvg";
import { attachDemoRepo, providerFor } from "@/modules/guest/pay";
import { normalizePhone } from "@/modules/guest/api/service";
import { createPaymentIntent, onIntentSucceeded } from "@/modules/payments/api";
import { giftCardCode } from "@/lib/promo/giftcards";
import { PromoPublic } from "./api";

const DRAFT = (slug: string) => `sufra-guest.gift.${slug}`;
interface Draft {
  /** card code reserved before paying (the intent's purposeRef) */
  code?: string;
  amount: Units;
  buyer: { name: string; phone: string };
  to: { name: string; phone: string; message: string };
}

export default function GiftPage() {
  const { restaurantSlug = "" } = useParams();
  const [params] = useSearchParams();
  const repo = useRepo();
  const api = useMemo(() => new PromoPublic(repo), [repo]);
  const svc = useGuestService();
  const { L, lang, loc } = useT();
  const { toast } = useToast();
  const [venue, setVenue] = useState<{ id: string; name: string; color: string } | null>(null);
  const [d, setD] = useState<Draft>(() => loadJSON<Draft>(DRAFT(restaurantSlug), { amount: major(500), buyer: { name: "", phone: "" }, to: { name: "", phone: "", message: "" } }));
  const [card, setCard] = useState<GiftCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(!!params.get("pi"));
  const [tried, setTried] = useState(false);

  useEffect(() => {
    svc.venue(restaurantSlug).then((v) => v && setVenue({ id: v.restaurantId, name: loc(v.name), color: v.brandColor }), () => undefined);
  }, [svc, restaurantSlug]); // eslint-disable-line react-hooks/exhaustive-deps
  // payments API hook: the card is issued as soon as the gift_card intent succeeds (idempotent by intent id)
  useEffect(
    () =>
      onIntentSucceeded("gift_card", async (row) => {
        if (row.restaurantId !== venue?.id) return;
        const draft = loadJSON<Draft | null>(DRAFT(restaurantSlug), null);
        const c = await api.issueGiftCard(restaurantSlug, { amount: row.amount, purchaser: row.customer ?? { name: "", phone: "" }, recipient: draft?.to.name ? draft.to : null, intentId: row.id, code: row.purposeRef ?? undefined });
        setCard(c);
      }),
    [api, restaurantSlug, venue?.id],
  );
  useEffect(() => {
    const pi = params.get("pi");
    if (!pi) return;
    attachDemoRepo(repo);
    (async () => {
      try {
        const intent = await providerFor(pi).retrieve(pi);
        if (intent?.status === "succeeded") {
          const draft = loadJSON<Draft | null>(DRAFT(restaurantSlug), null) ?? d;
          const c = await api.issueGiftCard(restaurantSlug, { amount: intent.amount, purchaser: draft.buyer, recipient: draft.to.name ? draft.to : null, intentId: pi, code: (intent.request.purposeRef as string | null | undefined) ?? draft.code });
          setCard(c);
          saveJSON(DRAFT(restaurantSlug), null);
        } else if (intent) toast({ title: L("الدفع ماتمش", "The payment didn't go through"), tone: "error" });
      } finally {
        setChecking(false);
      }
    })();
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    setTried(true);
    if (!d.buyer.name.trim() || !normalizePhone(d.buyer.phone) || d.amount < major(100) || !venue) return;
    setBusy(true);
    try {
      const code = giftCardCode();
      saveJSON(DRAFT(restaurantSlug), { ...d, code });
      const pi = await createPaymentIntent(repo, {
        restaurantId: venue.id, restaurantSlug, kind: "gift_card", purposeRef: code, amount: d.amount, currency: "EGP", customer: { name: d.buyer.name, phone: normalizePhone(d.buyer.phone)! }, note: L("كارت هدية", "Gift card"),
        returnUrl: `${window.location.origin}${import.meta.env.BASE_URL}r/${restaurantSlug}/gift?pi={pi}`, lang,
      });
      if (pi.redirectUrl) window.location.assign(pi.redirectUrl);
    } catch {
      toast({ title: L("الدفع مش متاح دلوقتي", "Payment isn't available right now"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const color = venue?.color ?? "#0d5a53";
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
        <section className="relative overflow-hidden rounded-[28px] p-6 text-white shadow-sf-lg" style={{ background: `linear-gradient(140deg, ${color}, color-mix(in srgb, var(--sf-brass) 65%, #0b1412))` }}>
          <span aria-hidden className="absolute -end-10 -top-14 size-44 rounded-full bg-white/10" />
          <Gift className="size-9 opacity-90" />
          <p className="mt-3 text-[14px] opacity-80">{L("كارت هدية", "Gift card")} · {venue?.name}</p>
          <p className="mt-1 font-display text-[40px] font-semibold leading-none"><Money value={card?.initial ?? d.amount} /></p>
          {card ? <p className="num mt-4 text-[18px] tracking-wider" dir="ltr">{card.code}</p> : <p className="mt-4 text-[13.5px] opacity-85">{d.to.name ? L(`لـ ${d.to.name}`, `For ${d.to.name}`) : L("هدية لحد بتحبه", "For someone you love")}</p>}
        </section>

        {checking ? (
          <div className="grid h-40 place-items-center"><Spinner /></div>
        ) : card ? (
          <section className="grid place-items-center gap-3 rounded-[22px] border border-line bg-surface p-5 text-center">
            <p className="text-[18px] font-bold">{L("الكارت جاهز 🎉", "Your card is ready 🎉")}</p>
            <div className="rounded-2xl bg-white p-3"><QrSvg value={card.code} fg="#0b1412" className="size-40" /></div>
            <p className="text-[13.5px] text-muted">{L("ورّي الكود أو الـ QR للكاشير — بيتخصم من الرصيد ويفضل الباقي للمرة الجاية.", "Show the code or QR at the cashier — the balance carries over.")}</p>
            {card.recipient?.phone ? (
              <a href={clickToChatUrl(card.recipient.phone, L(`🎁 ${card.purchaser?.name ?? ""} بعتلك كارت هدية من ${venue?.name} بـ ${formatMoney(card.initial, { lang: "ar" })}\nالكود: ${card.code}\n${card.recipient.message}`, `🎁 ${card.purchaser?.name ?? ""} sent you a ${venue?.name} gift card worth ${formatMoney(card.initial, { lang: "en" })}\nCode: ${card.code}\n${card.recipient.message}`))} target="_blank" rel="noreferrer" className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#1fa855] px-5 font-semibold text-white">
                <MessageCircle className="size-5" /> {L("ابعته على واتساب", "Send it on WhatsApp")}
              </a>
            ) : null}
          </section>
        ) : (
          <section className="grid gap-4 rounded-[22px] border border-line bg-surface p-5">
            <div className="flex flex-wrap gap-2">
              {[250, 500, 1000, 2000].map((v) => (
                <button key={v} type="button" onClick={() => setD({ ...d, amount: major(v) })} className={`num h-12 flex-1 rounded-xl border px-3 text-[16px] font-semibold ${d.amount === major(v) ? "border-primary bg-primary text-primary-ink" : "border-line hover:bg-surface-2"}`}>{v}</button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label={L("اسمك", "Your name")} value={d.buyer.name} onChange={(e) => setD({ ...d, buyer: { ...d.buyer, name: e.target.value } })} error={tried && !d.buyer.name.trim() ? L("مطلوب", "Required") : undefined} />
              <Input label={L("موبايلك", "Your mobile")} dir="ltr" inputMode="tel" value={d.buyer.phone} onChange={(e) => setD({ ...d, buyer: { ...d.buyer, phone: e.target.value } })} error={tried && !normalizePhone(d.buyer.phone) ? L("رقم صحيح", "Valid number") : undefined} />
              <Input label={L("اسم اللي هيستلمه", "Recipient name")} value={d.to.name} onChange={(e) => setD({ ...d, to: { ...d.to, name: e.target.value } })} />
              <Input label={L("موبايله (هنبعتله على واتساب)", "Their mobile (WhatsApp)")} dir="ltr" inputMode="tel" value={d.to.phone} onChange={(e) => setD({ ...d, to: { ...d.to, phone: e.target.value } })} />
            </div>
            <Textarea label={L("رسالة", "Message")} value={d.to.message} onChange={(e) => setD({ ...d, to: { ...d.to, message: e.target.value } })} placeholder={L("كل سنة وانت طيب ❤️", "Happy birthday ❤️")} />
            <Button size="lg" block loading={busy} onClick={pay}>{L("ادفع", "Pay")} {formatMoney(d.amount, { lang })}</Button>
            <p className="text-[12px] text-faint">{L("الكارت صالح سنة من تاريخ الشراء. مش بيترد كاش.", "Valid for a year from purchase. Not exchangeable for cash.")}</p>
          </section>
        )}
      </main>
    </div>
  );
}
