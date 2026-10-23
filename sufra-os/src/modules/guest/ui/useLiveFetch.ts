import { useCallback, useEffect, useRef, useState } from "react";
import type { GuestService } from "../api/service";

/** Fetch + keep fresh: the change feed (local) and polling (cloud anon has no Realtime rows). */
export function useLiveFetch<T>(svc: GuestService, restaurantId: string | null, fetcher: () => Promise<T>, deps: unknown[], pollMs = 6000) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const f = useRef(fetcher);
  f.current = fetcher;

  const refresh = useCallback(() => {
    const my = ++seq.current;
    f.current().then(
      (v) => {
        if (my === seq.current) {
          setData(v);
          setLoading(false);
        }
      },
      () => my === seq.current && setLoading(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    refresh();
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = restaurantId
      ? svc.watch(restaurantId, () => {
          if (t) clearTimeout(t);
          t = setTimeout(refresh, 150);
        })
      : () => {};
    const poll = setInterval(() => document.visibilityState !== "hidden" && refresh(), svc.local ? Math.max(pollMs, 15_000) : pollMs);
    return () => {
      off();
      clearInterval(poll);
      if (t) clearTimeout(t);
    };
  }, [svc, restaurantId, refresh, pollMs]);

  return { data, loading, refresh };
}
