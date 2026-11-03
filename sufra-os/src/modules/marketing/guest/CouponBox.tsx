/** Coupon field + automatic offers at guest checkout. Shows what applies, why a code doesn't, and the new total. */
import { useEffect, useMemo, useState } from "react";
import { BadgePercent, Check, Sparkles, Ticket, X } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { OrderMode } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { priceItems } from "@/data/pricing";
import type { Units } from "@/lib/money";
import { normalizeCode, REJECT_LABEL, type PromoResult } from "@/lib/promo";
import { Button, Money } from "@/ui";
import { useGuest } from "@/modules/guest/ui/context";
import { cartAsItems } from "@/modules/guest/cart";
import { PromoPublic } from "./api";

export function CouponBox({ mode, channel, deliveryFee, phone, onChange }: { mode: OrderMode; channel: "qr" | "online"; deliveryFee: Units; phone: string; onChange: (codes: string[], result: PromoResult | null) => void }) {
  const { slug, menu, venue, cart } = useGuest();
  const repo = useRepo();
  const api = useMemo(() => new PromoPublic(repo), [repo]);
  const { L, loc } = useT();
  const [text, setText] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [res, setRes] = useState<PromoResult | null>(null);
  const key = JSON.stringify([cart, mode, deliveryFee, codes, phone]);
  useEffect(() => {
    let off = false;
    if (!cart.length) return;
    api.checkCart(slug, menu, cart, { mode, channel, deliveryFee, codes, phone }).then(
      (r) => {
        if (off) return;
        setRes(r);
        onChange(codes, r);
      },
      () => undefined,
    );
    return () => {
      off = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const c = normalizeCode(text);
    if (c && !codes.includes(c)) setCodes([...codes, c]);
    setText("");
  };
  const total = useMemo(() => {
    if (!res || !cart.length) return null;
    const items = cartAsItems(menu, cart).map((i) => ({ ...i, discount: res.lineDiscounts[i.id] ?? 0 }));
    return priceItems(items, { mode, tax: venue.tax, deliveryFee: Math.max(0, deliveryFee - res.deliveryDiscount) }).totals.total;
  }, [res, cart, menu, mode, venue.tax, deliveryFee]);
  const rejectedTyped = res?.rejected.filter((r) => r.code && codes.includes(r.code)) ?? [];

  return (
    <div className="grid gap-2.5">
      <span className="text-[13px] font-semibold text-ink-2">{L("كوبون خصم", "Promo code")}</span>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          dir="ltr"
          placeholder="SUFRA15"
          aria-label={L("كوبون خصم", "Promo code")}
          className="num h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 uppercase outline-none focus:border-primary focus:shadow-[var(--sf-glow)]"
        />
        <Button variant="secondary" icon={<Ticket className="size-4" />} onClick={add} disabled={!text.trim()}>
          {L("طبّق", "Apply")}
        </Button>
      </div>
      {codes.length ? (
        <div className="flex flex-wrap gap-1.5">
          {codes.map((c) => {
            const bad = rejectedTyped.find((r) => r.code === c);
            return (
              <span key={c} className={`num inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold ${bad ? "border-danger/40 bg-danger-soft text-danger" : "border-ok/40 bg-ok-soft text-ok"}`} dir="ltr">
                {bad ? <X className="size-3.5" /> : <Check className="size-3.5" />}
                {c}
                <button type="button" aria-label={L("شيل الكود", "Remove code")} onClick={() => setCodes(codes.filter((x) => x !== c))} className="opacity-70 hover:opacity-100">
                  <X className="size-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}
      {rejectedTyped.map((r) => (
        <p key={`${r.code}${r.reason}`} className="text-[12.5px] font-semibold text-danger">
          {r.code}: {loc(REJECT_LABEL[r.reason])}
        </p>
      ))}
      {res?.applied.length ? (
        <ul className="grid gap-1.5 rounded-2xl bg-ok-soft/60 p-3">
          {res.applied.map((a) => (
            <li key={a.promotionId} className="flex items-center justify-between gap-2 text-[13.5px]">
              <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-ok">
                {a.code ? <BadgePercent className="size-4 shrink-0" /> : <Sparkles className="size-4 shrink-0" />}
                <span className="truncate">{loc(a.name)}</span>
              </span>
              <Money value={-(a.discount + a.deliveryDiscount)} className="font-semibold text-ok" />
            </li>
          ))}
          {total != null ? (
            <li className="mt-1 flex items-center justify-between border-t border-ok/30 pt-2 text-[14.5px] font-bold">
              <span>{L("الإجمالي بعد الخصم", "Total after discount")}</span>
              <Money value={total} />
            </li>
          ) : null}
        </ul>
      ) : null}
      {res?.hints.length ? (
        <p className="rounded-xl bg-brass-soft px-3 py-2 text-[13px] font-semibold text-brass-text">
          {L("زوّد", "Add")} <Money value={res.hints[0].missing} /> {L("وخد", "for")} «{loc(res.hints[0].name)}»
        </p>
      ) : null}
    </div>
  );
}
