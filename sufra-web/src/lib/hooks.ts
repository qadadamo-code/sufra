import { useEffect, useMemo, useState } from "react";
import { haversineKm, travel } from "./geo";
import type { Restaurant } from "./data";
import { useHome } from "./store";

/** Current time, refreshed every minute (open/closed badges stay honest). */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useDistances(list: Restaurant[]) {
  const { home } = useHome();
  return useMemo(() => {
    const m = new Map<string, { km: number; car: number; walk: number | null }>();
    for (const r of list) {
      const km = haversineKm(home, r);
      m.set(r.id, { km, ...travel(km) });
    }
    return m;
  }, [list, home]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}
