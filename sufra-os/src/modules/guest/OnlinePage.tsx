import { startTransition, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Bike, CalendarClock, CalendarDays, Clock3, CreditCard, MapPin, Phone, ShoppingBag, Smartphone, Store, Wallet } from "lucide-react";
import type { OrderMode } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { loadJSON, saveJSON } from "@/lib/storage";
import { Button, Input, Money, Segmented, useToast } from "@/ui";
import { Mark } from "@/shell/Logo";
import { HERO_IMAGE } from "./data/images";
import { openState, pickupSlots, PICKUP_MINUTES, venueMinutes } from "./data/venue";
import { cartCount, cartTotals, type MenuItemView } from "./cart";
import { normalizePhone, type PayChoice } from "./api/service";
import { pickProvider } from "./pay";
import { getNotifier } from "./notify/notifier";
import { GuestProvider, useGuest } from "./ui/context";
import { GuestToggles, Photo, TotalsList } from "./ui/bits";
import { MenuBrowser } from "./ui/Menu";
import { ItemSheet } from "./ui/ItemSheet";
import { CartBar, CartSheet } from "./ui/Cart";
import { formatMoney } from "@/lib/money";

type Kind = "delivery" | "takeaway" | "later";

interface Profile {
  name: string;
  phone: string;
  address: string;
  notes: string;
  zoneId: string;
}
const PROFILE_KEY = "sufra-guest.profile";

/** Online ordering: /r/:slug — delivery, takeaway now, or pickup at a time. */
export default function OnlinePage() {
  const { restaurantSlug = "" } = useParams();
  return (
    <GuestProvider slug={restaurantSlug} tableCode={null}>
      <OnlineView />
    </GuestProvider>
  );
}

function OnlineView() {
  const { slug, menu, venue, svc, cart, clearCart } = useGuest();
  const { L, loc, lang } = useT();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [item, setItem] = useState<MenuItemView | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("delivery");
  const [profile, setProfile] = useState<Profile>(() => ({ name: "", phone: "", address: "", notes: "", zoneId: venue.zones[0]?.id ?? "", ...loadJSON<Partial<Profile>>(PROFILE_KEY, {}) }));
  const [slot, setSlot] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<PayChoice>("cash");
  const [tried, setTried] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [now, setNow] = useState(() => venueMinutes(new Date(), venue.timezone));
  useEffect(() => {
    const id = setInterval(() => setNow(venueMinutes(new Date(), venue.timezone)), 60_000);
    return () => clearInterval(id);
  }, [venue.timezone]);
  useEffect(() => {
    document.title = `${loc(menu.restaurant.name)} · ${L("اطلب أونلاين", "Order online")}`;
  }, [menu, loc, L]);

  const hours = venue.branch?.hours ?? null;
  const st = openState(hours, now);
  const slots = useMemo(() => pickupSlots(hours, now), [hours, now]);
  useEffect(() => {
    if (kind === "later" && !slots.includes(slot)) setSlot(slots[1] ?? slots[0] ?? "");
  }, [kind, slots, slot]);

  const zone = venue.zones.find((z) => z.id === profile.zoneId) ?? null;
  const mode: OrderMode = kind === "delivery" ? "delivery" : "takeaway";
  const fee = kind === "delivery" ? zone?.fee ?? 0 : 0;
  const totals = cartTotals(menu, cart, { mode, tax: venue.tax, deliveryFee: fee });
  const minOk = kind !== "delivery" || !zone || totals.subtotal >= zone.minOrder;
  const phoneOk = !!normalizePhone(profile.phone);
  const online = !!pickProvider(svc.local ? "local" : "supabase");
  const n = cartCount(cart);
  const set = (p: Partial<Profile>) => setProfile((x) => ({ ...x, ...p }));

  const place = async () => {
    setTried(true);
    if (!st.open || !profile.name.trim() || !phoneOk || (kind === "delivery" && (!zone || !profile.address.trim())) || !minOk || (kind === "later" && !slot)) return;
    setPlacing(true);
    try {
      saveJSON(PROFILE_KEY, profile);
      let pickupAt: string | null = null;
      if (kind === "later" && slot) {
        const [h, m] = slot.split(":").map(Number);
        const mins = h * 60 + m;
        const ahead = (mins - now + 1440) % 1440;
        pickupAt = new Date(Date.now() + ahead * 60_000).toISOString();
      }
      const res = await svc.placeOrder(slug, {
        mode,
        lines: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, modifierIds: l.modifierIds, notes: l.notes })),
        customer: { name: profile.name, phone: profile.phone },
        note: note.trim(),
        delivery: kind === "delivery" ? { zoneId: profile.zoneId, address: profile.address, notes: profile.notes } : null,
        pickupAt,
        payment,
      });
      // WhatsApp "order received" (logged preview until the Cloud API is connected)
      void getNotifier()
        .send({
          restaurantId: venue.restaurantId,
          to: profile.phone,
          lang,
          template: "order_received",
          dedupeKey: `${res.orderId}:received`,
          vars: {
            name: profile.name.split(" ")[0],
            number: res.number,
            restaurant: loc(menu.restaurant.name),
            items: cart.map((l) => `${l.qty}× ${loc(menu.items.find((i) => i.id === l.itemId)?.name)}`).join("، "),
            total: formatMoney(totals.total, { lang }),
            payment: payment === "online" ? L("أونلاين", "Online") : payment === "card" ? L("كارت عند الاستلام", "Card on delivery") : L("كاش عند الاستلام", "Cash on delivery"),
            link: `${window.location.origin}${import.meta.env.BASE_URL}r/${slug}/o/${res.orderId}`,
          },
        })
        .catch(() => undefined);
      clearCart();
      setCartOpen(false);
      startTransition(() => navigate(`/r/${slug}/o/${res.orderId}${payment === "online" ? "?pay=1" : ""}`));
    } catch (e) {
      const m = (e as Error).message;
      toast({ title: m === "item_unavailable" ? L("في صنف خلص — راجع طلبك", "An item just sold out — check your order") : L("الطلب ماوصلش، جرّب تاني", "Couldn't place the order, try again"), tone: "error" });
    } finally {
      setPlacing(false);
    }
  };

  const etaText = kind === "delivery" && zone ? L(`${zone.etaMin}–${zone.etaMax} دقيقة`, `${zone.etaMin}–${zone.etaMax} min`) : kind === "takeaway" ? L(`جاهز خلال ~${PICKUP_MINUTES} دقيقة`, `Ready in ~${PICKUP_MINUTES} min`) : slot ? L(`استلام الساعة ${slot}`, `Pickup at ${slot}`) : "";

  const orderType = (
    <div className="grid gap-3 rounded-[24px] border border-line bg-surface p-4 shadow-sf-sm">
      <Segmented
        block
        label={L("نوع الطلب", "Order type")}
        value={kind}
        onChange={setKind}
        options={[
          { value: "delivery", label: L("توصيل", "Delivery"), icon: <Bike /> },
          { value: "takeaway", label: L("تيك أواي", "Takeaway"), icon: <ShoppingBag /> },
          { value: "later", label: L("بميعاد", "Schedule"), icon: <CalendarClock /> },
        ]}
      />
      {kind === "delivery" ? (
        <div className="grid gap-2.5">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="radiogroup" aria-label={L("المنطقة", "Area")}>
            {venue.zones.map((z) => (
              <button key={z.id} type="button" role="radio" aria-checked={profile.zoneId === z.id} onClick={() => set({ zoneId: z.id })} className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors", profile.zoneId === z.id ? "border-primary bg-primary-soft text-primary" : "border-line hover:border-line-strong")}>
                {loc(z.name)}
              </button>
            ))}
          </div>
          {zone ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              <Fact label={L("التوصيل", "Delivery")} value={<Money value={zone.fee} compact />} />
              <Fact label={L("أقل طلب", "Min. order")} value={<Money value={zone.minOrder} compact />} />
              <Fact label={L("الوقت", "ETA")} value={<span className="num" dir="ltr">{zone.etaMin}–{zone.etaMax}′</span>} />
            </div>
          ) : null}
        </div>
      ) : kind === "takeaway" ? (
        <p className="flex items-center gap-2 text-[13.5px] text-muted">
          <Store className="size-4 shrink-0 text-primary" />
          {L(`جاهز خلال ~${PICKUP_MINUTES} دقيقة من فرع`, `Ready in ~${PICKUP_MINUTES} min at`)} {venue.branch ? loc(venue.branch.name) : ""}
        </p>
      ) : (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="radiogroup" aria-label={L("ميعاد الاستلام", "Pickup time")}>
          {slots.length ? (
            slots.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={slot === s} onClick={() => setSlot(s)} className={cn("num h-10 shrink-0 rounded-xl border px-3.5 text-[14px] font-semibold transition-colors", slot === s ? "border-primary bg-primary text-primary-ink" : "border-line")}>
                {s}
              </button>
            ))
          ) : (
            <p className="text-[13.5px] text-muted">{L("مفيش مواعيد متاحة النهارده", "No slots left today")}</p>
          )}
        </div>
      )}
    </div>
  );

  const checkoutFields = (
    <div className="grid gap-4">
      <div className="rounded-2xl bg-surface-2 px-4 py-3 text-[13.5px]">
        <span className="font-semibold">{kind === "delivery" ? L("توصيل", "Delivery") : kind === "takeaway" ? L("تيك أواي", "Takeaway") : L("استلام بميعاد", "Pickup later")}</span>
        <span className="text-muted"> · {etaText}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={L("الاسم", "Name")} value={profile.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" error={tried && !profile.name.trim() ? L("مطلوب", "Required") : undefined} />
        <Input label={L("الموبايل", "Mobile")} value={profile.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" autoComplete="tel" dir="ltr" placeholder="01xxxxxxxxx" error={tried && !phoneOk ? L("رقم موبايل مصري صحيح", "A valid Egyptian mobile") : undefined} hint={L("هنبعتلك حالة الطلب على واتساب", "We'll send order updates on WhatsApp")} />
      </div>
      {kind === "delivery" ? (
        <div className="grid gap-3">
          <Input label={L("العنوان", "Address")} icon={<MapPin />} value={profile.address} onChange={(e) => set({ address: e.target.value })} autoComplete="street-address" placeholder={L("الشارع ورقم العمارة", "Street and building")} error={tried && !profile.address.trim() ? L("مطلوب", "Required") : undefined} />
          <Input label={L("الدور / الشقة / علامة مميزة", "Floor / flat / landmark")} value={profile.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={L("الدور ٣ شقة ٧ — جنب الصيدلية", "3rd floor, flat 7 — next to the pharmacy")} />
        </div>
      ) : null}
      <label className="grid gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">{L("ملاحظات على الطلب", "Order notes")}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} className="resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" placeholder={L("مثلًا: رن الجرس مرة واحدة", "e.g. ring once")} />
      </label>
      <div className="grid gap-2">
        <span className="text-[13px] font-semibold text-ink-2">{L("الدفع", "Payment")}</span>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={L("الدفع", "Payment")}>
          {(
            [
              { v: "cash", icon: <Wallet />, ar: kind === "delivery" ? "كاش عند الاستلام" : "كاش في الفرع", en: kind === "delivery" ? "Cash on delivery" : "Cash at pickup" },
              { v: "card", icon: <CreditCard />, ar: "كارت عند الاستلام", en: "Card on arrival" },
              ...(online ? [{ v: "online", icon: <Smartphone />, ar: "ادفع أونلاين", en: "Pay online" }] : []),
            ] as { v: PayChoice; icon: React.ReactNode; ar: string; en: string }[]
          ).map((o) => (
            <button key={o.v} type="button" role="radio" aria-checked={payment === o.v} onClick={() => setPayment(o.v)} className={cn("flex h-12 items-center gap-2.5 rounded-xl border px-3 text-start text-[14px] font-semibold transition-colors [&_svg]:size-5", payment === o.v ? "border-primary bg-primary-soft text-primary" : "border-line hover:border-line-strong [&_svg]:text-muted")}>
              {o.icon}
              {L(o.ar, o.en)}
            </button>
          ))}
        </div>
      </div>
      {!minOk && zone ? (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px] font-semibold text-warn">
          {L("أقل طلب للمنطقة دي", "Minimum order for this area is")} <Money value={zone.minOrder} compact /> — {L("زوّد", "add")} <Money value={zone.minOrder - totals.subtotal} />
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg pb-32">
      <header className="relative">
        <Photo src={HERO_IMAGE} alt="" eager className="h-[300px] w-full sm:h-[360px]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.5)_0%,rgb(0_0_0/0.08)_35%,rgb(0_0_0/0.78)_100%)]" />
        </Photo>
        <div className="absolute inset-x-0 top-0 mx-auto flex max-w-6xl items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <span className="rounded-full bg-black/30 p-1 backdrop-blur-md">
            <Mark className="size-8" />
          </span>
          <GuestToggles glass />
        </div>
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-6 text-white">
          <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-bold backdrop-blur-md", st.open ? "bg-ok/85" : "bg-black/50")}>
            <span className={cn("size-2 rounded-full", st.open ? "animate-pulse bg-white" : "bg-danger")} />
            {st.open ? L("مفتوح دلوقتي", "Open now") : L("مقفول دلوقتي", "Closed now")}
            {hours ? <span className="num font-semibold opacity-85">· <span dir="ltr">{hours.open}–{hours.close}</span></span> : null}
          </span>
          <h1 className="mt-2 text-[32px] leading-tight drop-shadow-sm sm:text-[40px]">{loc(menu.restaurant.name)}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-white/85">
            {venue.branch ? (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {loc(venue.branch.address)}
              </span>
            ) : null}
            {venue.phone ? (
              <a href={`tel:${venue.phone}`} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                <Phone className="size-3.5" />
                <span className="num" dir="ltr">{venue.phone}</span>
              </a>
            ) : null}
          </p>
          <div className="mt-3 flex gap-2">
            <Link to={`/r/${slug}/book`} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-bold text-[#16211e] shadow transition active:scale-95">
              <CalendarDays className="size-4" />
              {L("احجز ترابيزة", "Book a table")}
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6 lg:px-4">
        <div className="min-w-0">
          <div className="mx-auto -mt-3 max-w-2xl px-4 pb-1 lg:px-0 relative z-10">{orderType}</div>
          {!st.open ? (
            <div className="mx-auto mt-3 max-w-2xl px-4 lg:px-0">
              <p className="flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-[13.5px] font-semibold text-warn">
                <Clock3 className="size-4" />
                {st.opensInMin !== null ? L(`بنفتح كمان ${Math.floor(st.opensInMin / 60)}س ${st.opensInMin % 60}د — تقدر تتفرج على المنيو`, `Opens in ${Math.floor(st.opensInMin / 60)}h ${st.opensInMin % 60}m — browse the menu meanwhile`) : L("مقفول دلوقتي", "Closed now")}
              </p>
            </div>
          ) : null}
          <MenuBrowser onOpen={setItem} />
        </div>

        {/* desktop cart */}
        <aside className="hidden lg:block">
          <div className="sticky top-4 mt-6 grid max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto rounded-[24px] border border-line bg-surface p-5 shadow-sf thin-scrollbar">
            <p className="font-display text-[20px]">{L("طلبك", "Your order")}</p>
            {n ? (
              <>
                <ul className="grid gap-2 text-[14px]">
                  {cart.map((l) => {
                    const it = menu.items.find((i) => i.id === l.itemId);
                    return (
                      <li key={l.key} className="flex justify-between gap-2">
                        <span>
                          <span className="num text-muted">{l.qty}× </span>
                          {loc(it?.name)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <TotalsList totals={totals} vatRate={venue.tax.vatRate} big={false} />
                <Button size="lg" block onClick={() => setCartOpen(true)} disabled={!st.open}>
                  {L("كمّل الطلب", "Checkout")}
                </Button>
              </>
            ) : (
              <p className="py-6 text-center text-[14px] text-muted">{L("اختار أكلك من المنيو", "Pick something from the menu")}</p>
            )}
          </div>
        </aside>
      </div>
      <p className="mt-10 text-center text-[12px] text-faint">{L("بنظام سُفرة", "Powered by Sufra")}</p>

      <div className="lg:hidden">
        <CartBar onOpen={() => setCartOpen(true)} mode={mode} deliveryFee={fee} />
      </div>
      <ItemSheet item={item} onClose={() => setItem(null)} />
      <CartSheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        mode={mode}
        deliveryFee={fee}
        action={
          <Button size="lg" block loading={placing} disabled={!st.open || !n} onClick={place}>
            {!st.open ? L("مقفول دلوقتي", "Closed now") : payment === "online" ? L("كمّل للدفع", "Continue to payment") : L("أكّد الطلب", "Place order")}
          </Button>
        }
      >
        {checkoutFields}
      </CartSheet>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2">
      <p className="text-[11.5px] text-muted">{label}</p>
      <p className="text-[14.5px] font-bold">{value}</p>
    </div>
  );
}
