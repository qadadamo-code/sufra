import { useMemo } from "react";
import { useSession } from "@/auth/session";
import { homeFor, visibleModules } from "@/modules/registry";
import type { ModuleDef } from "@/modules/types";

export const GROUPS = ["service", "manage", "admin"] as const;

/** Nav items for the current role; the role's home first in the mobile bar. */
export function useNav() {
  const { role } = useSession();
  return useMemo(() => {
    const items = visibleModules(role);
    const home = homeFor(role);
    const grouped = GROUPS.map((g) => ({ group: g, items: items.filter((m) => m.nav!.group === g).sort((a, b) => a.nav!.order - b.nav!.order) })).filter((g) => g.items.length);
    const mobilePool = items.filter((m) => m.nav!.mobile || m.nav!.path === home);
    const mobile: ModuleDef[] = [...mobilePool.filter((m) => m.nav!.path === home), ...mobilePool.filter((m) => m.nav!.path !== home)].slice(0, 4);
    return { items, grouped, mobile, home };
  }, [role]);
}
