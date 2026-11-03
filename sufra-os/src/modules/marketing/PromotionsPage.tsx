import { useMemo, useState } from "react";
import { BadgePercent, Clock3, Copy, KeyRound, Pencil, Plus, Ticket, Zap } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Localized, OrderMode, Promotion } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, major } from "@/lib/money";
import { normalizeCode, referralCode, windowCheck, type PromoChannel, type PromoType } from "@/lib/promo";
import { Badge, Button, Dialog, EmptyState, Input, Segmented, Select, Switch, Table, useToast, type Column } from "@/ui";
import { LocalizedInput, MoneyInput, NumberInput } from "./ui";

export const TYPE_LABEL: Record<PromoType, Localized> = {
  percent: { ar: "خصم ٪", en: "% off" },
  amount: { ar: "خصم مبلغ", en: "Amount off" },
  bogo: { ar: "اشتري واحصل", en: "Buy X get Y" },
  combo: { ar: "كومبو بسعر", en: "Combo price" },
  free_delivery: { ar: "توصيل مجاني", en: "Free delivery" },
  free_item: { ar: "صنف مجاني", en: "Free item" },
};
const DAYS: Localized[] = [
  { ar: "حد", en: "Sun" }, { ar: "اتنين", en: "Mon" }, { ar: "تلات", en: "Tue" }, { ar: "أربع", en: "Wed" }, { ar: "خميس", en: "Thu" }, { ar: "جمعة", en: "Fri" }, { ar: "سبت", en: "Sat" },
];

type Draft = Omit<Promotion, "id" | "restaurantId" | "createdAt" | "updatedAt"> & { id?: string };
const blank = (): Draft => ({
  name: { ar: "", en: "" }, description: { ar: "", en: "" }, kind: "coupon", type: "percent", code: "", value: 1000, maxDiscount: null, minSpend: null, target: null, bogo: { buyQty: 1, getQty: 1 },
  combo: { itemIds: [] }, window: null, channels: [], modes: [], firstOrderOnly: false, limits: { total: null, perCustomer: null }, stackable: false, priority: 10, active: true, uses: 0,
  createdBy: null, campaignId: null,
});

export function describePromo(p: Pick<Promotion, "type" | "value" | "minSpend" | "maxDiscount" | "bogo">, lang: "ar" | "en") {
  const m = (u: number) => formatMoney(u, { lang, compact: true });
  const L = (a: string, e: string) => (lang === "ar" ? a : e);
  const base =
    p.type === "percent" ? L(`${p.value / 100}٪ خصم`, `${p.value / 100}% off`)
    : p.type === "amount" ? L(`${m(p.value)} خصم`, `${m(p.value)} off`)
    : p.type === "bogo" ? L(`اشتري ${p.bogo?.buyQty ?? 1} وخد ${p.bogo?.getQty ?? 1} ${p.value >= 10_000 ? "مجانًا" : `بخصم ${p.value / 100}٪`}`, `Buy ${p.bogo?.buyQty ?? 1} get ${p.bogo?.getQty ?? 1} ${p.value >= 10_000 ? "free" : `${p.value / 100}% off`}`)
    : p.type === "combo" ? L(`كومبو بـ ${m(p.value)}`, `Combo for ${m(p.value)}`)
    : p.type === "free_delivery" ? L("توصيل مجاني", "Free delivery")
    : L(`${p.value || 1} صنف مجاني`, `${p.value || 1} free item`);
  return [base, p.minSpend ? L(`فوق ${m(p.minSpend)}`, `over ${m(p.minSpend)}`) : null, p.maxDiscount ? L(`لحد ${m(p.maxDiscount)}`, `up to ${m(p.maxDiscount)}`) : null].filter(Boolean).join(" · ");
}

export default function PromotionsPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const promos = useLive("promotions", { orderBy: [{ field: "priority" }] }).data;
  const reds = useLive("promoRedemptions", { where: { status: "redeemed" } }).data;
  const codes = useLive("couponCodes").data;
  const [tab, setTab] = useState<"all" | "auto" | "coupon" | "off">("all");
  const [edit, setEdit] = useState<Draft | null>(null);
  const [gen, setGen] = useState<Promotion | null>(null);
  const now = new Date();

  const rows = promos.filter((p) => (tab === "all" ? p.active : tab === "off" ? !p.active : p.active && p.kind === tab));
  const byPromo = useMemo(() => {
    const m = new Map<string, { n: number; disc: number; rev: number }>();
    for (const r of reds) {
      if (!r.promotionId) continue;
      const x = m.get(r.promotionId) ?? { n: 0, disc: 0, rev: 0 };
      x.n++;
      x.disc += r.discount + r.deliveryDiscount;
      x.rev += r.revenue;
      m.set(r.promotionId, x);
    }
    return m;
  }, [reds]);

  const cols: Column<Promotion>[] = [
    {
      key: "name",
      header: L("العرض", "Offer"),
      cell: (p) => (
        <span className="grid min-w-0 gap-0.5">
          <span className="flex items-center gap-2">
            {p.kind === "auto" ? <Zap className="size-4 shrink-0 text-brass" /> : <Ticket className="size-4 shrink-0 text-primary" />}
            <span className="truncate font-semibold">{loc(p.name)}</span>
          </span>
          <span className="truncate text-[12.5px] text-muted">{describePromo(p, lang)}</span>
        </span>
      ),
    },
    { key: "code", header: L("الكود", "Code"), cell: (p) => (p.code ? <span className="num rounded-lg bg-surface-3 px-2 py-0.5 font-semibold" dir="ltr">{p.code}</span> : p.kind === "coupon" ? <Badge size="sm">{L(`${codes.filter((c) => c.promotionId === p.id).length} كود شخصي`, `${codes.filter((c) => c.promotionId === p.id).length} unique`)}</Badge> : <Badge size="sm" tone="brass">{L("تلقائي", "Auto")}</Badge>) },
    {
      key: "when",
      header: L("الوقت", "When"),
      hideOnMobile: true,
      cell: (p) => {
        const w = windowCheck(p, now);
        return (
          <span className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {p.window?.from ? <span className="num inline-flex items-center gap-1"><Clock3 className="size-3.5" />{p.window.from}–{p.window.to}</span> : null}
            {p.window?.days?.length ? <span>{p.window.days.map((d) => DAYS[d][lang]).join("، ")}</span> : null}
            {w ? <Badge size="sm" tone={w === "expired" ? "danger" : "neutral"}>{w}</Badge> : <Badge size="sm" tone="ok" dot>{L("شغّال دلوقتي", "Live now")}</Badge>}
          </span>
        );
      },
    },
    { key: "uses", header: L("استخدام", "Uses"), align: "end", cell: (p) => <span className="num">{p.uses}{p.limits?.total ? <span className="text-muted">/{p.limits.total}</span> : null}</span> },
    { key: "disc", header: L("خصومات", "Discounts"), align: "end", hideOnMobile: true, cell: (p) => <span className="num text-muted">{formatMoney(byPromo.get(p.id)?.disc ?? 0, { lang, whole: true })}</span> },
    {
      key: "act",
      header: "",
      align: "end",
      cell: (p) =>
        can("marketing.manage") ? (
          <span className="flex justify-end gap-1">
            {p.kind === "coupon" ? (
              <Button size="sm" variant="ghost" icon={<KeyRound className="size-4" />} onClick={(e) => (e.stopPropagation(), setGen(p))}>
                {L("أكواد", "Codes")}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={(e) => (e.stopPropagation(), setEdit({ ...p }))}>
              {L("تعديل", "Edit")}
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={L("فلتر", "Filter")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "all", label: L("الشغّال", "Active"), badge: promos.filter((p) => p.active).length },
            { value: "auto", label: L("تلقائي", "Automatic") },
            { value: "coupon", label: L("كوبونات", "Coupons") },
            { value: "off", label: L("متوقف", "Paused") },
          ]}
        />
        <div className="flex-1" />
        {can("marketing.manage") ? (
          <Button icon={<Plus className="size-4" />} onClick={() => setEdit(blank())}>
            {L("عرض جديد", "New offer")}
          </Button>
        ) : null}
      </div>
      <p className="text-[13px] text-muted">{L("كل الخصومات بتتحسب على الأصناف قبل الضريبة والخدمة. العروض اللي «مابتتجمعش» بتشتغل لوحدها — النظام بيختار الأوفر للزبون.", "Every discount is applied to the lines before VAT and service. Non-combinable offers apply alone — the engine picks whichever saves the guest more.")}</p>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table columns={cols} rows={rows} rowKey={(p) => p.id} onRowClick={can("marketing.manage") ? (p) => setEdit({ ...p }) : undefined} caption={L("العروض", "Offers")} empty={<EmptyState compact icon={<BadgePercent />} title={L("مفيش عروض هنا", "No offers here")} />} />
      </div>
      <PromoEditor draft={edit} onClose={() => setEdit(null)} />
      <CodesDialog promo={gen} onClose={() => setGen(null)} />
    </div>
  );
}

function PromoEditor({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const menu = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const cats = useLive("menuCategories", { orderBy: [{ field: "sort" }] }).data;
  const segments = useLive("segments").data;
  const program = useLive("loyaltyPrograms").data[0];
  const [d, setD] = useState<Draft | null>(draft);
  const [lastDraft, setLastDraft] = useState(draft);
  if (draft !== lastDraft) {
    setLastDraft(draft);
    setD(draft);
  }
  if (!d) return <Dialog open={false} onClose={onClose} />;
  const set = (x: Partial<Draft>) => setD({ ...d, ...x });
  const target = d.target ?? { itemIds: [], categoryIds: [] };
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const save = async () => {
    const row = { ...d, code: d.kind === "coupon" && d.code ? normalizeCode(d.code) : null, target: target.itemIds.length || target.categoryIds.length ? target : null };
    const { id, ...rest } = row;
    if (id) await db.update("promotions", id, rest);
    else await db.insert("promotions", { ...rest, createdBy: db.actorId });
    await db.audit(id ? "promo.edit" : "promo.create", "promotions", id ?? null, { name: d.name.ar });
    toast({ title: L("العرض اتحفظ", "Offer saved"), tone: "success" });
    onClose();
  };
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" aria-pressed={on} onClick={onClick} className={`h-8 rounded-full border px-2.5 text-[12.5px] font-semibold ${on ? "border-primary bg-primary-soft text-primary" : "border-line text-muted hover:bg-surface-2"}`}>
      {label}
    </button>
  );
  return (
    <Dialog
      open={!!draft}
      onClose={onClose}
      size="xl"
      title={d.id ? L("تعديل العرض", "Edit offer") : L("عرض جديد", "New offer")}
      description={describePromo(d, lang)}
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <Switch checked={d.active} onChange={(v) => set({ active: v })} label={L("شغّال", "Active")} />
          <div className="flex-1" />
          <Button size="lg" onClick={save} disabled={!d.name.ar.trim()}>{L("احفظ العرض", "Save offer")}</Button>
        </div>
      }
    >
      <div className="grid gap-5 pb-1 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <LocalizedInput label={L("اسم العرض", "Offer name")} value={d.name} onChange={(v) => set({ name: v })} />
          <Segmented block label={L("النوع", "Kind")} value={d.kind} onChange={(k) => set({ kind: k })} options={[{ value: "coupon", label: L("كوبون بكود", "Coupon code"), icon: <Ticket /> }, { value: "auto", label: L("عرض تلقائي", "Automatic"), icon: <Zap /> }]} />
          {d.kind === "coupon" ? <Input label={L("الكود المشترك (سيبه فاضي للأكواد الشخصية)", "Shared code (leave empty for unique codes)")} dir="ltr" value={d.code ?? ""} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="SUFRA15" /> : null}
          <Select label={L("نوع الخصم", "Discount type")} value={d.type} onChange={(e) => set({ type: e.target.value as PromoType, value: e.target.value === "percent" ? 1000 : e.target.value === "bogo" ? 10_000 : e.target.value === "free_item" ? 1 : e.target.value === "free_delivery" ? 0 : major(50) })} options={(Object.keys(TYPE_LABEL) as PromoType[]).map((t) => ({ value: t, label: loc(TYPE_LABEL[t]) }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            {d.type === "percent" ? <NumberInput label={L("النسبة", "Percent")} value={d.value / 100} suffix="%" onChange={(n) => set({ value: Math.round(n * 100) })} /> : null}
            {d.type === "amount" || d.type === "combo" ? <MoneyInput label={d.type === "combo" ? L("سعر الكومبو", "Combo price") : L("المبلغ", "Amount")} value={d.value} onChange={(u) => set({ value: u })} /> : null}
            {d.type === "bogo" ? (
              <>
                <NumberInput label={L("اشتري", "Buy")} value={d.bogo?.buyQty ?? 1} onChange={(n) => set({ bogo: { ...(d.bogo ?? { getQty: 1 }), buyQty: Math.max(1, Math.round(n)) } })} />
                <NumberInput label={L("وخد", "Get")} value={d.bogo?.getQty ?? 1} onChange={(n) => set({ bogo: { ...(d.bogo ?? { buyQty: 1 }), getQty: Math.max(1, Math.round(n)) } })} />
                <NumberInput label={L("خصم على اللي بياخده", "Off the reward units")} value={d.value / 100} suffix="%" onChange={(n) => set({ value: Math.round(n * 100) })} hint={L("١٠٠٪ = مجانًا", "100% = free")} />
              </>
            ) : null}
            {d.type === "free_item" ? <NumberInput label={L("عدد الأصناف المجانية", "Free units")} value={d.value || 1} onChange={(n) => set({ value: Math.max(1, Math.round(n)) })} /> : null}
            <MoneyInput label={L("أقل طلب", "Minimum spend")} value={d.minSpend ?? 0} onChange={(u) => set({ minSpend: u || null })} />
            {d.type === "percent" ? <MoneyInput label={L("أقصى خصم", "Max discount")} value={d.maxDiscount ?? 0} onChange={(u) => set({ maxDiscount: u || null })} /> : null}
            <NumberInput label={L("حد الاستخدام الكلي", "Total uses limit")} value={d.limits?.total ?? 0} hint={L("٠ = مفتوح", "0 = unlimited")} onChange={(n) => set({ limits: { ...d.limits, total: n ? Math.round(n) : null } })} />
            <NumberInput label={L("لكل زبون", "Per customer")} value={d.limits?.perCustomer ?? 0} hint={L("٠ = مفتوح", "0 = unlimited")} onChange={(n) => set({ limits: { ...d.limits, perCustomer: n ? Math.round(n) : null } })} />
            <NumberInput label={L("الأولوية", "Priority")} value={d.priority} hint={L("الأقل يتطبق الأول", "lower applies first")} onChange={(n) => set({ priority: Math.round(n) })} />
          </div>
          <div className="grid gap-1 rounded-2xl bg-surface-2 px-4 py-2">
            <Switch checked={d.stackable} onChange={(v) => set({ stackable: v })} label={L("يتجمع مع عروض تانية", "Combines with other offers")} />
            <Switch checked={!!d.firstOrderOnly} onChange={(v) => set({ firstOrderOnly: v })} label={L("لأول طلب بس", "First order only")} />
          </div>
        </div>

        <div className="grid content-start gap-4">
          {d.type === "combo" ? (
            <div className="grid gap-2">
              <span className="text-[13px] font-semibold text-ink-2">{L("أصناف الكومبو (واحد من كل صنف)", "Combo items (one of each)")}</span>
              <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto thin-scrollbar">{menu.map((m) => chip((d.combo?.itemIds ?? []).includes(m.id), loc(m.name), () => set({ combo: { itemIds: toggle(d.combo?.itemIds ?? [], m.id) } })))}</div>
            </div>
          ) : d.type !== "free_delivery" ? (
            <div className="grid gap-2">
              <span className="text-[13px] font-semibold text-ink-2">{L("على أقسام / أصناف (فاضي = الشيك كله)", "On categories / items (empty = whole bill)")}</span>
              <div className="flex flex-wrap gap-1.5">{cats.map((c) => chip(target.categoryIds.includes(c.id), loc(c.name), () => set({ target: { ...target, categoryIds: toggle(target.categoryIds, c.id) } })))}</div>
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto thin-scrollbar">{menu.map((m) => chip(target.itemIds.includes(m.id), loc(m.name), () => set({ target: { ...target, itemIds: toggle(target.itemIds, m.id) } })))}</div>
            </div>
          ) : null}
          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-ink-2">{L("الوقت", "Schedule")}</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input type="datetime-local" label={L("من", "Starts")} value={d.window?.startsAt?.slice(0, 16) ?? ""} onChange={(e) => set({ window: { ...d.window, startsAt: e.target.value ? new Date(e.target.value).toISOString() : null } })} />
              <Input type="datetime-local" label={L("لحد", "Ends")} value={d.window?.endsAt?.slice(0, 16) ?? ""} onChange={(e) => set({ window: { ...d.window, endsAt: e.target.value ? new Date(e.target.value).toISOString() : null } })} />
              <Input type="time" label={L("كل يوم من الساعة", "Daily from")} value={d.window?.from ?? ""} onChange={(e) => set({ window: { ...d.window, from: e.target.value || null } })} hint={L("هابي آور", "Happy hour")} />
              <Input type="time" label={L("للساعة", "to")} value={d.window?.to ?? ""} onChange={(e) => set({ window: { ...d.window, to: e.target.value || null } })} />
            </div>
            <div className="flex flex-wrap gap-1.5">{DAYS.map((x, i) => chip(!!d.window?.days?.includes(i), x[lang], () => set({ window: { ...d.window, days: toggle((d.window?.days ?? []).map(String), String(i)).map(Number) } })))}</div>
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-ink-2">{L("فين (فاضي = كله)", "Where (empty = everywhere)")}</span>
            <div className="flex flex-wrap gap-1.5">
              {(["pos", "qr", "online"] as PromoChannel[]).map((c) => chip(d.channels.includes(c), c === "pos" ? L("الكاشير", "POS") : c === "qr" ? L("منيو QR", "QR menu") : L("أونلاين", "Online"), () => set({ channels: toggle(d.channels, c) as PromoChannel[] })))}
              {(["dine_in", "takeaway", "delivery"] as OrderMode[]).map((m) => chip(!!d.modes?.includes(m), m === "dine_in" ? L("صالة", "Dine-in") : m === "takeaway" ? L("تيك أواي", "Takeaway") : L("دليفري", "Delivery"), () => set({ modes: toggle(d.modes ?? [], m) as OrderMode[] })))}
            </div>
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-ink-2">{L("لمين (فاضي = الكل)", "Who (empty = everyone)")}</span>
            <div className="flex flex-wrap gap-1.5">
              {segments.map((s) => chip(!!d.segmentIds?.includes(s.id), loc(s.name), () => set({ segmentIds: toggle(d.segmentIds ?? [], s.id) })))}
              {(program?.tiers ?? []).map((t) => chip(!!d.tierIds?.includes(t.id), `👑 ${loc(t.name)}`, () => set({ tierIds: toggle(d.tierIds ?? [], t.id) })))}
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

function CodesDialog({ promo, onClose }: { promo: Promotion | null; onClose: () => void }) {
  const { L, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const codes = useLive("couponCodes", { where: { promotionId: promo?.id ?? "-" } }, { enabled: !!promo }).data;
  const [n, setN] = useState(20);
  const [prefix, setPrefix] = useState("SUF");
  const make = async () => {
    if (!promo) return;
    const stamp = Date.now().toString(36);
    for (let i = 0; i < n; i++) await db.insert("couponCodes", { promotionId: promo.id, code: referralCode(`${promo.id}:${stamp}:${i}`, prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "CP"), customerId: null, campaignId: null, usedAt: null, checkId: null, expiresAt: promo.window?.endsAt ?? null });
    toast({ title: L(`اتعمل ${n} كود`, `${n} codes created`), tone: "success" });
  };
  const used = codes.filter((c) => c.usedAt).length;
  return (
    <Dialog open={!!promo} onClose={onClose} size="lg" title={L("أكواد شخصية (استخدام مرة واحدة)", "Unique single-use codes")} description={promo ? loc(promo.name) : ""}>
      <div className="grid gap-4 pb-1">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <NumberInput label={L("العدد", "How many")} value={n} onChange={(x) => setN(Math.min(500, Math.max(1, Math.round(x))))} />
          <Input label={L("بادئة", "Prefix")} dir="ltr" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          <Button onClick={make}>{L("اعمل أكواد", "Generate")}</Button>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <Badge>{L(`${codes.length} كود`, `${codes.length} codes`)}</Badge>
          <Badge tone="ok">{L(`${used} اتستخدم`, `${used} used`)}</Badge>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard?.writeText(codes.filter((c) => !c.usedAt).map((c) => c.code).join("\n"))}>
            {L("انسخ المتاح", "Copy unused")}
          </Button>
        </div>
        <ul className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto text-[13px] sm:grid-cols-3 thin-scrollbar">
          {codes.map((c) => (
            <li key={c.id} className={`num rounded-lg border px-2 py-1 ${c.usedAt ? "border-line text-faint line-through" : "border-line"}`} dir="ltr">
              {c.code}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
