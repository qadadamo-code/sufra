/** Edit one ticket line: qty, notes, seat, course, item discount, void (manager PIN once the kitchen has it). */
import { useEffect, useState } from "react";
import { Ban, BadgePercent } from "lucide-react";
import type { Discount, OrderItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, major } from "@/lib/money";
import { lineUnitPrice } from "@/data/pricing";
import { Badge, Button, Dialog, Segmented } from "@/ui";
import { Stepper } from "./bits";
import { lineDiscountUnits } from "../math";
import { STATUS_LABEL } from "./TicketPanel";

export const VOID_REASONS = [
  { ar: "العميل غيّر رأيه", en: "Guest changed mind" },
  { ar: "غلط في الطلب", en: "Order mistake" },
  { ar: "الأكل اتأخر", en: "Took too long" },
  { ar: "مش مظبوط", en: "Quality issue" },
  { ar: "خلصان", en: "Out of stock" },
];
export const DISCOUNT_REASONS = [
  { ar: "عميل دائم", en: "Regular guest" },
  { ar: "تعويض", en: "Service recovery" },
  { ar: "موظف", en: "Staff meal" },
  { ar: "عرض", en: "Promotion" },
  { ar: "مدير", en: "Manager's call" },
];

export function LineSheet({ item, guests, onClose, onSave, onVoid, onDiscount }: {
  item: OrderItem | null;
  guests: number;
  onClose: () => void;
  onSave: (it: OrderItem, patch: { qty?: number; notes?: string; seat?: number | null; course?: number }) => void;
  onVoid: (it: OrderItem, reason: string) => void;
  onDiscount: (it: OrderItem, d: Discount | null, reason: string) => void;
}) {
  const { L, loc, lang } = useT();
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [seat, setSeat] = useState<number | null>(null);
  const [course, setCourse] = useState(1);
  const [tab, setTab] = useState<"edit" | "discount" | "void">("edit");
  const [reason, setReason] = useState("");
  const [dKind, setDKind] = useState<"percent" | "amount">("percent");
  const [dVal, setDVal] = useState("10");
  useEffect(() => {
    if (!item) return;
    setQty(item.qty);
    setNotes(item.notes);
    setSeat(item.seat);
    setCourse(item.course);
    setTab("edit");
    setReason("");
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item) return <Dialog open={false} onClose={onClose} />;
  const isNew = item.status === "new";
  const gross = lineUnitPrice(item) * item.qty;
  const disc: Discount = dKind === "percent" ? { kind: "percent", rate: Math.round(Number(dVal || 0) * 100) } : { kind: "amount", value: major(Number(dVal || 0)) };
  const dUnits = lineDiscountUnits(item, disc);

  return (
    <Dialog
      open={!!item}
      onClose={onClose}
      size="md"
      title={
        <span className="flex items-center gap-2">
          {loc(item.name)}
          {!isNew ? <Badge tone="info" size="sm">{STATUS_LABEL[item.status][lang]}</Badge> : null}
        </span>
      }
      description={item.modifiers.map((m) => loc(m.name)).join(" · ") || undefined}
      footer={
        tab === "edit" ? (
          <Button size="lg" onClick={() => onSave(item, isNew ? { qty, notes, seat, course } : { notes, seat })} data-autofocus>
            {L("حفظ", "Save")}
          </Button>
        ) : tab === "discount" ? (
          <>
            {item.discount ? (
              <Button variant="ghost" onClick={() => onDiscount(item, null, "")}>
                {L("شيل الخصم", "Remove discount")}
              </Button>
            ) : null}
            <Button size="lg" variant="brass" disabled={!dUnits || !reason} onClick={() => onDiscount(item, disc, reason)}>
              {L("طبّق خصم", "Apply")} −{formatMoney(dUnits, { lang })}
            </Button>
          </>
        ) : (
          <Button size="lg" variant="danger" disabled={!reason} onClick={() => onVoid(item, reason)} icon={<Ban className="size-5" />}>
            {isNew ? L("شيل الصنف", "Remove item") : L("إلغاء (PIN مدير)", "Void (manager PIN)")}
          </Button>
        )
      }
    >
      <Segmented
        block
        label={L("نوع التعديل", "Edit")}
        value={tab}
        onChange={setTab}
        options={[
          { value: "edit", label: L("تعديل", "Edit") },
          { value: "discount", label: L("خصم", "Discount"), icon: <BadgePercent /> },
          { value: "void", label: L("إلغاء", "Void"), icon: <Ban /> },
        ]}
      />
      <div className="mt-4 grid gap-4">
        {tab === "edit" ? (
          <>
            {isNew ? (
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{L("الكمية", "Quantity")}</span>
                <Stepper value={qty} onChange={setQty} min={1} label={L("الكمية", "Quantity")} />
              </div>
            ) : (
              <p className="rounded-xl bg-info-soft px-3 py-2 text-[13.5px] text-info">{L("الصنف ده في المطبخ: الكمية والكورس اتقفلوا. للإلغاء استخدم «إلغاء».", "This line is in the kitchen: qty and course are locked. Use Void to cancel it.")}</p>
            )}
            <div>
              <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("الكرسي", "Seat")}</p>
              <div className="flex flex-wrap gap-1.5">
                {[null, ...Array.from({ length: Math.max(1, Math.min(guests, 12)) }, (_, i) => i + 1)].map((s) => (
                  <button key={String(s)} type="button" onClick={() => setSeat(s)} aria-pressed={seat === s} className={cn("num h-10 min-w-10 rounded-xl border px-3 text-[14px] font-semibold", seat === s ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:bg-surface-2")}>
                    {s ?? L("مشترك", "Shared")}
                  </button>
                ))}
              </div>
            </div>
            {isNew ? (
              <div>
                <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("الكورس", "Course")}</p>
                <Segmented label={L("الكورس", "Course")} value={String(course)} onChange={(v) => setCourse(Number(v))} options={[1, 2, 3].map((c) => ({ value: String(c), label: String(c) }))} />
              </div>
            ) : null}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={140} aria-label={L("ملاحظات", "Notes")} placeholder={L("ملاحظات للمطبخ", "Kitchen notes")} className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" />
          </>
        ) : tab === "discount" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented size="sm" label={L("نوع الخصم", "Discount type")} value={dKind} onChange={setDKind} options={[{ value: "percent", label: "%" }, { value: "amount", label: L("مبلغ", "Amount") }]} />
              {(dKind === "percent" ? ["10", "15", "25", "50", "100"] : ["10", "20", "50"]).map((v) => (
                <button key={v} type="button" onClick={() => setDVal(v)} className={cn("num h-9 rounded-full border px-3 text-[13.5px] font-semibold", dVal === v ? "border-brass bg-brass-soft text-brass-text" : "border-line hover:bg-surface-2")}>
                  {v}
                  {dKind === "percent" ? "%" : ""}
                </button>
              ))}
              <input value={dVal} onChange={(e) => setDVal(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" aria-label={L("القيمة", "Value")} className="num h-10 w-24 rounded-xl border border-line bg-surface px-3 text-center outline-none focus:border-primary" />
            </div>
            <ReasonPicker reasons={DISCOUNT_REASONS} value={reason} onChange={setReason} />
            <p className="text-[13px] text-muted">
              {L("قيمة الصنف", "Line value")}: <span className="num">{formatMoney(gross, { lang })}</span>
            </p>
          </>
        ) : (
          <>
            <ReasonPicker reasons={VOID_REASONS} value={reason} onChange={setReason} />
            {!isNew ? <p className="text-[13px] text-muted">{L("هيتطبع تيكت إلغاء للمطبخ وهيتسجل في السجل.", "A void ticket goes to the kitchen and the audit log.")}</p> : null}
          </>
        )}
      </div>
    </Dialog>
  );
}

export function ReasonPicker({ reasons, value, onChange }: { reasons: { ar: string; en: string }[]; value: string; onChange: (v: string) => void }) {
  const { L, lang } = useT();
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("السبب", "Reason")}</p>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <button key={r.en} type="button" onClick={() => onChange(r[lang])} aria-pressed={value === r[lang]} className={cn("h-10 rounded-full border px-3.5 text-[14px] font-medium", value === r[lang] ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface hover:bg-surface-2")}>
            {r[lang]}
          </button>
        ))}
      </div>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={L("أو اكتب السبب…", "Or type a reason…")} aria-label={L("السبب", "Reason")} className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-3.5 outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" />
    </div>
  );
}
