// Several small components from the owner's paste, kept together. Split each into its own
// file under src/components/ui/ (names in the section headers). All need `motion`.

// ============================================================================
// otp-input.tsx
// ============================================================================
"use client";

import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, Reorder, animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";

const CROSSFADE = { type: "spring", stiffness: 260, damping: 34, mass: 0.8 } as const;
const CELL = { type: "spring", stiffness: 520, damping: 34, mass: 0.45 } as const;
const POP = { type: "spring", stiffness: 640, damping: 22, mass: 0.7 } as const;
const FILL = { type: "spring", stiffness: 210, damping: 34, mass: 0.9 } as const;
const INSTANT = { duration: 0 } as const;
const STILL = { duration: 0 } as const;
const EASE = [0.23, 1, 0.32, 1] as const;

export type OtpMode = "numeric" | "alphanumeric";
const ALLOW: Record<OtpMode, RegExp> = { numeric: /^[0-9]$/, alphanumeric: /^[0-9a-zA-Z]$/ };

export type UseOtpInputOptions = {
  length?: number;
  mode?: OtpMode;
  defaultValue?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
};

export function useOtpInput({ length = 6, mode = "numeric", defaultValue = "", disabled = false, onChange, onComplete }: UseOtpInputOptions = {}) {
  const allow = ALLOW[mode];
  const keep = useCallback((text: string) => text.split("").filter((c) => allow.test(c)).join(""), [allow]);
  const [chars, setChars] = useState<string[]>(() => {
    const seed = defaultValue.split("").filter((c) => ALLOW[mode].test(c)).slice(0, length);
    return Array.from({ length }, (_, i) => seed[i] ?? "");
  });
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const charsRef = useRef(chars);
  charsRef.current = chars;
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const changed = useRef(onChange);
  changed.current = onChange;
  const completed = useRef(onComplete);
  completed.current = onComplete;

  useEffect(() => {
    setChars((prev) => (prev.length === length ? prev : Array.from({ length }, (_, i) => prev[i] ?? "")));
    refs.current.length = length;
  }, [length]);

  const commit = useCallback((next: string[]) => {
    charsRef.current = next;
    setChars(next);
    const value = next.join("");
    changed.current?.(value);
    if (next.length > 0 && next.every((c) => c !== "")) completed.current?.(value);
  }, []);

  const focusAt = useCallback(
    (index: number) => {
      const el = refs.current[Math.max(0, Math.min(length - 1, index))];
      if (!el) return;
      el.focus();
      el.select();
    },
    [length],
  );

  const fillFrom = useCallback(
    (index: number, text: string) => {
      const incoming = keep(text);
      if (incoming.length === 0) return;
      const next = [...charsRef.current];
      let cursor = index;
      for (const c of incoming) {
        if (cursor >= length) break;
        next[cursor] = c;
        cursor += 1;
      }
      commit(next);
      focusAt(cursor);
    },
    [commit, focusAt, keep, length],
  );

  const clear = useCallback(() => {
    commit(Array.from({ length }, () => ""));
    focusAt(0);
  }, [commit, focusAt, length]);

  const getCellProps = useCallback(
    (index: number) => ({
      ref: (el: HTMLInputElement | null) => {
        refs.current[index] = el;
      },
      value: chars[index] ?? "",
      disabled,
      type: "text" as const,
      inputMode: (mode === "numeric" ? "numeric" : "text") as "numeric" | "text",
      autoComplete: index === 0 ? "one-time-code" : "off",
      autoCorrect: "off" as const,
      autoCapitalize: "off" as const,
      spellCheck: false as const,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const previous = charsRef.current[index] ?? "";
        const raw = e.currentTarget.value;
        const trimmed = raw.length > 1 && previous && raw.startsWith(previous) ? raw.slice(previous.length) : raw;
        const incoming = keep(trimmed);
        if (incoming.length === 0) {
          if (raw.length === 0 && previous) {
            const next = [...charsRef.current];
            next[index] = "";
            commit(next);
          }
          e.currentTarget.value = charsRef.current[index] ?? "";
          return;
        }
        if (incoming.length === 1) {
          const next = [...charsRef.current];
          next[index] = incoming;
          e.currentTarget.value = incoming;
          commit(next);
          if (index < length - 1) focusAt(index + 1);
          return;
        }
        fillFrom(index, incoming);
      },
      onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Backspace") {
          e.preventDefault();
          const current = charsRef.current;
          const next = [...current];
          if (current[index]) {
            next[index] = "";
            commit(next);
            return;
          }
          if (index > 0) {
            next[index - 1] = "";
            commit(next);
            focusAt(index - 1);
          }
          return;
        }
        if (e.key === "Delete") {
          e.preventDefault();
          const next = [...charsRef.current];
          next[index] = "";
          commit(next);
          return;
        }
        // NOTE for RTL pages: the code reads left-to-right, keep the group dir="ltr".
        if (e.key === "ArrowLeft") return e.preventDefault(), focusAt(index - 1);
        if (e.key === "ArrowRight") return e.preventDefault(), focusAt(index + 1);
        if (e.key === "Home") return e.preventDefault(), focusAt(0);
        if (e.key === "End") return e.preventDefault(), focusAt(length - 1);
      },
      onPaste: (e: ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const text = keep(e.clipboardData.getData("text"));
        fillFrom(text.length >= length ? 0 : index, text);
      },
      onFocus: (e: FocusEvent<HTMLInputElement>) => {
        e.currentTarget.select();
        const firstEmpty = charsRef.current.findIndex((c) => c === "");
        if (firstEmpty !== -1 && firstEmpty < index) {
          focusAt(firstEmpty);
          return;
        }
        setFocusedIndex(index);
      },
      onBlur: (e: FocusEvent<HTMLInputElement>) => {
        const to = e.relatedTarget as HTMLInputElement | null;
        if (to && refs.current.includes(to)) return;
        setFocusedIndex(-1);
      },
    }),
    [chars, commit, disabled, fillFrom, focusAt, keep, length, mode],
  );

  return { chars, value: chars.join(""), length, complete: chars.length > 0 && chars.every((c) => c !== ""), focusedIndex, getCellProps, focusAt, clear };
}

export type OtpStatus = "idle" | "error" | "success";
export type OtpInputHandle = { clear: () => void; focus: () => void };

export function OtpInput({
  length = 6,
  mode = "numeric",
  defaultValue = "",
  onChange,
  onComplete,
  status = "idle",
  errorMessage = "",
  successMessage = "",
  hint = "",
  label = "Verification code",
  groupEvery = 3,
  disabled = false,
  autoFocus = false,
  focusOnError = true,
  className = "",
  ref,
}: {
  length?: number;
  mode?: OtpMode;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  status?: OtpStatus;
  errorMessage?: string;
  successMessage?: string;
  hint?: string;
  label?: string;
  groupEvery?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  focusOnError?: boolean;
  className?: string;
  ref?: React.Ref<OtpInputHandle>;
}) {
  const reduced = useReducedMotion();
  const statusId = useId();
  const { chars, focusedIndex, getCellProps, focusAt, clear } = useOtpInput({ length, mode, defaultValue, disabled, onChange, onComplete });
  const wasError = useRef(false);
  const error = status === "error";
  const success = status === "success";
  useImperativeHandle(ref, () => ({ clear: () => (clear(), focusAt(0)), focus: () => focusAt(0) }), [clear, focusAt]);
  useEffect(() => {
    if (error && !wasError.current && focusOnError && !disabled) focusAt(0);
    wasError.current = error;
  }, [error, focusOnError, disabled, focusAt]);
  useEffect(() => {
    if (autoFocus && !disabled) focusAt(0);
  }, [autoFocus, disabled, focusAt]);
  const enter = reduced ? { duration: 0 } : { duration: 0.22, ease: EASE };
  const swap = reduced ? { duration: 0 } : CROSSFADE;
  const hasStatus = hint.length > 0 || errorMessage.length > 0 || successMessage.length > 0;
  const message = error ? errorMessage : success ? successMessage : hint;
  const messageTone = error ? "text-red-600 dark:text-red-400" : success ? "text-emerald-600 dark:text-emerald-400" : "text-stone-500 dark:text-stone-400";

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <motion.div
        role="group"
        aria-label={label}
        className="relative flex gap-2"
        initial={false}
        variants={{ idle: { x: 0 }, wrong: { x: [0, -5, 4, -3, 0] } }}
        animate={error && !reduced ? "wrong" : "idle"}
        transition={{ duration: 0.32, ease: EASE }}
      >
        {Array.from({ length }, (_, i) => {
          const char = chars[i] ?? "";
          const active = focusedIndex === i;
          const gap = groupEvery > 0 && i > 0 && i % groupEvery === 0;
          return (
            <div key={i} className={`relative h-12 w-10 ${gap ? "ml-3" : ""}`}>
              <input
                {...getCellProps(i)}
                aria-label={`${label}, character ${i + 1} of ${length}`}
                aria-invalid={error || undefined}
                aria-describedby={hasStatus ? statusId : undefined}
                className={`h-12 w-10 rounded-[10px] border-2 text-center text-[15px] text-transparent caret-transparent outline-none transition-[background-color,border-color,box-shadow] duration-150 selection:bg-transparent focus-visible:outline-none disabled:opacity-50 ${
                  error
                    ? "border-red-500 bg-white dark:border-red-400 dark:bg-[#252522]"
                    : success
                      ? "border-emerald-500 bg-white dark:border-emerald-400 dark:bg-[#252522]"
                      : active
                        ? "border-[#4568FF] bg-white dark:border-[#93B0FF] dark:bg-[#252522]"
                        : char
                          ? "border-stone-300 bg-white dark:border-white/20 dark:bg-[#252522]"
                          : "border-stone-200 bg-stone-100/70 shadow-[inset_0_1px_2px_rgba(28,25,23,0.07)] dark:border-white/[0.08] dark:bg-[#1D1D1A] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]"
                }`}
              />
              <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                <AnimatePresence initial={false} mode="popLayout">
                  {char ? (
                    <motion.span
                      key={char}
                      initial={reduced ? false : { opacity: 0, scale: 0.97, y: 10, filter: "blur(6px)" }}
                      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -6, filter: "blur(3px)" }}
                      transition={enter}
                      className="col-start-1 row-start-1 font-mono text-[15px] tabular-nums text-stone-700 dark:text-stone-200"
                    >
                      {char}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
                {active && !char && !disabled ? (
                  <motion.span
                    className="col-start-1 row-start-1 block h-[17px] w-[1.5px] rounded-[1px] bg-stone-700 dark:bg-stone-200"
                    initial={{ opacity: 1 }}
                    animate={reduced ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
                    transition={reduced ? { duration: 0 } : { duration: 1.06, times: [0, 0.5, 0.5, 1], repeat: Infinity, ease: "linear" }}
                  />
                ) : null}
              </span>
            </div>
          );
        })}
      </motion.div>
      {hasStatus && (
        <>
          <div aria-hidden className="mt-2 grid h-4 text-[11.5px] leading-[16px]">
            <AnimatePresence initial={false} mode="wait">
              <motion.span
                key={status}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={swap}
                className={`col-start-1 row-start-1 ${messageTone}`}
              >
                {message}
              </motion.span>
            </AnimatePresence>
          </div>
          <span id={statusId} role="status" className="sr-only">
            {message}
          </span>
        </>
      )}
    </div>
  );
}
// demo: <OtpInput status={status} onComplete={(v)=>setStatus(v===CODE?"success":"error")} hint="Try 204815" successMessage="Code accepted." errorMessage="That code is not right." />

// ============================================================================
// password-strength.tsx
// ============================================================================
const COMMON = /^(?:password|passw0rd|qwerty|letmein|welcome|admin|iloveyou|monkey|dragon|abc123|111111|123123|123456)/i;
const RUN = /(.)\1{3,}/;
const RUN_UP = /(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|defg|qwer|wert|erty|asdf)/i;
const SYMBOL = /[!-/:-@[-`{-~]/;

export type PasswordRule = { id: string; label: string; test: (value: string) => boolean };
export const defaultPasswordRules: readonly PasswordRule[] = [
  { id: "length", label: "12 characters or more", test: (v) => v.length >= 12 },
  { id: "case", label: "Upper and lower case", test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { id: "digit", label: "A number", test: (v) => /\d/.test(v) },
  { id: "symbol", label: "A symbol", test: (v) => SYMBOL.test(v) },
];
const defaultLabels = ["Empty", "Weak", "Fair", "Good", "Strong"] as const;

export function usePasswordStrength(value: string, { rules = defaultPasswordRules, labels = defaultLabels as readonly string[], announceDelay = 700 } = {}) {
  const state = useMemo(() => {
    const evaluated = rules.map((rule) => ({ ...rule, met: rule.test(value) }));
    const passed = evaluated.reduce((n, r) => n + (r.met ? 1 : 0), 0);
    const guessable = value.length > 0 && (COMMON.test(value) || RUN.test(value) || RUN_UP.test(value));
    const score = value.length === 0 ? 0 : guessable ? 1 : Math.min(rules.length, Math.max(1, passed));
    const label = labels[Math.min(score, labels.length - 1)] ?? "";
    const unmet = evaluated.filter((r) => !r.met);
    const announcement =
      value.length === 0
        ? ""
        : [
            `Password strength ${label.toLowerCase()}.`,
            guessable ? "This is a commonly guessed pattern." : "",
            unmet.length === 0 ? "All requirements met." : `Still needed: ${unmet.map((r) => r.label.toLowerCase()).join(", ")}.`,
          ]
            .filter(Boolean)
            .join(" ");
    return { score, max: rules.length, label, rules: evaluated, guessable, announcement };
  }, [value, rules, labels]);
  const [settled, setSettled] = useState("");
  useEffect(() => {
    if (state.announcement === "") return setSettled("");
    const id = setTimeout(() => setSettled(state.announcement), announceDelay);
    return () => clearTimeout(id);
  }, [state.announcement, announceDelay]);
  return { ...state, announcement: settled };
}

const TONES = {
  none: { bar: "bg-stone-300 dark:bg-white/20", text: "text-stone-500 dark:text-stone-400" },
  danger: { bar: "bg-red-500", text: "text-red-600 dark:text-red-400" },
  caution: { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  safe: { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
} as const;
function toneFor(score: number, max: number) {
  if (score === 0) return TONES.none;
  const ratio = score / max;
  if (ratio <= 0.34) return TONES.danger;
  if (ratio <= 0.67) return TONES.caution;
  return TONES.safe;
}

export function PasswordStrength({ value, rules = defaultPasswordRules, labels = defaultLabels as readonly string[], announceDelay = 700, showRules = true, className = "" }: {
  value: string;
  rules?: readonly PasswordRule[];
  labels?: readonly string[];
  announceDelay?: number;
  showRules?: boolean;
  className?: string;
}) {
  const { score, max, label, rules: evaluated, guessable, announcement } = usePasswordStrength(value, { rules, labels, announceDelay });
  const reduced = useReducedMotion();
  const tone = toneFor(score, max);
  return (
    <div className={`w-full ${className}`}>
      <div role="meter" aria-label="Password strength" aria-valuemin={0} aria-valuemax={max} aria-valuenow={score} aria-valuetext={label} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }}>
        {Array.from({ length: max }, (_, i) => (
          <div key={i} className="relative h-1.5 overflow-hidden rounded-[2px] bg-stone-200 dark:bg-white/12">
            <motion.span className={`absolute inset-0 origin-left rounded-[2px] transition-colors duration-200 ${tone.bar}`} initial={false} animate={{ scaleX: i < score ? 1 : 0 }} transition={reduced ? INSTANT : { ...CELL, delay: i < score ? i * 0.03 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex h-5 items-center justify-between gap-3">
        <span className="inline-grid text-[12.5px] font-medium leading-5">
          {labels.map((text, i) => (
            <motion.span key={text} aria-hidden className={`col-start-1 row-start-1 whitespace-nowrap transition-colors duration-200 ${tone.text}`} initial={false} animate={{ opacity: i === Math.min(score, labels.length - 1) ? 1 : 0 }} transition={reduced ? INSTANT : CROSSFADE}>
              {text}
            </motion.span>
          ))}
        </span>
        <motion.span aria-hidden className="whitespace-nowrap text-[11.5px] leading-5 text-amber-600 dark:text-amber-400" initial={false} animate={{ opacity: guessable ? 1 : 0 }} transition={reduced ? INSTANT : CROSSFADE}>
          Commonly guessed
        </motion.span>
      </div>
      {showRules && (
        <ul className="mt-3 grid gap-1.5">
          {evaluated.map((rule) => (
            <li key={rule.id} className="flex items-center gap-2">
              <span className="relative grid size-[14px] shrink-0 place-items-center rounded-[4px] border border-stone-200 text-white dark:border-white/[0.16] dark:text-stone-900">
                <motion.span className="absolute inset-0 rounded-[3px] bg-emerald-500" initial={false} animate={{ opacity: rule.met ? 1 : 0 }} transition={reduced ? INSTANT : CROSSFADE} />
                <motion.svg viewBox="0 0 12 12" fill="none" aria-hidden className="relative size-[9px]" initial={false} animate={{ opacity: rule.met ? 1 : 0, scale: rule.met ? 1 : 0.6 }} transition={reduced ? INSTANT : CELL}>
                  <path d="M2 6.2 4.7 8.9 10 3.3" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
                </motion.svg>
              </span>
              <span className={`text-[12.5px] leading-5 transition-colors duration-200 ${rule.met ? "text-stone-700 dark:text-stone-200" : "text-stone-500 dark:text-stone-400"}`}>{rule.label}</span>
              <span className="sr-only">{rule.met ? "met" : "not met"}</span>
            </li>
          ))}
        </ul>
      )}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

// ============================================================================
// progress-bar.tsx
// ============================================================================
export function ProgressBar({ value, max = 100, label = "Progress", pendingLabel = "Working", completeLabel = "Complete", className = "" }: {
  value: number | null;
  max?: number;
  label?: string;
  pendingLabel?: string;
  completeLabel?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const labelId = useId();
  const indeterminate = value === null;
  const fraction = value === null || max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const percent = Math.round(fraction * 100);
  const complete = !indeterminate && fraction >= 1;
  const measured = indeterminate ? {} : { "aria-valuenow": Math.round(fraction * max * 100) / 100, "aria-valuetext": `${percent}%` };
  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="truncate text-[13px] font-medium text-stone-700 dark:text-stone-200">{label}</span>
        <span aria-hidden className="grid shrink-0 justify-items-end text-stone-500 dark:text-stone-400">
          <motion.span className="col-start-1 row-start-1 whitespace-nowrap text-[12px] font-medium leading-5" initial={false} animate={{ opacity: indeterminate ? 1 : 0 }} transition={reduced ? INSTANT : CROSSFADE}>{pendingLabel}</motion.span>
          <motion.span className="col-start-1 row-start-1 whitespace-nowrap font-mono text-[12px] font-medium leading-5 tabular-nums" initial={false} animate={{ opacity: indeterminate ? 0 : 1 }} transition={reduced ? INSTANT : CROSSFADE}>{percent}%</motion.span>
        </span>
      </div>
      <div role="progressbar" aria-labelledby={labelId} aria-valuemin={0} aria-valuemax={max} {...measured} className="mt-2 rounded-[4px] bg-stone-200/60 p-[2px] shadow-[inset_0_1px_2px_rgba(28,25,23,0.1),inset_0_0_0_1px_rgba(28,25,23,0.06)] dark:bg-[#1D1D1A] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.45)]">
        <div className="relative h-[8px] overflow-hidden rounded-[2px]">
          <motion.span aria-hidden className="absolute inset-0 block origin-left rounded-[2px] bg-[#4568FF] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-1px_0_rgba(28,25,23,0.2)] dark:bg-[#93B0FF]" initial={false} animate={{ scaleX: indeterminate ? 0 : fraction }} transition={reduced ? INSTANT : FILL} />
          {indeterminate && !reduced ? (
            <motion.span aria-hidden className="absolute inset-y-0 left-0 block w-2/5 rounded-[2px] bg-[#4568FF] dark:bg-[#93B0FF]" initial={{ x: "-100%", opacity: 0 }} animate={{ x: "250%", opacity: 1 }} exit={{ opacity: 0 }} transition={{ x: { duration: 1.25, ease: "easeInOut", repeat: Infinity }, opacity: { duration: 0.18 } }} />
          ) : null}
        </div>
      </div>
      <span aria-live="polite" className="sr-only">{complete ? completeLabel : indeterminate ? pendingLabel : ""}</span>
    </div>
  );
}

// ============================================================================
// loading-button.tsx  (useAsyncAction + LoadingButton)
// ============================================================================
export type AsyncActionStatus = "idle" | "pending" | "success" | "error";
export function useAsyncAction({ action, resetAfter = 1400, onError }: { action: () => unknown; resetAfter?: number; onError?: (error: unknown) => void }) {
  const [status, setStatus] = useState<AsyncActionStatus>("idle");
  const phase = useRef<AsyncActionStatus>("idle");
  const runId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const act = useRef(action);
  const fail = useRef(onError);
  useEffect(() => {
    act.current = action;
    fail.current = onError;
  });
  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current), (timer.current = null);
  }, []);
  const reset = useCallback(() => {
    runId.current += 1;
    clear();
    phase.current = "idle";
    setStatus("idle");
  }, [clear]);
  const run = useCallback(() => {
    if (phase.current === "pending") return;
    clear();
    const id = ++runId.current;
    phase.current = "pending";
    setStatus("pending");
    const settle = (next: "success" | "error") => {
      if (!alive.current || id !== runId.current) return;
      clear();
      phase.current = next;
      setStatus(next);
      timer.current = setTimeout(() => {
        if (!alive.current || id !== runId.current) return;
        phase.current = "idle";
        setStatus("idle");
      }, resetAfter);
    };
    Promise.resolve()
      .then(() => act.current())
      .then(
        () => settle("success"),
        (error: unknown) => {
          fail.current?.(error);
          settle("error");
        },
      );
  }, [clear, resetAfter]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clear();
    };
  }, [clear]);
  return { status, run, reset, pending: status === "pending" };
}
// LoadingButton: a button whose label crossfades between idle / pending (spinning arc) / success (check, emerald) /
// error (alert, red) faces stacked in one grid cell; aria-busy while pending; role=status announces success/error;
// whileTap y:1; styles: h-9 rounded-[9px] border-stone-200 bg-white px-3.5 text-[13px] font-medium with inset highlight.
// Props: onAction, children (idle label), pendingLabel, successLabel="Done", errorLabel="Try again", resetAfter=1400, disabled, onError.

// ============================================================================
// task-steps.tsx
// ============================================================================
export type TaskStep = { id: string; label: string; meta?: string };
export type TaskStepStatus = "pending" | "active" | "done" | "error";
export function useTaskSteps({ steps, current, failed = false }: { steps: TaskStep[]; current: number; failed?: boolean }) {
  const complete = !failed && current >= steps.length;
  const rows = steps.map((step, i) => ({
    ...step,
    status: (i < current ? "done" : i === current && failed ? "error" : i === current && !complete ? "active" : "pending") as TaskStepStatus,
  }));
  const active = rows.find((r) => r.status === "active");
  const sentence = failed
    ? `Failed at ${steps[Math.min(current, steps.length - 1)]?.label ?? "step"}`
    : complete
      ? `All ${steps.length} steps complete`
      : active
        ? `${active.label}, step ${current + 1} of ${steps.length}`
        : "";
  return { rows, complete, failed, sentence };
}
// TaskSteps: an <ol> of h-7 rows; each row has a 16px status cell that swaps (AnimatePresence) between
// done (emerald tick on emerald/14% tile, POP spring), error (red cross), active (spinning 12px arc), pending (5px square dot);
// the active label shimmers with a moving background-clip:text gradient (1.6s linear loop); `meta` (e.g. "8.1s") fades in when done;
// a role=status line announces the sentence 500ms after it changes. Props: steps, current, failed, label="Task progress".

// ============================================================================
// hold-to-confirm.tsx
// ============================================================================
// useHoldToConfirm({ onConfirm, onAbort, duration=1800, steps=20, releaseRate=2.5, moveTolerance=10, haptic=true, disabled })
//  - phases idle | holding | releasing | committed; a rAF loop accumulates elapsed while held and drains it at releaseRate×
//    when released; reaching `duration` commits (vibrate 14ms, onConfirm). Pointer moving > moveTolerance, blur, tab hidden,
//    pointerleave and Escape cancel. Space/Enter hold works from the keyboard.
// HoldToConfirm: a 40px tall button; a dark copy of the label is revealed left→right with clip-path inset(0 X% 0 0) driven by a
//    motion value animated linearly while holding and eased back on release; when committed both faces crossfade to a check +
//    confirmLabel; auto-resets after resetAfter=1600ms; sr-only hint "Press and hold for N seconds to confirm".
export function useHoldPlaceholder() {
  return { animate, useMotionValue, useTransform, Reorder, POP, STILL };
}

// ============================================================================
// reorder-list.tsx
// ============================================================================
// ReorderList<T>({ items, getId, getLabel, onReorder, onCommit, disabled, label, children: (item)=>ReactNode })
//  - motion's Reorder.Group axis="y" with Reorder.Item rows (rounded-[9px] border bg-white px-3 py-2.5, 6-dot grip),
//    lifted rows get a bigger shadow and scale 1.02 while dragging;
//  - keyboard: Space/Enter grabs a row, ArrowUp/Down moves it, Space drops, Escape restores the snapshot taken on grab;
//  - a role=status live region speaks "X grabbed, position 2 of 4." / "X dropped at position 3.".
