/**
 * ⌘K command palette. Anything can contribute commands while mounted:
 *
 *   useCommands([{ id: "pos.new", title: { ar: "طلب جديد", en: "New order" }, group: "actions", icon: <Plus/>, shortcut: "n", perform: () => … }]);
 *
 * The shell registers one command per screen from the module registry.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { matches } from "@/lib/arabic";
import { useT } from "@/i18n/i18n";
import type { Localized } from "@/data/types";
import { HotkeyScope, useHotkeys } from "./hotkeys";
import { Combo, Kbd } from "./Kbd";
import { spring, useReduced } from "./motion";

export interface Command {
  id: string;
  title: Localized;
  subtitle?: Localized;
  group: "screens" | "actions" | string;
  icon?: ReactNode;
  keywords?: string[];
  shortcut?: string;
  perform: () => void;
}

type Store = { cmds: Map<string, Command[]>; v: number; subs: Set<() => void> };
const Ctx = createContext<{ store: Store; open: boolean; setOpen: (v: boolean) => void } | null>(null);

export function CommandProvider({ children }: { children: ReactNode }) {
  const store = useRef<Store>({ cmds: new Map(), v: 0, subs: new Set() }).current;
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ store, open, setOpen }), [store, open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <CommandPalette />
    </Ctx.Provider>
  );
}

function useCtx() {
  const c = useContext(Ctx);
  if (!c) throw new Error("CommandProvider missing");
  return c;
}

export function useCommandPalette() {
  const { open, setOpen } = useCtx();
  return { open, setOpen, toggle: () => setOpen(!open) };
}

/** Register commands while the calling component is mounted. */
export function useCommands(cmds: Command[], deps: unknown[] = []) {
  const { store } = useCtx();
  const key = useRef(Math.random().toString(36).slice(2)).current;
  useEffect(() => {
    store.cmds.set(key, cmds);
    store.v++;
    store.subs.forEach((s) => s());
    return () => {
      store.cmds.delete(key);
      store.v++;
      store.subs.forEach((s) => s());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function useAllCommands() {
  const { store } = useCtx();
  useSyncExternalStore(
    (cb) => {
      store.subs.add(cb);
      return () => store.subs.delete(cb);
    },
    () => store.v,
    () => store.v,
  );
  return [...store.cmds.values()].flat();
}

function CommandPalette() {
  const { open, setOpen } = useCtx();
  const { t, lang } = useT();
  const all = useAllCommands();
  const reduced = useReduced();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useHotkeys({ "mod+k": () => setOpen(!open), "/": () => setOpen(true) }, { descriptions: { "mod+k": { ar: "لوحة الأوامر", en: "Command palette" } } });

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const hits = all.filter((c) => matches([c.title.ar, c.title.en, c.subtitle?.ar ?? "", c.subtitle?.en ?? "", ...(c.keywords ?? [])].join(" "), q));
    const order = (g: string) => (g === "screens" ? 0 : g === "actions" ? 1 : 2);
    return hits.sort((a, b) => order(a.group) - order(b.group)).slice(0, 40);
  }, [all, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = useCallback(
    (c: Command | undefined) => {
      if (!c) return;
      setOpen(false);
      setTimeout(c.perform, 10);
    },
    [setOpen],
  );

  const groups: { id: string; label: string; items: { c: Command; i: number }[] }[] = [];
  results.forEach((c, i) => {
    let g = groups.find((x) => x.id === c.group);
    if (!g) groups.push((g = { id: c.group, label: c.group === "screens" ? t("palette.screens") : c.group === "actions" ? t("palette.actions") : c.group, items: [] }));
    g.items.push({ c, i });
  });

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <HotkeyScope>
          <PaletteKeys onClose={() => setOpen(false)} onMove={(d) => setSel((s) => Math.max(0, Math.min(results.length - 1, s + d)))} onRun={() => run(results[sel])} />
          <div className="fixed inset-0 z-[90] flex items-start justify-center p-3 pt-[12vh] sm:p-6 sm:pt-[14vh]">
            <motion.div className="absolute inset-0 bg-[var(--sf-overlay)] backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0 : 0.16 }} onClick={() => setOpen(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={t("palette.label")}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
              transition={spring.snappy}
              className="relative flex max-h-[min(70dvh,560px)] w-full max-w-xl flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-sf-lg"
            >
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search className="size-5 shrink-0 text-muted" aria-hidden />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={t("palette.placeholder")}
                  className="h-14 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls="palette-list"
                  aria-activedescendant={results[sel] ? `cmd-${results[sel].id}` : undefined}
                />
                <Kbd>Esc</Kbd>
              </div>
              <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2 thin-scrollbar">
                {!results.length ? <p className="px-3 py-10 text-center text-[14px] text-muted">{t("palette.empty", { q })}</p> : null}
                {groups.map((g) => (
                  <div key={g.id} className="mb-1">
                    <p className="px-3 pt-2 pb-1 text-[11.5px] font-semibold text-faint">{g.label}</p>
                    {g.items.map(({ c, i }) => (
                      <button
                        key={c.id}
                        id={`cmd-${c.id}`}
                        data-idx={i}
                        role="option"
                        aria-selected={i === sel}
                        type="button"
                        onMouseMove={() => setSel(i)}
                        onClick={() => run(c)}
                        className={cn("relative flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-start transition-colors", i === sel ? "text-ink" : "text-ink-2")}
                      >
                        {i === sel ? <motion.span layoutId="palette-sel" className="absolute inset-0 rounded-xl bg-surface-3" transition={reduced ? { duration: 0 } : spring.layout} /> : null}
                        <span className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface [&_svg]:size-4", i === sel && "border-primary/30 text-primary")}>{c.icon}</span>
                        <span className="relative min-w-0 flex-1">
                          <span className="block truncate text-[14.5px] font-semibold">{c.title[lang]}</span>
                          {c.subtitle ? <span className="block truncate text-[12.5px] text-muted">{c.subtitle[lang]}</span> : null}
                        </span>
                        {c.shortcut ? <Combo combo={c.shortcut} className="relative" /> : null}
                        {i === sel ? <CornerDownLeft className="relative size-4 text-muted rtl:scale-x-[-1]" aria-hidden /> : null}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 border-t border-line bg-surface-2/60 px-4 py-2 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↵</Kbd> {t("palette.select")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> {t("palette.move")}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Kbd>Esc</Kbd> {t("palette.close")}
                </span>
              </div>
            </motion.div>
          </div>
        </HotkeyScope>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function PaletteKeys({ onClose, onMove, onRun }: { onClose: () => void; onMove: (d: number) => void; onRun: () => void }) {
  useHotkeys({ escape: onClose, arrowdown: () => onMove(1), arrowup: () => onMove(-1), enter: onRun, "mod+k": onClose }, { inInputs: true });
  return null;
}
