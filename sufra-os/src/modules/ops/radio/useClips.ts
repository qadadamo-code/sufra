import { useMemo } from "react";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { radio, useRadioEngine } from "./engine";
import { unreadCounts } from "./channels";

/** Clips of the last 24 h (hour-rounded so the live query key stays stable). */
export function useRecentClips(enabled = true) {
  const since = useMemo(() => {
    const d = new Date(Date.now() - 24 * 3600_000);
    d.setMinutes(0, 0, 0);
    return d.toISOString();
  }, []);
  return useLive("radioClips", { gte: { at: since }, orderBy: [{ field: "at", dir: "desc" }], limit: 400 }, { enabled });
}

export function useUnread() {
  const { staff, role, can } = useSession();
  const clips = useRecentClips(can("radio.use"));
  const snap = useRadioEngine();
  return useMemo(() => (staff ? unreadCounts(clips.data, staff.id, role, snap.lastRead) : {}), [clips.data, staff, role, snap.lastRead]);
}

export { radio };
