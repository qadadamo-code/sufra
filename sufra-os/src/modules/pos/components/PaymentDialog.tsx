/** Tenders: cash (quick notes, change), card, wallet, InstaPay, pay link; split tender and shares; tips on non-cash. */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Banknote, Check as CheckIcon, CreditCard, Link2, QrCode, Smartphone, X } from "lucide-react";
import type { Check, Payment, PaymentMethod } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, major, type Units } from "@/lib/money";
import { METHOD_LABEL } from "@/lib/receipt/model";
import { AnimatedMoney, Badge, Button, Dialog, IconButton, spring, useHotkeys, useReduced } from "@/ui";
import { changeDue, quickTenders, remaining, toPiastre, TENDERS } from "../math";
import { MoneyKeypad } from "./bits";

const ICON: Record<PaymentMethod, typeof Banknote> = { cash: Banknote, card: CreditCard, wallet: Smartphone, instapay: QrCode, online: Link2 };

export interface TenderInput {
  method: PaymentMethod;
  amount: Units;
  tip: Units;
  tendered: Units | null;
  reference: string | null;
  splitLabel: string | null;
}

export function PaymentDialog({ open, onClose, check, payments, shares, tipsEnabled, busy, onTender, onVoid, onComplete }: {
  open: boolean;
  onClose: () => void;
  check: Check | null;
  payments: Payment[];
  shares: { amounts: Units[]; labels: string[] } | null;
  tipsEnabled: boolean;
  busy: boolean;
  onTender: (t: TenderInput) => Promise<void>;
  onVoid: (p: Payment) => void;
  onComplete: () => void;
}) {
  const { L, lang } = useT();
  const reduced = useReduced();
  const total = check?.total ?? 0;
  const captured = payments.filter((p) => p.status === "captured");
  const due = remaining(total, captured);
  const shareIdx = shares ? Math.min(captured.filter((p) => p.splitLabel).length, shares.amounts.length - 1) : -1;
  const shareDue = shares && shareIdx >= 0 ? Math.min(due, shares.amounts[shareIdx]) : due;
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState<Units>(0);
  const [tip, setTip] = useState<Units>(0);
  const [ref, setRef] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount(shareDue);
    setTip(0);
    setRef("");
  }, [open, shareDue]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setTip(0), [method]);

  const isCash = method === "cash";
  const apply = Math.min(toPiastre(amount), due);
  const change = isCash ? changeDue(apply, amount) : 0;
  const quick = useMemo(() => quickTenders(shareDue), [shareDue]);
  const canTake = !busy && due > 0 && amount > 0 && (isCash || amount <= due);

  const take = async () => {
    if (!canTake) return;
    await onTender({ method, amount: apply, tip: isCash ? 0 : tip, tendered: isCash ? toPiastre(amount) : null, reference: ref.trim() || null, splitLabel: shares ? shares.labels[shareIdx] : null });
  };
  useHotkeys({ "mod+enter": take }, { enabled: open, inInputs: true });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={L("الدفع", "Payment")}
      description={shares ? L(`مقسوم على ${shares.amounts.length} — الجزء ${shareIdx + 1}`, `Split ${shares.amounts.length} ways — share ${shareIdx + 1}`) : undefined}
    >
      <div className="grid gap-5 md:grid-cols-[1fr_1.15fr]">
        <div className="grid content-start gap-4">
          <div className="rounded-[22px] bg-ink p-5 text-bg shadow-sf-lg">
            <div className="flex items-center justify-between text-[13.5px] opacity-75">
              <span>{L("الإجمالي", "Total")}</span>
              <span className="num">{formatMoney(total, { lang })}</span>
            </div>
            {captured.length ? (
              <div className="mt-1 flex items-center justify-between text-[13.5px] opacity-75">
                <span>{L("اتدفع", "Paid")}</span>
                <span className="num">{formatMoney(total - due, { lang })}</span>
              </div>
            ) : null}
            <div className="mt-3 text-[13px] font-semibold opacity-80">{due ? L("الباقي", "Remaining") : L("اتدفع بالكامل", "Fully paid")}</div>
            <AnimatedMoney value={due} className="text-[40px] font-semibold leading-tight tracking-tight" />
          </div>

          {shares ? (
            <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {shares.amounts.map((s, i) => {
                const paid = i < captured.filter((p) => p.splitLabel).length;
                return (
                  <li key={i} className={cn("rounded-2xl border px-3 py-2", paid ? "border-ok/40 bg-ok-soft" : i === shareIdx ? "border-primary bg-primary-soft" : "border-line bg-surface-2")}>
                    <div className="flex items-center justify-between text-[12px] font-semibold text-muted">
                      {shares.labels[i]}
                      {paid ? <CheckIcon className="size-4 text-ok" /> : null}
                    </div>
                    <div className="num text-[15px] font-semibold">{formatMoney(s, { lang })}</div>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {payments.length ? (
            <ul className="grid gap-1.5" aria-label={L("المدفوعات", "Payments")}>
              <AnimatePresence initial={false}>
                {payments.map((p) => {
                  const Icon = ICON[p.method];
                  return (
                    <motion.li key={p.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={spring.snappy} className={cn("flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-2", p.status !== "captured" && "opacity-50 line-through")}>
                      <span className="grid size-9 place-items-center rounded-xl bg-surface-3">
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {METHOD_LABEL[p.method][lang]} {p.splitLabel ? <span className="num text-[12px] text-muted">· {p.splitLabel}</span> : null}
                        </span>
                        <span className="block text-[12.5px] text-muted">
                          {p.tip ? `${L("إكرامية", "tip")} ${formatMoney(p.tip, { lang })}` : p.change ? `${L("باقي", "change")} ${formatMoney(p.change, { lang })}` : p.reference ?? ""}
                        </span>
                      </span>
                      <span className="num font-semibold">{formatMoney(p.amount, { lang })}</span>
                      {p.status === "captured" ? (
                        <IconButton label={L("إلغاء الدفعة", "Void payment")} size="sm" onClick={() => onVoid(p)}>
                          <X />
                        </IconButton>
                      ) : null}
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          ) : null}
        </div>

        <div className="grid content-start gap-4">
          <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label={L("طريقة الدفع", "Tender")}>
            {TENDERS.map((m) => {
              const Icon = ICON[m];
              const on = m === method;
              return (
                <button key={m} type="button" role="radio" aria-checked={on} onClick={() => setMethod(m)} className={cn("flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl border-2 px-1 text-[12.5px] font-semibold transition-colors", on ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>
                  <Icon className="size-6" />
                  {METHOD_LABEL[m][lang]}
                </button>
              );
            })}
          </div>

          <div className="flex items-end justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3">
            <div>
              <div className="text-[12.5px] font-semibold text-muted">{isCash ? L("العميل دفع", "Tendered") : L("المبلغ", "Amount")}</div>
              <div className="num text-[30px] font-semibold leading-tight" dir="ltr">
                {formatMoney(amount, { lang, bare: true })}
              </div>
            </div>
            {isCash ? (
              <div className="text-end">
                <div className="text-[12.5px] font-semibold text-muted">{L("الباقي للعميل", "Change")}</div>
                <AnimatedMoney value={change} className={cn("text-[24px] font-semibold", change ? "text-ok" : "text-faint")} />
              </div>
            ) : amount > due ? (
              <Badge tone="danger">{L("أكتر من المطلوب", "More than due")}</Badge>
            ) : null}
          </div>

          {isCash ? (
            <div className="flex flex-wrap gap-2">
              {quick.map((q, i) => (
                <button key={q} type="button" onClick={() => setAmount(q)} className={cn("num h-11 rounded-xl border px-3.5 text-[15px] font-semibold", amount === q ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:bg-surface-2")}>
                  {i === 0 ? L("مظبوط", "Exact") : formatMoney(q, { lang, compact: true, bare: true })}
                </button>
              ))}
            </div>
          ) : (
            <>
              {tipsEnabled ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-muted">{L("إكرامية", "Tip")}</span>
                  {[0, 500, 1000, 1500].map((bp) => {
                    const v = toPiastre(Math.round((apply * bp) / 10_000));
                    return (
                      <button key={bp} type="button" onClick={() => setTip(v)} className={cn("num h-10 rounded-full border px-3 text-[13.5px] font-semibold", tip === v ? "border-brass bg-brass-soft text-brass-text" : "border-line hover:bg-surface-2")}>
                        {bp ? `${bp / 100}%` : L("لا", "None")}
                      </button>
                    );
                  })}
                  {[major(20), major(50)].map((v) => (
                    <button key={v} type="button" onClick={() => setTip(v)} className={cn("num h-10 rounded-full border px-3 text-[13.5px] font-semibold", tip === v ? "border-brass bg-brass-soft text-brass-text" : "border-line hover:bg-surface-2")}>
                      +{formatMoney(v, { lang, compact: true, bare: true })}
                    </button>
                  ))}
                </div>
              ) : null}
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={method === "card" ? L("رقم الموافقة / آخر ٤ أرقام (اختياري)", "Auth code / last 4 (optional)") : method === "online" ? L("رقم العملية من لينك الدفع", "Pay-link transaction id") : L("رقم المرجع (اختياري)", "Reference (optional)")} aria-label={L("رقم المرجع", "Reference")} className="h-11 rounded-xl border border-line bg-surface px-3.5 outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" />
              {method === "online" ? <p className="rounded-xl bg-info-soft px-3 py-2 text-[13px] text-info">{L("لينك الدفع (Paymob/Kashier) جاي مع بوابة الدفع. دلوقتي سجّل الدفع بعد ما العميل يدفع.", "Pay links (Paymob/Kashier) arrive with the payment gateway. For now, record the payment once the guest has paid.")}</p> : null}
            </>
          )}

          <MoneyKeypad value={amount} onChange={setAmount} />
          <Button size="xl" variant="brass" block disabled={!canTake} loading={busy} onClick={take}>
            {due ? (
              <>
                {L("خد", "Take")} {formatMoney(apply + (isCash ? 0 : tip), { lang })}
              </>
            ) : (
              L("اتدفع", "Paid")
            )}
          </Button>
          {!due && check && check.status !== "paid" ? (
            <Button size="lg" variant="primary" block onClick={onComplete} loading={busy}>
              {L("اقفل الشيك واطبع", "Close & print")}
            </Button>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
