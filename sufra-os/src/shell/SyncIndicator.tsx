import { CloudOff, HardDrive, RefreshCw, Wifi } from "lucide-react";
import { useSync } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { clock } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Popover, StatusDot } from "@/ui";

/** Online/offline + sync status pill with an explanatory popover. */
export function SyncIndicator({ compact, className, side = "bottom", align = "end" }: { compact?: boolean; className?: string; side?: "top" | "bottom"; align?: "start" | "end" }) {
  const s = useSync();
  const { t, lang } = useT();
  const tone = s.error ? "warn" : !s.online ? "danger" : s.pending ? "warn" : "ok";
  const label = s.error
    ? t("sync.error")
    : !s.online
      ? t("sync.offline")
      : s.pending
        ? t("sync.pending", { n: s.pending })
        : s.mode === "local"
          ? s.peers
            ? t("sync.localPeers", { n: s.peers })
            : t("sync.local")
          : t("sync.online");
  const Icon = !s.online ? CloudOff : s.pending ? RefreshCw : s.mode === "local" ? HardDrive : Wifi;
  return (
    <Popover
      side={side}
      align={align}
      width="w-80"
      trigger={({ props }) => (
        <button
          type="button"
          {...props}
          aria-label={label}
          title={label}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-full text-[12.5px] font-semibold text-ink-2 transition-colors",
            compact ? "size-11 hover:bg-surface-3" : "h-9 border border-line bg-surface px-2.5 hover:bg-surface-2",
            className,
          )}
        >
          <StatusDot tone={tone} pulse={tone === "ok"} />
          {!compact ? <span className="max-w-40 truncate">{label}</span> : null}
        </button>
      )}
    >
      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-ink-2">
            <Icon className={cn("size-[18px]", s.pending && "animate-spin")} aria-hidden />
          </span>
          <div>
            <p className="font-semibold">{label}</p>
            {s.lastSyncAt ? <p className="text-[12px] text-muted">{t("sync.lastSync", { time: clock(s.lastSyncAt, lang) })}</p> : null}
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-muted">{s.mode === "local" ? t("sync.localHint") : t("sync.cloudHint")}</p>
        {s.error ? <p className="mt-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-[12px] text-warn">{s.error}</p> : null}
      </div>
    </Popover>
  );
}
