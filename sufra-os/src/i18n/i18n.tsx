/**
 * i18n: Arabic (default, Egyptian dialect for UI copy) + English.
 *
 *   const { t, lang, dir, L, loc } = useT();
 *   t("shell.search")                 // typed key from dict.ts
 *   t("pin.hello", { name })          // {placeholders}
 *   L("أهلاً", "Hi")                   // inline pair (one-offs)
 *   loc(item.name)                    // a Localized {ar,en} from the data
 *
 * Modules keep their own copy next to their code:
 *   const dict = defineDict({ "pos.pay": { ar: "ادفع", en: "Pay" } });
 *   const t = useDict(dict);  t("pos.pay")
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { dict, type TKey } from "./dict";
import { loadRaw, saveRaw } from "@/lib/storage";
import type { Localized } from "@/data/types";

export type Lang = "ar" | "en";
export type Entry = { ar: string; en: string };
export type Vars = Record<string, string | number>;

const LANG_KEY = "sufra-os.lang";

export function format(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(lang: Lang, key: TKey, vars?: Vars): string {
  const e = dict[key] as Entry | undefined;
  return e ? format(e[lang], vars) : key;
}

interface Ctx {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: TKey, vars?: Vars) => string;
  L: (ar: string, en: string) => string;
  loc: (v: Localized | null | undefined) => string;
}

const LangCtx = createContext<Ctx | null>(null);

export function LangProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLangState] = useState<Lang>(() => initial ?? (loadRaw(LANG_KEY) === "en" ? "en" : "ar"));
  useEffect(() => {
    if (typeof document === "undefined") return;
    const h = document.documentElement;
    h.lang = lang;
    h.dir = lang === "ar" ? "rtl" : "ltr";
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    saveRaw(LANG_KEY, l);
    setLangState(l);
  }, []);
  const value = useMemo<Ctx>(
    () => ({
      lang,
      dir: lang === "ar" ? "rtl" : "ltr",
      setLang,
      toggleLang: () => setLang(lang === "ar" ? "en" : "ar"),
      t: (k, v) => translate(lang, k, v),
      L: (ar, en) => (lang === "ar" ? ar : en),
      loc: (v) => (v ? v[lang] || v.ar || v.en : ""),
    }),
    [lang, setLang],
  );
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useT(): Ctx {
  const c = useContext(LangCtx);
  if (!c) throw new Error("useT outside LangProvider");
  return c;
}

/** Module-local dictionaries with typed keys. */
export function defineDict<K extends string>(d: Record<K, Entry>) {
  return d;
}
export function useDict<K extends string>(d: Record<K, Entry>) {
  const { lang } = useT();
  return useCallback((k: K, vars?: Vars) => format(d[k]?.[lang] ?? k, vars), [d, lang]);
}

export type { TKey };
