import { Languages, Moon, Search, Sun } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { useTheme } from "@/theme/theme";
import { IconButton, Kbd, MOD_LABEL, useCommandPalette } from "@/ui";
import { Mark } from "./Logo";
import { NotificationsBell } from "./Notifications";
import { SyncIndicator } from "./SyncIndicator";
import { UserMenu } from "./UserMenu";
import { matchPath, useLocation } from "react-router-dom";
import { modules } from "@/modules/registry";
import { useBranch } from "@/auth/session";

export function TopBar({ title }: { title?: string }) {
  const { t, loc, toggleLang } = useT();
  const theme = useTheme();
  const palette = useCommandPalette();
  const branch = useBranch();
  return (
    <header className="sticky top-0 z-40 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-2 px-4 md:px-6">
        {/* phone: brand + branch */}
        <div className="flex min-w-0 items-center gap-2.5 md:hidden">
          <Mark className="size-8" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[15px] font-bold">{title}</p>
            {branch ? <p className="truncate text-[11.5px] text-muted">{loc(branch.name)}</p> : null}
          </div>
        </div>
        {/* desktop: title + search */}
        <h1 className="hidden min-w-0 truncate font-display text-[19px] md:block">{title}</h1>
        <button
          type="button"
          onClick={() => palette.setOpen(true)}
          className="ms-4 hidden h-10 w-full max-w-sm items-center gap-2.5 rounded-xl border border-line bg-surface px-3 text-[14px] text-faint shadow-sf-sm transition-colors hover:border-line-strong hover:text-muted lg:flex"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 truncate text-start">{t("shell.search")}</span>
          <span className="flex gap-1" dir="ltr">
            <Kbd>{MOD_LABEL}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <div className="ms-auto flex items-center gap-1">
          <IconButton label={t("common.search")} onClick={() => palette.setOpen(true)} className="lg:hidden">
            <Search />
          </IconButton>
          <SyncIndicator compact className="me-1 md:hidden" />
          <IconButton label={t("shell.langLabel")} onClick={toggleLang} className="hidden sm:inline-flex">
            <Languages />
          </IconButton>
          <IconButton label={t("shell.theme")} onClick={theme.toggle} className="hidden sm:inline-flex">
            {theme.dark ? <Sun /> : <Moon />}
          </IconButton>
          <NotificationsBell />
          <div className="ms-1 md:hidden">
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}

/** Title of the screen at the current URL (the top bar sits outside the module's own tree). */
export function useShellTitle() {
  const { pathname } = useLocation();
  const { loc } = useT();
  for (const m of modules)
    for (const r of m.routes)
      if (matchPath({ path: r.path, end: true }, pathname)) return r.title && m.tabs ? `${loc(m.title)} · ${loc(r.title)}` : loc(m.title);
  return "";
}
