/**
 * Supplier marketplace inside the restaurant app — the same 25 suppliers / ~250 products as the public website
 * (copied into ./marketplace). Browse, compare prices across suppliers (and against what you pay today), then either
 * order through Sufra (a marketplace PO: catalogue price, Sufra collects, the SUPPLIER pays Sufra a monthly plan +
 * commission per delivered order) or contact the supplier directly (call / WhatsApp).
 */
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { BadgeCheck, MessageCircle, Minus, Phone, Plus, Scale, Search, ShoppingCart, Star, Store, Truck } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb } from "@/data/hooks";
import type { StockCategory, StockItem, Supplier } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { formatMoney, type Units } from "@/lib/money";
import { Badge, Button, Card, Dialog, EmptyState, Input, Segmented, useToast } from "@/ui";
import { CATEGORIES, DAY_NAMES, PRODUCTS, SUPPLIERS, ZONE_NAMES, piastresToUnits, supplierById, type Product, type Supplier as MSupplier, type SupplyCategory } from "./marketplace/suppliers";
import { SUPPLIER_PLANS, planOf } from "./marketplace/plans";
import { createPo, poLine, waLink } from "./purchasing";
import { useInventory } from "./useInventory";

const units = (p: number) => piastresToUnits(p);
/** base units in one marketplace pack for a matched stock item */
function packFactor(p: Product, item: StockItem | undefined): number {
  const u = p.unit.en;
  if (u === "kg") return item?.baseUnit === "pc" ? 1 : 1000;
  if (u === "25 kg sack") return 25_000;
  if (u === "50 kg sack") return 50_000;
  if (u === "20 L jerrycan") return 20_000;
  if (u === "5 L jerrycan") return 5_000;
  if (u === "piece") return 1;
  return item?.packs[0]?.factor ?? 1;
}
const CAT_MAP: Record<SupplyCategory, StockCategory> = { produce: "produce", meat: "meat", fish: "fish", dairy: "dairy", dry: "dry", drinks: "drinks", packaging: "packaging", cleaning: "cleaning", equipment: "dry" };

export default function MarketplacePage() {
  const { L, lang } = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const inv = useInventory();
  const db = useDb();
  const { toast } = useToast();
  const { can } = useSession();
  const [view, setView] = useState<"products" | "suppliers">(params.get("supplier") ? "products" : "products");
  const [cat, setCat] = useState<SupplyCategory | "all">("all");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<string | null>(params.get("supplier"));
  const [compare, setCompare] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const mine = useMemo(() => new Map(inv.items.filter((i) => i.marketKey).map((i) => [i.marketKey!, i])), [inv.items]);
  const products = useMemo(
    () => PRODUCTS.filter((p) => (cat === "all" || p.category === cat) && (!only || p.supplierId === only) && (!q.trim() || matches(`${p.ar} ${p.en} ${supplierById[p.supplierId].ar} ${supplierById[p.supplierId].en}`, q))).sort((a, b) => (mine.has(b.key) ? 1 : 0) - (mine.has(a.key) ? 1 : 0)),
    [cat, q, only, mine],
  );
  const suppliers = useMemo(() => SUPPLIERS.filter((s) => (cat === "all" || s.categories.includes(cat)) && (!q.trim() || matches(`${s.ar} ${s.en} ${s.areaAr} ${s.areaEn}`, q))), [cat, q]);
  const cartLines = Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => ({ p: PRODUCTS.find((x) => x.id === id)!, n }));
  const bySupplier = new Map<string, { p: Product; n: number }[]>();
  for (const l of cartLines) bySupplier.set(l.p.supplierId, [...(bySupplier.get(l.p.supplierId) ?? []), l]);
  const cartTotal = cartLines.reduce((a, l) => a + units(l.p.price) * l.n, 0);
  const add = (p: Product, d: number) => setCart((c) => ({ ...c, [p.id]: Math.max(0, (c[p.id] ?? 0) + d * (d > 0 && !(c[p.id] ?? 0) ? p.minQty : 1)) }));

  /** Links (or creates) the marketplace supplier + stock items + prices, then a marketplace PO per supplier. */
  const order = async () => {
    if (!inv.branchId) return;
    setBusy(true);
    try {
      let first: string | null = null;
      for (const [msid, lines] of bySupplier) {
        const ms = supplierById[msid];
        let sup: Supplier | undefined = inv.suppliers.find((s) => s.marketplaceId === msid);
        if (!sup)
          sup = await db.insert("suppliers", {
            name: { ar: ms.ar, en: ms.en }, contactName: "", phone: ms.phone, whatsapp: ms.phone, email: null, taxId: ms.tax, categories: ms.categories.map((c) => CAT_MAP[c]), area: { ar: ms.areaAr, en: ms.areaEn },
            termsDays: 0, leadDays: 1, days: ms.days, minOrder: units(ms.minOrder), deliveryFee: units(ms.deliveryFee), marketplaceId: msid, eInvoice: ms.eInvoice, rating: ms.rating, active: true, note: "",
          });
        const poLines = [];
        for (const { p, n } of lines) {
          let item = mine.get(p.key);
          if (!item)
            item = await db.insert("stockItems", {
              name: { ar: p.ar, en: p.en }, sku: p.key.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12), category: CAT_MAP[p.category], kind: "raw", baseUnit: p.unit.en === "kg" ? "g" : "pc",
              packs: p.unit.en === "kg" ? [] : [{ id: "pack", name: { ar: p.packAr, en: p.packEn }, factor: 1 }], countUnit: p.unit.en === "kg" ? "kg" : "pack", account: p.category === "drinks" ? "beverage" : p.category === "packaging" ? "packaging" : "food",
              levels: { min: 0, par: 0, max: 0 }, branchLevels: {}, supplierIds: [sup.id], preferredSupplierId: sup.id, lastCost: 0, defaultLocationIds: inv.locations[0] ? [inv.locations[0].id] : [], trackBatches: false,
              shelfLifeDays: null, vatBp: p.vat * 100, yieldBp: 10_000, allergens: [], active: true, note: "", marketKey: p.key,
            });
          const factor = packFactor(p, item);
          const price = units(p.price);
          let offer = inv.offers.find((o) => o.supplierId === sup!.id && o.itemId === item!.id);
          if (!offer) offer = await db.insert("supplierItems", { supplierId: sup.id, itemId: item.id, packName: { ar: p.packAr, en: p.packEn }, packFactor: factor, price, vatBp: p.vat * 100, code: p.id, history: [{ price, at: new Date().toISOString() }], preferred: false });
          else if (offer.price !== price) offer = await db.update("supplierItems", offer.id, { price, history: [...offer.history, { price, at: new Date().toISOString() }] });
          poLines.push(poLine(item, offer, n));
        }
        const home = inv.locations.find((l) => mine.get(lines[0].p.key)?.defaultLocationIds.includes(l.id)) ?? inv.locations[0];
        const po = await createPo(db, { supplierId: sup.id, branchId: inv.branchId, locationId: home.id, lines: poLines, channel: "marketplace", note: L("من سوق سُفرة", "From the Sufra marketplace") });
        first = first ?? po.id;
      }
      setCart({});
      toast({ title: L("المسودات جاهزة — راجعها وابعتها", "Drafts ready — review and send"), tone: "success" });
      if (first) nav(`/inventory/purchasing?po=${first}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 pb-24">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="grid size-12 place-items-center rounded-2xl bg-brass-soft text-brass-text"><Store className="size-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[18px] font-semibold">{L("سوق موردين سُفرة", "Sufra supplier marketplace")}</p>
          <p className="text-[13.5px] text-muted">{L(`${SUPPLIERS.length} مورد و${PRODUCTS.length} منتج بأسعار جملة القاهرة. اطلب عن طريق سُفرة بسعر الكتالوج (المورد هو اللي بيدفع اشتراك شهري + عمولة على كل طلب بيتسلّم) — أو كلّم المورد مباشرة.`, `${SUPPLIERS.length} suppliers, ${PRODUCTS.length} products at Cairo wholesale prices. Order through Sufra at the catalogue price (the supplier pays a monthly plan + commission per delivered order) — or contact the supplier directly.`)}</p>
        </div>
        <div className="flex gap-1.5 text-[12px]">
          {SUPPLIER_PLANS.map((p) => <Badge key={p.id} size="sm" tone={p.highlight ? "brass" : "neutral"}>{p[lang]} · {p.commissionPct}٪</Badge>)}
        </div>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <Input wrapClassName="min-w-56 flex-1" icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("طماطم، لحم ضاني، زيت …", "Tomatoes, lamb, oil …")} aria-label={L("بحث", "Search")} />
        <Segmented label={L("عرض", "View")} value={view} onChange={setView} options={[{ value: "products", label: L("منتجات", "Products") }, { value: "suppliers", label: L("موردين", "Suppliers") }]} />
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar md:mx-0 md:flex-wrap md:px-0">
        {[{ id: "all" as const, ar: "الكل", en: "All" }, ...CATEGORIES].map((c) => (
          <button key={c.id} type="button" onClick={() => setCat(c.id)} className={`h-10 shrink-0 rounded-full border px-4 text-[13.5px] font-semibold ${cat === c.id ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface hover:bg-surface-2"}`}>{c[lang]}</button>
        ))}
        {only ? <button type="button" onClick={() => setOnly(null)} className="h-10 shrink-0 rounded-full border border-brass bg-brass-soft px-4 text-[13.5px] font-semibold text-brass-text">{supplierById[only]?.[lang]} ✕</button> : null}
      </div>

      {view === "products" ? (
        products.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {products.slice(0, 90).map((p) => {
              const s = supplierById[p.supplierId];
              const have = mine.get(p.key);
              const offers = PRODUCTS.filter((x) => x.key === p.key).length;
              const yours = have ? currentPerPack(have, p, inv) : null;
              const n = cart[p.id] ?? 0;
              return (
                <li key={p.id}>
                  <Card className="grid h-full gap-2 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{p[lang]}</p>
                        <button type="button" onClick={() => setOnly(p.supplierId)} className="truncate text-start text-[12.5px] text-muted hover:text-primary">{s[lang]} {s.verified ? <BadgeCheck className="inline size-3.5 text-info" /> : null}</button>
                      </div>
                      {have ? <Badge size="sm" tone="primary">{L("بتستخدمه", "You use this")}</Badge> : null}
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <p className="font-display text-[20px] font-semibold num">{formatMoney(units(p.price), { lang })}</p>
                        <p className="text-[12px] text-muted">{lang === "ar" ? p.packAr : p.packEn}{p.vat ? ` + ${L("ضريبة", "VAT")} ١٤٪` : ` · ${L("معفي", "VAT-free")}`} · {L("أقل كمية", "min")} {p.minQty}</p>
                      </div>
                      {yours != null ? <span className={`text-[12px] font-semibold ${units(p.price) < yours ? "text-ok" : "text-muted"}`}>{L("بتدفع", "you pay")} {formatMoney(yours, { lang, whole: true })}</span> : null}
                    </div>
                    <div className="mt-auto flex items-center gap-2">
                      {offers > 1 ? <Button size="sm" variant="ghost" icon={<Scale className="size-4" />} onClick={() => setCompare(p.key)}>{L(`قارن (${offers})`, `Compare (${offers})`)}</Button> : <span className="flex-1" />}
                      <span className="flex-1" />
                      {can("purchasing.manage") || can("inventory.manage") ? (
                        n ? (
                          <span className="flex items-center gap-1">
                            <button type="button" aria-label={L("أقل", "Less")} className="grid size-10 place-items-center rounded-xl border border-line" onClick={() => add(p, -1)}><Minus className="size-4" /></button>
                            <span className="num w-8 text-center font-semibold">{n}</span>
                            <button type="button" aria-label={L("أكتر", "More")} className="grid size-10 place-items-center rounded-xl border border-line" onClick={() => add(p, 1)}><Plus className="size-4" /></button>
                          </span>
                        ) : (
                          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => add(p, 1)}>{L("للسلة", "Add")}</Button>
                        )
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={<Store />} title={L("مفيش نتايج", "No results")} />
        )
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {suppliers.map((s) => <SupplierCard key={s.id} s={s} linked={inv.suppliers.some((x) => x.marketplaceId === s.id)} onCatalogue={() => { setOnly(s.id); setView("products"); }} />)}
        </ul>
      )}

      {cartLines.length ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+76px)] z-30 mx-auto max-w-3xl md:bottom-6">
          <Card className="flex flex-wrap items-center gap-3 p-3 shadow-sf-lg">
            <ShoppingCart className="size-5 text-primary" />
            <div className="min-w-0 flex-1 text-[14px]">
              <b className="num">{cartLines.length}</b> {L("منتج من", "items from")} <b className="num">{bySupplier.size}</b> {L("مورد", "supplier(s)")} · <b>{formatMoney(cartTotal, { lang, whole: true })}</b>
              {[...bySupplier.keys()].some((id) => cartLines.filter((l) => l.p.supplierId === id).reduce((a, l) => a + l.p.price * l.n, 0) < supplierById[id].minOrder) ? <span className="block text-[12px] text-warn">{L("فيه مورد تحت الحد الأدنى للطلب", "A supplier is under their minimum order")}</span> : null}
            </div>
            <Button variant="ghost" onClick={() => setCart({})}>{L("فضّي", "Clear")}</Button>
            <Button variant="brass" loading={busy} icon={<Store className="size-4" />} onClick={order}>{L("اطلب عن طريق سُفرة", "Order through Sufra")}</Button>
          </Card>
        </div>
      ) : null}

      <Dialog open={!!compare} onClose={() => setCompare(null)} title={L("قارن الأسعار", "Compare prices")} description={compare ? PRODUCTS.find((p) => p.key === compare)?.[lang] : ""}>
        {compare ? <Compare productKey={compare} onAdd={(p) => { add(p, 1); setCompare(null); }} /> : null}
      </Dialog>
    </div>
  );
}

/** What you pay today for one marketplace pack of this product (your preferred supplier's price, scaled). */
function currentPerPack(item: StockItem, p: Product, inv: ReturnType<typeof useInventory>): Units | null {
  const offer = inv.offers.find((o) => o.itemId === item.id && o.supplierId === item.preferredSupplierId) ?? inv.offers.find((o) => o.itemId === item.id);
  if (!offer) return null;
  return Math.round((offer.price / offer.packFactor) * packFactor(p, item));
}

function Compare({ productKey, onAdd }: { productKey: string; onAdd: (p: Product) => void }) {
  const { L, lang } = useT();
  const inv = useInventory();
  const offers = PRODUCTS.filter((p) => p.key === productKey).sort((a, b) => a.price - b.price);
  const item = inv.items.find((i) => i.marketKey === productKey);
  const yours = item ? currentPerPack(item, offers[0], inv) : null;
  return (
    <ul className="grid gap-2 pb-1">
      {yours != null ? <li className="rounded-xl bg-primary-soft px-3 py-2 text-[13.5px] text-primary">{L("بتدفع النهارده", "You pay today")} <b className="num">{formatMoney(yours, { lang })}</b></li> : null}
      {offers.map((p, i) => {
        const s = supplierById[p.supplierId];
        const save = yours != null ? yours - units(p.price) : 0;
        return (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{s[lang]} {i === 0 ? <Badge size="sm" tone="ok">{L("الأرخص", "Cheapest")}</Badge> : null}</p>
              <p className="text-[12.5px] text-muted"><Star className="inline size-3.5 fill-brass text-brass" /> {s.rating} · {lang === "ar" ? s.areaAr : s.areaEn} · {s.deliveryFee ? `${L("توصيل", "delivery")} ${formatMoney(units(s.deliveryFee), { lang, whole: true })}` : L("توصيل مجاني", "free delivery")}</p>
            </div>
            <div className="text-end">
              <p className="num font-semibold">{formatMoney(units(p.price), { lang })}</p>
              {save > 0 ? <p className="text-[12px] text-ok">{L("توفير", "save")} {formatMoney(save, { lang, whole: true })}</p> : null}
            </div>
            <Button size="sm" onClick={() => onAdd(p)}>{L("للسلة", "Add")}</Button>
          </li>
        );
      })}
    </ul>
  );
}

function SupplierCard({ s, linked, onCatalogue }: { s: MSupplier; linked: boolean; onCatalogue: () => void }) {
  const { L, lang } = useT();
  const plan = SUPPLIER_PLANS.find((p) => p.id === planOf(s.id))!;
  return (
    <li>
      <Card className="grid h-full gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-semibold">{s[lang]} {s.verified ? <BadgeCheck className="size-4 text-info" /> : null}</p>
            <p className="text-[12.5px] text-muted">{lang === "ar" ? s.areaAr : s.areaEn} · {L("من", "since")} {s.since} · <Star className="inline size-3.5 fill-brass text-brass" /> {s.rating} ({s.ratings})</p>
          </div>
          {linked ? <Badge size="sm" tone="primary">{L("مورّدك", "Your supplier")}</Badge> : null}
        </div>
        <p className="line-clamp-2 text-[13px] text-ink-2">{lang === "ar" ? s.descAr : s.descEn}</p>
        <div className="flex flex-wrap gap-1.5 text-[12px]">
          <Badge size="sm"><Truck className="size-3.5" />{s.days.map((d) => DAY_NAMES[lang][d]).join(" ")}</Badge>
          <Badge size="sm">{L("قبل", "order by")} {s.cutoff}:00</Badge>
          <Badge size="sm">{L("أقل طلب", "min")} {formatMoney(piastresToUnits(s.minOrder), { lang, whole: true })}</Badge>
          {s.eInvoice ? <Badge size="sm" tone="info">{L("فاتورة إلكترونية", "e-invoice")}</Badge> : null}
          <Badge size="sm" tone="brass">{plan[lang]} · {plan.commissionPct}٪</Badge>
        </div>
        <p className="text-[12px] text-muted">{L("بيوصّل", "Delivers to")}: {s.zones.slice(0, 5).map((z) => ZONE_NAMES[z]?.[lang] ?? z).join("، ")}{s.zones.length > 5 ? " …" : ""}</p>
        <div className="mt-auto flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={onCatalogue}>{L("الكتالوج", "Catalogue")}</Button>
          <a className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13.5px] font-semibold hover:bg-surface-2" href={`tel:${s.phone}`}><Phone className="size-4" />{L("اتصال", "Call")}</a>
          <a className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-ok px-3 text-[13.5px] font-semibold text-white" href={waLink(s.phone, L("السلام عليكم، عايز أسأل عن أسعار الجملة", "Hello, I'd like your wholesale prices"))} target="_blank" rel="noreferrer"><MessageCircle className="size-4" />WhatsApp</a>
        </div>
      </Card>
    </li>
  );
}
