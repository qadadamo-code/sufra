// OtpInput — from the owner's paste. Sufra colours; the digit group is always dir="ltr" (codes read left-to-right).
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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

const CROSSFADE = { type: "spring", stiffness: 260, damping: 34, mass: 0.8 } as const;
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
  const messageTone = error ? "text-danger" : success ? "text-ok" : "text-muted-foreground";

  return (
    <div className={`inline-flex flex-col ${className}`}>
      <motion.div
        role="group"
        aria-label={label}
        dir="ltr"
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
                aria-label={`${label} ${i + 1}/${length}`}
                aria-invalid={error || undefined}
                aria-describedby={hasStatus ? statusId : undefined}
                className={`h-12 w-10 rounded-[12px] border-2 text-center text-[15px] text-transparent caret-transparent outline-none transition-[background-color,border-color,box-shadow] duration-150 selection:bg-transparent focus-visible:outline-none disabled:opacity-50 ${
                  error
                    ? "border-danger bg-card"
                    : success
                      ? "border-ok bg-card"
                      : active
                        ? "border-primary bg-card"
                        : char
                          ? "border-foreground/25 bg-card"
                          : "border-border bg-muted shadow-[inset_0_1px_2px_rgba(22,33,30,0.08)]"
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
                      className="col-start-1 row-start-1 font-mono text-[15px] tabular-nums text-foreground"
                    >
                      {char}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
                {active && !char && !disabled ? (
                  <motion.span
                    className="col-start-1 row-start-1 block h-[17px] w-[1.5px] rounded-[1px] bg-foreground"
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

