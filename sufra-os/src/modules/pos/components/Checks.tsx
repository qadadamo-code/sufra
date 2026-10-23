/** Open checks list (recall a held ticket), and the transfer / merge dialogs built on it. */
import { useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowLeftRight, Bike, Clock, LayoutGrid, Search, ShoppingBag, Store, Utensils } from "lucide-react";
import type { Check, DiningTable, Order, OrderItem } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { Badge, Button, Dialog, EmptyState, Segmented, spring, useReduced } from "@/ui";

export interface CheckRow {
  check: Check;
  order: Order | null;
  tables: string;
  customer: string;
  items: number;
}

const MODE_ICON = { dine_in: Utensils, takeaway: ShoppingBag, delivery: Bike, pickup: Store };

export function CheckCard({ row, active, onClick, disabled }: { row: CheckRow; active?: boolean; onClick: () => void; disabled?: boolean }) {
  const { L, lang } = useT();
  const reduced = useReduced();
  const mode = row.order?.pickupAt ? "pickup" : (row.order?.mode ?? "dine_in");
  const Icon = MODE_ICON[mode];
  const age = Math.floor((Date.now() - Date.parse(row.check.openedAt)) / 60_000);
  return (
    <motion.button
      type="button"
      layout={!reduced}
      disabled={disabled}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      transition={spring.snappy}
      onClick={onClick}
      className={cn("flex min-h-[104px] flex-col rounded-2xl border bg-surface p-3 text-start shadow-sf-sm transition-colors hover:border-line-strong disabled:opacity-40", active ? "border-primary ring-2 ring-primary/30" : "border-line")}
    >
      <span className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-ink-2">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15.5px] font-semibold">{row.tables ? `${L("ترابيزة", "Table")} ${row.tables}` : row.customer || (mode === "delivery" ? L("دليفري", "Delivery") : mode === "pickup" ? L("استلام", "Pickup") : L("تيك أواي", "Takeaway"))}</span>
          <span className="num block text-[12px] text-muted">#{row.order?.number ?? "—"} · {row.items} {L("صنف", "items")}</span>
        </span>
        {row.check.status === "bill_requested" ? <Badge tone="brass" size="sm" dot pulse>{L("الحساب", "Bill")}</Badge> : null}
      </span>
      <span className="mt-auto flex items-end justify-between pt-2">
        <span className={cn("flex items-center gap-1 text-[12px] font-semibold", age > 90 ? "text-danger" : age > 45 ? "text-warn" : "text-muted")}>
          <Clock className="size-3.5" /> {ago(row.check.openedAt, lang)}
        </span>
        <span className="num text-[16px] font-semibold">{formatMoney(row.check.total, { lang })}</span>
      </span>
    </motion.button>
  );
}

export function useCheckRows(checks: Check[], orders: Order[], items: OrderItem[], tables: DiningTable[], customers: { id: string; name: string; phone: string }[]): CheckRow[] {
  return useMemo(() => {
    const tl = new Map(tables.map((t) => [t.id, t.label]));
    return checks
      .map((c) => {
        const os = orders.filter((o) => o.checkId === c.id);
        const ids = new Set(os.map((o) => o.id));
        const cust = customers.find((x) => x.id === c.customerId);
        return {
          check: c,
          order: os[0] ?? null,
          tables: c.tableIds.map((id) => tl.get(id) ?? "?").join("+"),
          customer: cust ? cust.name || cust.phone : "",
          items: items.filter((i) => ids.has(i.orderId) && i.status !== "void").reduce((a, i) => a + i.qty, 0),
        };
      })
      .sort((a, b) => a.check.openedAt.localeCompare(b.check.openedAt));
  }, [checks, orders, items, tables, customers]);
}

export function OpenChecksDialog({ open, onClose, rows, activeId, onPick, title, exclude }: { open: boolean; onClose: () => void; rows: CheckRow[]; activeId: string | null; onPick: (c: Check) => void; title?: string; exclude?: string | null }) {
  const { L } = useT();
  const [q, setQ] = useState("");
  const [f, setF] = useState<"all" | "dine_in" | "takeaway" | "delivery">("all");
  useEffect(() => {
    if (open) setQ("");
  }, [open]);
  const shown = rows.filter((r) => r.check.id !== exclude && (f === "all" || r.order?.mode === f) && (!q || matches(`${r.tables} ${r.customer} ${r.order?.number ?? ""}`, q)));
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={title ?? L("الشيكات المفتوحة", "Open checks")}>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("ترابيزة، رقم، عميل…", "Table, number, customer…")} aria-label={L("بحث", "Search")} className="h-11 w-full rounded-xl border border-line bg-surface ps-9 pe-3 outline-none focus:border-primary" data-autofocus />
        </label>
        <Segmented size="sm" label={L("النوع", "Type")} value={f} onChange={setF} options={[{ value: "all", label: L("الكل", "All") }, { value: "dine_in", label: L("صالة", "Dine-in") }, { value: "takeaway", label: L("تيك أواي", "Takeaway") }, { value: "delivery", label: L("دليفري", "Delivery") }]} />
      </div>
      {shown.length ? (
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((r) => (
            <CheckCard key={r.check.id} row={r} active={r.check.id === activeId} onClick={() => onPick(r.check)} />
          ))}
        </div>
      ) : (
        <EmptyState className="mt-6" icon={<LayoutGrid />} title={L("مفيش شيكات مفتوحة", "No open checks")} compact />
      )}
    </Dialog>
  );
}

/** Pick lines (and how many of each) to move to another check or table. */
export function TransferDialog({ open, onClose, items, rows, exclude, onToCheck, onToTable, onMoveTable }: {
  open: boolean;
  onClose: () => void;
  items: OrderItem[];
  rows: CheckRow[];
  exclude: string | null;
  onToCheck: (moves: { itemId: string; qty: number }[], target: Check) => void;
  onToTable: (moves: { itemId: string; qty: number }[]) => void;
  onMoveTable: () => void;
}) {
  const { L, loc } = useT();
  const live = items.filter((i) => i.status !== "void");
  const [sel, setSel] = useState<Record<string, number>>({});
  useEffect(() => {
    if (open) setSel({});
  }, [open]);
  const moves = Object.entries(sel)
    .filter(([, q]) => q > 0)
    .map(([itemId, qty]) => ({ itemId, qty }));
  const targets = rows.filter((r) => r.check.id !== exclude);
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={L("نقل", "Transfer")} description={L("اختار الأصناف، وبعدين الشيك أو الترابيزة اللي هتروح لها", "Pick lines, then the check or table they go to")}>
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink-2">{L("الأصناف", "Lines")}</span>
            <button type="button" className="text-[13px] font-semibold text-primary" onClick={() => setSel(Object.fromEntries(live.map((i) => [i.id, i.qty])))}>
              {L("الكل", "All")}
            </button>
          </div>
          <ul className="grid gap-1.5">
            {live.map((i) => {
              const q = sel[i.id] ?? 0;
              return (
                <li key={i.id} className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-2", q ? "border-primary bg-primary-soft/50" : "border-line")}>
                  <button type="button" className="min-w-0 flex-1 truncate text-start text-[14.5px] font-medium" onClick={() => setSel((s) => ({ ...s, [i.id]: q ? 0 : i.qty }))}>
                    {loc(i.name)}
                  </button>
                  <span className="num flex items-center gap-1 text-[14px]">
                    <button type="button" className="size-8 rounded-lg border border-line" onClick={() => setSel((s) => ({ ...s, [i.id]: Math.max(0, q - 1) }))} aria-label="-">
                      −
                    </button>
                    <span className="w-10 text-center">
                      {q}/{i.qty}
                    </span>
                    <button type="button" className="size-8 rounded-lg border border-line" onClick={() => setSel((s) => ({ ...s, [i.id]: Math.min(i.qty, q + 1) }))} aria-label="+">
                      +
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink-2">{L("على فين؟", "To where?")}</span>
            <Button size="sm" variant="ghost" onClick={onMoveTable} icon={<ArrowLeftRight className="size-4" />}>
              {L("انقل الشيك كله لترابيزة", "Move whole check to a table")}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" disabled={!moves.length} onClick={() => onToTable(moves)} className="grid min-h-[104px] place-items-center rounded-2xl border-2 border-dashed border-line text-muted hover:border-primary hover:text-primary disabled:opacity-40">
              <span className="flex items-center gap-2 font-semibold">
                <LayoutGrid className="size-5" /> {L("ترابيزة…", "A table…")}
              </span>
            </button>
            {targets.map((r) => (
              <CheckCard key={r.check.id} row={r} onClick={() => onToCheck(moves, r.check)} disabled={!moves.length} />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
