import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { LayoutGrid } from "lucide-react";
import { useT, type TKey } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Sheet, spring, useReduced } from "@/ui";
import { NavBadge } from "./NavBadge";
import { useNav } from "./nav";
import { RestaurantSwitcher } from "./Switchers";

/** Phone bottom bar: the role's 4 key screens + "More" (everything else, in a bottom sheet). */
export function BottomNav() {
  const { t, loc } = useT();
  const { mobile, grouped } = useNav();
  const reduced = useReduced();
  const [more, setMore] = useState(false);
  const nav = useNavigate();
  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden" aria-label={t("shell.menu")}>
        <ul className="mx-auto flex max-w-lg">
          {mobile.map((m) => {
            const Icon = m.icon;
            return (
              <li key={m.id} className="flex-1">
                <NavLink to={m.nav!.path} className={({ isActive }) => cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11.5px] font-semibold", isActive ? "text-primary" : "text-muted")}>
                  {({ isActive }) => (
                    <>
                      {isActive ? <motion.span layoutId="bottom-active" className="absolute top-1.5 h-8 w-14 rounded-full bg-primary-soft" transition={reduced ? { duration: 0 } : spring.layout} /> : null}
                      <span className="relative">
                        <Icon className="size-[22px]" strokeWidth={isActive ? 2.3 : 1.9} aria-hidden />
                        <NavBadge module={m} className="absolute -top-1.5 -end-3" />
                      </span>
                      <span className="relative max-w-full truncate px-1">{loc(m.title)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
          <li className="flex-1">
            <button type="button" onClick={() => setMore(true)} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11.5px] font-semibold text-muted">
              <LayoutGrid className="size-[22px]" aria-hidden />
              {t("shell.more")}
            </button>
          </li>
        </ul>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title={t("shell.more")}>
        <div className="grid gap-5 pb-2">
          <RestaurantSwitcher />
          {grouped.map((g) => (
            <div key={g.group}>
              <p className="mb-2 text-[12px] font-semibold text-faint">{t(`nav.group.${g.group}` as TKey)}</p>
              <div className="grid grid-cols-3 gap-2">
                {g.items.map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        setMore(false);
                        nav(m.nav!.path);
                      }}
                      className="relative flex aspect-[1.1] flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-surface-2 p-2 text-[13px] font-semibold active:scale-[0.97]"
                    >
                      <Icon className="size-6 text-primary" aria-hidden />
                      <span className="truncate">{loc(m.title)}</span>
                      <NavBadge module={m} className="absolute top-2 end-2" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </>
  );
}
