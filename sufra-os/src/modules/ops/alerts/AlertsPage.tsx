/** /alerts — alerts center (live) + rules (who gets notified of what). */
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BellOff, Check, ChevronLeft, ChevronRight, Siren } from "lucide-react";
import { useDb } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { ROLE_LABEL, type Role } from "@/auth/roles";
import { useT } from "@/i18n/i18n";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, EmptyState, Input, Switch, Tabs, useToast } from "@/ui";
import type { AlertRule } from "../types";
import { ALERT_KINDS, ALERT_LABEL, type Alert } from "./alerts";
import { useAlerts } from "./useAlerts";
import { useOpsSettings, useSaveOps } from "../settings";

const NOTIFY_ROLES: Role[] = ["owner", "admin", "manager", "cashier", "waiter", "chef", "kitchen", "delivery", "accountant"];

export default function AlertsPage() {
  const { L } = useT();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as "live" | "done" | "rules" | null) ?? "live";
  const { alerts, acked } = useAlerts();
  const open = alerts.filter((a) => !acked.has(a.id));
  return (
    <div className="grid gap-4">
      <PageHeader icon={<Siren />} title={L("مركز التنبيهات", "Alerts center")} subtitle={L("كل اللي محتاج مدير — من الصالة والدليفري والدرج والكاميرات والدفع والشكاوى", "Everything that needs a manager — floor, delivery, drawer, cameras, payments, complaints")} />
      <Tabs
        label={L("العرض", "View")}
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        items={[
          { value: "live", label: L("محتاجة تتشاف", "Needs attention"), count: open.length },
          { value: "done", label: L("اتشافت", "Acknowledged") },
          { value: "rules", label: L("القواعد", "Rules") },
        ]}
      />
      {tab === "rules" ? <Rules /> : <AlertList list={tab === "live" ? open : alerts.filter((a) => acked.has(a.id))} done={tab === "done"} />}
    </div>
  );
}

function AlertList({ list, done }: { list: Alert[]; done: boolean }) {
  const { L, loc, lang, dir } = useT();
  const db = useDb();
  const nav = useNavigate();
  const { toast } = useToast();
  const Go = dir === "rtl" ? ChevronLeft : ChevronRight;
  const ack = async (a: Alert) => {
    const cur = await db.get("opsAcks", a.id);
    if (!cur) await db.insert("opsAcks", { id: a.id, kind: "alert", by: db.actorId, note: "", verdict: null });
    toast({ title: L("اتشافت", "Acknowledged"), duration: 1000 });
  };
  if (!list.length) return <EmptyState icon={<BellOff />} title={done ? L("مفيش حاجة هنا", "Nothing here") : L("كله تمام دلوقتي", "All clear right now")} body={done ? undefined : L("التنبيهات الجديدة بتظهر هنا لوحدها.", "New alerts appear here automatically.")} />;
  return (
    <div className="grid gap-2">
      {list.map((a) => (
        <Card key={a.id} data-alert={a.kind} className="flex items-center gap-3 p-3">
          <span className={cn("h-11 w-1.5 shrink-0 rounded-full", a.severity === "high" ? "bg-danger" : a.severity === "warn" ? "bg-warn" : "bg-info")} />
          <button type="button" className="min-w-0 flex-1 text-start" onClick={() => nav(a.path)}>
            <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-bold">
              {loc(a.title)}
              <Badge size="sm" tone={a.severity === "high" ? "danger" : "warn"}>{loc(ALERT_LABEL[a.kind])}</Badge>
            </p>
            <p className="truncate text-[12.5px] text-muted">{loc(a.detail)} · {ago(a.at, lang)}</p>
          </button>
          {!done ? <Button size="sm" variant="secondary" aria-label={L("اتشافت", "Acknowledge")} icon={<Check className="size-4" />} onClick={() => void ack(a)} /> : null}
          <Button size="sm" variant="ghost" aria-label={L("افتح", "Open")} icon={<Go className="size-4" />} onClick={() => nav(a.path)} />
        </Card>
      ))}
    </div>
  );
}

function Rules() {
  const { L, loc, lang } = useT();
  const { cfg } = useOpsSettings();
  const save = useSaveOps();
  const { can } = useSession();
  const { toast } = useToast();
  const [rules, setRules] = useState<AlertRule[] | null>(null);
  const list = rules ?? cfg.alertRules;
  const set = (kind: string, patch: Partial<AlertRule>) => setRules(list.map((r) => (r.kind === kind ? { ...r, ...patch } : r)));
  const unit: Record<string, string> = { late_delivery: L("دقايق تأخير", "min late"), cash_variance: L("جنيه على الأقل", "EGP at least"), device_offline: L("دقايق", "min") };
  return (
    <div className="grid gap-2">
      {ALERT_KINDS.map((k) => {
        const r = list.find((x) => x.kind === k)!;
        return (
          <Card key={k} className="grid gap-2 p-4" data-rule={k}>
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-[15px] font-bold">{loc(ALERT_LABEL[k])}</p>
              {unit[k] ? (
                <Input
                  aria-label={unit[k]}
                  type="number"
                  min={0}
                  wrapClassName="w-44"
                  end={<span className="text-[12px] text-muted">{unit[k]}</span>}
                  value={k === "cash_variance" ? r.threshold / 100_000 : r.threshold}
                  onChange={(e) => set(k, { threshold: Math.max(0, Number(e.target.value) || 0) * (k === "cash_variance" ? 100_000 : 1) })}
                />
              ) : null}
              <Switch checked={r.enabled} onChange={(v) => set(k, { enabled: v })} label={L("مفعّل", "On")} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="me-1 self-center text-[12.5px] text-muted">{L("يبلّغ:", "Notify:")}</span>
              {NOTIFY_ROLES.map((role) => {
                const on = r.notify.includes(role);
                return (
                  <button key={role} type="button" aria-pressed={on} disabled={!r.enabled} onClick={() => set(k, { notify: on ? r.notify.filter((x) => x !== role) : [...r.notify, role] })} className={cn("h-9 rounded-full border px-3 text-[13px] font-semibold disabled:opacity-50", on ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface")}>
                    {ROLE_LABEL[role][lang]}
                  </button>
                );
              })}
            </div>
            {k === "low_stock" ? <p className="text-[12px] text-muted">{L("بيشتغل لما وحدة المخزون تبعت الأصناف اللي تحت الحد.", "Works once the inventory module reports items below par.")}</p> : null}
            {k === "device_offline" ? <p className="text-[12px] text-muted">{L("قريباً — محتاج نبضات الأجهزة على السيرفر.", "Coming — needs device heartbeats on the server.")}</p> : null}
          </Card>
        );
      })}
      {can("settings.edit") ? (
        <Button className="justify-self-start" disabled={!rules} onClick={async () => (await save({ alertRules: list }), setRules(null), toast({ title: L("اتحفظت", "Saved"), tone: "success", duration: 1200 }))}>
          {L("احفظ القواعد", "Save rules")}
        </Button>
      ) : null}
    </div>
  );
}
