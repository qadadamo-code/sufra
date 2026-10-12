import { useLang } from "@/lib/i18n";
import { formatMoney, type PriceBreakdown } from "@/lib/pricing";
import { cn } from "@/lib/utils";

export function BreakdownTable({ b, serviceRate, className }: { b: PriceBreakdown; serviceRate: number; className?: string }) {
  const { L, lang } = useLang();
  const row = (label: string, v: number, opts: { neg?: boolean; muted?: boolean } = {}) => (
    <div className={cn("flex items-center justify-between py-1.5", opts.muted && "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className={cn("num", opts.neg && "text-ok")}>{opts.neg ? "−" : ""}{formatMoney(v, lang)}</dd>
    </div>
  );
  return (
    <dl className={cn("text-[15px]", className)}>
      {row(L("المجموع (قبل الضريبة)", "Subtotal (before tax)"), b.subtotal)}
      {b.discount ? row(L("الخصم", "Discount"), b.discount, { neg: true }) : null}
      {b.service ? row(L(`خدمة ${Math.round(serviceRate * 100)}٪`, `Service ${Math.round(serviceRate * 100)}%`), b.service, { muted: true }) : null}
      {row(L("ضريبة القيمة المضافة 14٪", "VAT 14%"), b.vat, { muted: true })}
      {b.deliveryFee ? row(L("التوصيل", "Delivery fee"), b.deliveryFee, { muted: true }) : null}
      <div className="mt-2 flex items-center justify-between border-t pt-3 text-lg font-bold">
        <dt>{L("الإجمالي", "Total")}</dt>
        <dd className="num">{formatMoney(b.total, lang)}</dd>
      </div>
    </dl>
  );
}
