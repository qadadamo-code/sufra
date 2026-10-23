import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BellOff, Check, ShieldAlert, Timer, TriangleAlert } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { ServiceCall } from "@/data/types";
import { useDict, useT, type TKey } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Avatar, Badge, Button, EmptyState, Segmented, useReduced, useToast } from "@/ui";
import { CallIcon, LEVEL_TONE, ThresholdsEditor, useCanEditSettings, ackCall, callLevel, callStats, doneCall, fmtWait, isForWaiter, sortInbox, waitingSec, type Sla } from "@/lib/service-calls";
import { wdict } from "./dict";
import type { WaiterData } from "./useWaiter";

const LEVEL_RING: Record<string, string> = {
  fresh: "border-line",
  warn: "border-warn",
  escalated: "border-danger",
  critical: "border-danger bg-danger-soft",
  ack: "border-primary/40",
  closed: "border-line",
};
const LEVEL_CHIP: Record<string, string> = {
  fresh: "bg-info-soft text-info",
  warn: "bg-warn-soft text-warn",
  escalated: "bg-danger text-white",
  critical: "bg-danger text-white",
  ack: "bg-primary-soft text-primary",
  closed: "bg-surface-3 text-muted",
};

export function CallCard({ call, data, now, sla, compact }: { call: ServiceCall; data: WaiterData; now: number; sla: Sla; compact?: boolean }) {
  const { t, loc } = useT();
  const w = useDict(wdict);
  const db = useDb();
  const { toast } = useToast();
  const menuItem = useLive("menuItems", { where: { id: call.itemId ?? "" } }, { enabled: !!call.itemId }).data[0];
  const level = callLevel(call, now, sla);
  const table = data.label.get(call.tableId) ?? "?";
  const waited = waitingSec(call, now);
  const ackName = call.ackBy ? data.staffName.get(call.ackBy)?.split(" ")[0] : null;
  return (
    <div className={cn("flex items-start gap-3 rounded-2xl border-2 bg-surface p-3 shadow-sf-sm", LEVEL_RING[level])}>
      <span className={cn("relative grid size-14 shrink-0 place-items-center rounded-2xl font-mono text-[22px] font-bold", LEVEL_CHIP[level])} aria-label={w("w.table", { n: table })}>
        {table}
        <span className="absolute -bottom-1.5 -end-1.5 grid size-7 place-items-center rounded-full border border-line bg-surface text-ink shadow-sf-sm [&_svg]:size-4">
          <CallIcon type={call.type} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-bold leading-snug">
          {t(`call.${call.type}` as TKey)}
          {menuItem ? <span className="font-semibold text-brass-text"> · {loc(menuItem.name)}</span> : null}
        </p>
        {call.text ? <p className="mt-0.5 text-[14.5px] text-ink-2">“{call.text}”</p> : null}
        {call.type === "complaint" && call.status === "open" ? (
          <p className="mt-1 flex items-center gap-1 text-[12.5px] font-semibold text-danger">
            <TriangleAlert className="size-3.5" aria-hidden /> {w("w.complaintHint")}
          </p>
        ) : null}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono font-semibold", LEVEL_CHIP[level])} dir="ltr">
            <Timer className="size-3.5" aria-hidden />
            {fmtWait(waited)}
          </span>
          {call.status === "open" && (level === "escalated" || level === "critical") ? (
            <Badge tone="danger" size="sm" icon={<ShieldAlert />}>
              {w("w.escalated")}
            </Badge>
          ) : null}
          {call.status === "ack" && ackName ? <span>{w("w.ackBy", { name: ackName })}</span> : null}
          {call.status === "done" ? <span>{w("w.respTime", { t: fmtWait(waited) })}</span> : null}
        </p>
      </div>
      {!compact && (call.status === "open" || call.status === "ack") ? (
        <div className="flex shrink-0 flex-col gap-1.5">
          {call.status === "open" ? (
            <Button
              size="md"
              onClick={async () => {
                await ackCall(db, call);
                toast({ title: t("toast.callAck", { table: w("w.table", { n: table }) }), tone: "success", duration: 2000 });
              }}
            >
              {w("w.ack")}
            </Button>
          ) : null}
          <Button size="md" variant={call.status === "open" ? "secondary" : "soft"} icon={<Check className="size-4.5" />} onClick={() => void doneCall(db, call)}>
            {w("w.done")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CallsTab({ data, now, sla, soundButton }: { data: WaiterData; now: number; sla: Sla; soundButton?: React.ReactNode }) {
  const w = useDict(wdict);
  const reduced = useReduced();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const guestCalls = data.calls.filter((c) => c.type !== "pickup");
  const active = guestCalls.filter((c) => c.status === "open" || c.status === "ack");
  const shown = sortInbox(scope === "all" || !data.me ? active : active.filter((c) => isForWaiter(c, data.me!, data.owners, now, sla)), now, sla);
  const closed = guestCalls.filter((c) => c.status === "done").slice(0, 12);
  const stats = useMemo(() => callStats(guestCalls, { now, sla }), [guestCalls, now, sla]);
  const mine = stats.byWaiter.find((x) => x.waiterId === data.me);
  const levels = shown.map((c) => callLevel(c, now, sla));
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label={w("w.answered")} value={mine?.answered ?? 0} />
        <Kpi label={w("w.avgResponse")} value={mine?.avgSec == null ? "—" : fmtWait(mine.avgSec)} tone={mine?.avgSec != null && mine.avgSec > sla.escalateSec ? "danger" : mine?.avgSec != null && mine.avgSec > sla.warnSec ? "warn" : "ok"} />
        <Kpi label={w("w.lateCalls")} value={mine?.late ?? 0} tone={mine?.late ? "danger" : undefined} />
      </div>
      <div className="flex items-center gap-2">
        <Segmented
          label={w("w.calls")}
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: "mine", label: w("w.mine"), badge: active.filter((c) => data.me && isForWaiter(c, data.me, data.owners, now, sla)).length || undefined },
            { value: "all", label: w("w.all"), badge: active.length || undefined },
          ]}
        />
        {levels.some((l) => l === "escalated" || l === "critical") ? (
          <Badge tone="danger" dot pulse className="max-[400px]:hidden">
            {w("w.escalated")}
          </Badge>
        ) : null}
        <span className="ms-auto">{soundButton}</span>
      </div>
      {!shown.length ? <EmptyState compact icon={<BellOff />} title={w("w.callsEmpty")} className="rounded-2xl border border-dashed border-line" /> : null}
      <ul className="grid gap-2.5 lg:grid-cols-2">
        <AnimatePresence initial={false}>
          {shown.map((c) => (
            <motion.li key={c.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }}>
              <CallCard call={c} data={data} now={now} sla={sla} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {closed.length ? (
        <section>
          <h3 className="mb-2 text-[14px] font-bold text-muted">{w("w.answeredToday")}</h3>
          <ul className="grid gap-2 opacity-80 lg:grid-cols-2">
            {closed.map((c) => (
              <li key={c.id}>
                <CallCard call={c} data={data} now={now} sla={sla} compact />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function Kpi({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "danger" }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface px-3 py-2.5 shadow-sf-sm", tone === "danger" && "border-danger/40 bg-danger-soft")}>
      <p className="truncate text-[12px] font-semibold text-muted">{label}</p>
      <p className={cn("font-mono text-[22px] font-bold leading-tight", tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "")}>{value}</p>
    </div>
  );
}

export function StatsTab({ data, now, sla }: { data: WaiterData; now: number; sla: Sla }) {
  const w = useDict(wdict);
  const { t } = useT();
  const stats = useMemo(() => callStats(data.calls, { now, sla }), [data.calls, now, sla]);
  const staff = new Map(data.staff.map((m) => [m.id, m]));
  const maxAvg = Math.max(1, ...stats.byWaiter.map((x) => x.avgSec ?? 0));
  const canEdit = useCanEditSettings();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-[20px] border border-line bg-surface p-4 shadow-sf-sm">
        <h3 className="mb-3 text-[16px]">{w("w.team")}</h3>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Kpi label={w("w.calls")} value={stats.count} />
          <Kpi label={w("w.avgResponse")} value={stats.avgSec == null ? "—" : fmtWait(stats.avgSec)} />
          <Kpi label={w("w.lateCalls")} value={stats.late} tone={stats.late ? "danger" : undefined} />
        </div>
        <ul className="grid gap-2">
          {stats.byWaiter.map((x) => {
            const m = staff.get(x.waiterId);
            const tone = LEVEL_TONE[x.avgSec == null ? "fresh" : x.avgSec >= sla.escalateSec ? "escalated" : x.avgSec >= sla.warnSec ? "warn" : "ack"];
            return (
              <li key={x.waiterId} className={cn("flex items-center gap-3 rounded-xl px-2 py-1.5", x.waiterId === data.me && "bg-primary-soft/60")}>
                <Avatar name={m?.name ?? "?"} color={m?.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{m?.name ?? "—"}</p>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3">
                    <div className={cn("h-full rounded-full", tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-ok")} style={{ width: `${Math.max(6, ((x.avgSec ?? 0) / maxAvg) * 100)}%` }} />
                  </div>
                </div>
                <div className="text-end">
                  <p className="font-mono text-[15px] font-bold" dir="ltr">
                    {x.avgSec == null ? "—" : fmtWait(x.avgSec)}
                  </p>
                  <p className="text-[11.5px] text-muted">{w("w.callsToday", { n: x.answered })}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="rounded-[20px] border border-line bg-surface p-4 shadow-sf-sm">
        <h3 className="mb-3 text-[16px]">{w("w.tables")}</h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.byTable.slice(0, 9).map((x) => (
            <li key={x.tableId} className="rounded-xl border border-line px-3 py-2">
              <p className="text-[13px] font-bold">{w("w.table", { n: data.label.get(x.tableId) ?? "?" })}</p>
              <p className="text-[12px] text-muted">
                {w("w.callsToday", { n: x.count })} · <span dir="ltr">{x.avgSec == null ? "—" : fmtWait(x.avgSec)}</span>
              </p>
            </li>
          ))}
        </ul>
        <h3 className="mt-4 mb-2 text-[16px]">{w("w.calls")}</h3>
        <ul className="flex flex-wrap gap-1.5">
          {stats.byType.map((x) => (
            <li key={x.type}>
              <Badge tone="neutral" icon={<CallIcon type={x.type} />}>
                {t(`call.${x.type}` as TKey)} · {x.count}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
      {canEdit ? (
        <ThresholdsEditor
          settingsKey="serviceCalls"
          value={sla}
          title={w("w.slaTitle")}
          fields={[
            { key: "warnSec", label: w("w.slaWarn"), unit: w("w.sec") },
            { key: "escalateSec", label: w("w.slaEsc"), unit: w("w.sec") },
            { key: "criticalSec", label: w("w.slaCrit"), unit: w("w.sec") },
          ]}
        />
      ) : null}
    </div>
  );
}
