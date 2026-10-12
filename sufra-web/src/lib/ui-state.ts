import { useSyncExternalStore } from "react";

type UI = { cartOpen: boolean };
let ui: UI = { cartOpen: false };
const ls = new Set<() => void>();
export function setUI(p: Partial<UI>) {
  ui = { ...ui, ...p };
  ls.forEach((l) => l());
}
export function useUI<T>(sel: (u: UI) => T): T {
  return useSyncExternalStore(
    (l) => {
      ls.add(l);
      return () => ls.delete(l);
    },
    () => sel(ui),
  );
}
