import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Languages, Minus, Moon, Plus, Sun, UtensilsCrossed } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { useTheme } from "@/theme/theme";
import { cn } from "@/lib/cn";
import type { Units } from "@/lib/money";
import { Money, useReduced } from "@/ui";

/** Food photo with a calm placeholder (never a broken image). Lazy, async-decoded, fixed aspect. */
export function Photo({ src, alt, className, eager, children }: { src: string | null; alt: string; className?: string; eager?: boolean; children?: ReactNode }) {
  const [ok, setOk] = useState(true);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={cn("relative overflow-hidden bg-[linear-gradient(135deg,var(--sf-surface-3),var(--sf-brass-soft))]", className)}>
      {src && ok ? (
        <img
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setOk(false)}
          className={cn("absolute inset-0 size-full object-cover transition-[opacity,transform] duration-500", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-brass/60 [&_svg]:size-1/3">
          <UtensilsCrossed aria-hidden />
        </span>
      )}
      {children}
    </div>
  );
}

export function QtyStepper({ value, onChange, min = 0, max = 50, size = "md", label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; size?: "sm" | "md" | "lg"; label: string }) {
  const reduced = useReduced();
  const { L } = useT();
  const s = size === "lg" ? "h-13 [&_button]:size-13" : size === "sm" ? "h-9 [&_button]:size-9" : "h-11 [&_button]:size-11";
  return (
    <div role="group" aria-label={label} className={cn("inline-flex items-center rounded-full border border-line bg-surface-2", s)}>
      <button type="button" aria-label={L("أقل", "Less")} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))} className="grid place-items-center rounded-full text-ink-2 transition active:scale-90 disabled:opacity-35 [&_svg]:size-4">
        <Minus />
      </button>
      <span className="relative grid min-w-7 place-items-center overflow-hidden text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            className="num text-[16px] font-bold"
            initial={reduced ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? undefined : { y: -12, opacity: 0 }}
            transition={{ duration: 0.16 }}
            aria-live="polite"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <button type="button" aria-label={L("زوّد", "More")} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))} className="grid place-items-center rounded-full text-ink-2 transition active:scale-90 disabled:opacity-35 [&_svg]:size-4">
        <Plus />
      </button>
    </div>
  );
}

export interface TotalsView {
  subtotal: Units;
  discountTotal?: Units;
  service: Units;
  vat: Units;
  deliveryFee?: Units;
  total: Units;
  paid?: Units;
}

/** Subtotal / service / VAT / delivery / total — the same breakdown on cart, bill and receipt. */
export function TotalsList({ totals, serviceRate, vatRate, className, big = true }: { totals: TotalsView; serviceRate?: number; vatRate?: number; className?: string; big?: boolean }) {
  const { L } = useT();
  const row = (label: ReactNode, v: Units, cls?: string) => (
    <div className={cn("flex items-baseline justify-between gap-3", cls)}>
      <dt className="text-muted">{label}</dt>
      <dd>
        <Money value={v} />
      </dd>
    </div>
  );
  return (
    <dl className={cn("grid gap-1.5 text-[14px]", className)}>
      {row(L("المجموع", "Subtotal"), totals.subtotal)}
      {totals.discountTotal ? row(L("خصم", "Discount"), -totals.discountTotal, "text-ok") : null}
      {totals.service ? row(serviceRate ? L(`خدمة ${serviceRate / 100}٪`, `Service ${serviceRate / 100}%`) : L("خدمة", "Service"), totals.service) : null}
      {totals.deliveryFee ? row(L("التوصيل", "Delivery"), totals.deliveryFee) : null}
      {totals.vat ? row(vatRate ? L(`ضريبة ${vatRate / 100}٪`, `VAT ${vatRate / 100}%`) : L("ضريبة", "VAT"), totals.vat) : null}
      <div className={cn("mt-1.5 flex items-baseline justify-between gap-3 border-t border-dashed border-line-strong pt-2.5 font-bold", big ? "text-[18px]" : "text-[15px]")}>
        <dt>{L("الإجمالي", "Total")}</dt>
        <dd>
          <Money value={totals.total} />
        </dd>
      </div>
      {totals.paid ? (
        <>
          {row(L("اتدفع", "Paid"), -totals.paid, "text-ok")}
          <div className="flex items-baseline justify-between gap-3 text-[16px] font-bold">
            <dt>{L("الباقي", "Due")}</dt>
            <dd>
              <Money value={Math.max(0, totals.total - totals.paid)} />
            </dd>
          </div>
        </>
      ) : null}
    </dl>
  );
}

/** Language + theme, styled for photos (glass) or plain surfaces. */
export function GuestToggles({ glass }: { glass?: boolean }) {
  const { toggleLang, lang } = useT();
  const theme = useTheme();
  const cls = cn(
    "inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13.5px] font-semibold transition active:scale-95 [&_svg]:size-[18px]",
    glass ? "bg-black/35 text-white backdrop-blur-md hover:bg-black/45" : "border border-line bg-surface text-ink-2 hover:bg-surface-2",
  );
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={cls} onClick={toggleLang} aria-label={lang === "ar" ? "English" : "العربية"}>
        <Languages />
        <span>{lang === "ar" ? "EN" : "ع"}</span>
      </button>
      <button type="button" className={cn(cls, "w-10 justify-center px-0")} onClick={theme.toggle} aria-label={theme.dark ? "Light" : "Dark"}>
        {theme.dark ? <Sun /> : <Moon />}
      </button>
    </div>
  );
}

export function SectionTitle({ children, sub, className }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3", className)}>
      <h2 className="text-[21px] leading-tight">{children}</h2>
      {sub ? <span className="text-[12.5px] text-muted">{sub}</span> : null}
    </div>
  );
}
