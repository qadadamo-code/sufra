/**
 * POS: offers, coupons and loyalty on the current check. The cashier types a coupon, scans/enters the guest's
 * phone (loyalty QR = "SUFRA:<phone>"), picks rewards or points; automatic offers (happy hour, combo, BOGO…) are
 * suggested. Applied as line discounts before tax (@finance/tax), recorded as promo redemptions — finalized when paid.
 */
import { useEffect, useState } from "react";
import { BadgePercent, Coins, Crown, Gift, ScanLine, Sparkles, Ticket, Trash2, UserRound, X } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { Check, Customer } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { maxRedeemable, normalizeCode, REJECT_LABEL, tierFor, type PromoResult } from "@/lib/promo";
import { Badge, Button, Dialog, Input, Money, useToast } from "@/ui";
import { normalizePhone } from "@/modules/guest/api/service";
import { applyToCheck, clearCheckPromos, evaluateCheck, inputFromApplied, rulesOf, type CheckPromoInput } from "../ops";
import { SellGiftCardDialog } from "../GiftCardsPage";
import { captureLead } from "@/modules/customers/crm";

export function PromoDialog({ open, onClose, check, onAttachCustomer }: { open: boolean; onClose: () => void; check: Check | null; onAttachCustomer: (customerId: string) => Promise<void> | void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const applied = useLive("promoRedemptions", { where: { checkId: check?.id ?? "-", status: "applied" } }, { enabled: !!check }).data;
  const program = useLive("loyaltyPrograms").data[0] ?? null;
  const rules = rulesOf(program);
  const customers = useLive("customers").data;
  const customer = customers.find((c) => c.id === check?.customerId) ?? null;
  const [input, setInput] = useState<CheckPromoInput>({ codes: [], rewards: [], points: 0 });
  const [code, setCode] = useState("");
  const [lookup, setLookup] = useState("");
  const [preview, setPreview] = useState<PromoResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sellGc, setSellGc] = useState(false);

  useEffect(() => {
    if (open) {
      setInput(inputFromApplied(applied));
      setErr(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify([input, check?.id, check?.subtotal, check?.customerId, open]);
  useEffect(() => {
    if (!open || !check) return;
    let off = false;
    evaluateCheck(db, check.id, input).then(
      (s) => {
        if (off) return;
        setPreview(s.result);
        setErr(null);
      },
      (e: Error) => !off && setErr(e.message),
    );
    return () => {
      off = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const tier = customer ? (customer.tierId ? rules.tiers.find((t) => t.id === customer.tierId) : tierFor(customer.lifetimePoints ?? 0, rules.tiers)) : null;
  const pendingRewardPts = input.rewards.reduce((a, id) => a + (rules.rewards.find((r) => r.id === id)?.cost ?? 0), 0);
  const balance = (customer?.loyaltyPoints ?? 0) - pendingRewardPts;
  const due = check ? check.subtotal - check.discountTotal : 0;
  const maxPts = customer ? maxRedeemable(Math.max(0, balance), due, rules) : 0;
  const findCustomer = async () => {
    const raw = lookup.trim().replace(/^SUFRA:/i, "");
    const phone = normalizePhone(raw);
    const hit = phone ? customers.find((c) => c.phone === phone && !c.mergedInto) : customers.find((c) => c.referralCode === raw.toUpperCase());
    if (hit) {
      await onAttachCustomer(hit.id);
      setLookup("");
      return;
    }
    if (phone) {
      const { customer: c } = await captureLead(db, { name: phone, phone, source: "pos", consent: { whatsapp: true } });
      await onAttachCustomer(c.id);
      toast({ title: L("عميل جديد اتسجل — كمّل اسمه من صفحة الزباين", "New guest saved — add their name in Customers"), tone: "success" });
      setLookup("");
    } else setErr(L("رقم موبايل أو QR الولاء", "A mobile number or the loyalty QR"));
  };
  const apply = async () => {
    if (!check) return;
    setBusy(true);
    try {
      const s = await applyToCheck(db, check.id, input);
      toast({ title: s.result.applied.length ? L(`اتطبق خصم ${formatMoney(s.result.discount + s.result.deliveryDiscount, { lang })}`, `Applied ${formatMoney(s.result.discount + s.result.deliveryDiscount, { lang })} off`) : L("مفيش عروض اتطبقت", "No offers applied"), tone: s.result.applied.length ? "success" : "default" });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const total = preview ? preview.discount + preview.deliveryDiscount : 0;
  const typedRejections = preview?.rejected.filter((r) => r.code && input.codes.map(normalizeCode).includes(r.code)) ?? [];

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        size="lg"
        title={L("عروض وكوبونات ونقاط", "Offers, coupons & points")}
        description={L("الخصم بيتحسب على الأصناف قبل الضريبة والخدمة", "Discounts apply to the lines before VAT and service")}
        footer={
          <div className="flex w-full flex-wrap items-center gap-2">
            {applied.length ? <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { if (check) await clearCheckPromos(db, check.id); onClose(); }}>{L("شيل كل العروض", "Remove all")}</Button> : null}
            <span className="flex-1" />
            <Button size="lg" variant="brass" loading={busy} onClick={apply} disabled={!check}>
              {total ? `${L("طبّق", "Apply")} −${formatMoney(total, { lang })}` : L("طبّق", "Apply")}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 pb-1">
          <section className="rounded-2xl border border-line p-3">
            {customer ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary"><UserRound className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{customer.name}</p>
                  <p className="text-[12.5px] text-muted">
                    <span className="num" dir="ltr">{customer.phone}</span> · {L(`${customer.visits} زيارة`, `${customer.visits} visits`)}
                  </p>
                </div>
                {tier ? <Badge tone="brass" icon={<Crown className="size-3" />}>{loc(tier.name)}</Badge> : null}
                <span className="text-end">
                  <span className="num block text-[20px] font-semibold text-brass-text">{customer.loyaltyPoints.toLocaleString("en")}</span>
                  <span className="text-[11.5px] text-muted">{L("نقطة", "points")} · {formatMoney(customer.loyaltyPoints * rules.pointValue, { lang })}</span>
                </span>
              </div>
            ) : (
              <div className="flex gap-2">
                <Input wrapClassName="flex-1" icon={<ScanLine />} value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void findCustomer()} placeholder={L("موبايل العميل أو امسح QR الولاء", "Guest mobile or scan the loyalty QR")} aria-label={L("العميل", "Customer")} dir="ltr" />
                <Button variant="secondary" onClick={() => void findCustomer()} disabled={!lookup.trim()}>{L("ربط", "Attach")}</Button>
              </div>
            )}
          </section>

          {customer && rules.enabled ? (
            <section className="grid gap-2">
              <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-2"><Gift className="size-4 text-brass" />{L("مكافآت", "Rewards")}</p>
              <div className="flex flex-wrap gap-2">
                {rules.rewards.filter((r) => r.active).map((r) => {
                  const on = input.rewards.includes(r.id);
                  const can = on || balance >= r.cost;
                  return (
                    <button key={r.id} type="button" disabled={!can} aria-pressed={on} onClick={() => setInput({ ...input, rewards: on ? input.rewards.filter((x) => x !== r.id) : [...input.rewards, r.id] })} className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-[13.5px] font-semibold disabled:opacity-40 ${on ? "border-brass bg-brass-soft text-brass-text" : "border-line hover:bg-surface-2"}`}>
                      {loc(r.name)} <span className="num text-[12px] opacity-75">{r.cost}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <Input wrapClassName="w-40" type="number" dir="ltr" label={L("استخدم نقاط", "Use points")} value={input.points || ""} onChange={(e) => setInput({ ...input, points: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                <Button variant="ghost" icon={<Coins className="size-4" />} onClick={() => setInput({ ...input, points: maxPts })} disabled={!maxPts}>
                  {L("الأقصى", "Max")} {maxPts ? `(${maxPts} = ${formatMoney(maxPts * rules.pointValue, { lang })})` : ""}
                </Button>
                {input.points && input.points < rules.minRedeem ? <span className="text-[12.5px] text-danger">{L(`أقل حاجة ${rules.minRedeem} نقطة`, `Minimum ${rules.minRedeem} points`)}</span> : null}
              </div>
            </section>
          ) : null}

          <section className="grid gap-2">
            <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-2"><Ticket className="size-4 text-primary" />{L("كوبون", "Coupon")}</p>
            <div className="flex gap-2">
              <Input wrapClassName="flex-1" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) { setInput({ ...input, codes: [...new Set([...input.codes, normalizeCode(code)])] }); setCode(""); } }} placeholder="SUFRA15" aria-label={L("كوبون", "Coupon")} className="uppercase" />
              <Button variant="secondary" disabled={!code.trim()} onClick={() => { setInput({ ...input, codes: [...new Set([...input.codes, normalizeCode(code)])] }); setCode(""); }}>{L("ضيف", "Add")}</Button>
            </div>
            {input.codes.length ? (
              <div className="flex flex-wrap gap-1.5">
                {input.codes.map((c) => {
                  const bad = typedRejections.find((r) => r.code === normalizeCode(c));
                  return (
                    <span key={c} className={`num inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold ${bad ? "border-danger/40 bg-danger-soft text-danger" : "border-ok/40 bg-ok-soft text-ok"}`} dir="ltr">
                      {c}
                      <button type="button" aria-label={L("شيل", "Remove")} onClick={() => setInput({ ...input, codes: input.codes.filter((x) => x !== c) })}><X className="size-3.5" /></button>
                    </span>
                  );
                })}
              </div>
            ) : null}
            {typedRejections.map((r) => <p key={`${r.code}${r.reason}`} className="text-[12.5px] font-semibold text-danger">{r.code}: {loc(REJECT_LABEL[r.reason])}</p>)}
          </section>

          <section className="grid gap-2 rounded-2xl bg-surface-2 p-3">
            <p className="inline-flex items-center gap-2 text-[13px] font-semibold text-ink-2"><Sparkles className="size-4 text-brass" />{L("هيتطبق", "Will apply")}</p>
            {preview?.applied.length ? (
              <ul className="grid gap-1.5">
                {preview.applied.map((a) => (
                  <li key={a.promotionId} className="flex items-center justify-between gap-2 text-[14px]">
                    <span className="inline-flex min-w-0 items-center gap-2">
                      {a.promotionId.startsWith("reward:") || a.promotionId === "points" ? <Coins className="size-4 shrink-0 text-brass" /> : a.code ? <Ticket className="size-4 shrink-0 text-primary" /> : <BadgePercent className="size-4 shrink-0 text-ok" />}
                      <span className="truncate font-semibold">{loc(a.name)}</span>
                    </span>
                    <Money value={-(a.discount + a.deliveryDiscount)} className="font-semibold" />
                  </li>
                ))}
                <li className="mt-1 flex items-center justify-between border-t border-line pt-2 font-bold">
                  <span>{L("إجمالي الخصم", "Total discount")}</span>
                  <Money value={-total} />
                </li>
              </ul>
            ) : (
              <p className="text-[13px] text-muted">{L("مفيش عروض تنطبق على الشيك ده دلوقتي", "No offer applies to this check right now")}</p>
            )}
            {preview?.hints.length ? <p className="text-[12.5px] font-semibold text-brass-text">{L("زوّد", "Add")} {formatMoney(preview.hints[0].missing, { lang })} {L("وياخد", "to get")} «{loc(preview.hints[0].name)}»</p> : null}
            {preview?.rejected.filter((r) => r.reason === "not_stackable").length ? <p className="text-[12px] text-muted">{L("في عروض تانية مابتتجمعش — اخترنا الأوفر للزبون", "Some offers can't be combined — the best one for the guest was picked")}</p> : null}
          </section>
          {err ? <p className="text-[13px] font-semibold text-danger">{err === "insufficient" ? L("النقاط مش كفاية", "Not enough points") : err === "below_min" ? L(`أقل حاجة ${rules.minRedeem} نقطة`, `Minimum ${rules.minRedeem} points`) : err}</p> : null}
          <Button variant="ghost" icon={<Gift className="size-4" />} onClick={() => setSellGc(true)} className="justify-self-start">{L("بيع كارت هدية", "Sell a gift card")}</Button>
        </div>
      </Dialog>
      <SellGiftCardDialog open={sellGc} onClose={() => setSellGc(false)} />
    </>
  );
}

export type { Customer };
