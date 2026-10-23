/** Sub-page tabs for Settings (General · Invoice · Tax · Users). */
import { NavLink } from "react-router-dom";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { moduleById } from "../registry";

export function SettingsNav() {
  const { loc } = useT();
  const { can } = useSession();
  const m = moduleById("settings");
  if (!m?.tabs) return null;
  const perm = (path: string) => m.routes.find((r) => r.path === path)?.permission ?? m.permission;
  return (
    <nav className="-mb-2 flex gap-1 overflow-x-auto border-b border-line no-scrollbar" aria-label={loc(m.title)}>
      {m.tabs
        .filter((t) => { const p = perm(t.path); return !p || can(p); })
        .map((t) => (
          <NavLink key={t.path} to={t.path} end className={({ isActive }) => cn("relative -mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-[14.5px] font-semibold transition-colors", isActive ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink")}>
            {loc(t.title)}
          </NavLink>
        ))}
    </nav>
  );
}
