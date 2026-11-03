import { useUnread } from "./useClips";

export function useRadioBadge(): number | null {
  const u = useUnread();
  const n = Object.values(u).reduce((a, b) => a + b, 0);
  return n || null;
}
