/**
 * Split a check by item, by seat, evenly (N ways) or by amount.
 * Item/seat splits create new checks (each priced on its own); even/amount splits keep one check and pay it in shares.
 */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Plus, Scissors, Users } from "lucide-react";
import type { OrderItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, major, type Units } from "@/lib/money";
import { AnimatedMoney, Button, Dialog, Segmented, spring, useReduced } from "@/ui";
import { seatGroups, splitByAmounts, splitEvenly, sumUnits } from "../math";
import { Stepper } from "./bits";

export type SplitMode = "item" | "seat" | "even" | "amount";

export function SplitDialog({ open, onClose, items, total, price, onSplitChecks, onShares }: {
  open: boolean;
  onClose: () => void;
  items: OrderItem[];
  total: Units;
  price: (items: OrderItem[]) => Units;
  onSplitChecks: (groups: { itemId: string; qty: number }[][]) => void;
  onShares: (shares: Units[], labels: string[]) => void;
}) {
  const { L, loc, lang } = useT();
  const reduced = useReduced();
  const live = useMemo(() => items.filter((i) => i.status !== "void"), [items]);
  const [mode, setMode] = useState<SplitMode>("item");
  const [buckets, setBuckets] = useState(2);
  const [target, setTarget] = useState(1);
  /** itemId → qty per bucket */
  const [alloc, setAlloc] = useState<Record<string, number[]>>({});
  const [n, setN] = useState(2);
  const [amounts, setAmounts] = useState<string[]>([""]);

  useEffect(() => {
    if (!open) return;
    setMode("item");
    setBuckets(2);
    setTarget(1);
    setAlloc(Object.fromEntries(live.map((i) => [i.id, [i.qty, 0]])));
    setN(2);
    setAmounts([""]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (it: OrderItem, from: number) => {
    setAlloc((a) => {
      const cur = [...(a[it.id] ?? [it.qty])];
      while (cur.length < buckets) cur.push(0);
      const to = from === target ? 0 : target;
      if (!cur[from]) return a;
      cur[from] -= 1;
      cur[to] += 1;
      return { ...a, [it.id]: cur };
    });
  };
  const bucketItems = (b: number) =>
    live.flatMap((i) => {
      const q = alloc[i.id]?.[b] ?? (b === 0 ? i.qty : 0);
      return q > 0 ? [{ ...i, qty: q, discount: Math.round((i.discount * q) / i.qty) }] : [];
    });
  const seats = useMemo(() => [...seatGroups(live).entries()], [live]);
  const evenShares = useMemo(() => (total > 0 ? splitEvenly(total, n) : []), [total, n]);
  let amountShares: Units[] = [];
  let amountErr = "";
  try {
    const given = amounts.map((a) => Number(a || 0)).filter((x) => x > 0).map((x) => major(x));
    amountShares = given.length ? splitByAmounts(total, given) : [];
  } catch (e) {
    amountErr = (e as Error).message;
  }

  const confirm = () => {
    if (mode === "item") {
      const groups = Array.from({ length: buckets - 1 }, (_, k) => live.flatMap((i) => (alloc[i.id]?.[k + 1] ? [{ itemId: i.id, qty: alloc[i.id][k + 1] }] : []))).filter((g) => g.length);
      if (groups.length) onSplitChecks(groups);
    } else if (mode === "seat") {
      const groups = seats.slice(1).map(([, list]) => list.map((i) => ({ itemId: i.id, qty: i.qty })));
      if (groups.length) onSplitChecks(groups);
    } else if (mode === "even") onShares(evenShares, evenShares.map((_, i) => `${i + 1}/${n}`));
    else if (amountShares.length) onShares(amountShares, amountShares.map((_, i) => `${i + 1}/${amountShares.length}`));
  };
  const canConfirm =
    mode === "item" ? live.some((i) => (alloc[i.id] ?? []).slice(1).some((q) => q > 0)) && bucketItems(0).length > 0 : mode === "seat" ? seats.length > 1 : mode === "even" ? n > 1 : amountShares.length > 1 && !amountErr;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={L("تقسيم الشيك", "Split check")}
      footer={
        <div className="flex w-full items-center gap-3">
          <span className="text-[13.5px] text-muted">
            {L("الإجمالي", "Total")} <span className="num font-semibold text-ink">{formatMoney(total, { lang })}</span>
          </span>
          <div className="flex-1" />
          <Button size="lg" disabled={!canConfirm} onClick={confirm} icon={<Scissors className="size-5" />}>
            {mode === "item" || mode === "seat" ? L("قسّم لشيكات", "Split into checks") : L("ادفع بالأجزاء", "Pay in shares")}
          </Button>
        </div>
      }
    >
      <Segmented
        block
        label={L("طريقة التقسيم", "Split by")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "item", label: L("بالصنف", "By item") },
          { value: "seat", label: L("بالكرسي", "By seat") },
          { value: "even", label: L("بالتساوي", "Evenly") },
          { value: "amount", label: L("بالمبلغ", "By amount") },
        ]}
      />
      <div className="mt-4">
        {mode === "item" ? (
          <>
            <p className="mb-3 text-[13.5px] text-muted">{L("اختار الشيك اللي هتنقل له، وبعدين اضغط على الأصناف (كل ضغطة = واحد).", "Pick a target check, then tap lines to move them one at a time.")}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: buckets }, (_, b) => {
                const list = bucketItems(b);
                return (
                  <motion.div
                    layout={!reduced}
                    key={b}
                    className={cn("flex min-h-48 flex-col rounded-2xl border-2 p-3 transition-colors", target === b && b > 0 ? "border-primary bg-primary-soft/40" : "border-line bg-surface-2/50")}
                  >
                    <button type="button" onClick={() => setTarget(b)} className="mb-2 flex items-center justify-between gap-2 text-start" aria-pressed={target === b}>
                      <span className="font-semibold">{b === 0 ? L("الشيك ده", "This check") : L(`شيك جديد ${b}`, `New check ${b}`)}</span>
                      <span className="num text-[15px] font-semibold">{formatMoney(list.length ? price(list) : 0, { lang })}</span>
                    </button>
                    <ul className="grid gap-1">
                      {list.map((i) => (
                        <motion.li layout={!reduced} key={i.id} transition={spring.snappy}>
                          <button type="button" onClick={() => move(i, b)} className="flex w-full items-center gap-2 rounded-xl bg-surface px-2.5 py-2 text-start shadow-sf-sm hover:bg-surface-3">
                            <span className="num grid size-7 place-items-center rounded-lg bg-surface-3 text-[13px] font-bold">{i.qty}</span>
                            <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{loc(i.name)}</span>
                            {i.seat ? <span className="num text-[12px] text-muted">#{i.seat}</span> : null}
                          </button>
                        </motion.li>
                      ))}
                    </ul>
                  </motion.div>
                );
              })}
              {buckets < 6 ? (
                <button type="button" onClick={() => (setBuckets((x) => x + 1), setTarget(buckets))} className="grid min-h-48 place-items-center rounded-2xl border-2 border-dashed border-line text-muted hover:border-line-strong hover:text-ink">
                  <span className="flex items-center gap-2 font-semibold">
                    <Plus className="size-5" /> {L("شيك كمان", "Another check")}
                  </span>
                </button>
              ) : null}
            </div>
          </>
        ) : mode === "seat" ? (
          seats.length < 2 ? (
            <p className="rounded-2xl bg-surface-2 p-6 text-center text-muted">{L("الأصناف مش متقسمة على كراسي. حدد الكرسي من تعديل الصنف.", "Lines are not assigned to seats yet. Set a seat on each line first.")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {seats.map(([seat, list], k) => (
                <div key={seat} className={cn("rounded-2xl border p-3", k === 0 ? "border-line bg-surface-2/50" : "border-primary/40 bg-primary-soft/30")}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Users className="size-4" />
                      {seat ? L(`كرسي ${seat}`, `Seat ${seat}`) : L("مشترك", "Shared")}
                      {k === 0 ? <span className="text-[12px] font-medium text-muted">· {L("يفضل هنا", "stays")}</span> : null}
                    </span>
                    <span className="num font-semibold">{formatMoney(price(list), { lang })}</span>
                  </div>
                  <ul className="grid gap-0.5 text-[13.5px]">
                    {list.map((i) => (
                      <li key={i.id} className="flex gap-2">
                        <span className="num text-muted">{i.qty}×</span>
                        <span className="truncate">{loc(i.name)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        ) : mode === "even" ? (
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{L("عدد الأجزاء", "Ways")}</span>
              <Stepper value={n} onChange={setN} min={2} max={20} label={L("عدد الأجزاء", "Ways")} />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {evenShares.map((s, i) => (
                <div key={i} className="rounded-2xl border border-line bg-surface-2 p-3 text-center">
                  <div className="text-[12.5px] text-muted">
                    {i + 1}/{n}
                  </div>
                  <AnimatedMoney value={s} className="text-[18px] font-semibold" />
                </div>
              ))}
            </div>
            <p className="text-[13px] text-muted">
              {L("المجموع", "Sum")}: <span className="num">{formatMoney(sumUnits(evenShares), { lang })}</span> = {L("الإجمالي بالظبط (القروش الزيادة على الأوائل)", "the total exactly (spare piastres go to the first shares)")}
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {amounts.map((a, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="num w-10 text-muted">{i + 1}</span>
                <input
                  value={a}
                  inputMode="decimal"
                  onChange={(e) => setAmounts((xs) => xs.map((x, j) => (j === i ? e.target.value.replace(/[^\d.]/g, "") : x)))}
                  aria-label={L(`جزء ${i + 1}`, `Share ${i + 1}`)}
                  className="num h-12 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[17px] outline-none focus:border-primary focus:shadow-[var(--sf-glow)]"
                  placeholder="0.00"
                />
              </div>
            ))}
            <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAmounts((xs) => [...xs, ""])} className="justify-self-start">
              {L("جزء كمان", "Add share")}
            </Button>
            {amountErr ? <p className="text-[13.5px] font-semibold text-danger">{L("المبالغ أكتر من الإجمالي", "Shares exceed the total")}</p> : amountShares.length ? (
              <p className="text-[13.5px] text-muted">
                {L("الجزء الأخير", "Last share")}: <span className="num font-semibold text-ink">{formatMoney(amountShares[amountShares.length - 1], { lang })}</span>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Dialog>
  );
}
