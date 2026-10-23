import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellRing, ChefHat, QrCode } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import { ackServiceCall } from "@/data/ops";
import { useSession } from "@/auth/session";
import { useT, type TKey } from "@/i18n/i18n";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Button, EmptyState, IconButton, Popover, useToast } from "@/ui";
import { CallIcon, needsManager, useCallAlerts, useNow, useSla } from "@/lib/service-calls";

/** Live feed of what needs a human: guest calls, food ready to serve, QR orders waiting for confirmation. */
export function useNotifications() {
  const { can } = useSession();
  const calls = useLive("serviceCalls", { where: { status: "open" }, orderBy: [{ field: "createdAt", dir: "desc" }] }, { enabled: can("service_calls.handle") });
  const ready = useLive("orderItems", { where: { status: "ready" } }, { enabled: can("floor.view") });
  const qr = useLive("orders", { where: { source: "qr", status: "open" } }, { enabled: can("floor.view") });
  const tables = useLive("tables");
  const orders = useLive("orders", { where: { status: ["open", "sent", "ready", "served"] } }, { enabled: can("floor.view") });
  return useMemo(() => {
    const label = new Map(tables.data.map((t) => [t.id, t.label]));
    const readyByOrder = new Map<string, number>();
    for (const i of ready.data) readyByOrder.set(i.orderId, (readyByOrder.get(i.orderId) ?? 0) + i.qty);
    const orderById = new Map(orders.data.map((o) => [o.id, o]));
    return {
      calls: calls.data.map((c) => ({ ...c, table: label.get(c.tableId) ?? "?" })),
      ready: [...readyByOrder.entries()].flatMap(([orderId, n]) => {
        const o = orderById.get(orderId);
        return o ? [{ order: o, n, table: o.tableIds.map((t) => label.get(t)).filter(Boolean).join("+") }] : [];
      }),
      qr: qr.data.map((o) => ({ order: o, table: o.tableIds.map((t) => label.get(t)).join("+") })),
      count: calls.data.length + readyByOrder.size + qr.data.length,
    };
  }, [calls.data, ready.data, qr.data, tables.data, orders.data]);
}

export function NotificationsBell() {
  const n = useNotifications();
  useCallAlerts(); // toasts + sounds for new/escalated guest calls and ready food (src/lib/service-calls)
  const sla = useSla();
  const now = useNow(5000);
  const db = useDb();
  const { t, lang } = useT();
  const { toast } = useToast();
  const nav = useNavigate();
  const Icon = n.count ? BellRing : Bell;
  return (
    <Popover
      align="end"
      width="w-[360px]"
      trigger={({ props }) => (
        <IconButton label={t("shell.notifications")} badge={n.count || null} {...props}>
          <motion.span key={n.count} initial={{ rotate: 0 }} animate={n.count ? { rotate: [0, -14, 12, -8, 5, 0] } : {}} transition={{ duration: 0.6 }} className="grid place-items-center">
            <Icon />
          </motion.span>
        </IconButton>
      )}
    >
      {(close) => (
        <div className="max-h-[70dvh] overflow-y-auto thin-scrollbar">
          <p className="px-3 pt-2 pb-1 text-[13px] font-bold">{t("shell.notifications")}</p>
          {!n.count ? <EmptyState compact icon={<Bell />} title={t("shell.noNotifications")} /> : null}
          <AnimatePresence initial={false}>
            {n.calls.map((c) => (
              <motion.div key={c.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                  <span className={cn("relative grid size-10 shrink-0 place-items-center rounded-xl font-mono text-[15px] font-semibold", needsManager(c, now, sla) ? "bg-danger text-white" : "bg-brass-soft text-brass-text")}>
                    {c.table}
                    <span className="absolute -bottom-1 -end-1 grid size-5 place-items-center rounded-full bg-surface text-ink-2 shadow-sf-sm [&_svg]:size-3">
                      <CallIcon type={c.type} />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">
                      {t(`call.${c.type}` as TKey)}
                      {c.text ? <span className="font-normal text-muted"> — {c.text}</span> : null}
                    </p>
                    <p className="text-[12px] text-muted">
                      {t("common.table", { n: c.table })} · {ago(c.createdAt, lang)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="soft"
                    onClick={async () => {
                      await ackServiceCall(db, c);
                      toast({ title: t("toast.callAck", { table: t("common.table", { n: c.table }) }), tone: "success" });
                    }}
                  >
                    {t("overview.ack")}
                  </Button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {n.ready.map((r) => (
            <button key={r.order.id} type="button" onClick={() => (close(), nav("/floor"))} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start hover:bg-surface-2">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ok-soft text-ok">
                <ChefHat className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">
                  {t("item.ready")} · {t("common.items", { n: r.n })}
                </p>
                <p className="text-[12px] text-muted">{r.table ? t("common.table", { n: r.table }) : t("common.order", { n: r.order.number })}</p>
              </div>
            </button>
          ))}
          {n.qr.map((q) => (
            <button key={q.order.id} type="button" onClick={() => (close(), nav("/orders"))} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start hover:bg-surface-2")}>
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-info-soft text-info">
                <QrCode className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">QR · {t("common.order", { n: q.order.number })}</p>
                <p className="text-[12px] text-muted">
                  {t("common.table", { n: q.table })} · {ago(q.order.openedAt, lang)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
