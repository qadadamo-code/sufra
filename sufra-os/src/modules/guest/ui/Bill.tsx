import { useEffect, useMemo, useState } from "react";
import { CreditCard, Divide, ListChecks, ReceiptText, ShieldCheck, Smartphone, Users, Wallet } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { major, UNITS_PER_MAJOR, type Units } from "@/lib/money";
import { AnimatedMoney, Button, Dialog, EmptyState, Money, Segmented, Skeleton } from "@/ui";
import type { TableBill } from "../api/service";
import { myShare, tipFor, type SplitMode } from "../split";
import { QtyStepper, TotalsList } from "./bits";

export interface PayChoice {
  amount: Units;
  tip: Units;
  splitLabel: string | null;
}

const TIPS = [0, 500, 1000, 1500];

/** Running bill → split → tip → pay online or ask the waiter (cash / card). */
export function BillSheet({
  open,
  onClose,
  bill,
  loading,
  tipsEnabled,
  serviceRate,
  vatRate,
  canPayOnline,
  paying,
  onPayOnline,
  onWaiter,
}: {
  open: boolean;
  onClose: () => void;
  bill: TableBill | null;
  loading: boolean;
  tipsEnabled: boolean;
  serviceRate: number;
  vatRate: number;
  canPayOnline: boolean;
  paying: boolean;
  onPayOnline: (p: PayChoice) => void;
  onWaiter: (method: "cash" | "card", p: PayChoice) => void;
}) {
  const { L, loc } = useT();
  const [mode, setMode] = useState<SplitMode>("full");
  const [people, setPeople] = useState(2);
  const [shares, setShares] = useState(1);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [custom, setCustom] = useState("");
  const [tipBp, setTipBp] = useState(1000);
  const [tipCustom, setTipCustom] = useState<string | null>(null);

  useEffect(() => {
    if (open) setPicked({});
  }, [open]);

  const total = bill?.totals.total ?? 0;
  const paid = bill?.totals.paid ?? 0;
  const due = Math.max(0, total - paid);
  const customUnits = useMemo(() => {
    try {
      return custom.trim() ? major(custom.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", ".")) : 0;
    } catch {
      return 0;
    }
  }, [custom]);
  const share = bill ? myShare({ mode, total, paid, people, shares, lines: bill.lines.map((l) => ({ id: l.id, qty: l.qty, gross: l.gross })), picked, custom: customUnits }) : 0;
  const tip = !tipsEnabled ? 0 : tipCustom !== null ? (() => { try { return tipCustom.trim() ? major(tipCustom.trim()) : 0; } catch { return 0; } })() : tipFor(share, tipBp);
  const label = mode === "even" ? L(`${shares} من ${people}`, `${shares} of ${people}`) : mode === "items" ? L("أصنافي", "My items") : mode === "custom" ? L("مبلغ محدد", "Custom amount") : null;
  const choice: PayChoice = { amount: share, tip, splitLabel: label };

  return (
    <Dialog open={open} onClose={onClose} title={L("الحساب", "The bill")} size="lg" variant="auto"
      footer={bill && due > 0 ? (
        <div className="grid w-full gap-2">
          <div className="flex items-baseline justify-between px-1 text-[14px]">
            <span className="text-muted">{tip ? L("نصيبك + البقشيش", "Your share + tip") : L("هتدفع", "You pay")}</span>
            <AnimatedMoney value={share + tip} className="text-[20px] font-bold" />
          </div>
          {canPayOnline ? (
            <Button size="lg" block icon={<Smartphone />} disabled={share <= 0} loading={paying} onClick={() => onPayOnline(choice)}>
              {L("ادفع أونلاين", "Pay online")}
            </Button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" icon={<Wallet />} onClick={() => onWaiter("cash", choice)}>
              {L("كاش للجرسون", "Cash to waiter")}
            </Button>
            <Button variant="secondary" size="lg" icon={<CreditCard />} onClick={() => onWaiter("card", choice)}>
              {L("كارت للجرسون", "Card to waiter")}
            </Button>
          </div>
          {canPayOnline ? (
            <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-muted">
              <ShieldCheck className="size-3.5" />
              {L("الدفع بيتم في صفحة آمنة لشركة الدفع — إحنا مش بنشوف بيانات الكارت", "Paid on the provider's secure page — we never see your card")}
            </p>
          ) : null}
        </div>
      ) : undefined}
    >
      {loading && !bill ? (
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}
        </div>
      ) : !bill || !bill.lines.length ? (
        <EmptyState compact icon={<ReceiptText />} title={L("لسه مفيش حساب", "No bill yet")} body={L("لما تطلب، الحساب هيظهر هنا على طول", "Once you order, the bill shows up here live")} />
      ) : (
        <div className="grid gap-5 pb-1">
          <ul className="grid gap-2">
            {bill.lines.map((l) => {
              const sel = picked[l.id] ?? 0;
              return (
                <li key={l.id} className={cn("flex items-center gap-3 rounded-2xl px-1 py-1.5 transition-colors", mode === "items" && sel > 0 && "bg-primary-soft/60")}>
                  {mode === "items" ? (
                    l.qty === 1 ? (
                      <button type="button" role="checkbox" aria-checked={sel > 0} onClick={() => setPicked((p) => ({ ...p, [l.id]: sel ? 0 : 1 }))} className={cn("grid size-7 shrink-0 place-items-center rounded-lg border-2 text-[13px] font-bold", sel ? "border-primary bg-primary text-primary-ink" : "border-line-strong")}>
                        {sel ? "✓" : ""}
                      </button>
                    ) : (
                      <QtyStepper size="sm" value={sel} max={l.qty} onChange={(v) => setPicked((p) => ({ ...p, [l.id]: v }))} label={loc(l.name)} />
                    )
                  ) : (
                    <span className="num grid size-7 shrink-0 place-items-center rounded-lg bg-surface-3 text-[13px] font-bold">{l.qty}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold leading-snug">{loc(l.name)}</p>
                    {l.modifiers.length ? <p className="text-[12px] text-muted">{l.modifiers.map(loc).join(" · ")}</p> : null}
                  </div>
                  <Money value={l.gross} className="text-[14px]" />
                </li>
              );
            })}
          </ul>

          <div className="rounded-2xl bg-surface-2 p-4">
            <TotalsList totals={bill.totals} serviceRate={serviceRate} vatRate={vatRate} />
          </div>

          {bill.payments.length ? (
            <div className="grid gap-1.5 text-[13px]">
              {bill.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl bg-ok-soft px-3 py-2 text-ok">
                  <span className="font-semibold">✓ {p.splitLabel ?? (p.method === "online" ? L("دفع أونلاين", "Paid online") : L("مدفوع", "Paid"))}</span>
                  <Money value={p.amount} />
                </div>
              ))}
            </div>
          ) : null}

          {due > 0 ? (
            <>
              <div className="grid gap-3">
                <p className="text-[16px] font-bold">{L("هتدفع قد إيه؟", "How do you want to pay?")}</p>
                <Segmented
                  block
                  label={L("طريقة التقسيم", "Split")}
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "full", label: L("الكل", "All"), icon: <ReceiptText /> },
                    { value: "even", label: L("بالتساوي", "Evenly"), icon: <Users /> },
                    { value: "items", label: L("أصنافي", "My items"), icon: <ListChecks /> },
                    { value: "custom", label: L("مبلغ", "Amount"), icon: <Divide /> },
                  ]}
                />
                {mode === "even" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5 rounded-2xl border border-line p-3">
                      <span className="text-[12.5px] font-semibold text-muted">{L("عددكم", "People")}</span>
                      <QtyStepper value={people} min={2} max={30} onChange={(v) => (setPeople(v), setShares((s) => Math.min(s, v)))} label={L("عددكم", "People")} />
                    </div>
                    <div className="grid gap-1.5 rounded-2xl border border-line p-3">
                      <span className="text-[12.5px] font-semibold text-muted">{L("هدفع عن", "I pay for")}</span>
                      <QtyStepper value={shares} min={1} max={people} onChange={setShares} label={L("هدفع عن", "I pay for")} />
                    </div>
                  </div>
                ) : mode === "items" ? (
                  <p className="text-[13px] text-muted">{L("علّم على اللي أكلته — الخدمة والضريبة بتتقسم بالنسبة", "Tick what you had — service and VAT are shared proportionally")}</p>
                ) : mode === "custom" ? (
                  <label className="relative block">
                    <input inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0.00" className="num h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[18px] outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" aria-label={L("المبلغ", "Amount")} />
                    <span className="absolute inset-y-0 end-4 my-auto h-fit text-[13px] text-muted">{L(`الباقي ${(due / UNITS_PER_MAJOR).toFixed(2)}`, `Due ${(due / UNITS_PER_MAJOR).toFixed(2)}`)}</span>
                  </label>
                ) : null}
              </div>

              {tipsEnabled ? (
                <div className="grid gap-2.5">
                  <p className="text-[16px] font-bold">{L("بقشيش للفريق", "Tip the team")}</p>
                  <div className="grid grid-cols-5 gap-1.5">
                    {TIPS.map((bp) => (
                      <button key={bp} type="button" onClick={() => (setTipBp(bp), setTipCustom(null))} className={cn("h-11 rounded-xl border text-[14px] font-bold transition-colors", tipCustom === null && tipBp === bp ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:border-line-strong")}>
                        {bp ? <span className="num">{bp / 100}%</span> : L("لأ", "No")}
                      </button>
                    ))}
                    <button type="button" onClick={() => setTipCustom("")} className={cn("h-11 rounded-xl border text-[13.5px] font-bold", tipCustom !== null ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface")}>
                      {L("مبلغ", "Other")}
                    </button>
                  </div>
                  {tipCustom !== null ? <input autoFocus inputMode="decimal" value={tipCustom} onChange={(e) => setTipCustom(e.target.value)} placeholder="0.00" className="num h-11 rounded-xl border border-line bg-surface px-3 outline-none focus:border-primary" aria-label={L("البقشيش", "Tip")} /> : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl bg-ok-soft p-4 text-center font-bold text-ok">{L("الحساب اتدفع بالكامل — شكرًا!", "Fully paid — thank you!")}</div>
          )}
        </div>
      )}
    </Dialog>
  );
}
