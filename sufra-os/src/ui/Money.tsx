import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { moneyParts, type Currency, type Units } from "@/lib/money";
import { useT } from "@/i18n/i18n";

/**
 * An amount in Units (0.00001 EGP). Digits in the mono face (tabular), currency in the text face, smaller.
 * Arabic: "1,250.00 ج.م" · English: "EGP 1,250.00". Always bidi-isolated so it reads right in either language.
 */
export function Money({ value, currency = "EGP", compact, whole, signed, className, currencyClassName, tone }: { value: Units; currency?: Currency; compact?: boolean; whole?: boolean; signed?: boolean; className?: string; currencyClassName?: string; tone?: "auto" }) {
  const { lang } = useT();
  const p = moneyParts(value, { lang, currency, compact: compact || whole, whole, signed });
  const cur = <span className={cn("font-sans text-[0.72em] font-semibold opacity-75", currencyClassName)}>{p.currency}</span>;
  const digits = (
    <span className="num" dir="ltr">
      {p.sign}
      {p.digits}
    </span>
  );
  return (
    <span className={cn("inline-flex items-baseline gap-[0.3em] whitespace-nowrap [unicode-bidi:isolate]", tone === "auto" && value < 0 && "text-danger", className)} dir={lang === "ar" ? "rtl" : "ltr"}>
      {lang === "ar" ? (
        <>
          {digits}
          {cur}
        </>
      ) : (
        <>
          {cur}
          {digits}
        </>
      )}
    </span>
  );
}

/** Money that rolls to its new value (reduced motion: jumps). */
export function AnimatedMoney({ value, ...rest }: Parameters<typeof Money>[0]) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      from.current = value;
      return;
    }
    const c = animate(from.current, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => setShown(Math.round(v / 1000) * 1000) });
    from.current = value;
    return () => c.stop();
  }, [value, reduced]);
  return <Money value={shown} {...rest} />;
}

/** Plain number with mono digits, animated. */
export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduced) return setShown(value);
    const c = animate(from.current, value, { duration: 0.5, onUpdate: (v) => setShown(Math.round(v)) });
    from.current = value;
    return () => c.stop();
  }, [value, reduced]);
  return (
    <span className={cn("num", className)} dir="ltr">
      {shown.toLocaleString("en-US")}
    </span>
  );
}
