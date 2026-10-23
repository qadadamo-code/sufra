/**
 * Orders: everything today (business day) from every channel — POS, waiter, QR, online, phone, delivery —
 * with filters, search, a detail drawer (items trail, payments, receipts + ETA), reprint and manager-approved refunds.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Bike, ClipboardList, Globe, Printer, QrCode, ReceiptText, RotateCcw, Search, ShoppingBag, Store, Utensils, Wallet } from "lucide-react";
import { useApproval } from "@/auth/approval";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Order, OrderStatus, Payment, PaymentMethod, Receipt } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { clock, startOfDay } from "@/lib/time";
import { METHOD_LABEL, type ReceiptModel } from "@/lib/receipt/model";
import { PageHeader } from "@/shell/PageHeader";
import { AnimatedMoney, Badge, Button, Card, Dialog, EmptyState, Segmented, Sheet, StatTile, Table, useToast, type Tone } from "@/ui";
import { ReceiptDialog } from "../pos/components/ReceiptDialog";
import { STATUS_LABEL } from "../pos/components/TicketPanel";
import { ETA_LABEL } from "../pos/EtaQueue";
import { refundSale, returnable } from "../pos/sale";
import { useReceiptSourceBuilder, useShift, useStaffNames } from "../pos/usePos";

type Channel = "all" | "pos" | "qr" | "online" | "delivery";
type Kind = "all" | "dine_in" | "takeaway" | "pickup" | "delivery";
type StatusF = "all" | "active" | "closed" | "void";

const ORDER_TONE: Record<OrderStatus, Tone> = { open: "warn", sent: "info", ready: "ok", served: "primary", closed: "neutral", void: "danger" };
const ORDER_LABEL: Record<OrderStatus, { ar: string; en: string }> = {
  open: { ar: "مفتوح", en: "Open" },
  sent: { ar: "في المطبخ", en: "In kitchen" },
  ready: { ar: "جاهز", en: "Ready" },
  served: { ar: "اتقدّم", en: "Served" },
  closed: { ar: "مقفول", en: "Closed" },
  void: { ar: "ملغي", en: "Void" },
};
const SOURCE_LABEL: Record<Order["source"], { ar: string; en: string }> = {
  pos: { ar: "كاشير", en: "POS" },
  waiter: { ar: "جرسون", en: "Waiter" },
  qr: { ar: "QR", en: "QR" },
  online: { ar: "أونلاين", en: "Online" },
  phone: { ar: "تليفون", en: "Phone" },
  aggregator: { ar: "تطبيق", en: "App" },
};
const kindOf = (o: Order): Exclude<Kind, "all"> => (o.pickupAt ? "pickup" : o.mode);
const KIND_ICON = { dine_in: Utensils, takeaway: ShoppingBag, pickup: Store, delivery: Bike };
const channelOf = (o: Order): Exclude<Channel, "all"> => (o.mode === "delivery" ? "delivery" : o.source === "qr" ? "qr" : o.source === "online" ? "online" : "pos");

export default function OrdersPage() {
  const { L, lang } = useT();
  const since = useMemo(() => {
    const d = startOfDay();
    if (new Date().getHours() < 5) d.setDate(d.getDate() - 1);
    return d.toISOString();
  }, []);
  const orders = useLive("orders", { gte: { openedAt: since }, orderBy: [{ field: "openedAt", dir: "desc" }] }).data;
  const checkIds = useMemo(() => [...new Set(orders.map((o) => o.checkId).filter((x): x is string => !!x))], [orders]);
  const checks = useLive("checks", { where: { id: checkIds } }, { enabled: checkIds.length > 0 }).data;
  const items = useLive("orderItems", { where: { orderId: orders.map((o) => o.id) } }, { enabled: orders.length > 0 }).data;
  const tables = useLive("tables").data;
  const customers = useLive("customers").data;
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [channel, setChannel] = useState<Channel>("all");
  const [status, setStatus] = useState<StatusF>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const checkById = useMemo(() => new Map(checks.map((c) => [c.id, c])), [checks]);
  const tableLabel = (ids: string[]) => ids.map((id) => tables.find((t) => t.id === id)?.label ?? "?").join("+");
  const custOf = (o: Order) => customers.find((c) => c.id === o.customerId);
  const rows = orders.filter((o) => {
    if (kind !== "all" && kindOf(o) !== kind) return false;
    if (channel !== "all" && channelOf(o) !== channel) return false;
    if (status === "active" && (o.status === "closed" || o.status === "void")) return false;
    if (status === "closed" && o.status !== "closed") return false;
    if (status === "void" && o.status !== "void") return false;
    if (q.trim()) {
      const c = custOf(o);
      const ch = o.checkId ? checkById.get(o.checkId) : null;
      if (!matches(`${o.number} ${tableLabel(o.tableIds)} ${c?.name ?? ""} ${c?.phone ?? ""} ${ch?.receiptNo ?? ""} ${o.delivery?.address ?? ""}`, q)) return false;
    }
    return true;
  });
  const paid = checks.filter((c) => c.status === "paid");
  const sales = paid.reduce((a, c) => a + c.total, 0);
  const active = orders.filter((o) => o.status !== "closed" && o.status !== "void").length;

  return (
    <div className="grid gap-6">
      <PageHeader icon={<ClipboardList />} title={L("الطلبات", "Orders")} subtitle={L("كل طلبات النهارده من كل القنوات — مباشر", "Every order today from every channel — live")} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} icon={<ClipboardList />} label={L("طلبات النهارده", "Orders today")} value={orders.length} sub={`${active} ${L("شغالين", "active")}`} />
        <StatTile index={1} icon={<Wallet />} tone="brass" label={L("مبيعات مقفولة", "Closed sales")} value={<AnimatedMoney value={sales} whole />} sub={`${paid.length} ${L("شيك", "checks")}`} />
        <StatTile index={2} icon={<ReceiptText />} tone="info" label={L("متوسط الشيك", "Average check")} value={<AnimatedMoney value={paid.length ? Math.round(sales / paid.length) : 0} whole />} />
        <StatTile index={3} icon={<QrCode />} tone="ok" label={L("من QR وأونلاين", "From QR & online")} value={orders.filter((o) => o.source === "qr" || o.source === "online").length} />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <label className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("رقم، ترابيزة، عميل، إيصال…", "Number, table, customer, receipt…")} aria-label={L("بحث", "Search")} className="h-11 w-full rounded-xl border border-line bg-surface ps-9 pe-3 outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" />
          </label>
          <Segmented size="sm" label={L("الحالة", "Status")} value={status} onChange={setStatus} options={[{ value: "all", label: L("الكل", "All") }, { value: "active", label: L("شغال", "Active") }, { value: "closed", label: L("مقفول", "Closed") }, { value: "void", label: L("ملغي", "Void") }]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <Segmented size="sm" label={L("النوع", "Type")} value={kind} onChange={setKind} options={[{ value: "all", label: L("كل الأنواع", "All types") }, { value: "dine_in", label: L("صالة", "Dine-in"), icon: <Utensils /> }, { value: "takeaway", label: L("تيك أواي", "Takeaway"), icon: <ShoppingBag /> }, { value: "pickup", label: L("استلام", "Pickup"), icon: <Store /> }, { value: "delivery", label: L("دليفري", "Delivery"), icon: <Bike /> }]} />
          <Segmented size="sm" label={L("القناة", "Channel")} value={channel} onChange={setChannel} options={[{ value: "all", label: L("كل القنوات", "All channels") }, { value: "pos", label: L("كاشير/جرسون", "POS") }, { value: "qr", label: "QR", icon: <QrCode /> }, { value: "online", label: L("أونلاين", "Online"), icon: <Globe /> }, { value: "delivery", label: L("دليفري", "Delivery"), icon: <Bike /> }]} />
        </div>
        {rows.length ? (
          <Table
            rows={rows}
            rowKey={(o) => o.id}
            onRowClick={(o) => setOpenId(o.id)}
            selectedKey={openId}
            columns={[
              { key: "n", header: "#", width: "64px", cell: (o) => <span className="num font-bold">{o.number}</span> },
              { key: "t", header: L("الوقت", "Time"), cell: (o) => <span className="num text-[13px] text-muted">{clock(o.openedAt, lang)}</span>, hideOnMobile: true },
              {
                key: "k",
                header: L("النوع", "Type"),
                cell: (o) => {
                  const k = kindOf(o);
                  const Icon = KIND_ICON[k];
                  return (
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 text-muted" />
                      <span className="font-semibold">{o.tableIds.length ? `${L("ترابيزة", "T")} ${tableLabel(o.tableIds)}` : (custOf(o)?.name || { dine_in: L("صالة", "Dine-in"), takeaway: L("تيك أواي", "Takeaway"), pickup: L("استلام", "Pickup"), delivery: L("دليفري", "Delivery") }[k])}</span>
                    </span>
                  );
                },
              },
              { key: "c", header: L("القناة", "Channel"), cell: (o) => <Badge size="sm" tone={o.source === "qr" ? "info" : o.source === "online" ? "brass" : "neutral"}>{SOURCE_LABEL[o.source][lang]}</Badge>, hideOnMobile: true },
              { key: "i", header: L("أصناف", "Items"), align: "center", hideOnMobile: true, cell: (o) => <span className="num">{items.filter((i) => i.orderId === o.id && i.status !== "void").reduce((a, i) => a + i.qty, 0)}</span> },
              { key: "s", header: L("الحالة", "Status"), cell: (o) => <Badge size="sm" dot tone={ORDER_TONE[o.status]}>{ORDER_LABEL[o.status][lang]}</Badge> },
              {
                key: "p",
                header: L("الدفع", "Payment"),
                hideOnMobile: true,
                cell: (o) => {
                  const c = o.checkId ? checkById.get(o.checkId) : null;
                  if (!c) return "—";
                  return c.status === "paid" ? <Badge size="sm" tone="ok">{L("مدفوع", "Paid")}</Badge> : c.paid ? <Badge size="sm" tone="brass">{L("جزئي", "Partial")}</Badge> : c.status === "void" ? <Badge size="sm">—</Badge> : <Badge size="sm" tone="warn">{L("لسه", "Unpaid")}</Badge>;
                },
              },
              { key: "r", header: L("إيصال", "Receipt"), hideOnMobile: true, cell: (o) => <span className="num text-[12.5px] text-muted">{(o.checkId && checkById.get(o.checkId)?.receiptNo) || "—"}</span> },
              { key: "tot", header: L("الإجمالي", "Total"), align: "end", cell: (o) => <span className="num font-semibold">{o.checkId && checkById.get(o.checkId) ? formatMoney(checkById.get(o.checkId)!.total, { lang }) : "—"}</span> },
            ]}
          />
        ) : (
          <EmptyState compact icon={<ClipboardList />} title={L("مفيش طلبات بالفلتر ده", "No orders match")} />
        )}
      </Card>
      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const nav = useNavigate();
  const db = useDb();
  const approve = useApproval();
  const { toast } = useToast();
  const { can } = useSession();
  const names = useStaffNames();
  const { device, shift } = useShift();
  const builder = useReceiptSourceBuilder();
  const order = useLive("orders", { where: { id: orderId ?? "-" } }, { enabled: !!orderId }).data[0] ?? null;
  const checkId = order?.checkId ?? "-";
  const check = useLive("checks", { where: { id: checkId } }, { enabled: !!order?.checkId }).data[0] ?? null;
  const orders = useLive("orders", { where: { checkId } }, { enabled: !!order?.checkId }).data;
  const items = useLive("orderItems", { where: { orderId: orders.map((o) => o.id) } }, { enabled: orders.length > 0 }).data;
  const payments = useLive("payments", { where: { checkId }, orderBy: [{ field: "createdAt" }] }, { enabled: !!order?.checkId }).data;
  const receipts = useLive("receipts", { where: { checkId }, orderBy: [{ field: "seq" }] }, { enabled: !!order?.checkId }).data;
  const tables = useLive("tables").data;
  const [view, setView] = useState<{ model: ReceiptModel; title: string } | null>(null);
  const [refund, setRefund] = useState(false);
  const sale = receipts.find((r) => r.kind === "SC") ?? null;
  const returns = receipts.filter((r) => r.kind === "RC");
  const open = !!orderId && !!order;
  const mine = items.filter((i) => order && i.orderId === order.id);

  const reprint = (r: Receipt | null) => {
    if (!builder || !check) return;
    const m = r ? builder.fromReceipt(r, check, orders, payments, r.refundOf ? receipts.find((x) => x.id === r.refundOf) : null) : builder.fromCheck(check, orders, items, payments, payments[0]?.takenBy ?? null);
    if (m) setView({ model: m, title: r ? r.receiptNo : check.receiptNo ?? L("شيك مبدئي", "Pre-bill") });
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} size="lg" title={order ? `${L("طلب", "Order")} #${order.number}` : ""} description={order ? `${SOURCE_LABEL[order.source][lang]} · ${clock(order.openedAt, lang)}${order.tableIds.length ? ` · ${L("ترابيزة", "Table")} ${order.tableIds.map((id) => tables.find((t) => t.id === id)?.label).join("+")}` : ""}` : undefined}
        footer={
          order ? (
            <div className="flex w-full flex-wrap gap-2">
              {check && (check.status === "open" || check.status === "bill_requested") && can("pos.use") ? (
                <Button
                  variant="soft"
                  onClick={() => {
                    localStorage.setItem("sufra-os.pos.active", check.id);
                    nav("/pos");
                  }}
                >
                  {L("افتح في الكاشير", "Open in POS")}
                </Button>
              ) : null}
              <div className="flex-1" />
              {sale && can("payments.take") ? (
                <Button variant="danger-soft" icon={<RotateCcw className="size-4" />} onClick={() => setRefund(true)}>
                  {L("مرتجع", "Refund")}
                </Button>
              ) : null}
              {check ? (
                <Button icon={<Printer className="size-4" />} onClick={() => reprint(sale)}>
                  {sale ? L("إعادة طباعة", "Reprint") : L("شيك مبدئي", "Pre-bill")}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {order ? (
          <div className="grid gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge dot tone={ORDER_TONE[order.status]}>{ORDER_LABEL[order.status][lang]}</Badge>
              {check ? <Badge tone={check.status === "paid" ? "ok" : "warn"}>{check.status === "paid" ? L("مدفوع", "Paid") : check.status === "void" ? L("ملغي", "Void") : L("لسه مدفوعش", "Unpaid")}</Badge> : null}
              {order.delivery ? <Badge tone="info" icon={<Bike className="size-3" />}>{order.delivery.address}</Badge> : null}
              {order.pickupAt ? <Badge tone="brass" icon={<Store className="size-3" />}>{clock(order.pickupAt, lang)}</Badge> : null}
            </div>
            <section>
              <h3 className="mb-2 text-[13px] font-bold tracking-wide text-muted">{L("الأصناف", "Items")}</h3>
              <ul className="grid gap-1.5">
                {mine.map((i, k) => (
                  <motion.li key={i.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.02 }} className={cn("rounded-xl border border-line px-3 py-2", i.status === "void" && "opacity-60")}>
                    <div className="flex items-center gap-2">
                      <span className="num grid size-7 place-items-center rounded-lg bg-surface-3 text-[13px] font-bold">{i.qty}</span>
                      <span className={cn("min-w-0 flex-1 truncate font-semibold", i.status === "void" && "line-through")}>{loc(i.name)}</span>
                      <Badge size="sm" tone={i.status === "void" ? "danger" : i.status === "ready" ? "ok" : i.status === "new" ? "neutral" : "info"}>
                        {STATUS_LABEL[i.status][lang]}
                      </Badge>
                    </div>
                    {i.modifiers.length || i.notes ? <p className="mt-1 text-[12.5px] text-muted">{[...i.modifiers.map((m) => loc(m.name)), i.notes && `“${i.notes}”`].filter(Boolean).join(" · ")}</p> : null}
                    <p className="num mt-1 text-[11.5px] text-faint">
                      {i.createdBy ? `${names.get(i.createdBy)?.name ?? ""} · ` : ""}
                      {i.firedAt ? `${L("اتبعت", "fired")} ${clock(i.firedAt, lang)}` : ""}
                      {i.readyAt ? ` · ${L("جاهز", "ready")} ${clock(i.readyAt, lang)}` : ""}
                      {i.servedAt ? ` · ${L("اتقدّم", "served")} ${clock(i.servedAt, lang)}` : ""}
                      {i.voidReason ? ` · ${L("اتلغى", "void")}: ${i.voidReason}` : ""}
                    </p>
                  </motion.li>
                ))}
              </ul>
            </section>
            {check ? (
              <section className="rounded-2xl bg-surface-2 p-4">
                <dl className="grid gap-1 text-[14px]">
                  <Line l={L("الإجمالي قبل الخصم", "Subtotal")} v={check.subtotal} lang={lang} />
                  {check.discountTotal ? <Line l={`${L("خصم", "Discount")}${check.discountReason ? ` · ${check.discountReason}` : ""}`} v={-check.discountTotal} lang={lang} /> : null}
                  {check.service ? <Line l={L("خدمة", "Service")} v={check.service} lang={lang} /> : null}
                  {check.vat ? <Line l={L("ضريبة ق.م", "VAT")} v={check.vat} lang={lang} /> : null}
                  <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2 text-[17px] font-semibold">
                    <dt>{L("الإجمالي", "Total")}</dt>
                    <dd className="num">{formatMoney(check.total, { lang })}</dd>
                  </div>
                </dl>
              </section>
            ) : null}
            {payments.length ? (
              <section>
                <h3 className="mb-2 text-[13px] font-bold tracking-wide text-muted">{L("المدفوعات", "Payments")}</h3>
                <ul className="grid gap-1.5">
                  {payments.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {METHOD_LABEL[p.method][lang]} {p.splitLabel ? <span className="num text-[12px] text-muted">· {p.splitLabel}</span> : null}
                        </span>
                        <span className="block text-[12px] text-muted">
                          {clock(p.createdAt, lang)} · {p.takenBy ? names.get(p.takenBy)?.name : ""}
                          {p.tip ? ` · ${L("إكرامية", "tip")} ${formatMoney(p.tip, { lang })}` : ""}
                        </span>
                      </span>
                      {p.status !== "captured" ? <Badge size="sm" tone={p.status === "refunded" ? "brass" : "neutral"}>{p.status === "refunded" ? L("مرتجع", "Refund") : L("ملغي", "Void")}</Badge> : null}
                      <span className={cn("num font-semibold", p.amount < 0 && "text-danger")}>{formatMoney(p.amount, { lang })}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {receipts.length ? (
              <section>
                <h3 className="mb-2 text-[13px] font-bold tracking-wide text-muted">{L("الإيصالات", "Receipts")}</h3>
                <ul className="grid gap-1.5">
                  {receipts.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                      <ReceiptText className="size-4 text-muted" />
                      <span className="num min-w-0 flex-1 font-semibold">{r.receiptNo}</span>
                      <Badge size="sm" tone={r.kind === "RC" ? "brass" : "neutral"}>{r.kind === "RC" ? L("مرتجع", "Return") : L("بيع", "Sale")}</Badge>
                      <Badge size="sm" tone={r.etaStatus === "valid" ? "ok" : r.etaStatus === "invalid" ? "danger" : r.etaStatus === "not_required" ? "neutral" : "warn"}>
                        ETA · {ETA_LABEL[r.etaStatus][lang]}
                      </Badge>
                      <Button size="sm" variant="ghost" icon={<Printer className="size-4" />} onClick={() => reprint(r)} aria-label={L("اطبع", "Print")} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      <ReceiptDialog open={!!view} onClose={() => setView(null)} model={view?.model ?? null} title={view?.title} />
      {sale && check ? (
        <RefundDialog
          open={refund}
          onClose={() => setRefund(false)}
          sale={sale}
          returns={returns}
          payments={payments}
          shiftOpen={!!shift}
          onRefund={async (picks, method, reason) => {
            const who = await approve({ kind: "refund" }, L(`مرتجع من ${sale.receiptNo}`, `Refund on ${sale.receiptNo}`));
            if (!who) return;
            try {
              const r = await refundSale(db, sale, picks, method, { shift, device, approvedBy: who.id, reason });
              setRefund(false);
              toast({ title: L(`اتعمل مرتجع ${r.receipt.receiptNo}`, `Refund ${r.receipt.receiptNo} issued`), description: formatMoney(r.receipt.bill.payable, { lang }), tone: "success" });
              if (builder) setView({ model: builder.fromReceipt(r.receipt, check, orders, payments, sale), title: r.receipt.receiptNo });
            } catch (e) {
              toast({ title: String((e as Error).message), tone: "error" });
            }
          }}
        />
      ) : null}
    </>
  );
}

function Line({ l, v, lang }: { l: string; v: number; lang: "ar" | "en" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{l}</dt>
      <dd className="num">{formatMoney(v, { lang })}</dd>
    </div>
  );
}

function RefundDialog({ open, onClose, sale, returns, payments, shiftOpen, onRefund }: {
  open: boolean;
  onClose: () => void;
  sale: Receipt;
  returns: Receipt[];
  payments: Payment[];
  shiftOpen: boolean;
  onRefund: (picks: { lineId: string; qty: number }[], method: PaymentMethod, reason: string) => void;
}) {
  const { L, lang, loc } = useT();
  const left = useMemo(() => returnable(sale, returns), [sale, returns]);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>(payments.find((p) => p.status === "captured")?.method ?? "cash");
  const [reason, setReason] = useState("");
  const chosen = Object.entries(picks)
    .filter(([, q]) => q > 0)
    .map(([lineId, qty]) => ({ lineId, qty }));
  const estimate = chosen.reduce((a, p) => {
    const l = sale.bill.lines.find((x) => x.id === p.lineId)!;
    return a + Math.round((l.total * p.qty) / l.qty);
  }, 0);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={L("مرتجع", "Refund")}
      description={L(`من الإيصال ${sale.receiptNo} — بيطلع إيصال مرتجع إلكتروني مربوط بالأصل`, `Against ${sale.receiptNo} — issues a linked return e-receipt`)}
      footer={
        <Button variant="danger" size="lg" disabled={!chosen.length || !reason.trim() || !shiftOpen} onClick={() => onRefund(chosen, method, reason.trim())} icon={<RotateCcw className="size-5" />}>
          {L("رجّع", "Refund")} ≈ {formatMoney(estimate, { lang })}
        </Button>
      }
    >
      <div className="grid gap-4">
        {!shiftOpen ? <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13.5px] font-medium text-warn">{L("لازم وردية مفتوحة على الجهاز ده عشان المرتجع يتسجل في الدرج.", "Open a shift on this device first — the refund goes through its drawer.")}</p> : null}
        <div className="flex justify-end">
          <button type="button" className="text-[13px] font-semibold text-primary" onClick={() => setPicks(Object.fromEntries(sale.bill.lines.map((l) => [l.id, left.get(l.id) ?? 0])))}>
            {L("رجّع الكل", "Return everything")}
          </button>
        </div>
        <ul className="grid gap-1.5">
          {sale.bill.lines.map((l) => {
            const max = left.get(l.id) ?? 0;
            const q = picks[l.id] ?? 0;
            return (
              <li key={l.id} className={cn("flex items-center gap-3 rounded-xl border px-3 py-2", q ? "border-danger/40 bg-danger-soft/40" : "border-line", !max && "opacity-50")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{loc(l.name)}</span>
                  <span className="num block text-[12px] text-muted">
                    {l.qty} × {formatMoney(l.unitPrice, { lang })} {max < l.qty ? `· ${L("اترجع", "returned")} ${l.qty - max}` : ""}
                  </span>
                </span>
                <span className="num flex items-center gap-1">
                  <button type="button" className="size-9 rounded-lg border border-line disabled:opacity-40" disabled={!q} onClick={() => setPicks((p) => ({ ...p, [l.id]: q - 1 }))} aria-label="-">
                    −
                  </button>
                  <span className="w-10 text-center">
                    {q}/{max}
                  </span>
                  <button type="button" className="size-9 rounded-lg border border-line disabled:opacity-40" disabled={q >= max} onClick={() => setPicks((p) => ({ ...p, [l.id]: q + 1 }))} aria-label="+">
                    +
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("طريقة الرد", "Refund to")}</p>
          <Segmented label={L("طريقة الرد", "Refund to")} value={method} onChange={setMethod} options={(["cash", "card", "wallet", "instapay"] as PaymentMethod[]).map((m) => ({ value: m, label: METHOD_LABEL[m][lang] }))} />
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L("سبب المرتجع", "Reason for the refund")} aria-label={L("السبب", "Reason")} className="h-11 rounded-xl border border-line bg-surface px-3.5 outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" />
      </div>
    </Dialog>
  );
}

