import { Check, ChevronsUpDown, MapPin, Store } from "lucide-react";
import { useBranch, useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Avatar, MenuItem, MenuLabel, Popover } from "@/ui";

export function RestaurantSwitcher({ collapsed }: { collapsed?: boolean }) {
  const s = useSession();
  const { t, loc } = useT();
  const branch = useBranch();
  if (!s.restaurant) return null;
  const many = s.memberships.length > 1;
  return (
    <Popover
      width="w-72"
      trigger={({ props }) => (
        <button
          type="button"
          {...props}
          title={loc(s.restaurant!.name)}
          className={cn("group flex w-full items-center gap-3 rounded-2xl border border-line bg-surface p-2 text-start shadow-sf-sm transition-colors hover:border-line-strong", collapsed && "justify-center border-transparent bg-transparent p-1 shadow-none")}
        >
          <Avatar name={loc(s.restaurant!.name).replace(/^مطعم\s+/, "")} color={s.restaurant!.brandColor} size={collapsed ? "md" : "md"} className="rounded-xl" />
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold leading-tight">{loc(s.restaurant!.name)}</span>
                <span className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-muted">
                  <MapPin className="size-3 shrink-0" aria-hidden />
                  {branch ? loc(branch.name) : "—"}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-faint group-hover:text-muted" aria-hidden />
            </>
          ) : null}
        </button>
      )}
    >
      {(close) => (
        <div>
          {many ? (
            <>
              <MenuLabel>{t("shell.switchRestaurant")}</MenuLabel>
              {s.memberships.map(({ restaurant }) => (
                <MenuItem
                  key={restaurant.id}
                  icon={<Store />}
                  active={restaurant.id === s.restaurant?.id}
                  end={restaurant.id === s.restaurant?.id ? <Check className="size-4" /> : null}
                  onClick={() => (close(), void s.switchRestaurant(restaurant.id))}
                >
                  {loc(restaurant.name)}
                </MenuItem>
              ))}
            </>
          ) : null}
          <MenuLabel>{t("shell.switchBranch")}</MenuLabel>
          {s.branches.map((b) => (
            <MenuItem key={b.id} icon={<MapPin />} active={b.id === s.branchId} end={b.id === s.branchId ? <Check className="size-4" /> : null} onClick={() => (close(), s.switchBranch(b.id))}>
              <span className="block truncate">{loc(b.name)}</span>
              <span className="block truncate text-[12px] font-normal text-muted">{loc(b.address)}</span>
            </MenuItem>
          ))}
        </div>
      )}
    </Popover>
  );
}
