import { NavLink } from "react-router-dom";
import { motion } from "motion/react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useT, type TKey } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { IconButton, spring, useReduced } from "@/ui";
import { Logo } from "./Logo";
import { NavBadge } from "./NavBadge";
import { useNav } from "./nav";
import { RestaurantSwitcher } from "./Switchers";
import { SyncIndicator } from "./SyncIndicator";
import { UserMenu } from "./UserMenu";

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t, loc, dir } = useT();
  const { grouped } = useNav();
  const reduced = useReduced();
  const ToggleIcon = collapsed ? (dir === "rtl" ? PanelLeftClose : PanelLeftOpen) : dir === "rtl" ? PanelLeftOpen : PanelLeftClose;
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 84 : 272 }}
      transition={reduced ? { duration: 0 } : spring.soft}
      className="sticky top-0 hidden h-dvh shrink-0 flex-col border-e border-line bg-sidebar md:flex"
      aria-label={t("shell.menu")}
    >
      <div className={cn("flex h-16 shrink-0 items-center gap-2 px-4", collapsed && "justify-center px-0")}>
        {!collapsed ? <Logo className="flex-1" /> : null}
        <IconButton label={collapsed ? t("shell.expand") : t("shell.collapse")} size="sm" onClick={onToggle}>
          <ToggleIcon />
        </IconButton>
      </div>
      <div className={cn("px-3 pb-3", collapsed && "px-2")}>
        <RestaurantSwitcher collapsed={collapsed} />
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 thin-scrollbar" aria-label={t("shell.menu")}>
        {grouped.map((g) => (
          <div key={g.group} className="mt-3 first:mt-1">
            {!collapsed ? <p className="px-3 pb-1.5 text-[11.5px] font-semibold tracking-wide text-faint">{t(`nav.group.${g.group}` as TKey)}</p> : <div className="mx-auto mb-2 h-px w-8 bg-line" />}
            <ul className="grid gap-0.5">
              {g.items.map((m) => {
                const Icon = m.icon;
                return (
                  <li key={m.id}>
                    <NavLink
                      to={m.nav!.path}
                      title={collapsed ? loc(m.title) : undefined}
                      className={({ isActive }) =>
                        cn(
                          "group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[14.5px] font-semibold transition-colors",
                          collapsed && "justify-center px-0",
                          isActive ? "text-primary" : "text-ink-2 hover:bg-surface-3 hover:text-ink",
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive ? (
                            <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-primary-soft ring-1 ring-primary/15" transition={reduced ? { duration: 0 } : spring.layout}>
                              <span className="absolute inset-y-2.5 -start-3 w-1 rounded-e-full bg-primary" />
                            </motion.span>
                          ) : null}
                          <Icon className="relative size-5 shrink-0" strokeWidth={isActive ? 2.25 : 1.9} aria-hidden />
                          {!collapsed ? <span className="relative min-w-0 flex-1 truncate">{loc(m.title)}</span> : null}
                          <NavBadge module={m} className={cn("relative", collapsed && "absolute -top-0.5 end-2")} />
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className={cn("grid shrink-0 gap-2 border-t border-line p-3", collapsed && "justify-items-center px-2")}>
        <SyncIndicator compact={collapsed} side="top" align="start" className={cn(!collapsed && "w-full justify-start")} />
        <UserMenu side="top" align="start" full={!collapsed} />
      </div>
    </motion.aside>
  );
}
