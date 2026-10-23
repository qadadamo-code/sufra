/** Bill discount: % or amount, with a reason. Above the restaurant's limit the caller asks for a manager PIN. */
import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { Discount } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, major, type Units } from "@/lib/money";
import { AnimatedMoney, Button, Dialog, Segmented } from "@/ui";
import { discountPct } from "../math";
import { DISCOUNT_REASONS, ReasonPicker } from "./LineSheet";

export function DiscountDialog({ open, onClose, base, current, currentReason, limitPct, preview, onApply }: {
  open: boolean;
  onClose: () => void;
  base: Units;
  current: Discount | null;
  currentReason: string | null;
  limitPct: number;
  preview: (d: Discount | null) => Units;
  onApply: (d: Discount | null, reason: string) => void;
}) {
  const { L, lang } = useT();
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [val, setVal] = useState("10");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!open) return;
    setKind(current?.kind ?? "percent");
    setVal(current ? (current.kind === "percent" ? String(current.rate / 100) : String(current.value / 100_000)) : "10");
    setReason(currentReason ?? "");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const d: Discount | null = useMemo(() => {
    const n = Number(val || 0);
    if (!n) return null;
    return kind === "percent" ? { kind: "percent", rate: Math.min(10_000, Math.round(n * 100)) } : { kind: "amount", value: Math.min(base, major(n)) };
  }, [kind, val, base]);
  const pct = discountPct(d, base);
  const needsPin = pct > limitPct;
  const after = preview(d);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={L("خصم على الشيك", "Bill discount")}
      description={L(`أكتر من ${limitPct}% محتاج PIN مدير`, `More than ${limitPct}% needs a manager PIN`)}
      footer={
        <>
          {current ? (
            <Button variant="ghost" onClick={() => onApply(null, "")}>
              {L("شيل الخصم", "Remove")}
            </Button>
          ) : null}
          <Button size="lg" variant="brass" disabled={!d || !reason.trim()} onClick={() => d && onApply(d, reason.trim())} icon={needsPin ? <ShieldCheck className="size-5" /> : undefined}>
            {L("طبّق", "Apply")}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" label={L("نوع الخصم", "Discount type")} value={kind} onChange={setKind} options={[{ value: "percent", label: "%" }, { value: "amount", label: L("مبلغ", "Amount") }]} />
          {(kind === "percent" ? ["5", "10", "15", "20", "50"] : ["25", "50", "100"]).map((v) => (
            <button key={v} type="button" onClick={() => setVal(v)} className={cn("num h-10 rounded-full border px-3.5 text-[14px] font-semibold", val === v ? "border-brass bg-brass-soft text-brass-text" : "border-line hover:bg-surface-2")}>
              {v}
              {kind === "percent" ? "%" : ""}
            </button>
          ))}
          <input value={val} onChange={(e) => setVal(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-label={L("القيمة", "Value")} className="num h-10 w-24 rounded-xl border border-line bg-surface px-3 text-center outline-none focus:border-primary" />
        </div>
        <ReasonPicker reasons={DISCOUNT_REASONS} value={reason} onChange={setReason} />
        <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
          <span className="text-[13.5px] text-muted">
            {L("قبل", "Before")} <span className="num">{formatMoney(preview(null), { lang })}</span>
            {d ? <span className={cn("ms-2 rounded-full px-2 py-0.5 text-[12px] font-bold", needsPin ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>{pct.toFixed(pct % 1 ? 1 : 0)}%</span> : null}
          </span>
          <AnimatedMoney value={after} className="text-[22px] font-semibold" />
        </div>
      </div>
    </Dialog>
  );
}
