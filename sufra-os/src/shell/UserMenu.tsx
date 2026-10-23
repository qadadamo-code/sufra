import { useState } from "react";
import { Keyboard, Languages, Lock, LogOut, Monitor, Moon, RotateCcw, Sun, Users } from "lucide-react";
import { useSession } from "@/auth/session";
import { ROLE_LABEL } from "@/auth/roles";
import { useRepo } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { useTheme } from "@/theme/theme";
import { cn } from "@/lib/cn";
import { Avatar, Badge, MenuItem, MenuSeparator, Popover, Segmented, useToast } from "@/ui";
import { ShortcutsDialog } from "./ShortcutsDialog";

export function UserMenu({ side = "bottom", align = "end", full }: { side?: "top" | "bottom"; align?: "start" | "end"; full?: boolean }) {
  const s = useSession();
  const repo = useRepo();
  const { t, lang, loc, toggleLang } = useT();
  const theme = useTheme();
  const { toast } = useToast();
  const [shortcuts, setShortcuts] = useState(false);
  if (!s.staff) return null;
  const staff = s.staff;
  return (
    <>
      <Popover
        side={side}
        align={align}
        width="w-80"
        trigger={({ props }) => (
          <button
            type="button"
            {...props}
            aria-label={staff.name}
            className={cn("flex items-center gap-2.5 rounded-full text-start transition-colors hover:bg-surface-3", full ? "w-full rounded-2xl p-1.5" : "p-0.5")}
          >
            <Avatar name={staff.name} color={staff.color} size={full ? "md" : "sm"} status="online" />
            {full ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold leading-tight">{staff.name}</span>
                <span className="block truncate text-[12px] text-muted">{loc(ROLE_LABEL[staff.role])}</span>
              </span>
            ) : null}
          </button>
        )}
      >
        {(close) => (
          <div>
            <div className="flex items-center gap-3 px-3 pt-2 pb-3">
              <Avatar name={staff.name} color={staff.color} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[15.5px] font-bold">{staff.name}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone="primary" size="sm">
                    {loc(ROLE_LABEL[staff.role])}
                  </Badge>
                  <Badge size="sm">{s.method === "pin" ? t("shell.viaPin") : t("shell.viaEmail")}</Badge>
                </div>
                {s.user?.email && s.method === "password" ? <p className="mt-1 truncate text-[12px] text-muted ltr">{s.user.email}</p> : null}
              </div>
            </div>
            <div className="px-2 pb-2">
              <Segmented
                block
                size="sm"
                label={t("shell.theme")}
                value={theme.pref}
                onChange={theme.set}
                options={[
                  { value: "light", label: t("shell.themeLight"), icon: <Sun /> },
                  { value: "dark", label: t("shell.themeDark"), icon: <Moon /> },
                  { value: "system", label: t("shell.themeSystem"), icon: <Monitor /> },
                ]}
              />
            </div>
            <MenuItem icon={<Languages />} onClick={toggleLang} end={<span className="text-[12px] text-muted">{lang === "ar" ? "EN" : "ع"}</span>}>
              {t("shell.langSwitch")}
            </MenuItem>
            <MenuItem icon={<Keyboard />} onClick={() => (close(), setShortcuts(true))} end={<span className="font-mono text-[12px] text-muted">?</span>}>
              {t("shell.shortcuts")}
            </MenuItem>
            <MenuSeparator />
            {s.deviceRestaurantId ? (
              <MenuItem icon={s.method === "pin" ? <Lock /> : <Users />} onClick={() => (close(), s.lock())}>
                {s.method === "pin" ? t("shell.lock") : t("shell.switchUser")}
              </MenuItem>
            ) : null}
            {repo.reset ? (
              <MenuItem
                icon={<RotateCcw />}
                onClick={async () => {
                  close();
                  await repo.reset!();
                  toast({ title: t("toast.demoReset"), tone: "success" });
                }}
              >
                {t("shell.resetDemo")}
              </MenuItem>
            ) : null}
            {s.user ? (
              <MenuItem icon={<LogOut />} danger onClick={() => (close(), void s.signOut())}>
                {t("shell.signOut")}
              </MenuItem>
            ) : null}
          </div>
        )}
      </Popover>
      <ShortcutsDialog open={shortcuts} onClose={() => setShortcuts(false)} />
    </>
  );
}
