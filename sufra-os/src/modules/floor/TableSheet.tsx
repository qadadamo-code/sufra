import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, BellRing, CalendarClock, Check, Combine, Lock, LockOpen, Minus, Plus, Receipt, ReceiptText, ShoppingBag, Sparkles, Split, TriangleAlert, Unlink, Users, Wallet } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import { ackServiceCall, resolveServiceCall } from "@/data/ops";
import type { Membership, OrderItemStatus } from "@/data/types";
import { useDict, useT, type TKey } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { AnimatedMoney, Badge, Button, Money, Select, Sheet, useReduced, useToast, type Tone } from "@/ui";
import { floorDict } from "./dict";
import { STATE_ICON } from "./FloorCanvas";
import type { TableView } from "./model";
import { markClean, markPaid, reopenBill, requestBill, seatTables, setBlocked, setGuests, setWaiter, splitByTable, unlinkTables } from "./ops";

const ITEM_TONE: Record<OrderItemStatus, Tone> = { new: "neutral", sent: "info", preparing: "warn", ready: "ok", served: "primary", void: "danger" };

export function StateBadge({ state, label }: { state: TableView["state"]; label: string }) {
  const Icon = STATE_ICON[state];
  return (
    <span className={cn("fl-root inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-bold", `fl-st-${state}`, "fl-swatch")}>
      <Icon className="size-3.5" strokeWidth={2.6} />
      {label}
    </span>
  );
}

export interface TableSheetProps {
  tv: TableView | null;
  zoneName: string;
  labels: Map<string, string>;
  waiters: Membership[];
  onClose: () => void;
  /** start a pick-a-table flow on the map */
  onPick: (kind: "transfer" | "merge") => void;
  fmtElapsed: (m: number) => string;
  fmtTime: (iso: string) => string;
}

export function TableSheet({ tv, zoneName, labels, waiters, onClose, onPick, fmtElapsed, fmtTime }: TableSheetProps) {
  const f = useDict(floorDict);
  const { t, L, loc, lang } = useT();
  const db = useDb();
  const session = useSession();
  const nav = useNavigate();
  const { toast } = useToast();
  const reduced = useReduced();
  const [busy, setBusy] = useState<string | null>(null);
  const [guests, setGuestsLocal] = useState(2);
  const [waiterId, setWaiterId] = useState<string>("");
  const check = tv?.check ?? null;
  const orders = useLive("orders", { where: { checkId: check?.id ?? "__none" } }, { enabled: !!check }).data;
  const items = useLive("orderItems", { where: { orderId: orders.length ? orders.map((o) => o.id) : ["__none"] }, orderBy: [{ field: "createdAt" }] }, { enabled: !!check }).data;
  const live = items.filter((i) => i.status !== "void");

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast({ title: ok, tone: "success" });
    } catch (e) {
      toast({ title: (e as Error).message === "table_busy" ? f("toast.busy") : f("toast.error"), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const table = tv?.table;
  const can = session.can;
  const others = check ? check.tableIds.filter((id) => id !== table?.id).map((id) => labels.get(id) ?? "?") : [];
  const waiterOptions = useMemo(() => [{ value: "", label: f("sheet.noWaiter") }, ...waiters.map((w) => ({ value: w.id, label: w.name }))], [waiters, f]);

  if (!tv || !table) return <Sheet open={false} onClose={onClose} />;
  const state = tv.state;
  const title = t("common.table", { n: table.label });

  return (
    <Sheet
      open={!!tv}
      onClose={onClose}
      size="md"
      title={
        <span className="flex flex-wrap items-center gap-2.5">
          <span>{title}</span>
          <StateBadge state={state} label={f(`state.${state}`)} />
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{zoneName}</span>
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" /> {f("sheet.capacity", { n: tv.capacity })}
          </span>
          {others.length ? <span className="font-semibold text-primary">{f("sheet.group", { list: others.join("، ") })}</span> : null}
        </span>
      }
    >
      <div className="space-y-5 pt-1">
        {tv.calls.length ? (
          <section className="rounded-2xl border border-danger/30 bg-danger-soft/50 p-3">
            <h3 className="mb-2 flex items-center gap-2 text-[14px] font-bold text-danger">
              <BellRing className="size-4 animate-pulse" /> {f("sheet.calls")}
            </h3>
            <ul className="space-y-2">
              {tv.calls.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-xl bg-surface p-2 ps-3">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                    {t(`call.${c.type}` as TKey)}
                    {c.text ? <span className="font-normal text-muted"> · {c.text}</span> : null}
                  </span>
                  <Badge tone={c.status === "open" ? "danger" : "warn"} size="sm" dot pulse={c.status === "open"}>
                    {t(`call.${c.status}` as TKey)}
                  </Badge>
                  {c.status === "open" ? (
                    <Button size="sm" variant="secondary" onClick={() => run("ack" + c.id, () => ackServiceCall(db, c))} loading={busy === "ack" + c.id}>
                      {f("sheet.ack")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="soft" onClick={() => run("done" + c.id, () => resolveServiceCall(db, c))} loading={busy === "done" + c.id} icon={<Check />}>
                    {f("sheet.done")}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {check ? (
          <>
            <section className="flex items-center justify-between gap-3 rounded-2xl bg-primary-soft/60 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold text-muted">{f("sheet.total")}</p>
                <AnimatedMoney value={check.total} className="text-[26px] font-bold leading-tight" />
              </div>
              {check.paid ? (
                <div className="text-end text-[12.5px] text-muted">
                  {f("sheet.paid")}
                  <Money value={check.paid} className="block text-[15px] font-semibold text-ink" />
                </div>
              ) : null}
            </section>
            <section className="grid grid-cols-2 gap-2">
              <Fact label={f("sheet.guests")}>
                <div className="flex items-center justify-between gap-1">
                  <StepBtn label="−" disabled={check.guests <= 1 || !can("floor.manage")} onClick={() => run("g", () => setGuests(db, check, check.guests - 1))}>
                    <Minus />
                  </StepBtn>
                  <span className="num text-[22px] font-bold">{check.guests}</span>
                  <StepBtn label="+" disabled={!can("floor.manage")} onClick={() => run("g", () => setGuests(db, check, check.guests + 1))}>
                    <Plus />
                  </StepBtn>
                </div>
              </Fact>
              <Fact label={L("قاعدين بقالهم", "Seated for")}>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="num text-[22px] font-bold">{tv.elapsed != null ? fmtElapsed(tv.elapsed) : "—"}</span>
                  <span className="truncate text-[12px] text-muted">{f("sheet.since", { t: fmtTime(check.openedAt) })}</span>
                </span>
              </Fact>
            </section>

            <Select
              label={f("sheet.waiter")}
              value={tv.waiter?.id ?? ""}
              options={waiterOptions}
              disabled={!can("floor.manage")}
              onChange={(e) => run("w", () => setWaiter(db, check, e.target.value || null))}
            />

            <section>
              <h3 className="mb-2 flex items-center justify-between text-[14px] font-bold">
                <span>{f("sheet.items")}</span>
                <span className="text-[12.5px] font-semibold text-muted">{t("common.items", { n: live.reduce((s, i) => s + i.qty, 0) })}</span>
              </h3>
              {live.length ? (
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                  <AnimatePresence initial={false}>
                    {live.map((i) => (
                      <motion.li key={i.id} layout={!reduced} initial={reduced ? false : { opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 bg-surface px-3 py-2.5">
                        <span className="num grid size-7 shrink-0 place-items-center rounded-lg bg-surface-3 text-[13px] font-bold">{i.qty}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14.5px] font-semibold">{loc(i.name)}</span>
                          {i.modifiers.length || (check.tableIds.length > 1 && i.originTableId) ? (
                            <span className="block truncate text-[12.5px] text-muted">
                              {check.tableIds.length > 1 && i.originTableId ? `${t("common.table", { n: labels.get(i.originTableId) ?? "?" })}${i.modifiers.length ? " · " : ""}` : ""}
                              {i.modifiers.map((m) => loc(m.name)).join("، ")}
                            </span>
                          ) : null}
                        </span>
                        <Badge tone={ITEM_TONE[i.status]} size="sm">
                          {t(`item.${i.status}` as TKey)}
                        </Badge>
                        <Money value={i.unitPrice * i.qty} className="text-[13.5px] text-ink-2" />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              ) : (
                <p className="rounded-2xl border border-dashed border-line-strong p-4 text-center text-[14px] text-muted">{f("sheet.noItems")}</p>
              )}
            </section>

            {tv.atRisk && tv.next ? (
              <p className="flex items-start gap-2 rounded-2xl bg-warn-soft p-3 text-[13.5px] font-semibold text-warn">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {f("sheet.atRisk")} · {tv.next.name} {fmtTime(tv.next.startsAt)}
              </p>
            ) : null}

            <section className="grid grid-cols-2 gap-2">
              {can("pos.use") ? (
                <Button className="col-span-2" size="lg" icon={<ShoppingBag />} onClick={() => nav(`/pos?table=${table.id}&check=${check.id}`)}>
                  {f("sheet.toPos")}
                </Button>
              ) : null}
              {check.status === "open" ? (
                <Action icon={<ReceiptText />} onClick={() => run("bill", () => requestBill(db, check), f("toast.billRequested"))} loading={busy === "bill"} tone="bill" disabled={!can("floor.manage")}>
                  {f("sheet.requestBill")}
                </Action>
              ) : (
                <Action icon={<Receipt />} onClick={() => run("reopen", () => reopenBill(db, check))} loading={busy === "reopen"} disabled={!can("floor.manage")}>
                  {f("sheet.backToOpen")}
                </Action>
              )}
              {can("payments.take") ? (
                <Action icon={<Wallet />} onClick={() => run("paid", () => markPaid(db, check), f("toast.paid"))} loading={busy === "paid"} tone="free">
                  {f("sheet.markPaid")}
                </Action>
              ) : null}
              <Action icon={<ArrowLeftRight />} onClick={() => onPick("transfer")} disabled={!can("orders.transfer")}>
                {f("sheet.transfer")}
              </Action>
              <Action icon={<Combine />} onClick={() => onPick("merge")} disabled={!can("checks.merge") && !can("floor.manage")}>
                {f("sheet.merge")}
              </Action>
              {check.tableIds.length > 1 ? (
                <Action icon={<Split />} onClick={() => run("split", () => splitByTable(db, check), f("toast.split"))} loading={busy === "split"} disabled={!can("checks.split")}>
                  {f("sheet.split")}
                </Action>
              ) : null}
            </section>
          </>
        ) : (
          <>
            {tv.next ? (
              <section className={cn("fl-root rounded-2xl p-3.5", "fl-st-reserved fl-soft")}>
                <div className="flex items-center gap-3">
                  <span className="fl-text grid size-10 shrink-0 place-items-center rounded-xl bg-surface">
                    <CalendarClock className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-muted">{f("sheet.next")}</p>
                    <p className="truncate text-[15px] font-bold">
                      {tv.next.name} · {t("common.guests", { n: tv.next.party })}
                    </p>
                    <p className="fl-text num text-[13px] font-bold">{fmtTime(tv.next.startsAt)}</p>
                  </div>
                  {can("floor.manage") && state !== "blocked" ? (
                    <Button size="sm" onClick={() => run("seatres", () => seatTables(db, { tableIds: tv.next!.tableIds.length ? tv.next!.tableIds : [table.id], guests: tv.next!.party, reservationId: tv.next!.id, customerId: tv.next!.customerId }), f("toast.seated", { t: table.label }))} loading={busy === "seatres"}>
                      {f("sheet.seatNow")}
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}

            {state === "dirty" ? (
              <Button size="lg" block variant="brass" icon={<Sparkles />} onClick={() => run("clean", () => markClean(db, [table.id]), f("toast.cleaned"))} loading={busy === "clean"} disabled={!can("floor.manage")}>
                {f("sheet.markClean")}
              </Button>
            ) : null}

            {state !== "blocked" && can("floor.manage") ? (
              <section className="space-y-3 rounded-2xl border border-line bg-surface-2/60 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] font-bold">{f("sheet.guests")}</span>
                  <div className="flex items-center gap-1.5">
                    <StepBtn label="−" disabled={guests <= 1} onClick={() => setGuestsLocal((g) => Math.max(1, g - 1))}>
                      <Minus />
                    </StepBtn>
                    <span className="num w-10 text-center text-[24px] font-bold">{guests}</span>
                    <StepBtn label="+" onClick={() => setGuestsLocal((g) => Math.min(40, g + 1))}>
                      <Plus />
                    </StepBtn>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                    <button key={n} type="button" onClick={() => setGuestsLocal(n)} className={cn("num h-9 min-w-9 rounded-xl border px-2 text-[14px] font-bold transition-colors", guests === n ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:border-line-strong", n > tv.capacity && guests !== n && "text-faint")}>
                      {n}
                    </button>
                  ))}
                </div>
                <Select label={f("sheet.waiter")} value={waiterId || tv.waiter?.id || ""} options={waiterOptions} onChange={(e) => setWaiterId(e.target.value)} />
                <Button size="lg" block icon={<Users />} loading={busy === "seat"} onClick={() => run("seat", () => seatTables(db, { tableIds: tv.group && !tv.group.physical ? tv.group.tableIds : [table.id], guests, waiterId: waiterId || tv.waiter?.id || null }), f("toast.seated", { t: table.label }))}>
                  {f("sheet.open")}
                </Button>
              </section>
            ) : null}

            <section className="grid grid-cols-2 gap-2">
              {tv.group && !tv.group.physical ? (
                <Action icon={<Unlink />} onClick={() => run("unlink", () => unlinkTables(db, [table.id]))} loading={busy === "unlink"} disabled={!can("floor.manage")}>
                  {L("فك الربط", "Unlink tables")}
                </Action>
              ) : (
                <Action icon={<Combine />} onClick={() => onPick("merge")} disabled={!can("floor.manage")}>
                  {f("sheet.merge")}
                </Action>
              )}
              {state === "blocked" ? (
                <Action icon={<LockOpen />} onClick={() => run("block", () => setBlocked(db, table, false))} loading={busy === "block"} disabled={!can("floor.manage")}>
                  {f("sheet.unblock")}
                </Action>
              ) : (
                <Action icon={<Lock />} onClick={() => run("block", () => setBlocked(db, table, true))} loading={busy === "block"} disabled={!can("floor.manage")}>
                  {f("sheet.block")}
                </Action>
              )}
            </section>
          </>
        )}
        <p className="pb-2 text-center text-[12px] text-faint">
          QR · <span className="num ltr">{table.code}</span> · {lang === "ar" ? "الكود المطبوع على الترابيزة" : "printed on the table"}
        </p>
      </div>
    </Sheet>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface-2/60 p-3">
      <p className="mb-1 truncate text-[12px] font-semibold text-muted">{label}</p>
      {children}
    </div>
  );
}

function StepBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-3 disabled:opacity-40 [&_svg]:size-4">
      {children}
    </button>
  );
}

function Action({ icon, children, onClick, loading, disabled, tone }: { icon: ReactNode; children: ReactNode; onClick: () => void; loading?: boolean; disabled?: boolean; tone?: "bill" | "free" }) {
  return (
    <Button variant="secondary" size="lg" onClick={onClick} loading={loading} disabled={disabled} className={cn("fl-root h-auto min-h-13 justify-start whitespace-normal py-2.5 text-start text-[14px] leading-tight", tone && `fl-st-${tone}`)} icon={<span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-[18px]", tone ? "fl-soft fl-text" : "bg-surface-3")}>{icon}</span>}>
      {children}
    </Button>
  );
}
