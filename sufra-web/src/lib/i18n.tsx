import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang } from "./data";
import { loadRaw, saveRaw } from "./storage";

type Ctx = { lang: Lang; dir: "rtl" | "ltr"; setLang: (l: Lang) => void; L: (ar: string, en: string) => string };
const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (loadRaw("sufra.lang") === "en" ? "en" : "ar"));
  useEffect(() => {
    const h = document.documentElement;
    h.lang = lang;
    h.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = lang === "ar" ? "سُفرة — اكتشف واحجز واطلب في القاهرة" : "Sufra — discover, book & order in Cairo";
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    saveRaw("sufra.lang", l);
    setLangState(l);
  }, []);
  const L = useCallback((ar: string, en: string) => (lang === "ar" ? ar : en), [lang]);
  const value = useMemo<Ctx>(() => ({ lang, dir: lang === "ar" ? "rtl" : "ltr", setLang, L }), [lang, setLang, L]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useLang(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error("useLang outside LangProvider");
  return c;
}
