import { useMemo, useState } from "react";
import { Banknote, Bike, CreditCard, ShoppingBag, Store, Ticket, UtensilsCrossed } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import { BreakdownTable } from "@/components/sufra/Breakdown";
import { Photo } from "@/components/sufra/Photo";
import { areaName, areas, byId, itemIndex, serviceRateOf } from "@/lib/data";
import { useLang } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { applyCode } from "@/lib/offers";
import { egp, formatMoney, priceBreakdown, type PriceMode } from "@/lib/pricing";
import { navigate } from "@/lib/router";
import { addVisit, cartAdd, cartClear, updateAccount, useAccount, useStore, type Order } from "@/lib/store";
import { cn } from "@/lib/utils";

export default function Checkout() {
  const { L, lang } = useLang();
  const cart = useStore((s) => s.cart);
  const acc = useAccount();
  const r = cart ? byId[cart.rid] : null;
  const [mode, setMode] = useState<PriceMode>(r?.delivery ? "delivery" : "pickup");
  const [area, setArea] = useState(acc?.profile.homeArea ?? "downtown");
  const [street, setStreet] = useState("");
  const [payment, setPayment] = useState<"cash" | "card">("cash");
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [codeMsg, setCodeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [table, setTable] = useState("");

  const lines = useMemo(() => (cart?.lines ?? []).map((l) => ({ ...l, ...itemIndex[l.itemId] })).filter((l) => l.item), [cart]);
  const subtotal = lines.reduce((a, l) => a + egp(l.item.price) * l.qty, 0);
  const now = new Date();
  const res = r && applied ? applyCode(r, applied, { subtotal, mode, now }) : null;
  const okRes = res && res.ok ? res : null;
  const fee = mode === "delivery" && r?.delivery ? (okRes?.freeDelivery ? 0 : egp(r.delivery.fee)) : 0;
  const serviceRate = r ? serviceRateOf(r) : 0.12;
  const b = priceBreakdown({ lines: lines.map((l) => ({ unitPrice: egp(l.item.price), qty: l.qty })), mode, serviceRate, discount: okRes?.discount ?? null, deliveryFee: fee });
  const belowMin = mode === "delivery" && r?.delivery ? subtotal < egp(r.delivery.min) : false;
  const walletCodes = acc && r ? acc.wallet.filter((w) => w.rid === r.id) : [];

  if (!r || !lines.length) {
    return (
      <div className="wrap gutter grid min-h-[55vh] place-items-center text-center">
        <div>
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-card"><ShoppingBag className="size-7 text-muted-foreground" aria-hidden /></span>
          <h1 className="mt-4 text-3xl font-bold">{L("السلة فاضية", "Your cart is empty")}</h1>
          <a href="#/explore" className="sf-btn sf-btn-primary mt-5">{L("استكشف المطاعم", "Explore restaurants")}</a>
        </div>
      </div>
    );
  }

  const tryCode = (c: string) => {
    const out = applyCode(r, c, { subtotal, mode, now });
    if (out.ok) {
      setApplied(c.trim().toUpperCase());
      setCodeMsg({ ok: true, text: out.note ? out.note[lang] : L(`اتطبق: ${out.offer.ar}`, `Applied: ${out.offer.en}`) });
    } else {
      setApplied(null);
      setCodeMsg({ ok: false, text: out.reason[lang] });
    }
  };

  const place = async () => {
    if (!acc) throw new Error("auth");
    if (belowMin) throw new Error("min");
    if (mode === "delivery" && !street.trim()) throw new Error("address");
    await new Promise((res) => setTimeout(res, 1200));
    const o: Order = {
      id: "o-" + Date.now().toString(36),
      rid: r.id,
      lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unit: egp(l.item.price) })),
      mode,
      breakdown: b,
      code: okRes ? applied ?? undefined : undefined,
      address: mode === "delivery" ? `${street.trim()}، ${areaName(area, "ar")}` : mode === "dine-in" ? L(`ترابيزة ${table || "—"}`, `Table ${table || "—"}`) : undefined,
      payment,
      createdAt: Date.now(),
      stepSec: 9,
    };
    updateAccount((a) => ({ ...a, orders: [o, ...a.orders], points: a.points + Math.floor(b.total / 1000) }));
    addVisit(0);
    window.setTimeout(() => {
      cartClear();
      navigate(`/order/${o.id}`);
    }, 600);
  };

  const modes: { id: PriceMode; label: string; sub: string; Icon: typeof Bike; disabled?: boolean }[] = [
    { id: "delivery", label: L("توصيل", "Delivery"), sub: r.delivery ? L(`~${r.delivery.eta} دقيقة · ${r.delivery.fee} ج.م`, `~${r.delivery.eta} min · EGP ${r.delivery.fee}`) : L("مش متاح", "Not available"), Icon: Bike, disabled: !r.delivery },
    { id: "pickup", label: L("استلام من المطعم", "Pickup"), sub: L("جاهز في 20 دقيقة", "Ready in ~20 min"), Icon: Store },
    { id: "dine-in", label: L("في المطعم", "Dine-in"), sub: L(`اطلب من الترابيزة · خدمة ${Math.round(serviceRate * 100)}٪`, `Order at your table · ${Math.round(serviceRate * 100)}% service`), Icon: UtensilsCrossed },
  ];

  return (
    <div className="wrap gutter pb-16 pt-6">
      <p className="sf-kicker">{L("الخطوة الأخيرة", "Last step")}</p>
      <h1 className="text-[32px] font-bold sm:text-[44px]">{L("تأكيد الطلب", "Checkout")}</h1>
      <p className="text-muted-foreground">
        {L("من", "From")} <a href={`#/r/${r.slug}`} className="font-semibold text-primary hover:underline">{r[lang]}</a>
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_400px]">
        <div className="grid content-start gap-6">
          <section className="sf-card p-5" aria-labelledby="mode-h">
            <h2 id="mode-h" className="text-lg font-bold">{L("هتاخده إزاي؟", "How do you want it?")}</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="mode-h">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  disabled={m.disabled}
                  onClick={() => setMode(m.id)}
                  className={cn("flex items-start gap-3 rounded-2xl border bg-background p-3 text-start transition-colors disabled:opacity-45", mode === m.id && "border-primary bg-primary-soft")}
                >
                  <m.Icon className={cn("mt-0.5 size-5 shrink-0", mode === m.id ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  <span>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="block text-xs text-muted-foreground">{m.sub}</span>
                  </span>
                </button>
              ))}
            </div>
            {mode === "delivery" ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[200px_1fr]">
                <label>
                  <span className="sf-label">{L("المنطقة", "Area")}</span>
                  <select className="sf-input" value={area} onChange={(e) => setArea(e.target.value)}>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a[lang]}</option>)}
                  </select>
                </label>
                <label>
                  <span className="sf-label">{L("العنوان بالتفصيل", "Street address")}</span>
                  <input className="sf-input" value={street} onChange={(e) => setStreet(e.target.value)} placeholder={L("الشارع، رقم العمارة، الدور، الشقة", "Street, building, floor, flat")} autoComplete="street-address" />
                </label>
              </div>
            ) : mode === "dine-in" ? (
              <label className="mt-4 block max-w-xs">
                <span className="sf-label">{L("رقم الترابيزة (اختياري)", "Table number (optional)")}</span>
                <input className="sf-input num" inputMode="numeric" value={table} onChange={(e) => setTable(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              </label>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">{lang === "ar" ? r.addressAr : r.addressEn}</p>
            )}
            {belowMin ? <p className="mt-3 rounded-xl bg-warn-soft px-3 py-2 text-sm">{L(`أقل طلب للتوصيل ${r.delivery!.min} ج.م — ضيف حاجة كمان.`, `Minimum for delivery is EGP ${r.delivery!.min} — add a little more.`)}</p> : null}
          </section>

          <section className="sf-card p-5" aria-labelledby="items-h">
            <h2 id="items-h" className="text-lg font-bold">{L("الطلب", "Your order")}</h2>
            <ul className="mt-2 divide-y">
              {lines.map((l) => (
                <li key={l.itemId} className="flex items-center gap-3 py-3">
                  <Photo k={l.item.img} label={l.item[lang]} className="size-14 shrink-0 rounded-xl" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.item[lang]}</p>
                    <p className="num whitespace-nowrap text-sm text-muted-foreground">{l.qty} × {formatMoney(egp(l.item.price), lang)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" className="grid size-8 place-items-center rounded-full border" onClick={() => cartAdd(r.id, l.itemId, -1)} aria-label={L("أقل", "Fewer")}>−</button>
                    <button type="button" className="grid size-8 place-items-center rounded-full border" onClick={() => cartAdd(r.id, l.itemId, 1)} aria-label={L("أكتر", "More")}>+</button>
                  </div>
                  <span className="num shrink-0 whitespace-nowrap text-end font-semibold sm:w-24">{formatMoney(egp(l.item.price) * l.qty, lang)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="sf-card p-5" aria-labelledby="pay-h">
            <h2 id="pay-h" className="text-lg font-bold">{L("الدفع", "Payment")}</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-labelledby="pay-h">
              {[
                { id: "cash" as const, label: L("كاش عند الاستلام", "Cash on delivery / pickup"), Icon: Banknote },
                { id: "card" as const, label: L("كارت مع المندوب أو في المطعم", "Card on delivery / at the counter"), Icon: CreditCard },
              ].map((p) => (
                <button key={p.id} type="button" role="radio" aria-checked={payment === p.id} onClick={() => setPayment(p.id)} className={cn("flex items-center gap-3 rounded-2xl border bg-background p-3 text-start", payment === p.id && "border-primary bg-primary-soft")}>
                  <p.Icon className="size-5 text-primary" aria-hidden />
                  <span className="font-medium">{p.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{L("نسخة تجريبية: مفيش دفع أونلاين ومش هنطلب بيانات كارت.", "Demo: no online payment, we never ask for card details.")}</p>
          </section>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="sf-card p-5">
            <h2 className="text-lg font-bold">{L("الحساب", "Summary")}</h2>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                tryCode(code);
              }}
            >
              <label className="relative flex-1">
                <span className="sr-only">{L("كود الخصم", "Offer code")}</span>
                <Ticket className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-brass" aria-hidden />
                <input className="sf-input num ps-9 uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder={L("كود الخصم", "Offer code")} />
              </label>
              <button type="submit" className="sf-btn sf-btn-ghost bg-card">{L("طبّق", "Apply")}</button>
            </form>
            {walletCodes.length || r.offers.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(walletCodes.length ? walletCodes.map((w) => w.code) : r.offers.map((o) => o.code)).map((c) => (
                  <button key={c} type="button" onClick={() => { setCode(c); tryCode(c); }} className="num rounded-full border border-dashed border-brass/60 px-2.5 py-1 text-xs text-brass hover:bg-brass-soft">
                    {c}
                  </button>
                ))}
              </div>
            ) : null}
            {codeMsg ? <p className={cn("mt-2 text-sm", codeMsg.ok ? "text-ok" : "text-danger")} role="status">{codeMsg.text}</p> : null}
            {okRes?.freeDelivery ? <p className="mt-1 text-sm text-ok">{L("التوصيل ببلاش", "Free delivery applied")}</p> : null}
            <BreakdownTable b={b} serviceRate={serviceRate} className="mt-4" />
            <p className="mt-2 text-xs text-muted-foreground">{L("الخدمة على الطلبات جوه المطعم بس. الضريبة 14٪ على المجموع بعد الخصم والخدمة. التوصيل من غير خدمة ولا ضريبة.", "Service applies to dine-in only. 14% VAT is on the subtotal after discount and service. Delivery carries neither.")}</p>
            {!acc ? (
              <button type="button" className="sf-btn sf-btn-primary mt-4 w-full" onClick={() => navigate("/account")}>{L("سجّل دخول عشان تطلب", "Sign in to order")}</button>
            ) : (
              <LoadingButton
                onAction={place}
                disabled={belowMin || (mode === "delivery" && !street.trim())}
                pendingLabel={L("بنبعت الطلب للمطعم…", "Sending to the kitchen…")}
                successLabel={L("الطلب اتبعت!", "Order sent!")}
                errorLabel={L("حصلت مشكلة", "Something went wrong")}
                onError={() => notify({ title: L("مقدرناش نبعت الطلب", "Couldn't place the order"), tone: "danger", icon: "bell" })}
                className="mt-4 w-full"
              >
                {L("اطلب", "Place order")} · <span className="num">{formatMoney(b.total, lang)}</span>
              </LoadingButton>
            )}
            {mode === "delivery" && !street.trim() ? <p className="mt-2 text-center text-xs text-muted-foreground">{L("اكتب العنوان الأول", "Add your address first")}</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
