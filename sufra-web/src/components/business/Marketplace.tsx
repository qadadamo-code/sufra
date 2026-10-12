/**
 * Restaurant purchasing marketplace ("اطلب من الموردين"): browse suppliers by category, compare prices for the same
 * item, cart per supplier, place an order, track it, receive goods (feeds inventory conceptually) and rate the supplier.
 */
import { useMemo, useState } from "react";
import { BadgeCheck, Beef, Carrot, CookingPot, CupSoda, Fish, Milk, Minus, Package, Phone, Plus, Search, ShoppingCart, SprayCan, Star, Truck, Wheat, MessageCircle, FileCheck2 } from "lucide-react";
import { Photo } from "@/components/sufra/Photo";
import { Modal } from "@/components/sufra/Modal";
import { LoadingButton } from "@/components/ui/loading-button";
import { TaskSteps } from "@/components/ui/task-steps";
import { useLang } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { CATEGORIES, DAY_NAMES, PRODUCTS, SUPPLIERS, ZONE_NAMES, offersFor, productById, supplierById, type Product, type Supplier, type SupplyCategory } from "@/data/business/suppliers";
import { DEMO_RESTAURANT, orderTotals, placeOrder, sendMessage, setCartQty, updateOrder, useBiz, type PurchaseOrder } from "@/data/business/store";
import { Money, Pill, Segmented } from "./kit";

const ICONS = { produce: Carrot, meat: Beef, fish: Fish, dairy: Milk, dry: Wheat, drinks: CupSoda, packaging: Package, cleaning: SprayCan, equipment: CookingPot } satisfies Record<SupplyCategory, typeof Carrot>;

export const STATUS_STEPS = ["new", "confirmed", "out", "delivered", "invoiced"] as const;
export function statusLabel(s: string, L: (a: string, e: string) => string) {
  return (
    {
      new: L("جديد", "New"),
      confirmed: L("اتأكد", "Confirmed"),
      out: L("خرج للتوصيل", "Out for delivery"),
      delivered: L("اتسلّم", "Delivered"),
      invoiced: L("اتفوتر", "Invoiced"),
      cancelled: L("ملغي", "Cancelled"),
    } as Record<string, string>
  )[s];
}
export function statusTone(s: string): "muted" | "primary" | "brass" | "ok" | "danger" | "warn" {
  return s === "new" ? "brass" : s === "confirmed" ? "primary" : s === "out" ? "warn" : s === "delivered" || s === "invoiced" ? "ok" : "danger";
}

function Stars({ value, onRate, label }: { value: number; onRate?: (n: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role={onRate ? "radiogroup" : undefined} aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) =>
        onRate ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}`} onClick={() => onRate(n)} className="p-0.5">
            <Star className={cn("size-5", n <= value ? "fill-brass text-brass" : "text-muted-foreground")} aria-hidden />
          </button>
        ) : (
          <Star key={n} className={cn("size-3.5", n <= Math.round(value) ? "fill-brass text-brass" : "text-muted-foreground/40")} aria-hidden />
        ),
      )}
    </span>
  );
}

function Qty({ p }: { p: Product }) {
  const { L, lang } = useLang();
  const qty = useBiz((s) => s.cart[p.supplierId]?.[p.id] ?? 0);
  const step = p.minQty > 1 ? p.minQty : 1;
  if (!qty)
    return (
      <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => setCartQty(p.supplierId, p.id, p.minQty)} aria-label={L(`ضيف ${p.ar}`, `Add ${p.en}`)}>
        <Plus className="size-4" aria-hidden />
        {L("أضف", "Add")}
      </button>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-card p-0.5">
      <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-muted" aria-label={L("قلّل", "Decrease")} onClick={() => setCartQty(p.supplierId, p.id, qty - step < p.minQty ? 0 : qty - step)}>
        <Minus className="size-4" aria-hidden />
      </button>
      <span className="num min-w-8 text-center font-semibold" aria-live="polite">
        {qty}
        <span className="sr-only"> {lang === "ar" ? p.unit.ar : p.unit.en}</span>
      </span>
      <button type="button" className="grid size-8 place-items-center rounded-full hover:bg-muted" aria-label={L("زوّد", "Increase")} onClick={() => setCartQty(p.supplierId, p.id, qty + step)}>
        <Plus className="size-4" aria-hidden />
      </button>
    </span>
  );
}

function ProductRow({ p, showSupplier }: { p: Product; showSupplier?: boolean }) {
  const { L, lang } = useLang();
  const s = supplierById[p.supplierId];
  return (
    <li className="flex items-center gap-3 rounded-2xl border bg-card p-2.5">
      <Photo k={p.img} label={lang === "ar" ? p.ar : p.en} className="size-14 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{lang === "ar" ? p.ar : p.en}</p>
        <p className="truncate text-[12.5px] text-muted-foreground">
          {lang === "ar" ? p.packAr : p.packEn}
          {showSupplier ? ` · ${lang === "ar" ? s.ar : s.en}` : ""}
        </p>
        <p className="text-[13px]">
          <Money v={p.price} className="font-bold" /> <span className="text-muted-foreground">/ {lang === "ar" ? p.unit.ar : p.unit.en}</span>
          {p.vat ? <span className="ms-1 text-[11px] text-muted-foreground">{L("+ ضريبة 14%", "+14% VAT")}</span> : <span className="ms-1 text-[11px] text-ok">{L("معفى", "VAT-exempt")}</span>}
        </p>
      </div>
      <div className="grid shrink-0 justify-items-end gap-1">
        <Qty p={p} />
        {p.minQty > 1 ? <span className="text-[11px] text-muted-foreground">{L(`أقل كمية ${p.minQty}`, `Min ${p.minQty}`)}</span> : null}
      </div>
    </li>
  );
}

function SupplierCard({ s, onOpen }: { s: Supplier; onOpen: () => void }) {
  const { L, lang } = useLang();
  const count = PRODUCTS.filter((p) => p.supplierId === s.id).length;
  return (
    <article className={cn("group flex flex-col overflow-hidden rounded-[22px] border bg-card transition-shadow hover:shadow-sf", s.featured && "ring-1 ring-brass/60")}>
      <button type="button" onClick={onOpen} className="text-start">
        <div className="relative">
          <Photo k={s.img} label={lang === "ar" ? s.ar : s.en} className="aspect-[16/9]" />
          <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
            {s.featured ? <Pill tone="brass" className="bg-brass text-brass-ink">{L("مورّد مميز", "Featured")}</Pill> : null}
            {s.verified ? <Pill tone="primary" className="bg-card/90"><BadgeCheck className="size-3" aria-hidden />{L("موثّق", "Verified")}</Pill> : null}
          </div>
        </div>
        <div className="p-3.5">
          <h3 className="truncate text-[17px] font-bold">{lang === "ar" ? s.ar : s.en}</h3>
          <p className="truncate text-[13px] text-muted-foreground">{s.categories.map((c) => CATEGORIES.find((x) => x.id === c)![lang]).join(" · ")} · {lang === "ar" ? s.areaAr : s.areaEn}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <span className="inline-flex items-center gap-1"><Star className="size-3.5 fill-brass text-brass" aria-hidden /><span className="num font-semibold">{s.rating.toFixed(1)}</span><span className="text-muted-foreground">({s.ratings})</span></span>
            <span className="text-muted-foreground">{count} {L("منتج", "products")}</span>
            <span className="text-muted-foreground">{L("أقل طلب", "Min")} <Money v={s.minOrder} /></span>
          </div>
        </div>
      </button>
    </article>
  );
}

function SupplierSheet({ s, onClose }: { s: Supplier | null; onClose: () => void }) {
  const { L, lang } = useLang();
  const [cat, setCat] = useState<SupplyCategory | "all">("all");
  if (!s) return <Modal open={false} onClose={onClose} title="">{null}</Modal>;
  const items = PRODUCTS.filter((p) => p.supplierId === s.id && (cat === "all" || p.category === cat));
  return (
    <Modal open={!!s} onClose={onClose} title={lang === "ar" ? s.ar : s.en} className="sm:max-w-2xl" footer={<CartSummary supplierId={s.id} compact />}>
      <p className="text-[14px] text-muted-foreground">{lang === "ar" ? s.descAr : s.descEn}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-4">
        <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted-foreground">{L("أيام التوصيل", "Delivery days")}</dt><dd className="font-semibold">{s.days.map((d) => DAY_NAMES[lang][d]).join("، ")}</dd></div>
        <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted-foreground">{L("اطلب قبل", "Order before")}</dt><dd className="num font-semibold">{s.cutoff}:00</dd></div>
        <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted-foreground">{L("التوصيل", "Delivery")}</dt><dd className="font-semibold">{s.deliveryFee ? <Money v={s.deliveryFee} /> : L("مجاني", "Free")}</dd></div>
        <div className="rounded-xl bg-surface-2 p-2"><dt className="text-muted-foreground">{L("فاتورة إلكترونية", "E-invoice")}</dt><dd className="font-semibold">{s.eInvoice ? L("أيوه (B2B)", "Yes (B2B)") : L("لأ", "No")}</dd></div>
      </dl>
      <p className="mt-2 text-[12.5px] text-muted-foreground">{L("بيوصّل: ", "Delivers to: ")}{s.zones.map((z) => ZONE_NAMES[z]?.[lang] ?? z).join("، ")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`tel:${s.phone}`} className="sf-btn sf-btn-ghost sf-btn-sm"><Phone className="size-4" aria-hidden />{L("كلّم المورّد مباشرة", "Call the supplier directly")}<span className="num" dir="ltr">{s.phone}</span></a>
      </div>
      {s.categories.length > 1 ? (
        <div className="mt-4">
          <Segmented size="sm" label={L("القسم", "Category")} value={cat} onChange={setCat} options={[{ id: "all" as const, label: L("الكل", "All") }, ...s.categories.map((c) => ({ id: c, label: CATEGORIES.find((x) => x.id === c)![lang] }))]} />
        </div>
      ) : null}
      <ul className="mt-4 grid gap-2">
        {items.map((p) => <ProductRow key={p.id} p={p} />)}
      </ul>
    </Modal>
  );
}

function CartSummary({ supplierId, compact }: { supplierId: string; compact?: boolean }) {
  const { L, lang } = useLang();
  const cart = useBiz((st) => st.cart[supplierId]);
  const [note, setNote] = useState("");
  const s = supplierById[supplierId];
  if (!cart || !Object.keys(cart).length) return compact ? <p className="text-center text-[13px] text-muted-foreground">{L("السلة فاضية — ضيف منتجات", "Cart is empty — add products")}</p> : null;
  const lines = Object.entries(cart).map(([id, qty]) => ({ productId: id, qty, price: productById[id].price, vat: productById[id].vat }));
  const t = orderTotals({ lines });
  const fee = s.deliveryFee;
  const below = t.net < s.minOrder;
  return (
    <div className="grid gap-2">
      {!compact ? (
        <ul className="grid gap-1 text-[13px]">
          {lines.map((l) => {
            const p = productById[l.productId];
            return (
              <li key={l.productId} className="flex justify-between gap-2">
                <span className="truncate"><span className="num [unicode-bidi:isolate]" dir="ltr">{l.qty}×</span> {lang === "ar" ? p.ar : p.en}</span>
                <Money v={l.price * l.qty} />
              </li>
            );
          })}
        </ul>
      ) : null}
      <div className="grid gap-0.5 text-[13px]">
        <div className="flex justify-between"><span className="text-muted-foreground">{L("قبل الضريبة", "Subtotal")}</span><Money v={t.net} /></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{L("ضريبة", "VAT")}</span><Money v={t.vat} /></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{L("توصيل", "Delivery")}</span>{fee ? <Money v={fee} /> : <span className="text-ok">{L("مجاني", "Free")}</span>}</div>
        <div className="flex justify-between font-bold"><span>{L("الإجمالي", "Total")}</span><Money v={t.gross + fee} /></div>
      </div>
      {below ? <p className="rounded-lg bg-warn-soft px-2 py-1 text-[12.5px] text-warn">{L("أقل طلب ", "Minimum order ")}<Money v={s.minOrder} />{L(" — ناقص ", " — add ")}<Money v={s.minOrder - t.net} /></p> : null}
      {!compact ? <input className="sf-input h-10 text-[14px]" placeholder={L("ملاحظة للمورّد (اختياري)", "Note to supplier (optional)")} value={note} onChange={(e) => setNote(e.target.value)} /> : null}
      <LoadingButton
        disabled={below}
        className="h-11 w-full"
        onAction={async () => {
          await new Promise((r) => setTimeout(r, 700));
          const po = placeOrder(supplierId, note.trim() || undefined);
          if (po) notify({ title: L(`اتبعت الطلب ${po.id}`, `Order ${po.id} sent`), detail: lang === "ar" ? s.ar : s.en, tone: "primary", icon: "check" });
        }}
        pendingLabel={L("بنبعت…", "Sending…")}
        successLabel={L("اتبعت!", "Sent!")}
      >
        <Truck className="size-4" aria-hidden />
        {L("ابعت الطلب", "Place order")}
      </LoadingButton>
    </div>
  );
}

function Carts() {
  const { L, lang } = useLang();
  const carts = useBiz((s) => s.cart);
  const ids = Object.keys(carts);
  return (
    <aside className="h-max rounded-[22px] border bg-card p-4 lg:sticky lg:top-24" aria-label={L("سلات الشراء", "Purchase carts")}>
      <h3 className="flex items-center gap-2 font-bold"><ShoppingCart className="size-4 text-primary" aria-hidden />{L("السلة (لكل مورّد)", "Cart (per supplier)")}</h3>
      {!ids.length ? <p className="mt-2 text-[13.5px] text-muted-foreground">{L("السلة فاضية. كل مورّد ليه سلة وطلب لوحده.", "Empty. Each supplier gets its own cart and order.")}</p> : null}
      <div className="mt-3 grid gap-4">
        {ids.map((id) => (
          <div key={id} className="rounded-2xl border p-3">
            <p className="mb-2 truncate font-semibold">{lang === "ar" ? supplierById[id].ar : supplierById[id].en}</p>
            <CartSummary supplierId={id} />
          </div>
        ))}
      </div>
    </aside>
  );
}

function Compare({ cat, q }: { cat: SupplyCategory | "all"; q: string }) {
  const { L, lang } = useLang();
  const keys = useMemo(() => {
    const seen = new Map<string, Product>();
    for (const p of PRODUCTS) if ((cat === "all" || p.category === cat) && !seen.has(p.key) && (!q || p.ar.includes(q) || p.en.toLowerCase().includes(q.toLowerCase()))) seen.set(p.key, p);
    return [...seen.values()].filter((p) => offersFor(p.key).length > 1).slice(0, 24);
  }, [cat, q]);
  if (!keys.length) return <p className="text-muted-foreground">{L("مفيش منتجات بأكتر من مورّد هنا.", "No products sold by several suppliers here.")}</p>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {keys.map((k) => {
        const offers = offersFor(k.key);
        const best = offers[0].price;
        return (
          <section key={k.key} className="rounded-2xl border bg-card p-3">
            <h3 className="font-bold">{lang === "ar" ? k.ar : k.en} <span className="text-[13px] font-normal text-muted-foreground">· {lang === "ar" ? k.packAr : k.packEn}</span></h3>
            <ul className="mt-2 grid gap-1.5">
              {offers.map((p) => {
                const s = supplierById[p.supplierId];
                const diff = Math.round(((p.price - best) / best) * 100);
                return (
                  <li key={p.id} className={cn("flex items-center gap-2 rounded-xl px-2 py-1.5", p.price === best ? "bg-primary-soft" : "bg-surface-2")}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{lang === "ar" ? s.ar : s.en}</span>
                      <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground"><Star className="size-3 fill-brass text-brass" aria-hidden /><span className="num">{s.rating.toFixed(1)}</span> · {L("أقل", "min")} <Money v={s.minOrder} /></span>
                    </span>
                    <span className="text-end">
                      <Money v={p.price} className="block font-bold" />
                      {p.price === best ? <span className="text-[11px] font-semibold text-primary">{L("الأرخص", "Cheapest")}</span> : <span className="num text-[11px] text-muted-foreground" dir="ltr">+{diff}%</span>}
                    </span>
                    <Qty p={p} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function MyOrders() {
  const { L, lang } = useLang();
  const all = useBiz((s) => s.orders);
  const orders = useMemo(() => all.filter((o) => o.restaurantId === DEMO_RESTAURANT.id), [all]);
  const [chat, setChat] = useState<PurchaseOrder | null>(null);
  const [msg, setMsg] = useState("");
  const live = useBiz((s) => (chat ? s.orders.find((o) => o.id === chat.id) ?? null : null));
  if (!orders.length) return <p className="text-muted-foreground">{L("لسه مفيش طلبات.", "No orders yet.")}</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {orders.map((o) => {
        const s = supplierById[o.supplierId];
        const t = orderTotals(o);
        const idx = Math.max(0, STATUS_STEPS.indexOf(o.status as (typeof STATUS_STEPS)[number]));
        return (
          <article key={o.id} className="rounded-[22px] border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-muted-foreground"><bdi className="num">{o.id}</bdi> · <bdi className="num">{new Date(o.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB")}</bdi></p>
                <h3 className="truncate text-[17px] font-bold">{lang === "ar" ? s.ar : s.en}</h3>
                <p className="text-[13px] text-muted-foreground">{o.lines.length} {L("أصناف", "items")} · <Money v={t.gross} /></p>
              </div>
              <Pill tone={statusTone(o.status)}>{statusLabel(o.status, L)}</Pill>
            </div>
            {o.status !== "cancelled" ? (
              <TaskSteps className="mt-3" label={L("حالة الطلب", "Order status")} current={o.status === "invoiced" ? 5 : idx + (o.status === "delivered" ? 1 : 0)} steps={STATUS_STEPS.map((st) => ({ id: st, label: statusLabel(st, L) }))} />
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(o.status === "delivered" || o.status === "invoiced") && !o.received ? (
                <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => { updateOrder(o.id, { received: true }); notify({ title: L("اتسجّل الاستلام", "Goods received"), detail: L("الكميات اتضافت للمخزن ومتوسط التكلفة اتحدّث", "Quantities added to stock; average cost updated"), tone: "primary", icon: "check" }); }}>
                  <FileCheck2 className="size-4" aria-hidden />
                  {L("استلم البضاعة", "Receive goods")}
                </button>
              ) : null}
              {o.received ? <Pill tone="ok">{L("اتضاف للمخزن", "Added to stock")}</Pill> : null}
              {o.received ? <Stars value={o.rating ?? 0} onRate={(n) => { updateOrder(o.id, { rating: n }); notify({ title: L("شكرًا على التقييم", "Thanks for rating"), ttl: 2200 }); }} label={L("قيّم المورّد", "Rate the supplier")} /> : null}
              <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm" onClick={() => setChat(o)}><MessageCircle className="size-4" aria-hidden />{L("شات", "Chat")}{o.messages.length ? <span className="num text-[11px]">({o.messages.length})</span> : null}</button>
              <a href={`tel:${s.phone}`} className="sf-btn sf-btn-ghost sf-btn-sm"><Phone className="size-4" aria-hidden />{L("اتصل", "Call")}</a>
            </div>
          </article>
        );
      })}
      <Modal open={!!live} onClose={() => setChat(null)} title={live ? `${live.id} · ${lang === "ar" ? supplierById[live.supplierId].ar : supplierById[live.supplierId].en}` : ""}>
        {live ? (
          <div className="grid gap-2">
            {live.messages.length ? live.messages.map((m, i) => (
              <p key={i} className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-[14px]", m.from === "restaurant" ? "ms-auto bg-primary text-primary-foreground" : "bg-surface-2")}>{m.text}</p>
            )) : <p className="text-muted-foreground">{L("ابدأ المحادثة مع المورّد.", "Start the conversation with the supplier.")}</p>}
            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!msg.trim()) return; sendMessage(live.id, { from: "restaurant", name: DEMO_RESTAURANT.ar, text: msg.trim() }); setMsg(""); }}>
              <input className="sf-input h-11" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={L("اكتب رسالة…", "Write a message…")} aria-label={L("رسالة", "Message")} />
              <button className="sf-btn sf-btn-primary">{L("ابعت", "Send")}</button>
            </form>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function Marketplace({ initialKey }: { initialKey?: string }) {
  const { L, lang } = useLang();
  const [view, setView] = useState<"browse" | "compare" | "orders">(initialKey ? "compare" : "browse");
  const [cat, setCat] = useState<SupplyCategory | "all">("all");
  const [q, setQ] = useState(initialKey ? PRODUCTS.find((p) => p.key === initialKey)?.ar ?? "" : "");
  const [open, setOpen] = useState<Supplier | null>(null);
  const suppliers = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return SUPPLIERS.filter((s) => (cat === "all" || s.categories.includes(cat)) && (!ql || s.ar.includes(q.trim()) || s.en.toLowerCase().includes(ql) || PRODUCTS.some((p) => p.supplierId === s.id && (p.ar.includes(q.trim()) || p.en.toLowerCase().includes(ql))))).sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || b.rating - a.rating);
  }, [cat, q]);
  const orderCount = useBiz((s) => s.orders.filter((o) => o.restaurantId === DEMO_RESTAURANT.id && o.status !== "invoiced" && o.status !== "cancelled").length);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label={L("عرض", "View")} value={view} onChange={setView} options={[{ id: "browse", label: L("الموردين", "Suppliers") }, { id: "compare", label: L("قارن الأسعار", "Compare prices") }, { id: "orders", label: L("طلباتي", "My orders"), badge: orderCount ? String(orderCount) : undefined }]} />
        {view !== "orders" ? (
          <label className="relative w-full sm:w-72">
            <span className="sr-only">{L("دوّر", "Search")}</span>
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input className="sf-input h-11 ps-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر على منتج أو مورّد", "Search products or suppliers")} />
          </label>
        ) : null}
      </div>
      {view !== "orders" ? (
        <div className="-mx-4 overflow-x-auto px-4 no-scrollbar md:mx-0 md:px-0">
          <div className="flex w-max gap-2">
            <button type="button" className="sf-chip" aria-pressed={cat === "all"} onClick={() => setCat("all")}>{L("الكل", "All")}</button>
            {CATEGORIES.map((c) => {
              const Icon = ICONS[c.id];
              return (
                <button key={c.id} type="button" className="sf-chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                  <Icon className="size-4" aria-hidden />
                  {lang === "ar" ? c.ar : c.en}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className={cn("grid gap-5", view !== "orders" && "lg:grid-cols-[1fr_320px]")}>
        <div className="min-w-0">
          {view === "browse" ? (
            suppliers.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {suppliers.map((s) => <SupplierCard key={s.id} s={s} onOpen={() => setOpen(s)} />)}
              </div>
            ) : (
              <p className="text-muted-foreground">{L("مفيش نتايج.", "No results.")}</p>
            )
          ) : view === "compare" ? (
            <Compare cat={cat} q={q.trim()} />
          ) : (
            <MyOrders />
          )}
        </div>
        {view !== "orders" ? <Carts /> : null}
      </div>
      <SupplierSheet s={open} onClose={() => setOpen(null)} />
    </div>
  );
}

export default Marketplace;
