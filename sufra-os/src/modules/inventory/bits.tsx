/** Labels and small widgets shared by the inventory screens (and the menu manager's recipe tab). */
import { useEffect, useState, type ReactNode } from "react";
import type { Localized, MoveKind, PoStatus, StockCategory, StockItem, WasteReason } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, type Tone } from "@/ui/Badge";
import { formatQty, q3, unitsFor } from "./units";

export const CATEGORY_LABEL: Record<StockCategory, Localized> = {
  produce: { ar: "خضار وفاكهة", en: "Produce" },
  meat: { ar: "لحوم ودواجن", en: "Meat & poultry" },
  fish: { ar: "أسماك", en: "Fish" },
  dairy: { ar: "ألبان وبيض", en: "Dairy & eggs" },
  dry: { ar: "بقالة جافة", en: "Dry goods" },
  spices: { ar: "بهارات", en: "Spices" },
  bakery: { ar: "مخبوزات", en: "Bakery" },
  drinks: { ar: "مشروبات", en: "Drinks" },
  packaging: { ar: "تغليف", en: "Packaging" },
  cleaning: { ar: "منظفات", en: "Cleaning" },
  prep: { ar: "تحضيرات (صوصات وعجين)", en: "Prep (sauces, doughs)" },
};

export const MOVE_LABEL: Record<MoveKind, Localized> = {
  opening: { ar: "رصيد أول", en: "Opening" },
  receive: { ar: "استلام", en: "Received" },
  sale: { ar: "بيع", en: "Sale" },
  waste: { ar: "هالك", en: "Waste" },
  staff_meal: { ar: "وجبة طاقم", en: "Staff meal" },
  transfer_out: { ar: "تحويل خارج", en: "Transfer out" },
  transfer_in: { ar: "تحويل داخل", en: "Transfer in" },
  production_in: { ar: "إنتاج", en: "Produced" },
  production_out: { ar: "دخل في إنتاج", en: "Used in prep" },
  count_adjust: { ar: "تسوية جرد", en: "Count adjustment" },
  supplier_return: { ar: "مرتجع لمورد", en: "Return to supplier" },
  sale_reversal: { ar: "إلغاء بيع", en: "Sale reversed" },
};
export const MOVE_TONE: Partial<Record<MoveKind, Tone>> = { receive: "ok", sale: "primary", waste: "danger", staff_meal: "warn", count_adjust: "brass", production_in: "info", opening: "neutral" };

export const WASTE_REASONS: { id: WasteReason; ar: string; en: string }[] = [
  { id: "expired", ar: "انتهت صلاحيته", en: "Expired" },
  { id: "spoiled", ar: "باظ / معطوب", en: "Spoiled" },
  { id: "burnt", ar: "اتحرق", en: "Burnt" },
  { id: "dropped", ar: "وقع", en: "Dropped" },
  { id: "overproduction", ar: "زيادة إنتاج", en: "Over-production" },
  { id: "returned_by_guest", ar: "زبون رجّعه", en: "Returned by guest" },
  { id: "void_after_send", ar: "اتلغى بعد ما اتعمل", en: "Voided after send" },
  { id: "staff_meal", ar: "وجبة طاقم", en: "Staff meal" },
  { id: "other", ar: "سبب تاني", en: "Other" },
];
export const wasteLabel = (r: WasteReason | null, lang: "ar" | "en") => WASTE_REASONS.find((x) => x.id === r)?.[lang] ?? "—";

export const PO_STATUS: Record<PoStatus, { ar: string; en: string; tone: Tone }> = {
  draft: { ar: "مسودة", en: "Draft", tone: "neutral" },
  sent: { ar: "اتبعت", en: "Sent", tone: "info" },
  partial: { ar: "استلام جزئي", en: "Partly received", tone: "warn" },
  received: { ar: "اتستلم", en: "Received", tone: "primary" },
  invoiced: { ar: "عليه فاتورة", en: "Invoiced", tone: "brass" },
  paid: { ar: "اتدفع", en: "Paid", tone: "ok" },
  cancelled: { ar: "اتلغى", en: "Cancelled", tone: "danger" },
};
export function PoBadge({ status }: { status: PoStatus }) {
  const { lang } = useT();
  const s = PO_STATUS[status];
  return (
    <Badge size="sm" tone={s.tone} dot>
      {s[lang]}
    </Badge>
  );
}

/** Stock status of one item vs its levels. */
export function stockState(qty: number, lv: { min: number; par: number }): { tone: Tone; ar: string; en: string } {
  if (qty <= 0 && lv.min > 0) return { tone: "danger", ar: "خلص", en: "Out" };
  if (qty <= lv.min && lv.min > 0) return { tone: "warn", ar: "قليل", en: "Low" };
  if (lv.par > 0 && qty >= lv.par * 2.5) return { tone: "info", ar: "زيادة", en: "Over" };
  return { tone: "ok", ar: "تمام", en: "OK" };
}

export function Qty({ qty, item, unit, className }: { qty: number; item: Pick<StockItem, "baseUnit" | "packs">; unit?: string; className?: string }) {
  const { lang } = useT();
  return <span className={cn("num whitespace-nowrap", qty < 0 && "text-danger", className)}>{formatQty(qty, item, lang, unit)}</span>;
}

/** Quantity + unit picker; reports the value in BASE units. */
export function QtyInput({ item, value, onChange, label, defaultUnit, className, autoFocus }: { item: Pick<StockItem, "baseUnit" | "packs">; value: number; onChange: (baseQty: number) => void; label?: ReactNode; defaultUnit?: string; className?: string; autoFocus?: boolean }) {
  const { lang } = useT();
  const units = unitsFor(item);
  const [unit, setUnit] = useState(() => (defaultUnit && units.some((u) => u.id === defaultUnit) ? defaultUnit : units[units.length > 1 && item.baseUnit !== "pc" ? 1 : 0].id));
  const u = units.find((x) => x.id === unit) ?? units[0];
  const [text, setText] = useState(() => (value ? String(q3(value / u.factor)) : ""));
  useEffect(() => {
    const cur = Number(text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))) * u.factor;
    if (q3(cur || 0) !== q3(value)) setText(value ? String(q3(value / u.factor)) : "");
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className={cn("grid gap-1.5", className)}>
      {label ? <span className="text-[13px] font-semibold text-ink-2">{label}</span> : null}
      <span className="flex h-11 overflow-hidden rounded-xl border border-line bg-surface focus-within:border-primary focus-within:shadow-[var(--sf-glow)]">
        <input
          autoFocus={autoFocus}
          inputMode="decimal"
          className="num w-0 min-w-14 flex-1 bg-transparent px-3 text-[15px] outline-none"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
            onChange(Number.isFinite(n) ? q3(n * u.factor) : 0);
          }}
        />
        <select
          aria-label={lang === "ar" ? "الوحدة" : "Unit"}
          className="w-auto max-w-[55%] shrink-0 truncate border-s border-line bg-surface-2 px-2 text-[13px] font-semibold text-ink-2 outline-none"
          value={unit}
          onChange={(e) => {
            const nu = units.find((x) => x.id === e.target.value)!;
            setUnit(nu.id);
            const n = Number(text) || 0;
            onChange(q3(n * nu.factor));
          }}
        >
          {units.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name[lang]}
              {x.factor !== 1 && !["kg", "L"].includes(x.id) ? ` (${x.factor})` : ""}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

/** Downsizes an image file to a small JPEG data URL (waste photos, menu photos). */
export function readImage(file: File, max = 640, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("not an image"));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.src = String(r.result);
    };
    r.readAsDataURL(file);
  });
}

export const pct = (bp: number, lang: "ar" | "en", digits = 1) => `${new Intl.NumberFormat(lang === "ar" ? "ar-EG" : "en-US", { maximumFractionDigits: digits }).format(bp / 100)}٪`.replace("٪", lang === "ar" ? "٪" : "%");
