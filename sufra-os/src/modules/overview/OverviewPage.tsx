import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, CalendarClock, ChefHat, CircleDollarSign, Flame, LayoutGrid, ReceiptText, Users, Wallet } from "lucide-react";
import { useBranch, useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import { ackServiceCall, resolveServiceCall } from "@/data/ops";
import type { DiningTable, PaymentMethod, TableStatus } from "@/data/types";
import { useT, type TKey } from "@/i18n/i18n";
import { ago, clock, startOfDay } from "@/lib/time";
import { formatMoney, sumUnits } from "@/lib/money";
import { cn } from "@/lib/cn";
import { AnimatedMoney, AnimatedNumber, Badge, BarChart, Button, Card, CardHeader, EmptyState, Meter, Money, StatTile, useReduced, type Tone } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";

const TABLE_TONE: Record<TableStatus, string> = {
  free: "border-line bg-surface text-muted",
  seated: "border-info/40 bg-info-soft text-info",
  ordered: "border-primary/40 bg-primary-soft text-primary",
  bill: "border-brass/50 bg-brass-soft text-brass-text",
  dirty: "border-warn/40 bg-warn-soft text-warn",
  reserved: "border-line-strong border-dashed bg-surface-2 text-ink-2",
  blocked: "border-line bg-surface-3 text-faint line-through",
};
const PAY_TONE: Record<PaymentMethod, Tone> = { cash: "ok", card: "primary", wallet: "brass", instapay: "info", online: "warn" };

export default function OverviewPage() {
  const { t, lang, loc, L } = useT();
  const { staff } = useSession();
  const branch = useBranch();
  const db = useDb();
  const reduced = useReduced();
  const since = useMemo(() => startOfDay().toISOString(), []);
  const bq = branch ? { branchId: branch.id } : {};

  const payments = useLive("payments", { where: { ...bq, status: "captured" }, gte: { createdAt: since } }).data;
  const checks = useLive("checks", { where: { ...bq }, gte: { openedAt: since } }).data;
  const openChecks = useLive("checks", { where: { ...bq, status: ["open", "bill_requested"] } }).data;
  const tables = useLive("tables", { where: { ...bq, active: true }, orderBy: [{ field: "label" }] }).data;
  const zones = useLive("zones", { where: { ...bq }, orderBy: [{ field: "sort" }] }).data;
  const calls = useLive("serviceCalls", { where: { ...bq, status: ["open", "ack"] }, orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const kitchen = useLive("orderItems", { where: { status: ["sent", "preparing", "ready"] } }).data;
  const items = useLive("orderItems", { gte: { createdAt: since } }).data;
  const reservations = useLive("reservations", { where: { ...bq, status: ["pending", "confirmed", "seated"] }, gte: { startsAt: since }, orderBy: [{ field: "startsAt" }] }).data;
  const activeOrders = useLive("orders", { where: { ...bq, status: ["open", "sent", "ready", "served"] }, orderBy: [{ field: "openedAt", dir: "desc" }] }).data;

  const label = useMemo(() => new Map(tables.map((x) => [x.id, x.label])), [tables]);
  const sales = sumUnits(payments.map((p) => p.amount));
  const tips = sumUnits(payments.map((p) => p.tip));
  const paidChecks = checks.filter((c) => c.status === "paid");
  const avg = paidChecks.length ? Math.round(sumUnits(paidChecks.map((c) => c.total)) / paidChecks.length) : 0;
  const openValue = sumUnits(openChecks.map((c) => c.total));
  const busy = tables.filter((x) => ["seated", "ordered", "bill"].includes(x.status));
  const covers = openChecks.filter((c) => c.tableIds.length).reduce((a, c) => a + c.guests, 0);
  const queue = kitchen.filter((i) => i.status !== "ready").length;
  const ready = kitchen.filter((i) => i.status === "ready").length;
  const todayRes = reservations.filter((r) => new Date(r.startsAt).toDateString() === new Date().toDateString());

  // sales by hour from noon (or the first sale) to now
  const hours = useMemo(() => {
    const now = new Date();
    const first = Math.min(12, ...payments.map((p) => new Date(p.createdAt).getHours()));
    const last = Math.max(now.getHours(), first + 5);
    const out = [];
    for (let h = first; h <= last; h++) {
      const v = sumUnits(payments.filter((p) => new Date(p.createdAt).getHours() === h).map((p) => p.amount));
      const hh = String(h % 24).padStart(2, "0");
      out.push({ key: hh, label: hh, value: v, tip: `${hh}:00 · ${formatMoney(v, { lang, compact: true })}` });
    }
    return out;
  }, [payments, lang]);

  const top = useMemo(() => {
    const m = new Map<string, { name: (typeof items)[number]["name"]; qty: number }>();
    for (const i of items) if (i.status !== "void") m.set(i.itemId, { name: i.name, qty: (m.get(i.itemId)?.qty ?? 0) + i.qty });
    return [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);
  }, [items]);

  const mix = useMemo(() => {
    const m = new Map<PaymentMethod, number>();
    for (const p of payments) m.set(p.method, (m.get(p.method) ?? 0) + p.amount);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [payments]);

  const hour = new Date().getHours();
  const first = staff?.name.split(" ")[0] === "الشيف" ? staff.name : (staff?.name.split(" ")[0] ?? "");
  const greet = t(hour < 12 ? "overview.morning" : "overview.evening", { name: first });

  const fadeUp = (i: number) => (reduced ? {} : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.1 + i * 0.05, type: "spring" as const, stiffness: 260, damping: 30 } });

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6">
      <PageHeader
        title={greet}
        subtitle={t("overview.subtitle", { branch: branch ? loc(branch.name) : "" })}
        kicker={new Date().toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long" })}
        actions={
          <Badge tone="ok" dot pulse>
            {t("overview.live")}
          </Badge>
        }
      />

      <section className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label={t("overview.sales")}>
        <StatTile index={0} icon={<CircleDollarSign />} label={t("overview.sales")} value={<AnimatedMoney value={sales} whole />} sub={t("overview.paidChecks", { n: paidChecks.length })} spark={hours.map((h) => h.value)} />
        <StatTile index={1} icon={<ReceiptText />} tone="brass" label={t("overview.openChecks")} value={<AnimatedNumber value={openChecks.length} />} sub={t("overview.openValue", { v: formatMoney(openValue, { lang, whole: true }) })} />
        <StatTile index={2} icon={<Users />} tone="info" label={t("overview.covers")} value={<AnimatedNumber value={covers} />} sub={t("overview.tablesBusy", { busy: busy.length, total: tables.length })} />
        <StatTile index={3} icon={<Wallet />} tone="ok" label={t("overview.avgCheck")} value={<AnimatedMoney value={avg} whole />} sub={t("overview.tips", { v: formatMoney(tips, { lang, whole: true }) })} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
        {/* sales by hour */}
        <motion.div {...fadeUp(0)} className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader icon={<CircleDollarSign />} title={t("overview.salesByHour")} action={<Money value={sales} compact className="text-[15px] font-semibold" />} />
            <div className="px-5 pb-5">{sales ? <BarChart data={hours} highlight={String(hour).padStart(2, "0")} ariaLabel={t("overview.salesByHour")} /> : <EmptyState compact title={t("overview.noSales")} />}</div>
          </Card>
        </motion.div>

        {/* guest calls */}
        <motion.div {...fadeUp(1)}>
          <Card className="flex h-full flex-col">
            <CardHeader icon={<BellRing />} title={t("overview.calls")} action={calls.length ? <Badge tone="brass">{calls.length}</Badge> : null} />
            <ul className="grid gap-1 px-3 pb-3">
              <AnimatePresence initial={false}>
                {calls.map((c) => (
                  <motion.li key={c.id} layout={!reduced} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
                      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl font-mono text-[15px] font-semibold", c.status === "open" ? "bg-brass-soft text-brass-text" : "bg-surface-3 text-muted")}>{label.get(c.tableId)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-semibold">
                          {t(`call.${c.type}` as TKey)}
                          {c.text ? <span className="font-normal text-muted"> — {c.text}</span> : null}
                        </p>
                        <p className="text-[12px] text-muted">
                          {t(`call.${c.status}` as TKey)} · {ago(c.createdAt, lang)}
                        </p>
                      </div>
                      {c.status === "open" ? (
                        <Button size="sm" variant="soft" onClick={() => ackServiceCall(db, c)}>
                          {t("overview.ack")}
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => resolveServiceCall(db, c)}>
                          {t("overview.done")}
                        </Button>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
              {!calls.length ? <EmptyState compact icon={<BellRing />} title={t("overview.noCalls")} /> : null}
            </ul>
          </Card>
        </motion.div>

        {/* floor */}
        <motion.div {...fadeUp(2)} className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader
              icon={<LayoutGrid />}
              title={t("overview.tablesNow")}
              subtitle={t("overview.tablesBusy", { busy: busy.length, total: tables.length })}
              action={
                <Link to="/floor" className="rounded-lg px-2 py-1 text-[13px] font-semibold text-primary hover:bg-primary-soft">
                  {t("common.viewAll")}
                </Link>
              }
            />
            <div className="grid gap-4 px-5 pb-5">
              {zones.map((z) => (
                <div key={z.id}>
                  <p className="mb-2 text-[12.5px] font-semibold text-muted">{loc(z.name)}</p>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
                    {tables
                      .filter((x) => x.zoneId === z.id)
                      .sort((a, b) => Number(a.label) - Number(b.label))
                      .map((x) => (
                        <TableChip key={x.id} table={x} />
                      ))}
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[12px] text-muted">
                {(["free", "seated", "ordered", "bill", "dirty", "reserved"] as TableStatus[]).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <span className={cn("size-3 rounded-[4px] border", TABLE_TONE[s])} />
                    {t(`table.${s}` as TKey)}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        </motion.div>

        {/* kitchen */}
        <motion.div {...fadeUp(3)}>
          <Card className="h-full">
            <CardHeader icon={<ChefHat />} title={t("overview.kitchen")} subtitle={t("overview.kitchenSub", { ready })} />
            <div className="grid grid-cols-2 gap-3 px-5 pb-5">
              <div className="rounded-2xl bg-warn-soft p-4">
                <p className="text-[12.5px] font-semibold text-warn">{t("item.preparing")}</p>
                <p className="num mt-1 text-[30px] font-semibold text-warn">{queue}</p>
              </div>
              <div className="rounded-2xl bg-ok-soft p-4">
                <p className="text-[12.5px] font-semibold text-ok">{t("item.ready")}</p>
                <p className="num mt-1 text-[30px] font-semibold text-ok">{ready}</p>
              </div>
              <div className="col-span-2">
                <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
                  <Flame className="size-3.5" aria-hidden />
                  {t("overview.topItems")}
                </p>
                <ol className="grid gap-2">
                  {top.map((x, i) => (
                    <li key={i} className="grid gap-1">
                      <div className="flex items-center justify-between gap-2 text-[13.5px]">
                        <span className="truncate">{loc(x.name)}</span>
                        <span className="num text-muted">×{x.qty}</span>
                      </div>
                      <Meter value={x.qty} max={top[0]?.qty ?? 1} tone={i === 0 ? "brass" : "primary"} label={loc(x.name)} />
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* active orders */}
        <motion.div {...fadeUp(4)} className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader icon={<ReceiptText />} title={t("overview.orders")} action={<Badge>{activeOrders.length}</Badge>} />
            <ul className="divide-y divide-line px-5 pb-3">
              {activeOrders.slice(0, 7).map((o) => {
                const lines = kitchen.filter((i) => i.orderId === o.id);
                const tone: Tone = o.status === "open" ? "info" : o.status === "sent" ? "warn" : o.status === "ready" ? "ok" : "neutral";
                const check = openChecks.find((c) => c.id === o.checkId);
                return (
                  <li key={o.id} className="flex items-center gap-3 py-2.5">
                    <span className="num grid size-10 shrink-0 place-items-center rounded-xl bg-surface-3 text-[13px] font-semibold">#{o.number}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">
                        {o.tableIds.length ? t("common.table", { n: o.tableIds.map((x) => label.get(x)).join("+") }) : t(`mode.${o.mode}` as TKey)}
                        <span className="font-normal text-muted"> · {t(`mode.${o.mode}` as TKey)}</span>
                        {o.source === "qr" ? <span className="ms-1.5 rounded bg-info-soft px-1 text-[11px] font-bold text-info">QR</span> : null}
                      </p>
                      <p className="text-[12px] text-muted">
                        {clock(o.openedAt, lang)} · {ago(o.openedAt, lang)}
                        {lines.length ? ` · ${t("common.items", { n: lines.length })}` : ""}
                      </p>
                    </div>
                    {check ? <Money value={check.total} compact className="hidden text-[14px] font-semibold sm:inline-flex" /> : null}
                    <Badge tone={tone} size="sm">
                      {t(`order.${o.status}` as TKey)}
                    </Badge>
                  </li>
                );
              })}
              {!activeOrders.length ? <EmptyState compact title={t("overview.noOrders")} /> : null}
            </ul>
          </Card>
        </motion.div>

        <div className="grid gap-4 lg:gap-5">
          {/* reservations */}
          <motion.div {...fadeUp(5)}>
            <Card>
              <CardHeader icon={<CalendarClock />} title={t("overview.reservations")} action={<Badge>{todayRes.length}</Badge>} />
              <ul className="grid gap-1 px-3 pb-3">
                {todayRes.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                    <span className="num w-14 shrink-0 text-center text-[14px] font-semibold text-primary">{clock(r.startsAt, lang)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold">{r.name}</p>
                      <p className="truncate text-[12px] text-muted">
                        {t("common.guests", { n: r.party })}
                        {r.tableIds.length ? ` · ${t("common.table", { n: r.tableIds.map((x) => label.get(x)).join("+") })}` : ""}
                      </p>
                    </div>
                    {r.tags.includes("vip") ? <Badge tone="brass" size="sm">VIP</Badge> : r.tags.includes("birthday") ? <Badge tone="danger" size="sm">{L("عيد ميلاد", "Birthday")}</Badge> : null}
                    {r.status === "pending" ? <Badge tone="warn" size="sm">{t("res.pending")}</Badge> : null}
                  </li>
                ))}
                {!todayRes.length ? <EmptyState compact title={t("overview.noReservations")} /> : null}
              </ul>
            </Card>
          </motion.div>

          {/* payment mix */}
          <motion.div {...fadeUp(6)}>
            <Card>
              <CardHeader icon={<Wallet />} title={t("overview.payMix")} />
              <ul className="grid gap-3 px-5 pb-5">
                {mix.map(([m, v]) => (
                  <li key={m} className="grid gap-1.5">
                    <div className="flex items-center justify-between text-[13.5px]">
                      <span className="font-semibold">{t(`pay.${m}` as TKey)}</span>
                      <Money value={v} compact className="text-muted" />
                    </div>
                    <Meter value={v} max={sales} tone={PAY_TONE[m]} label={t(`pay.${m}` as TKey)} />
                  </li>
                ))}
                {!mix.length ? <EmptyState compact title={t("overview.noSales")} /> : null}
              </ul>
            </Card>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function TableChip({ table }: { table: DiningTable }) {
  const { t, lang } = useT();
  const round = table.shape === "round" || table.shape === "oval";
  return (
    <Link
      to="/floor"
      title={`${t("common.table", { n: table.label })} · ${t(`table.${table.status}` as TKey)}${table.statusSince ? ` · ${ago(table.statusSince, lang)}` : ""}`}
      className={cn("relative grid aspect-square place-items-center border-2 text-[16px] font-semibold transition-transform hover:-translate-y-0.5", round ? "rounded-full" : "rounded-2xl", TABLE_TONE[table.status])}
    >
      <span className="num">{table.label}</span>
      {table.status === "bill" ? <span className="absolute -top-1 -end-1 size-3 animate-pulse-dot rounded-full bg-brass text-brass" /> : null}
    </Link>
  );
}
