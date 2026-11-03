import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Phone, Plus, Star, Store, Truck } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Supplier } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { dayLabel } from "@/lib/time";
import { Badge, Button, Dialog, EmptyState, Input, Money, Table, Tabs, type Column } from "@/ui";
import { LocalizedInput } from "@/modules/marketing/ui";
import { PoBadge, pct } from "./bits";
import { supplierBalances, waLink } from "./purchasing";
import { supplierPerformance } from "./reports";
import { useInventory } from "./useInventory";

export default function SuppliersPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const inv = useInventory();
  const invoices = useLive("supplierInvoices").data;
  const pos = useLive("purchaseOrders").data;
  const balances = useMemo(() => supplierBalances(invoices), [invoices]);
  const perf = useMemo(() => new Map(supplierPerformance(inv.suppliers, pos, inv.offers).map((p) => [p.supplierId, p])), [inv, pos]);
  const [open, setOpen] = useState<Supplier | null>(null);
  const [add, setAdd] = useState(false);
  const cols: Column<Supplier>[] = [
    {
      key: "n", header: L("المورد", "Supplier"), cell: (s) => (
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate font-semibold">{loc(s.name)}{s.marketplaceId ? <Store className="size-4 shrink-0 text-brass" aria-label={L("على سوق سُفرة", "on the Sufra marketplace")} /> : null}</p>
          <p className="truncate text-[12px] text-muted">{s.contactName} · <span dir="ltr">{s.phone}</span></p>
        </div>
      ),
    },
    { key: "t", header: L("آجل", "Terms"), hideOnMobile: true, cell: (s) => <span className="text-[13px]">{s.termsDays ? `${s.termsDays} ${L("يوم", "days")}` : L("كاش", "Cash")}</span> },
    { key: "o", header: L("في الميعاد", "On time"), align: "end", hideOnMobile: true, cell: (s) => { const p = perf.get(s.id); return p?.delivered ? <Badge size="sm" tone={p.onTimeBp >= 9000 ? "ok" : p.onTimeBp >= 7000 ? "warn" : "danger"}>{pct(p.onTimeBp, lang, 0)}</Badge> : "—"; } },
    { key: "pr", header: L("تغيّر الأسعار", "Price change"), align: "end", hideOnMobile: true, cell: (s) => { const p = perf.get(s.id); return p && p.priceChangeBp ? <span className={`num text-[13px] ${p.priceChangeBp > 0 ? "text-danger" : "text-ok"}`}>{p.priceChangeBp > 0 ? "+" : ""}{pct(p.priceChangeBp, lang)}</span> : <span className="text-muted">—</span>; } },
    { key: "b", header: L("ليه عندنا", "We owe"), align: "end", cell: (s) => { const b = balances.get(s.id); return b ? <span className="grid justify-items-end"><Money value={b.owed} whole className="font-semibold" />{b.overdue ? <span className="text-[11.5px] text-danger">{L("متأخر", "overdue")} {formatMoney(b.overdue, { lang, whole: true })}</span> : null}</span> : <span className="text-muted">—</span>; } },
    {
      key: "c", header: "", align: "end", cell: (s) => (
        <span className="flex justify-end gap-1">
          <a className="grid size-10 place-items-center rounded-xl text-primary hover:bg-primary-soft" href={`tel:${s.phone}`} aria-label={L("اتصال", "Call")} onClick={(e) => e.stopPropagation()}><Phone className="size-4" /></a>
          {s.whatsapp ? <a className="grid size-10 place-items-center rounded-xl text-ok hover:bg-ok-soft" href={waLink(s.whatsapp, L("السلام عليكم", "Hello"))} target="_blank" rel="noreferrer" aria-label="WhatsApp" onClick={(e) => e.stopPropagation()}><MessageCircle className="size-4" /></a> : null}
        </span>
      ),
    },
  ];
  const owed = [...balances.values()].reduce((a, b) => a + b.owed, 0);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px]">{L("إجمالي المستحق للموردين", "Total owed to suppliers")}: <b><Money value={owed} whole /></b></p>
        {can("purchasing.manage") ? <Button icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>{L("مورد جديد", "New supplier")}</Button> : null}
      </div>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table columns={cols} rows={inv.suppliers} rowKey={(s) => s.id} onRowClick={setOpen} caption={L("الموردين", "Suppliers")} empty={<EmptyState compact icon={<Truck />} title={L("مفيش موردين", "No suppliers")} />} />
      </div>
      {open ? <SupplierSheet supplier={open} onClose={() => setOpen(null)} /> : null}
      <AddSupplierDialog open={add} onClose={() => setAdd(false)} />
    </div>
  );
}

function SupplierSheet({ supplier: s, onClose }: { supplier: Supplier; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const nav = useNavigate();
  const inv = useInventory();
  const [tab, setTab] = useState<"prices" | "orders" | "invoices">("prices");
  const offers = inv.offers.filter((o) => o.supplierId === s.id);
  const pos = useLive("purchaseOrders", { where: { supplierId: s.id }, orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const invoices = useLive("supplierInvoices", { where: { supplierId: s.id }, orderBy: [{ field: "date", dir: "desc" }] }).data;
  const payments = useLive("supplierPayments", { where: { supplierId: s.id }, orderBy: [{ field: "paidAt", dir: "desc" }] }).data;
  return (
    <Dialog open onClose={onClose} size="lg" variant="sheet-end" title={loc(s.name)} description={`${loc(s.area)} · ${s.termsDays ? `${L("آجل", "terms")} ${s.termsDays} ${L("يوم", "days")}` : L("كاش", "cash")} · ${L("توريد خلال", "lead")} ${s.leadDays} ${L("يوم", "d")}`}>
      <div className="grid gap-4 pb-2">
        <div className="flex flex-wrap gap-2">
          <a className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 font-semibold hover:bg-surface-2" href={`tel:${s.phone}`}><Phone className="size-4" />{L("اتصال", "Call")}</a>
          {s.whatsapp ? <a className="inline-flex h-11 items-center gap-2 rounded-xl bg-ok px-4 font-semibold text-white" href={waLink(s.whatsapp, L("السلام عليكم", "Hello"))} target="_blank" rel="noreferrer"><MessageCircle className="size-4" />WhatsApp</a> : null}
          {s.marketplaceId ? <Button variant="brass" icon={<Store className="size-4" />} onClick={() => nav(`/inventory/marketplace?supplier=${s.marketplaceId}`)}>{L("كتالوجه على سوق سُفرة", "Their Sufra catalogue")}</Button> : null}
        </div>
        <Tabs label={L("أقسام المورد", "Supplier sections")} value={tab} onChange={setTab} items={[{ value: "prices", label: L("الأسعار", "Prices"), count: offers.length }, { value: "orders", label: L("الطلبات", "Orders"), count: pos.length }, { value: "invoices", label: L("الفواتير والدفع", "Invoices & payments") }]} />
        {tab === "prices" ? (
          <ul className="grid gap-1.5">
            {offers.map((o) => {
              const it = inv.itemById.get(o.itemId);
              const prev = o.history.length > 1 ? o.history[o.history.length - 2].price : null;
              return (
                <li key={o.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[14px]">
                  <span className="min-w-0 flex-1 truncate">{loc(it?.name)} {it?.preferredSupplierId === s.id ? <Star className="inline size-3.5 fill-brass text-brass" /> : null}<span className="ms-1.5 text-[12px] text-muted">{loc(o.packName)}</span></span>
                  {prev ? <span className={`num text-[12px] ${o.price > prev ? "text-danger" : "text-ok"}`}>{o.price > prev ? "▲" : "▼"} {formatMoney(prev, { lang, whole: true })}</span> : null}
                  <Money value={o.price} className="font-semibold" />
                </li>
              );
            })}
          </ul>
        ) : null}
        {tab === "orders" ? (
          <ul className="grid gap-1.5">
            {pos.map((p) => (
              <li key={p.id}><button type="button" onClick={() => nav(`/inventory/purchasing?po=${p.id}`)} className="flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-start text-[14px] hover:bg-surface-3">
                <span className="num font-semibold" dir="ltr">{p.number}</span><span className="flex-1 text-[12.5px] text-muted">{dayLabel(p.createdAt, lang)}</span><PoBadge status={p.status} /><Money value={p.total} whole />
              </button></li>
            ))}
          </ul>
        ) : null}
        {tab === "invoices" ? (
          <div className="grid gap-3">
            <ul className="grid gap-1.5">
              {invoices.map((i) => (
                <li key={i.id} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-[14px]">
                  <span className="num font-semibold" dir="ltr">{i.number}</span>
                  <span className="flex-1 text-[12.5px] text-muted">{i.date} → {i.dueDate}</span>
                  <Badge size="sm" tone={i.status === "paid" ? "ok" : i.dueDate < new Date().toISOString().slice(0, 10) ? "danger" : "warn"}>{i.status === "paid" ? L("مدفوعة", "paid") : i.status === "partial" ? L("جزئي", "partial") : L("مفتوحة", "open")}</Badge>
                  <Money value={i.total} whole />
                </li>
              ))}
            </ul>
            <p className="text-[13px] font-semibold text-ink-2">{L("المدفوعات", "Payments")}</p>
            <ul className="grid gap-1.5">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between rounded-xl bg-surface-2 px-3 py-2 text-[14px]"><span>{dayLabel(p.paidAt, lang)} · {p.method}</span><Money value={p.amount} whole /></li>
              ))}
              {!payments.length ? <li className="text-[13px] text-muted">—</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function AddSupplierDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const [name, setName] = useState({ ar: "", en: "" });
  const [phone, setPhone] = useState("");
  const [contact, setContact] = useState("");
  const [terms, setTerms] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onClose={onClose} title={L("مورد جديد", "New supplier")} footer={
      <Button block size="lg" loading={busy} disabled={!(name.ar || name.en) || !phone} onClick={async () => {
        setBusy(true);
        try {
          await db.insert("suppliers", {
            name: { ar: name.ar || name.en, en: name.en || name.ar }, contactName: contact, phone, whatsapp: phone, email: null, taxId: "", categories: [], area: { ar: "", en: "" }, termsDays: terms, leadDays: 1,
            days: [0, 1, 2, 3, 4, 5, 6], minOrder: 0, deliveryFee: 0, marketplaceId: null, eInvoice: false, rating: 0, active: true, note: "",
          });
          onClose();
        } finally {
          setBusy(false);
        }
      }}>{L("احفظ", "Save")}</Button>
    }>
      <div className="grid gap-3 pb-1">
        <LocalizedInput label={L("الاسم", "Name")} value={name} onChange={setName} />
        <Input label={L("المسؤول", "Contact")} value={contact} onChange={(e) => setContact(e.target.value)} />
        <Input label={L("الموبايل / واتساب", "Mobile / WhatsApp")} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Input label={L("أيام الآجل", "Credit days")} type="number" className="num" value={terms} onChange={(e) => setTerms(Math.max(0, Number(e.target.value) || 0))} />
      </div>
    </Dialog>
  );
}
