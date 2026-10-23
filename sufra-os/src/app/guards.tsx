import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import { useSession } from "@/auth/session";
import { ROLE_LABEL } from "@/auth/roles";
import type { Permission } from "@/auth/permissions";
import { useT } from "@/i18n/i18n";
import { EmptyState, LinkButton } from "@/ui";
import { homeFor } from "@/modules/registry";
import { Mark } from "@/shell/Logo";

export function BootScreen() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg">
      <div className="flex flex-col items-center gap-4">
        <Mark className="size-14 animate-pulse" />
      </div>
    </div>
  );
}

/** Needs an acting staff member; otherwise PIN screen (paired device) or email login. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const s = useSession();
  const loc = useLocation();
  if (s.status === "booting") return <BootScreen />;
  if (!s.staff) return <Navigate to={s.status === "locked" ? "/login/pin" : "/login"} replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

export function RequirePermission({ permission, children }: { permission?: Permission; children: ReactNode }) {
  const s = useSession();
  const { t, loc } = useT();
  if (!permission || s.can(permission)) return <>{children}</>;
  return (
    <EmptyState
      icon={<ShieldOff />}
      title={t("forbidden.title")}
      body={t("forbidden.body", { role: s.role ? loc(ROLE_LABEL[s.role]) : "—" })}
      action={<LinkButton to={homeFor(s.role)} variant="secondary">{t("soon.home")}</LinkButton>}
    />
  );
}

export function RoleHome() {
  const { role } = useSession();
  return <Navigate to={homeFor(role)} replace />;
}
