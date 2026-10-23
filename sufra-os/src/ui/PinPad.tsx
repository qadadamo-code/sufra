import { useEffect, useState } from "react";
import { motion, useAnimationControls } from "motion/react";
import { Delete } from "lucide-react";
import { cn } from "@/lib/cn";
import { latinDigits } from "@/lib/arabic";
import { useT } from "@/i18n/i18n";
import { useHotkeys } from "./hotkeys";
import { useReduced } from "./motion";

/**
 * Big touch PIN pad (72px keys). Calls onComplete when `length` digits are in; parent answers true/false.
 * Wrong → shake + clear. Hardware keyboard (incl. Arabic-Indic digits) works too.
 */
export function PinPad({ length = 4, onComplete, disabled, error, size = "lg" }: { length?: number; onComplete: (pin: string) => Promise<boolean> | boolean; disabled?: boolean; error?: string | null; size?: "md" | "lg" }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "ok" | "bad">("idle");
  const controls = useAnimationControls();
  const reduced = useReduced();
  const { t } = useT();

  const push = (d: string) => {
    if (disabled || busy || state === "ok") return;
    setState("idle");
    setPin((p) => (p.length < length ? p + d : p));
  };
  const back = () => !busy && setPin((p) => p.slice(0, -1));

  useEffect(() => {
    if (pin.length !== length) return;
    let alive = true;
    setBusy(true);
    Promise.resolve(onComplete(pin)).then((ok) => {
      if (!alive) return;
      setBusy(false);
      if (ok) setState("ok");
      else {
        setState("bad");
        if (!reduced) void controls.start({ x: [0, -14, 12, -9, 7, -3, 0], transition: { duration: 0.42 } });
        setTimeout(() => alive && setPin(""), 380);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  const keys: Record<string, () => void> = { backspace: back, delete: () => setPin("") };
  for (let i = 0; i <= 9; i++) keys[String(i)] = () => push(String(i));
  "٠١٢٣٤٥٦٧٨٩".split("").forEach((d) => (keys[d] = () => push(latinDigits(d))));
  useHotkeys(keys, { inInputs: true });

  const key = size === "lg" ? "h-[68px] sm:h-[76px] text-[28px]" : "h-14 text-[22px]";
  return (
    <div className="mx-auto w-full max-w-[320px] select-none">
      <motion.div animate={controls} className="mb-2 flex items-center justify-center gap-4" dir="ltr" aria-live="polite" aria-label={t("pin.enter")}>
        {Array.from({ length }, (_, i) => {
          const filled = i < pin.length;
          return (
            <motion.span
              key={i}
              animate={reduced ? undefined : { scale: filled ? [1, 1.25, 1] : 1 }}
              transition={{ duration: 0.22 }}
              className={cn(
                "size-4 rounded-full border-2 transition-colors duration-150",
                state === "bad" ? "border-danger bg-danger" : state === "ok" ? "border-ok bg-ok" : filled ? "border-primary bg-primary" : "border-line-strong bg-transparent",
              )}
            />
          );
        })}
      </motion.div>
      <p className={cn("mb-5 h-5 text-center text-[13.5px] font-semibold", error || state === "bad" ? "text-danger" : "text-transparent")} role="alert">
        {error || (state === "bad" ? t("pin.wrong") : ".")}
      </p>
      <div className="grid grid-cols-3 gap-3" dir="ltr">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <PadKey key={d} className={key} onClick={() => push(d)} disabled={disabled} label={t("pin.digit", { n: d })}>
            {d}
          </PadKey>
        ))}
        <PadKey className={cn(key, "text-[14px] font-semibold text-muted")} onClick={() => setPin("")} disabled={disabled || !pin} label={t("pin.clear")} subtle>
          C
        </PadKey>
        <PadKey className={key} onClick={() => push("0")} disabled={disabled} label={t("pin.digit", { n: 0 })}>
          0
        </PadKey>
        <PadKey className={cn(key, "text-muted")} onClick={back} disabled={disabled || !pin} label={t("pin.delete")} subtle>
          <Delete className="size-7" />
        </PadKey>
      </div>
    </div>
  );
}

function PadKey({ children, onClick, disabled, className, label, subtle }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; className?: string; label: string; subtle?: boolean }) {
  const reduced = useReduced();
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      whileTap={reduced ? undefined : { scale: 0.92 }}
      transition={{ type: "spring", stiffness: 700, damping: 30 }}
      className={cn(
        "grid place-items-center rounded-[22px] font-mono font-medium transition-colors disabled:opacity-40",
        subtle ? "bg-transparent hover:bg-surface-3" : "border border-line bg-surface shadow-sf-sm hover:border-line-strong hover:bg-surface-2 active:bg-primary-soft",
        className,
      )}
    >
      {children}
    </motion.button>
  );
}
