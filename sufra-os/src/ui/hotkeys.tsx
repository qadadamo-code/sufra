/**
 * Contextual hotkeys.
 *
 *   useHotkeys({ "mod+k": openPalette, "g o": () => nav("/overview"), "?": showHelp }, { description: {...} })
 *
 * - "mod" = ⌘ on Apple, Ctrl elsewhere. Sequences are space-separated ("g o").
 * - Scopes: a Dialog/Sheet opens a new scope; only the top-most scope's hotkeys fire, so pressing "n" inside a
 *   dialog does not trigger the page behind it. Wrap a subtree in <HotkeyScope> to create one yourself.
 * - Ignored while typing in inputs, unless the combo has a modifier or the option `inInputs` is set.
 * - Registered hotkeys with a description are listed by useHotkeyList() (shortcut help sheet).
 */
import { createContext, useContext, useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { Localized } from "@/data/types";

type Handler = (e: KeyboardEvent) => void;
interface Binding {
  id: string;
  scope: string;
  combo: string;
  handler: Handler;
  inInputs: boolean;
  description?: Localized;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD_LABEL = isMac ? "⌘" : "Ctrl";

const bindings = new Map<string, Binding>();
const scopeStack: string[] = ["root"];
const listeners = new Set<() => void>();
let version = 0;
const notify = () => {
  version++;
  listeners.forEach((l) => l());
};

let seq: { key: string; at: number } | null = null;

function normKey(e: KeyboardEvent) {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  return k === " " ? "space" : k === "esc" ? "escape" : k;
}

function matchCombo(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.split("+");
  const key = parts.pop()!;
  const want = new Set(parts);
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (want.has("mod") !== mod) return false;
  if (!want.has("mod") && (e.metaKey || e.ctrlKey)) return false;
  if (want.has("alt") !== e.altKey) return false;
  // shift is implied by characters like "?" — only enforce when asked for explicitly
  if (want.has("shift") && !e.shiftKey) return false;
  // physical key (e.code) so shortcuts work on an Arabic keyboard layout too
  const code = e.code?.toLowerCase() ?? "";
  const physical = code.startsWith("key") ? code.slice(3) : code.startsWith("digit") ? code.slice(5) : "";
  return normKey(e) === key || (key.length === 1 && physical === key);
}

function typingIn(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  const top = scopeStack[scopeStack.length - 1];
  const typing = typingIn(e);
  const now = Date.now();
  const prev = seq && now - seq.at < 900 ? seq.key : null;
  for (const b of bindings.values()) {
    if (b.scope !== top) continue;
    const hasMod = /(^|\+)(mod|alt)\+/.test(b.combo);
    if (typing && !b.inInputs && !hasMod && b.combo !== "escape") continue;
    const steps = b.combo.split(" ");
    if (steps.length === 2) {
      if (prev && matchesPrev(steps[0], prev) && matchCombo(steps[1], e)) {
        e.preventDefault();
        seq = null;
        b.handler(e);
        return;
      }
      continue;
    }
    if (matchCombo(b.combo, e)) {
      e.preventDefault();
      seq = null;
      b.handler(e);
      return;
    }
  }
  if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
    const code = e.code?.toLowerCase() ?? "";
    seq = { key: code.startsWith("key") ? code.slice(3) : normKey(e), at: now };
  }
}
const matchesPrev = (step: string, prev: string) => step === prev;

if (typeof window !== "undefined") window.addEventListener("keydown", onKeyDown);

const ScopeCtx = createContext("root");

/** Pushes a hotkey scope while mounted (dialogs do this automatically). */
export function HotkeyScope({ children, active = true }: { children: ReactNode; active?: boolean }) {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    scopeStack.push(id);
    notify();
    return () => {
      const i = scopeStack.lastIndexOf(id);
      if (i > 0) scopeStack.splice(i, 1);
      notify();
    };
  }, [id, active]);
  return <ScopeCtx.Provider value={id}>{children}</ScopeCtx.Provider>;
}

export interface HotkeyOptions {
  enabled?: boolean;
  inInputs?: boolean;
  /** per-combo descriptions for the help sheet */
  descriptions?: Record<string, Localized>;
}

export function useHotkeys(map: Record<string, Handler>, opts: HotkeyOptions = {}) {
  const scope = useContext(ScopeCtx);
  const ref = useRef(map);
  ref.current = map;
  const base = useId();
  const combos = Object.keys(map).join("|");
  const descKey = JSON.stringify(opts.descriptions ?? {});
  useEffect(() => {
    if (opts.enabled === false) return;
    const ids: string[] = [];
    for (const combo of Object.keys(ref.current)) {
      const id = `${base}:${combo}`;
      ids.push(id);
      bindings.set(id, { id, scope, combo: combo.toLowerCase(), inInputs: !!opts.inInputs, handler: (e) => ref.current[combo]?.(e), description: opts.descriptions?.[combo] });
    }
    notify();
    return () => {
      ids.forEach((i) => bindings.delete(i));
      notify();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combos, scope, opts.enabled, opts.inInputs, descKey, base]);
}

/** Hotkeys with descriptions in the active scope (for the help sheet). */
export function useHotkeyList() {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
  const seen = new Set<string>();
  return [...bindings.values()].filter((b) => b.description && !seen.has(b.combo) && seen.add(b.combo)).map((b) => ({ combo: b.combo, description: b.description! }));
}

/** "mod+k" → ["⌘","K"] for <Kbd>. */
export function comboKeys(combo: string): string[][] {
  return combo.split(" ").map((step) =>
    step.split("+").map((k) => (k === "mod" ? MOD_LABEL : k === "shift" ? "⇧" : k === "alt" ? (isMac ? "⌥" : "Alt") : k === "escape" ? "Esc" : k.length === 1 ? k.toUpperCase() : k)),
  );
}
