import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { MessageCircle, Phone, Plus, ShoppingCart, Sparkles, Store, Trash2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { PoLine, PurchaseOrder } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, type Units } from "@/lib/money";
import { dayLabel } from "@/lib/time";
import { Badge, Button, Dialog, EmptyState, Input, Money, Segmented, Select, Switch, Table, useToast, type Column } from "@/ui";
import { MoneyInput } from "@/modules/marketing/ui";
import { PoBadge, Qty, pct } from "./bits";
import { cancelPo, createPo, dailyUsage, invoicePo, paySupplier, poLine, poMessage, poTotals, receivePo, receiptVariance, sendPo, suggestOrders, updatePoLines, waLink, type ReceiveLine, type Suggestion } from "./purchasing";
import { useInventory } from "./useInventory";

type View = "open" | "receive" | "pay" | "all";

export default function PurchasingPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const inv = useInventory();
  const [params, setParams] = useSearchParams();
  const pos = useLive("purchaseOrders", { orderBy: [{ field: "createdAt", dir: "desc" }] }).data.filter((p) => !inv.branchId || p.branchId === inv.branchId);
  const [view, setView] = useState<View>("open");
  const [openId, setOpenId] = useState<string | null>(params.get("po"));
  const [suggest, setSuggest] = useState(params.get("suggest") === "1");
  const [create, setCreate] = useState(false);
  useEffect(() => {
    if (params.get("suggest") === "1") setSuggest(true);
    if (params.get("po")) setOpenId(params.get("po"));
  }, [params]);
  const rows = pos.filter((p) => (view === "open" ? ["draft", "sent", "partial"].includes(p.status) : view === "receive" ? p.status === "received" : view === "pay" ? p.status === "invoiced" : true));
  const open = pos.find((p) => p.id === openId) ?? null;
  const cols: Column<PurchaseOrder>[] = [
    { key: "n", header: L("رقم", "No."), cell: (p) => <span className="num font-semibold" dir="ltr">{p.number}</span> },
    { key: "s", header: L("المورد", "Supplier"), cell: (p) => <span className="flex items-center gap-1.5">{p.channel === "marketplace" ? <Store className="size-4 text-brass" aria-label={L("سوق سُفرة", "Sufra marketplace")} /> : null}{loc(inv.supplierById.get(p.supplierId)?.name)}</span> },
    { key: "d", header: L("التسليم", "Delivery"), hideOnMobile: true, cell: (p) => <span className="text-[13px] text-muted">{p.receivedAt ? dayLabel(p.receivedAt, lang) : p.expectedAt ? dayLabel(p.expectedAt, lang) : "—"}</span> },
    { key: "l", header: L("سطور", "Lines"), align: "end", hideOnMobile: true, cell: (p) => <span className="num">{p.lines.length}</span> },
    { key: "t", header: L("الإجمالي", "Total"), align: "end", cell: (p) => <Money value={p.total} whole /> },
    { key: "st", header: L("الحالة", "Status"), align: "end", cell: (p) => <PoBadge status={p.status} /> },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={L("عرض", "View")}
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: L("مفتوحة", "Open") },
            { value: "receive", label: L("اتستلمت — محتاجة فاتورة", "Received — to invoice") },
            { value: "pay", label: L("محتاجة دفع", "To pay") },
            { value: "all", label: L("الكل", "All") },
          ]}
        />
        <div className="ms-auto flex flex-wrap gap-2">
          {can("purchasing.manage") || can("inventory.manage") ? <Button variant="brass" icon={<Sparkles className="size-4" />} onClick={() => setSuggest(true)}>{L("اقتراحات الطلب", "Suggested orders")}</Button> : null}
          {can("purchasing.manage") || can("inventory.manage") ? <Button icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>{L("طلب شراء", "New PO")}</Button> : null}
        </div>
      </div>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table columns={cols} rows={rows} rowKey={(p) => p.id} onRowClick={(p) => setOpenId(p.id)} caption={L("طلبات الشراء", "Purchase orders")} empty={<EmptyState compact icon={<ShoppingCart />} title={L("مفيش طلبات هنا", "No purchase orders here")} />} />
      </div>
      {open ? <PoSheet po={open} onClose={() => { setOpenId(null); if (params.get("po")) setParams({}, { replace: true }); }} /> : null}
      <SuggestDialog open={suggest} onClose={() => { setSuggest(false); if (params.get("suggest")) setParams({}, { replace: true }); }} onCreated={(id) => { setView("open"); setOpenId(id); }} />
      <CreatePoDialog open={create} onClose={() => setCreate(false)} onCreated={(id) => setOpenId(id)} />
    </div>
  );
}

function SuggestDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const since = useMemo(() => new Date(Date.now() - 14 * 86_400_000).toISOString(), []);
  const moves = useLive("stockMoves", { where: { kind: ["sale", "waste", "staff_meal", "production_out"] }, gte: { at: since } }, { enabled: open }).data;
  const pos = useLive("purchaseOrders", { where: { status: ["draft", "sent", "partial"] } }, { enabled: open }).data;
  const list = useMemo<Suggestion[]>(() => {
    if (!inv.branchId) return [];
    const onHand = new Map([...inv.onHand.entries()].map(([k, v]) => [k, v.qty]));
    return suggestOrders({ items: inv.items, branchId: inv.branchId, onHand, openPos: pos, offers: inv.offers, suppliers: inv.suppliers, usage: dailyUsage(moves, 7), coverDays: inv.settings.coverDays });
  }, [inv, moves, pos]);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const bySupplier = new Map<string, Suggestion[]>();
  for (const s of list) if (s.supplierId) bySupplier.set(s.supplierId, [...(bySupplier.get(s.supplierId) ?? []), s]);
  const chosen = list.filter((s) => s.supplierId && !skip.has(s.item.id));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={L("اقتراحات طلبات الشراء", "Suggested purchase orders")}
      description={L("من الـ par والحد الأدنى + متوسط الاستهلاك اليومي آخر أسبوع × (مدة التوريد + أيام التغطية) − الموجود − اللي في الطريق", "From par/min + last week's daily usage × (lead time + cover days) − on hand − on order")}
      footer={
        <Button block size="lg" loading={busy} disabled={!chosen.length || !inv.branchId} onClick={async () => {
          setBusy(true);
          try {
            let first: string | null = null;
            for (const [sid, ss] of bySupplier) {
              const lines = ss.filter((s) => !skip.has(s.item.id)).map((s) => poLine(s.item, s.offer, qty[s.item.id] ?? s.packs));
              if (!lines.length) continue;
              const home = inv.locations.find((l) => ss[0].item.defaultLocationIds.includes(l.id)) ?? inv.locations[0];
              const po = await createPo(db, { supplierId: sid, branchId: inv.branchId!, locationId: home.id, lines, suggested: true, note: L("من اقتراحات الطلب", "From suggested orders") });
              first = first ?? po.id;
            }
            toast({ title: L(`اتعمل ${bySupplier.size} مسودة`, `${bySupplier.size} draft PO(s) created`), tone: "success" });
            onClose();
            if (first) onCreated(first);
          } finally {
            setBusy(false);
          }
        }}>
          {L("اعمل مسودات الطلبات", "Create draft POs")} ({chosen.length})
        </Button>
      }
    >
      {!list.length ? (
        <EmptyState compact icon={<Sparkles />} title={L("كله تمام", "Nothing to order")} body={L("مفيش خامة تحت حد الطلب", "No item is at its reorder point")} />
      ) : (
        <div className="grid gap-4 pb-1">
          {[...bySupplier.entries()].map(([sid, ss]) => {
            const sup = inv.supplierById.get(sid);
            const total = ss.filter((s) => !skip.has(s.item.id)).reduce((a, s) => a + (qty[s.item.id] ?? s.packs) * (s.offer?.price ?? 0), 0);
            return (
              <section key={sid} className="rounded-2xl border border-line">
                <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                  <span className="font-semibold">{loc(sup?.name)} {sup?.marketplaceId ? <Badge size="sm" tone="brass" className="ms-1.5">{L("سوق سُفرة", "Sufra marketplace")}</Badge> : null}</span>
                  <span className="text-[13px] text-muted">{L("توريد خلال", "lead")} {sup?.leadDays ?? 1} {L("يوم", "d")} · <b className="num text-ink">{formatMoney(total, { lang, whole: true })}</b></span>
                </header>
                <ul className="divide-y divide-line">
                  {ss.map((s) => (
                    <li key={s.item.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                      <input type="checkbox" className="size-5 accent-[var(--sf-primary)]" checked={!skip.has(s.item.id)} aria-label={loc(s.item.name)} onChange={() => setSkip((x) => { const n = new Set(x); if (n.has(s.item.id)) n.delete(s.item.id); else n.add(s.item.id); return n; })} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{loc(s.item.name)}</p>
                        <p className="text-[12.5px] text-muted">
                          {L("موجود", "on hand")} <Qty qty={s.onHand} item={s.item} /> · {L("في الطريق", "on order")} <Qty qty={s.onOrder} item={s.item} /> · {L("بيتصرف يوميًا", "uses/day")} <Qty qty={s.dailyUsage} item={s.item} />
                        </p>
                      </div>
                      <input type="number" min={0} inputMode="decimal" aria-label={L("الكمية", "Quantity")} className="num h-10 w-20 rounded-xl border border-line bg-surface px-2 text-center" value={qty[s.item.id] ?? s.packs} onChange={(e) => setQty({ ...qty, [s.item.id]: Math.max(0, Number(e.target.value) || 0) })} />
                      <span className="w-28 text-[12.5px] text-muted">{loc(s.offer?.packName)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

function CreatePoDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { L, loc } = useT();
  const db = useDb();
  const inv = useInventory();
  const [supplierId, setSupplierId] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={L("طلب شراء جديد", "New purchase order")} footer={
      <Button block size="lg" loading={busy} disabled={!supplierId || !inv.branchId} onClick={async () => {
        setBusy(true);
        try {
          const offers = inv.offers.filter((o) => o.supplierId === supplierId);
          const first = offers[0];
          const it = first ? inv.itemById.get(first.itemId) : null;
          if (!it || !inv.branchId) return;
          const home = inv.locations.find((l) => it.defaultLocationIds.includes(l.id)) ?? inv.locations[0];
          const po = await createPo(db, { supplierId, branchId: inv.branchId, locationId: home.id, lines: [poLine(it, first, 1)] });
          onClose();
          onCreated(po.id);
        } finally {
          setBusy(false);
        }
      }}>{L("ابدأ مسودة", "Start a draft")}</Button>
    }>
      <div className="grid gap-3 pb-1">
        <Select label={L("المورد", "Supplier")} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={[{ value: "", label: "—" }, ...inv.suppliers.filter((s) => inv.offers.some((o) => o.supplierId === s.id)).map((s) => ({ value: s.id, label: loc(s.name) }))]} />
        <p className="text-[13px] text-muted">{L("هتقدر تضيف وتعدّل السطور في المسودة", "You can add and edit lines on the draft")}</p>
      </div>
    </Dialog>
  );
}

export function PoSheet({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const { can, restaurant } = useSession();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const sup = inv.supplierById.get(po.supplierId);
  const [lines, setLines] = useState<PoLine[]>(po.lines);
  useEffect(() => setLines(po.lines), [po.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [step, setStep] = useState<null | "receive" | "invoice" | "pay">(null);
  const [busy, setBusy] = useState(false);
  const draft = po.status === "draft";
  const t = poTotals(lines, po.deliveryFee);
  const manage = can("purchasing.manage") || can("inventory.manage");
  const offersOfSupplier = inv.offers.filter((o) => o.supplierId === po.supplierId && !lines.some((l) => l.itemId === o.itemId));
  const inv0 = useLive("supplierInvoices", { where: { id: po.invoiceId ?? "-" } }, { enabled: !!po.invoiceId }).data[0];
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok, tone: "success" });
    } catch (e) {
      toast({ title: String((e as Error).message ?? e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const msg = poMessage({ ...po, lines }, restaurant ? loc(restaurant.name) : "", lang);
  return (
    <Dialog open onClose={onClose} size="xl" variant="sheet-end" title={`${po.number} · ${loc(sup?.name)}`} description={<span className="inline-flex flex-wrap items-center gap-2"><PoBadge status={po.status} />{po.expectedAt ? `${L("التسليم", "delivery")} ${dayLabel(po.expectedAt, lang)}` : ""}{po.suggested ? <Badge size="sm" tone="brass">{L("من الاقتراحات", "suggested")}</Badge> : null}</span>}>
      <div className="grid gap-4 pb-2">
        <ul className="grid gap-2">
          {lines.map((l, i) => {
            const it = inv.itemById.get(l.itemId);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{loc(l.name)}</p>
                  <p className="text-[12.5px] text-muted">{loc(l.packName)} · {formatMoney(l.price, { lang })}{l.vatBp ? ` + ${pct(l.vatBp, lang, 0)}` : ""}{l.receivedQty ? ` · ${L("اتستلم", "received")} ${l.receivedQty}` : ""}</p>
                </div>
                {draft && manage ? (
                  <>
                    <input type="number" min={0} inputMode="decimal" aria-label={L("الكمية", "Quantity")} className="num h-10 w-20 rounded-xl border border-line bg-surface px-2 text-center" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                    <button type="button" aria-label={L("شيل", "Remove")} className="grid size-10 place-items-center rounded-xl text-danger hover:bg-danger-soft" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
                  </>
                ) : (
                  <span className="num text-[14px]">{l.qty} × {it ? <Qty qty={l.packFactor} item={it} /> : null}</span>
                )}
                <Money value={Math.round(l.qty * l.price)} whole className="w-24 text-end font-semibold" />
              </li>
            );
          })}
        </ul>
        {draft && manage && offersOfSupplier.length ? (
          <Select aria-label={L("ضيف خامة", "Add an item")} value="" onChange={(e) => { const o = offersOfSupplier.find((x) => x.id === e.target.value); const it = o ? inv.itemById.get(o.itemId) : null; if (o && it) setLines([...lines, poLine(it, o, 1)]); }} options={[{ value: "", label: L("+ ضيف خامة من أسعار المورد", "+ Add an item from the supplier's prices") }, ...offersOfSupplier.map((o) => ({ value: o.id, label: `${loc(inv.itemById.get(o.itemId)?.name)} · ${loc(o.packName)} · ${formatMoney(o.price, { lang, whole: true })}` }))]} />
        ) : null}
        <dl className="grid gap-1 rounded-2xl bg-surface-2 p-3.5 text-[14px]">
          <div className="flex justify-between"><dt className="text-muted">{L("صافي", "Net")}</dt><dd><Money value={t.net} /></dd></div>
          {po.deliveryFee ? <div className="flex justify-between"><dt className="text-muted">{L("توصيل", "Delivery")}</dt><dd><Money value={po.deliveryFee} /></dd></div> : null}
          <div className="flex justify-between"><dt className="text-muted">{L("ضريبة مدخلات (تتخصم)", "Input VAT (recoverable)")}</dt><dd><Money value={t.vat} /></dd></div>
          <div className="flex justify-between text-[16px] font-semibold"><dt>{L("الإجمالي", "Total")}</dt><dd><Money value={t.total} /></dd></div>
        </dl>
        {po.marketplace ? (
          <div className="rounded-2xl border border-brass/40 bg-brass-soft/50 p-3.5 text-[13.5px]">
            <p className="flex items-center gap-1.5 font-semibold text-brass-text"><Store className="size-4" />{L("طلب عن طريق سوق سُفرة", "Ordered through the Sufra marketplace")}</p>
            <p className="mt-1 text-muted">
              {L("المورد على باقة", "Supplier plan")} <b>{po.marketplace.plan}</b> · {L("عمولة", "commission")} {po.marketplace.commissionPct}٪ {L("على المستلم فعلًا", "on delivered value")}: <b className="num text-ink">{formatMoney(po.marketplace.commission, { lang })}</b> {L("من", "of")} <span className="num">{formatMoney(po.marketplace.base, { lang, whole: true })}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-muted">{L("العمولة على المورد مش عليك — سعرك هو سعر الكتالوج. سُفرة بتحصّل وتحوّل للمورد.", "Commission is charged to the supplier, not you — you pay the catalogue price. Sufra collects and pays the supplier out.")}</p>
          </div>
        ) : null}
        {inv0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line p-3.5 text-[14px]">
            <span>{L("فاتورة", "Invoice")} <b className="num">{inv0.number}</b> · {L("استحقاق", "due")} {inv0.dueDate}</span>
            <span>{L("مدفوع", "paid")} <Money value={inv0.paid} /> / <Money value={inv0.total} /></span>
          </div>
        ) : null}

        {manage ? (
          <div className="flex flex-wrap gap-2">
            {draft ? (
              <>
                {JSON.stringify(lines) !== JSON.stringify(po.lines) ? <Button variant="secondary" loading={busy} onClick={() => act(() => updatePoLines(db, po.id, lines), L("اتحفظ", "Saved"))}>{L("احفظ", "Save")}</Button> : null}
                {sup?.whatsapp ? (
                  <Button icon={<MessageCircle className="size-4" />} loading={busy} disabled={!lines.length} onClick={() => act(async () => { await updatePoLines(db, po.id, lines); window.open(waLink(sup.whatsapp!, msg), "_blank", "noopener"); await sendPo(db, po.id, "whatsapp"); }, L("اتبعت على واتساب", "Sent on WhatsApp"))}>
                    {L("ابعت واتساب", "Send on WhatsApp")}
                  </Button>
                ) : null}
                {sup?.marketplaceId ? (
                  <Button variant="brass" icon={<Store className="size-4" />} loading={busy} disabled={!lines.length} onClick={() => act(async () => { await updatePoLines(db, po.id, lines); await sendPo(db, po.id, "marketplace"); }, L("اتبعت عن طريق سُفرة", "Ordered through Sufra"))}>
                    {L("اطلب عن طريق سُفرة", "Order through Sufra")}
                  </Button>
                ) : null}
                {sup?.phone ? <a className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 font-semibold hover:bg-surface-2" href={`tel:${sup.phone}`}><Phone className="size-4" />{L("كلّمه", "Call")}</a> : null}
                <Button variant="danger-soft" loading={busy} onClick={() => act(() => cancelPo(db, po.id), L("اتلغى", "Cancelled"))}>{L("إلغاء", "Cancel")}</Button>
              </>
            ) : null}
            {po.status === "sent" || po.status === "partial" ? <Button size="lg" onClick={() => setStep("receive")}>{L("استلام البضاعة", "Receive goods")}</Button> : null}
            {po.status === "received" ? <Button size="lg" onClick={() => setStep("invoice")}>{L("سجّل فاتورة المورد", "Record supplier invoice")}</Button> : null}
            {po.status === "invoiced" && inv0 ? <Button size="lg" onClick={() => setStep("pay")}>{L("ادفع للمورد", "Pay supplier")}</Button> : null}
          </div>
        ) : null}
      </div>
      {step === "receive" ? <ReceiveDialog po={po} onClose={() => setStep(null)} /> : null}
      {step === "invoice" ? <InvoiceDialog po={po} onClose={() => setStep(null)} /> : null}
      {step === "pay" && inv0 ? <PayDialog invoiceId={inv0.id} due={inv0.total - inv0.paid} onClose={() => setStep(null)} /> : null}
    </Dialog>
  );
}

function ReceiveDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const [rec, setRec] = useState<ReceiveLine[]>(() => po.lines.map((l) => ({ lineId: l.id, qty: Math.max(0, l.qty - l.receivedQty), price: l.price, lot: null, expiresOn: null })));
  const [closeShort, setCloseShort] = useState(false);
  const [busy, setBusy] = useState(false);
  const variance = receiptVariance(po, rec);
  const effect = variance.reduce((a, v) => a + v.priceEffect, 0);
  return (
    <Dialog open onClose={onClose} size="lg" title={L("استلام بضاعة", "Receive goods")} description={`${po.number} · ${L("سجّل اللي وصل فعلًا وبأي سعر", "Record what actually arrived and at what price")}`} footer={
      <Button block size="lg" loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await receivePo(db, po.id, rec, { closeShort });
          toast({ title: L("اتستلم ودخل المخزن", "Received into stock"), tone: "success" });
          onClose();
        } catch (e) {
          toast({ title: String((e as Error).message), tone: "error" });
        } finally {
          setBusy(false);
        }
      }}>{L("استلم", "Receive")}</Button>
    }>
      <ul className="grid gap-2 pb-1">
        {po.lines.map((l, i) => {
          const r = rec[i];
          const v = variance[i];
          const it = inv.itemById.get(l.itemId);
          const remaining = l.qty - l.receivedQty;
          return (
            <li key={l.id} className="grid gap-2 rounded-2xl border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{loc(l.name)}</span>
                <span className="text-[12.5px] text-muted">{L("مطلوب", "ordered")} {remaining} {loc(l.packName)}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input label={L("الكمية الواصلة", "Qty received")} type="number" inputMode="decimal" className="num" value={r.qty} onChange={(e) => setRec(rec.map((x, j) => (j === i ? { ...x, qty: Math.max(0, Number(e.target.value) || 0) } : x)))} />
                <MoneyInput label={L("السعر للعبوة", "Price per pack")} value={r.price} onChange={(price) => setRec(rec.map((x, j) => (j === i ? { ...x, price } : x)))} />
              </div>
              {it?.trackBatches ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input label={L("رقم التشغيلة", "Lot")} value={r.lot ?? ""} onChange={(e) => setRec(rec.map((x, j) => (j === i ? { ...x, lot: e.target.value } : x)))} />
                  <Input label={L("تاريخ الانتهاء", "Expires")} type="date" value={r.expiresOn ?? ""} onChange={(e) => setRec(rec.map((x, j) => (j === i ? { ...x, expiresOn: e.target.value || null } : x)))} />
                </div>
              ) : null}
              {v.qtyDiff || v.priceDiff ? (
                <p className="text-[12.5px]">
                  {v.qtyDiff ? <Badge size="sm" tone="warn" className="me-1.5">{L("فرق كمية", "qty")} {v.qtyDiff > 0 ? "+" : ""}{v.qtyDiff}</Badge> : null}
                  {v.priceDiff ? <Badge size="sm" tone={v.priceDiff > 0 ? "danger" : "ok"}>{L("فرق سعر", "price")} {formatMoney(v.priceDiff, { lang, signed: true })} → {formatMoney(v.priceEffect, { lang, signed: true })}</Badge> : null}
                </p>
              ) : null}
            </li>
          );
        })}
        {effect ? <p className={`text-[13.5px] font-semibold ${effect > 0 ? "text-danger" : "text-ok"}`}>{L("أثر فرق الأسعار", "Price variance effect")}: {formatMoney(effect, { lang, signed: true })}</p> : null}
        <Switch checked={closeShort} onChange={setCloseShort} label={L("اقفل الطلب حتى لو ناقص", "Close the order even if short")} description={L("الباقي مش هييجي", "The rest will not come")} />
      </ul>
    </Dialog>
  );
}

function InvoiceDialog({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [eta, setEta] = useState("");
  const [busy, setBusy] = useState(false);
  const received = po.lines.reduce((a, l) => a + l.receivedValue, 0);
  return (
    <Dialog open onClose={onClose} title={L("فاتورة المورد", "Supplier invoice")} description={L("بتتقيد: مخزون (صافي) + ضريبة مدخلات ١٤٠١ على حساب الموردين ٢١٠١", "Posts: inventory (net) + input VAT 1401 against payables 2101")} footer={
      <Button block size="lg" loading={busy} disabled={!number.trim()} onClick={async () => {
        setBusy(true);
        try {
          const inv = await invoicePo(db, po.id, { number, date, etaUuid: eta || null });
          toast({ title: L("الفاتورة اتسجلت واتقيدت", "Invoice recorded and posted"), description: formatMoney(inv.total, { lang }), tone: "success" });
          onClose();
        } finally {
          setBusy(false);
        }
      }}>{L("سجّل الفاتورة", "Record invoice")}</Button>
    }>
      <div className="grid gap-3 pb-1">
        <p className="text-[14px]">{L("قيمة المستلم (صافي)", "Received value (net)")}: <b><Money value={received} /></b></p>
        <Input label={L("رقم فاتورة المورد", "Supplier invoice no.")} value={number} onChange={(e) => setNumber(e.target.value)} dir="ltr" />
        <Input label={L("التاريخ", "Date")} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <Input label={L("UUID الفاتورة الإلكترونية (لو المورد مسجل)", "E-invoice UUID (if the supplier issues one)")} value={eta} onChange={(e) => setEta(e.target.value)} dir="ltr" />
      </div>
    </Dialog>
  );
}

function PayDialog({ invoiceId, due, onClose }: { invoiceId: string; due: Units; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [amount, setAmount] = useState(due);
  const [method, setMethod] = useState<"bank" | "cash" | "instapay" | "cheque">("bank");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onClose={onClose} title={L("دفع للمورد", "Pay supplier")} description={`${L("المستحق", "Due")} ${formatMoney(due, { lang })}`} footer={
      <Button block size="lg" loading={busy} disabled={amount <= 0 || amount > due} onClick={async () => {
        setBusy(true);
        try {
          await paySupplier(db, { invoiceId, amount, method, reference: ref });
          toast({ title: L("اتدفع", "Paid"), description: formatMoney(amount, { lang }), tone: "success" });
          onClose();
        } finally {
          setBusy(false);
        }
      }}>{L("ادفع", "Pay")} {formatMoney(amount, { lang })}</Button>
    }>
      <div className="grid gap-3 pb-1">
        <MoneyInput label={L("المبلغ", "Amount")} value={amount} onChange={setAmount} />
        <Segmented block label={L("طريقة الدفع", "Method")} value={method} onChange={setMethod} options={[{ value: "bank", label: L("تحويل بنكي", "Bank") }, { value: "cash", label: L("كاش", "Cash") }, { value: "instapay", label: "InstaPay" }, { value: "cheque", label: L("شيك", "Cheque") }]} />
        <Input label={L("مرجع", "Reference")} value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" />
      </div>
    </Dialog>
  );
}
