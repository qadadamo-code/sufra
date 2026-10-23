import { useT } from "@/i18n/i18n";
import { Combo, Dialog } from "@/ui";
import { modules } from "@/modules/registry";
import { useSession } from "@/auth/session";
import { can } from "@/auth/permissions";

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, loc, L } = useT();
  const { role } = useSession();
  const rows = [
    { combo: "mod+k", label: L("لوحة الأوامر", "Command palette") },
    { combo: "/", label: L("دوّر", "Search") },
    { combo: "?", label: t("shell.shortcuts") },
    { combo: "[", label: L("صغّر/كبّر القائمة", "Toggle sidebar") },
    ...modules.filter((m) => m.shortcut && (!m.permission || can(role, m.permission))).map((m) => ({ combo: m.shortcut!, label: loc(m.title) })),
  ];
  return (
    <Dialog open={open} onClose={onClose} title={t("shell.shortcuts")} size="sm">
      <ul className="grid gap-1 pt-1">
        {rows.map((r) => (
          <li key={r.combo} className="flex min-h-10 items-center justify-between gap-4 border-b border-line/70 py-1.5 last:border-0">
            <span className="text-[14px]">{r.label}</span>
            <Combo combo={r.combo} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
