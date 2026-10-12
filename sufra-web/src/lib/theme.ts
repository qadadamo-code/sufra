import { useCallback, useEffect, useState } from "react";
import { loadRaw, saveRaw } from "./storage";

export type ThemePref = "system" | "light" | "dark";
const mq = () => window.matchMedia?.("(prefers-color-scheme: dark)");

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && !!mq()?.matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1412" : "#0d5a53");
  window.dispatchEvent(new CustomEvent("sufra-theme"));
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    const v = loadRaw("sufra.theme");
    return v === "light" || v === "dark" ? v : "system";
  });
  useEffect(() => {
    apply(pref);
    if (pref !== "system") return;
    const m = mq();
    const on = () => apply("system");
    m?.addEventListener("change", on);
    return () => m?.removeEventListener("change", on);
  }, [pref]);
  const set = useCallback((p: ThemePref) => {
    saveRaw("sufra.theme", p);
    setPref(p);
  }, []);
  return { pref, set };
}

/** Resolved dark/light, re-rendering when it changes. */
export function useIsDark() {
  const read = () => document.documentElement.getAttribute("data-theme") === "dark";
  const [dark, setDark] = useState(read);
  useEffect(() => {
    const on = () => setDark(read());
    window.addEventListener("sufra-theme", on);
    return () => window.removeEventListener("sufra-theme", on);
  }, []);
  return dark;
}
