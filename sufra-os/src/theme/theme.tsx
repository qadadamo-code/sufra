import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadRaw, saveRaw } from "@/lib/storage";

export type ThemePref = "system" | "light" | "dark";
const KEY = "sufra-os.theme";
const mq = () => (typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : undefined);

function apply(pref: ThemePref) {
  if (typeof document === "undefined") return false;
  const dark = pref === "dark" || (pref === "system" && !!mq()?.matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1412" : "#0d5a53");
  return dark;
}

const Ctx = createContext<{ pref: ThemePref; dark: boolean; set: (p: ThemePref) => void; toggle: () => void } | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPref] = useState<ThemePref>(() => {
    const v = loadRaw(KEY);
    return v === "light" || v === "dark" ? v : "system";
  });
  const [dark, setDark] = useState(() => apply(pref));
  useEffect(() => {
    setDark(apply(pref));
    if (pref !== "system") return;
    const m = mq();
    const on = () => setDark(apply("system"));
    m?.addEventListener("change", on);
    return () => m?.removeEventListener("change", on);
  }, [pref]);
  const set = useCallback((p: ThemePref) => {
    saveRaw(KEY, p);
    setPref(p);
  }, []);
  const value = useMemo(() => ({ pref, dark, set, toggle: () => set(dark ? "light" : "dark") }), [pref, dark, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTheme outside ThemeProvider");
  return c;
}
