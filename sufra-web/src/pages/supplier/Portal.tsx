import { useEffect, useMemo, useState } from "react";
import { BarChart3, Boxes, CalendarClock, ClipboardList, Eye, EyeOff, FileText, MessagesSquare, Plus, Receipt, Send, Users } from "lucide-react";
import { useLang } from "@/lib/i18n";
import type { Route } from "@/lib/router";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Photo } from "@/components/sufra/Photo";
import { Modal } from "@/components/sufra/Modal";
import { GroupChat } from "@/components/ui/group-chat";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { BizPage, Card, Field, Money, Pill, RouteTabs, SampleBadge, Segmented, Stat } from "@/components/business/kit";
import { BarChart, Meter } from "@/components/business/charts";
import { UserTable } from "@/components/business/UserTable";
import { statusLabel, statusTone, STATUS_STEPS } from "@/components/business/Marketplace";
import { supplierStatement, type SupplierOrderStatus } from "@/data/business/billing";
import { PAYMENT_COLLECTION_PCT, SUPPLIER_PLANS } from "@/data/business/supplier-plans";
import { CATEGORIES, DAY_NAMES, DEMO_SUPPLIER_ID, PRODUCTS, ZONE_NAMES, productById, supplierById, type SupplyCategory } from "@/data/business/suppliers";
import { addProduct, advanceOrder, editProduct, NEXT_STATUS, orderTotals, sendMessage, updateOrder, useBiz, type PurchaseOrder } from "@/data/business/store";
import { egp } from "@/data/business/plans";

const ME = supplierById[DEMO_SUPPLIER_ID];
const PLAN = SUPPLIER_PLANS.find((p) => p.id === "growth")!;

function useMyOrders() {
  const all = useBiz((s) => s.orders);
  return useMemo(() => all.filter((o) => o.supplierId === DEMO_SUPPLIER_ID).sort((a, b) => b.createdAt - a.createdAt), [all]);
}
const fmtDate = (t: number, lang: "ar" | "en") => new Date(t).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short" });

function Catalogue() {
  const { L, lang } = useLang();
  const edits = useBiz((s) => s.productEdits);
  const extra = useBiz((s) => s.extraProducts);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ ar: "", en: "", category: "produce" as SupplyCategory, price: 100, stock: 50, unitAr: "كيلو", unitEn: "kg", vat: 0 as 0 | 14, minQty: 1 });
  const mine = PRODUCTS.filter((p) => p.supplierId === DEMO_SUPPLIER_ID);
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13.5px] text-muted-foreground">{L(`${mine.length + extra.length} منتج · التعديلات بتظهر للمطاعم على طول`, `${mine.length + extra.length} products · edits show to restaurants instantly`)}</p>
          <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />{L("منتج جديد", "New product")}</button>
        </div>
        <div className="relative overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[720px] text-[14px]">
            <caption className="sr-only">{L("الكتالوج والمخزن", "Catalogue & warehouse")}</caption>
            <thead>
              <tr className="border-b text-[12px] text-muted-foreground">
                <th scope="col" className="p-3 text-start">{L("المنتج", "Product")}</th>
                <th scope="col" className="p-3 text-start">{L("العبوة", "Pack")}</th>
                <th scope="col" className="p-3 text-end">{L("السعر (قبل الضريبة)", "Price (pre-VAT)")}</th>
                <th scope="col" className="p-3 text-center">{L("ضريبة", "VAT")}</th>
                <th scope="col" className="p-3 text-end">{L("المخزون", "Stock")}</th>
                <th scope="col" className="p-3 text-end">{L("أقل طلب", "Min qty")}</th>
                <th scope="col" className="p-3 text-center">{L("ظاهر", "Listed")}</th>
              </tr>
            </thead>
            <tbody>
              {extra.map((p) => (
                <tr key={p.id} className="border-b bg-brass-soft/40">
                  <td className="p-3"><span className="font-semibold">{lang === "ar" ? p.ar : p.en || p.ar}</span> <Pill tone="brass">{L("جديد", "New")}</Pill></td>
                  <td className="p-3 text-muted-foreground">{lang === "ar" ? p.unitAr : p.unitEn}</td>
                  <td className="p-3 text-end"><Money v={p.price} /></td>
                  <td className="num p-3 text-center">{p.vat}%</td>
                  <td className="num p-3 text-end">{p.stock}</td>
                  <td className="num p-3 text-end">{p.minQty}</td>
                  <td className="p-3 text-center">✓</td>
                </tr>
              ))}
              {mine.map((p) => {
                const e = edits[p.id] ?? {};
                const price = e.price ?? p.price;
                const stock = e.stock ?? p.stock;
                const low = stock < 30;
                return (
                  <tr key={p.id} className={cn("border-b last:border-0", e.hidden && "opacity-50")}>
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <Photo k={p.img} label={lang === "ar" ? p.ar : p.en} className="size-10 shrink-0 rounded-lg" />
                        <span className="font-semibold">{lang === "ar" ? p.ar : p.en}</span>
                      </div>
                    </td>
                    <td className="p-3 text-muted-foreground">{lang === "ar" ? p.packAr : p.packEn}</td>
                    <td className="p-3 text-end">
                      <label className="sr-only" htmlFor={`pr-${p.id}`}>{L("السعر", "Price")}</label>
                      <input id={`pr-${p.id}`} type="number" min={0} step={0.5} className="sf-input num h-9 w-24 text-end text-[14px]" dir="ltr" value={price / 100} onChange={(ev) => editProduct(p.id, { price: egp(Math.max(0, Number(ev.target.value) || 0)) })} />
                    </td>
                    <td className="num p-3 text-center">{p.vat ? "14%" : <span className="text-ok">0%</span>}</td>
                    <td className="p-3 text-end">
                      <label className="sr-only" htmlFor={`st-${p.id}`}>{L("المخزون", "Stock")}</label>
                      <input id={`st-${p.id}`} type="number" min={0} className={cn("sf-input num h-9 w-20 text-end text-[14px]", low && "border-warn text-warn")} dir="ltr" value={stock} onChange={(ev) => editProduct(p.id, { stock: Math.max(0, Math.round(Number(ev.target.value) || 0)) })} />
                    </td>
                    <td className="num p-3 text-end">{e.minQty ?? p.minQty}</td>
                    <td className="p-3 text-center">
                      <button type="button" className="grid size-9 place-items-center rounded-full hover:bg-muted" aria-pressed={!e.hidden} aria-label={e.hidden ? L("اظهره للمطاعم", "Show to restaurants") : L("اخفيه", "Hide")} onClick={() => editProduct(p.id, { hidden: !e.hidden })}>
                        {e.hidden ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4 text-primary" aria-hidden />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="grid h-max gap-4">
        <Card>
          <h3 className="flex items-center gap-2 font-sans text-[15px] font-semibold"><CalendarClock className="size-4 text-primary" aria-hidden />{L("التوصيل", "Delivery")}</h3>
          <p className="mt-2 text-[13px] text-muted-foreground">{L("الأيام", "Days")}</p>
          <div className="mt-1 flex flex-wrap gap-1">{DAY_NAMES[lang].map((d, i) => <Pill key={d} tone={ME.days.includes(i) ? "primary" : "muted"}>{d}</Pill>)}</div>
          <p className="mt-3 text-[13px] text-muted-foreground">{L("المناطق", "Areas")}</p>
          <div className="mt-1 flex flex-wrap gap-1">{ME.zones.map((z) => <Pill key={z}>{ZONE_NAMES[z]?.[lang] ?? z}</Pill>)}</div>
          <p className="mt-3 text-[13px]">{L("آخر ميعاد للطلب", "Order cut-off")} <span className="num font-semibold">{ME.cutoff}:00</span> · {L("أقل طلب", "Min order")} <Money v={ME.minOrder} /></p>
        </Card>
        <Card>
          <h3 className="font-sans text-[15px] font-semibold">{L("مخزون قليل", "Low stock")}</h3>
          <ul className="mt-2 grid gap-1.5 text-[13px]">
            {mine.filter((p) => (edits[p.id]?.stock ?? p.stock) < 60).slice(0, 5).map((p) => (
              <li key={p.id} className="flex justify-between gap-2"><span className="truncate">{lang === "ar" ? p.ar : p.en}</span><span className="num text-warn">{edits[p.id]?.stock ?? p.stock}</span></li>
            ))}
          </ul>
        </Card>
      </aside>
      <Modal open={adding} onClose={() => setAdding(false)} title={L("منتج جديد", "New product")} footer={
        <button type="button" className="sf-btn sf-btn-primary w-full" disabled={!form.ar.trim()} onClick={() => { addProduct({ id: `x-${Date.now()}`, ar: form.ar.trim(), en: form.en.trim(), category: form.category, price: egp(form.price), stock: form.stock, unitAr: form.unitAr, unitEn: form.unitEn, vat: form.vat, minQty: form.minQty }); setAdding(false); notify({ title: L("المنتج اتضاف", "Product added"), detail: form.ar, tone: "primary", icon: "check" }); }}>{L("ضيف للكتالوج", "Add to catalogue")}</button>
      }>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={L("الاسم بالعربي", "Arabic name")}><input className="sf-input" value={form.ar} onChange={(e) => setForm({ ...form, ar: e.target.value })} /></Field>
            <Field label={L("الاسم بالإنجليزي", "English name")}><input className="sf-input" dir="ltr" value={form.en} onChange={(e) => setForm({ ...form, en: e.target.value })} /></Field>
          </div>
          <Field label={L("القسم", "Category")}>
            <select className="sf-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as SupplyCategory })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{lang === "ar" ? c.ar : c.en}</option>)}</select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={L("الوحدة", "Unit")}>
              <select className="sf-input" value={form.unitAr} onChange={(e) => { const u = [["كيلو", "kg"], ["كرتونة", "carton"], ["شيكارة 25 كجم", "25 kg sack"], ["جركن 20 لتر", "20 L jerrycan"], ["قطعة", "piece"]].find((x) => x[0] === e.target.value)!; setForm({ ...form, unitAr: u[0], unitEn: u[1] }); }}>
                {[["كيلو", "kg"], ["كرتونة", "carton"], ["شيكارة 25 كجم", "25 kg sack"], ["جركن 20 لتر", "20 L jerrycan"], ["قطعة", "piece"]].map(([a, e]) => <option key={a} value={a}>{lang === "ar" ? a : e}</option>)}
              </select>
            </Field>
            <Field label={L("السعر (ج.م)", "Price (EGP)")}><input type="number" className="sf-input num" dir="ltr" value={form.price} onChange={(e) => setForm({ ...form, price: Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <Field label={L("المخزون", "Stock")}><input type="number" className="sf-input num" dir="ltr" value={form.stock} onChange={(e) => setForm({ ...form, stock: Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <Field label={L("ضريبة", "VAT")}>
              <select className="sf-input" value={form.vat} onChange={(e) => setForm({ ...form, vat: Number(e.target.value) as 0 | 14 })}><option value={0}>{L("معفى 0%", "Exempt 0%")}</option><option value={14}>14%</option></select>
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function OrderCard({ o, onChat }: { o: PurchaseOrder; onChat: () => void }) {
  const { L, lang } = useLang();
  const t = orderTotals(o);
  const next = NEXT_STATUS[o.status];
  const action = { new: L("أكّد الطلب", "Confirm"), confirmed: L("خرج للتوصيل", "Dispatch"), out: L("اتسلّم", "Mark delivered"), delivered: L("طلّع الفاتورة", "Issue invoice") } as Partial<Record<SupplierOrderStatus, string>>;
  return (
    <article className="rounded-[22px] border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="num text-[12px] text-muted-foreground">{o.id} · {fmtDate(o.createdAt, lang)} · {L("توصيل", "deliver")} {fmtDate(o.deliverOn, lang)}</p>
          <h3 className="truncate text-[17px] font-bold">{lang === "ar" ? o.restaurantAr : o.restaurantEn}</h3>
        </div>
        <Pill tone={statusTone(o.status)}>{statusLabel(o.status, L)}</Pill>
      </div>
      <ul className="mt-2 grid gap-0.5 text-[13px]">
        {o.lines.map((l) => {
          const p = productById[l.productId];
          return (
            <li key={l.productId} className="flex justify-between gap-2"><span className="truncate"><span className="num">{l.qty}×</span> {p ? (lang === "ar" ? p.ar : p.en) : l.productId}</span><Money v={l.price * l.qty} /></li>
          );
        })}
      </ul>
      <div className="mt-2 flex justify-between border-t pt-2 text-[14px] font-bold"><span>{L("الإجمالي شامل الضريبة", "Total incl. VAT")}</span><Money v={t.gross} /></div>
      {o.note ? <p className="mt-2 rounded-lg bg-brass-soft px-2 py-1 text-[13px] text-accent-foreground">{o.note}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {next ? <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => { advanceOrder(o.id); notify({ title: `${o.id}: ${statusLabel(next, L)}`, detail: lang === "ar" ? o.restaurantAr : o.restaurantEn, ttl: 2600 }); }}>{action[o.status]}</button> : null}
        <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm" onClick={onChat}><MessagesSquare className="size-4" aria-hidden />{L("شات مع المطعم", "Chat")}{o.messages.length ? <span className="num text-[11px]">({o.messages.length})</span> : null}</button>
        {o.status === "new" ? <HoldToConfirm className="h-9 text-[13px]" label={L("اضغط مطوّل للإلغاء", "Hold to cancel")} confirmLabel={L("اتلغى", "Cancelled")} onConfirm={() => updateOrder(o.id, { status: "cancelled" })} /> : null}
      </div>
    </article>
  );
}

function Orders({ onChat }: { onChat: (id: string) => void }) {
  const { L } = useLang();
  const orders = useMyOrders();
  const [f, setF] = useState<"all" | SupplierOrderStatus>("all");
  const list = orders.filter((o) => f === "all" || o.status === f);
  const count = (s: SupplierOrderStatus) => orders.filter((o) => o.status === s).length;
  return (
    <div className="grid gap-4">
      <Segmented label={L("الحالة", "Status")} value={f} onChange={setF} options={[{ id: "all" as const, label: L("الكل", "All") }, ...STATUS_STEPS.map((s) => ({ id: s, label: statusLabel(s, L), badge: count(s) ? String(count(s)) : undefined })), { id: "cancelled" as const, label: statusLabel("cancelled", L) }]} />
      {list.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map((o) => <OrderCard key={o.id} o={o} onChat={() => onChat(o.id)} />)}</div> : <p className="text-muted-foreground">{L("مفيش طلبات هنا.", "No orders here.")}</p>}
    </div>
  );
}

function Chat({ initial }: { initial?: string }) {
  const { L, lang } = useLang();
  const orders = useMyOrders();
  const [sel, setSel] = useState(initial ?? orders[0]?.id);
  const [msg, setMsg] = useState("");
  const o = orders.find((x) => x.id === sel);
  useEffect(() => { if (initial) setSel(initial); }, [initial]);
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <ul className="grid h-max gap-1.5" aria-label={L("المحادثات", "Conversations")}>
        {orders.filter((x) => x.status !== "cancelled").slice(0, 10).map((x) => (
          <li key={x.id}>
            <button type="button" aria-current={x.id === sel} onClick={() => setSel(x.id)} className={cn("flex w-full items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2 text-start", x.id === sel && "border-primary bg-primary-soft")}>
              <span className="min-w-0"><span className="block truncate font-semibold">{lang === "ar" ? x.restaurantAr : x.restaurantEn}</span><span className="num text-[12px] text-muted-foreground">{x.id}</span></span>
              {x.messages.length ? <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">{x.messages.length}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {o ? (
        <GroupChat
          channel={o.id}
          members={[o.restaurantId, ME.id]}
          messages={o.messages.length ? o.messages.map((m) => ({ name: m.from === "supplier" ? (lang === "ar" ? ME.ar : ME.en) : lang === "ar" ? o.restaurantAr : o.restaurantEn, text: m.text, time: new Date(m.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) })) : [{ name: lang === "ar" ? o.restaurantAr : o.restaurantEn, text: L("(لسه مفيش رسايل على الطلب ده)", "(No messages on this order yet)") }]}
        >
          <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); if (!msg.trim()) return; sendMessage(o.id, { from: "supplier", name: ME.ar, text: msg.trim() }); setMsg(""); }}>
            <input className="sf-input h-11" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={L("اكتب للمطعم…", "Message the restaurant…")} aria-label={L("رسالة", "Message")} />
            <button className="sf-btn sf-btn-primary h-11 px-4" aria-label={L("ابعت", "Send")}><Send className="size-4 rtl:-scale-x-100" aria-hidden /></button>
          </form>
        </GroupChat>
      ) : null}
    </div>
  );
}

function Invoices() {
  const { L, lang } = useLang();
  const orders = useMyOrders().filter((o) => o.status === "invoiced" || o.status === "delivered");
  const [open, setOpen] = useState<PurchaseOrder | null>(null);
  const eTone = { none: "muted", pending: "warn", submitted: "primary", valid: "ok", rejected: "danger" } as const;
  const eLabel = { none: L("لسه", "Not issued"), pending: L("مستنية", "Pending"), submitted: L("اتبعتت", "Submitted"), valid: L("مقبولة", "Valid"), rejected: L("مرفوضة", "Rejected") };
  return (
    <>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[640px] text-[14px]">
          <caption className="sr-only">{L("الفواتير", "Invoices")}</caption>
          <thead><tr className="border-b text-[12px] text-muted-foreground"><th scope="col" className="p-3 text-start">{L("الفاتورة", "Invoice")}</th><th scope="col" className="p-3 text-start">{L("المطعم", "Restaurant")}</th><th scope="col" className="p-3 text-end">{L("الإجمالي", "Total")}</th><th scope="col" className="p-3 text-end">{L("عمولة سُفرة", "Sufra commission")}</th><th scope="col" className="p-3 text-center">{L("فاتورة إلكترونية (B2B · i)", "E-invoice (B2B · i)")}</th><th scope="col" className="p-3" /></tr></thead>
          <tbody>
            {orders.map((o) => {
              const t = orderTotals(o);
              const c = supplierStatement(PLAN.id, [{ id: o.id, net: t.net, status: "delivered" }]).commission;
              return (
                <tr key={o.id} className="border-b last:border-0">
                  <td className="num p-3 font-semibold">INV-{o.id.slice(3)}</td>
                  <td className="p-3">{lang === "ar" ? o.restaurantAr : o.restaurantEn}</td>
                  <td className="p-3 text-end"><Money v={t.gross} /></td>
                  <td className="p-3 text-end text-muted-foreground"><Money v={-c} /></td>
                  <td className="p-3 text-center"><Pill tone={eTone[o.einvoice]}>{eLabel[o.einvoice]}</Pill></td>
                  <td className="p-3 text-end"><button type="button" className="sf-btn sf-btn-ghost sf-btn-sm" onClick={() => setOpen(o)}>{L("عرض", "View")}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `INV-${open.id.slice(3)}` : ""}>
        {open ? (() => {
          const t = orderTotals(open);
          const c = supplierStatement(PLAN.id, [{ id: open.id, net: t.net, status: "delivered", collectedBySufra: open.collectedBySufra }]);
          return (
            <div className="grid gap-3 text-[14px]">
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-2 p-3 text-[13px]">
                <div><p className="text-muted-foreground">{L("البائع", "Issuer")}</p><p className="font-semibold">{lang === "ar" ? ME.ar : ME.en}</p><p className="num" dir="ltr">RIN {ME.tax}</p></div>
                <div><p className="text-muted-foreground">{L("المشتري", "Receiver")}</p><p className="font-semibold">{lang === "ar" ? open.restaurantAr : open.restaurantEn}</p><p className="num" dir="ltr">RIN {open.restaurantTax}</p></div>
              </div>
              <ul className="grid gap-1">
                {open.lines.map((l) => <li key={l.productId} className="flex justify-between gap-2"><span>{l.qty}× {lang === "ar" ? productById[l.productId]?.ar : productById[l.productId]?.en} <span className="text-[11px] text-muted-foreground">({l.vat}%)</span></span><Money v={l.price * l.qty} /></li>)}
              </ul>
              <div className="grid gap-1 border-t pt-2">
                <div className="flex justify-between"><span className="text-muted-foreground">{L("قبل الضريبة", "Net")}</span><Money v={t.net} /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{L("ضريبة (T1)", "VAT (T1)")}</span><Money v={t.vat} /></div>
                <div className="flex justify-between font-bold"><span>{L("الإجمالي", "Total")}</span><Money v={t.gross} /></div>
              </div>
              <div className="grid gap-1 rounded-xl border border-dashed p-3 text-[13px]">
                <p className="font-semibold">{L("خصومات سُفرة (فاتورة منفصلة من سُفرة للمورّد)", "Sufra deductions (separate Sufra → supplier invoice)")}</p>
                <div className="flex justify-between"><span className="text-muted-foreground">{L(`عمولة ${PLAN.commissionPct}%`, `Commission ${PLAN.commissionPct}%`)}</span><Money v={-c.commission} /></div>
                {c.collection ? <div className="flex justify-between"><span className="text-muted-foreground">{L(`تحصيل ${PAYMENT_COLLECTION_PCT}%`, `Collection ${PAYMENT_COLLECTION_PCT}%`)}</span><Money v={-c.collection} /></div> : null}
              </div>
              <p className="text-[12px] text-muted-foreground">{L("فاتورة إلكترونية B2B نوع (i) — UUID بيتولّد من محتوى الفاتورة وتتبعت لمنظومة مصلحة الضرايب.", "B2B e-invoice type (i) — UUID derived from the document, submitted to the ETA.")}</p>
              {open.einvoice !== "valid" ? <button type="button" className="sf-btn sf-btn-primary" onClick={() => { updateOrder(open.id, { einvoice: "submitted" }); setTimeout(() => updateOrder(open.id, { einvoice: "valid" }), 2000); setOpen(null); notify({ title: L("الفاتورة اتبعتت للمنظومة", "Invoice submitted to the ETA"), tone: "primary" }); }}><Receipt className="size-4" aria-hidden />{L("ابعت الفاتورة الإلكترونية", "Submit e-invoice")}</button> : null}
            </div>
          );
        })() : null}
      </Modal>
    </>
  );
}

function Statement() {
  const { L, lang } = useLang();
  const orders = useMyOrders();
  const s = supplierStatement(PLAN.id, orders.map((o) => ({ id: o.id, net: orderTotals(o).net, status: o.status, collectedBySufra: o.collectedBySufra })));
  const month = new Date().toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { month: "long", year: "numeric" });
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <h3 className="font-sans text-[16px] font-bold">{L("كشف حساب", "Statement")} · {month}</h3>
          <Pill tone="primary">{L("باقة", "Plan")} {lang === "ar" ? PLAN.ar : PLAN.en} · {PLAN.commissionPct}%</Pill>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[460px] text-[14px]">
            <caption className="sr-only">{L("سطور العمولة", "Commission lines")}</caption>
            <thead><tr className="border-b text-[12px] text-muted-foreground"><th scope="col" className="p-3 text-start">{L("الطلب", "Order")}</th><th scope="col" className="p-3 text-end">{L("قيمة مسلّمة", "Delivered value")}</th><th scope="col" className="p-3 text-end">{L("عمولة", "Commission")}</th><th scope="col" className="p-3 text-end">{L("تحصيل", "Collection")}</th></tr></thead>
            <tbody>
              {s.lines.map((l) => <tr key={l.id} className="border-b"><td className="num p-3">{l.id}</td><td className="p-3 text-end"><Money v={l.base} /></td><td className="p-3 text-end"><Money v={l.commission} /></td><td className="p-3 text-end">{l.collection ? <Money v={l.collection} /> : "—"}</td></tr>)}
            </tbody>
          </table>
        </div>
        <p className="p-3 text-[12px] text-muted-foreground">{L("الطلبات الجديدة والملغية مش بتدخل في العمولة.", "New and cancelled orders are not charged.")}</p>
      </Card>
      <Card className="h-max">
        <dl className="grid gap-2 text-[14px]">
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("مبيعات مسلّمة", "Delivered sales")}</dt><dd><Money v={s.gmv} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("اشتراك شهري", "Subscription")}</dt><dd><Money v={s.subscription} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("عمولات", "Commissions")}</dt><dd><Money v={s.commission} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("رسوم التحصيل", "Collection fees")}</dt><dd><Money v={s.collection} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("ضريبة 14% على الرسوم", "14% VAT on fees")}</dt><dd><Money v={s.feesVat} /></dd></div>
          <div className="flex justify-between border-t pt-2 font-bold"><dt>{L("رسوم سُفرة", "Sufra fees")}</dt><dd><Money v={s.feesGross} /></dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">{L("اتحصّل عن طريق سُفرة", "Collected by Sufra")}</dt><dd><Money v={s.collected} /></dd></div>
          <div className={cn("flex justify-between rounded-xl px-3 py-2 font-bold", s.payout >= 0 ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn")}><dt>{s.payout >= 0 ? L("هيتحوّلك", "Payout to you") : L("مستحق لسُفرة", "Due to Sufra")}</dt><dd><Money v={Math.abs(s.payout)} /></dd></div>
        </dl>
      </Card>
    </div>
  );
}

function Customers() {
  const { L, lang } = useLang();
  const orders = useMyOrders();
  const rows = useMemo(() => {
    const m = new Map<string, { id: string; ar: string; en: string; n: number; total: number; last: number }>();
    for (const o of orders) {
      const r = m.get(o.restaurantId) ?? { id: o.restaurantId, ar: o.restaurantAr, en: o.restaurantEn, n: 0, total: 0, last: 0 };
      r.n++;
      if (o.status !== "cancelled") r.total += orderTotals(o).gross;
      r.last = Math.max(r.last, o.createdAt);
      m.set(o.restaurantId, r);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [orders]);
  return (
    <UserTable
      caption={L("عملاء المورّد", "Supplier customers")}
      headers={{ user: L("المطعم", "Restaurant"), role: L("الطلبات", "Orders"), status: L("الحالة", "Status"), lastSeen: L("آخر طلب", "Last order") }}
      extraHeader={L("إجمالي المشتريات", "Total bought")}
      users={rows.map((r, i) => ({ id: r.id, name: lang === "ar" ? r.ar : r.en, role: `${r.n} ${L("طلب", "orders")}`, status: i === 0 ? { label: L("أكبر عميل", "Top customer"), tone: "primary" } : Date.now() - r.last < 3 * 86400000 ? { label: L("نشط", "Active"), tone: "ok" } : { label: L("هادي", "Quiet"), tone: "muted" }, lastSeen: fmtDate(r.last, lang), extra: <Money v={r.total} className="font-semibold" /> }))}
    />
  );
}

function Analytics() {
  const { L, lang } = useLang();
  const orders = useMyOrders();
  const days = useMemo(() => {
    const out: { key: string; label: string; value: number; tip: string }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      const real = orders.filter((o) => o.status !== "cancelled" && new Date(o.createdAt).toISOString().slice(0, 10) === key).reduce((s, o) => s + orderTotals(o).net, 0);
      const base = egp(Math.round(6000 + 4000 * Math.sin(i * 0.9) ** 2 + (d.getDay() === 4 ? 5000 : 0)));
      const v = real + base;
      out.push({ key, label: key, value: v, tip: `${fmtDate(d.getTime(), lang)} · ${(v / 100).toLocaleString("en-US")} ${L("ج.م", "EGP")}` });
    }
    return out;
  }, [orders, lang, L]);
  const total = days.reduce((s, d) => s + d.value, 0);
  const prodAgg = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) if (o.status !== "cancelled") for (const l of o.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.price * l.qty);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [orders]);
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-4"><Stat label={L("مبيعات 30 يوم", "30-day sales")} value={<Money v={total} />} /></Card>
        <Card className="p-4"><Stat label={L("طلبات", "Orders")} value={<span className="num">{orders.filter((o) => o.status !== "cancelled").length + 112}</span>} /></Card>
        <Card className="p-4"><Stat label={L("متوسط التقييم", "Avg rating")} value={<span className="num">{ME.rating.toFixed(1)}</span>} sub={`${ME.ratings} ${L("تقييم", "ratings")}`} /></Card>
        <Card className="p-4"><Stat label={L("نسبة التسليم في المعاد", "On-time delivery")} value={<span className="num">96%</span>} tone="ok" sub={L("آخر 30 يوم", "last 30 days")} /></Card>
      </div>
      <Card>
        <h3 className="mb-3 font-sans text-[15px] font-semibold">{L("المبيعات اليومية (قبل الضريبة)", "Daily sales (pre-VAT)")}</h3>
        <BarChart data={days} height={180} highlightLast ariaLabel={L("المبيعات اليومية", "Daily sales")} axis={{ first: fmtDate(Date.now() - 29 * 86400000, lang), last: fmtDate(Date.now(), lang) }} />
      </Card>
      <Card>
        <h3 className="mb-3 font-sans text-[15px] font-semibold">{L("أكتر منتجات بتتباع", "Top products")}</h3>
        <ul className="grid gap-2.5">
          {prodAgg.map(([id, v]) => (
            <li key={id} className="grid gap-1">
              <div className="flex justify-between gap-2 text-[14px]"><span>{lang === "ar" ? productById[id]?.ar : productById[id]?.en}</span><Money v={v} className="font-semibold" /></div>
              <Meter value={v} max={prodAgg[0][1]} label={productById[id]?.en ?? id} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function Portal({ route }: { route: Route }) {
  const { L, lang } = useLang();
  const tab = route.query.get("tab") ?? "orders";
  const [chatWith, setChatWith] = useState<string | undefined>(route.query.get("order") ?? undefined);
  const orders = useMyOrders();
  const newCount = orders.filter((o) => o.status === "new").length;
  const tabs = [
    { id: "orders", label: L(`الطلبات${newCount ? ` (${newCount})` : ""}`, `Orders${newCount ? ` (${newCount})` : ""}`), icon: <ClipboardList className="size-4" aria-hidden /> },
    { id: "catalogue", label: L("الكتالوج والمخزن", "Catalogue & stock"), icon: <Boxes className="size-4" aria-hidden /> },
    { id: "chat", label: L("الشات", "Chat"), icon: <MessagesSquare className="size-4" aria-hidden /> },
    { id: "invoices", label: L("الفواتير", "Invoices"), icon: <FileText className="size-4" aria-hidden /> },
    { id: "statement", label: L("كشف الحساب", "Statement"), icon: <Receipt className="size-4" aria-hidden /> },
    { id: "customers", label: L("العملاء", "Customers"), icon: <Users className="size-4" aria-hidden /> },
    { id: "analytics", label: L("التحليلات", "Analytics"), icon: <BarChart3 className="size-4" aria-hidden /> },
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : "orders";
  return (
    <BizPage kind="suppliers" path={route.path} cta={{ href: "#/suppliers?s=pricing", label: L("الباقات", "Plans") }}>
      <div className="wrap gutter py-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Photo k={ME.img} label={ME.ar} className="size-12 shrink-0 rounded-2xl" />
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">{L("بوابة المورّد", "Supplier portal")}</p>
              <h1 className="truncate text-[24px] font-bold sm:text-[32px]">{lang === "ar" ? ME.ar : ME.en}</h1>
            </div>
          </div>
          <SampleBadge />
        </div>
        <div className="mt-5"><RouteTabs base="/suppliers/portal" tabs={tabs} active={active} label={L("أقسام البوابة", "Portal sections")} /></div>
        <div className="mt-6">
          {active === "orders" ? <Orders onChat={(id) => { setChatWith(id); location.hash = `#/suppliers/portal?tab=chat&order=${id}`; }} /> : active === "catalogue" ? <Catalogue /> : active === "chat" ? <Chat initial={chatWith} /> : active === "invoices" ? <Invoices /> : active === "statement" ? <Statement /> : active === "customers" ? <Customers /> : <Analytics />}
        </div>
      </div>
    </BizPage>
  );
}


