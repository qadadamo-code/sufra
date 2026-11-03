import { useEffect, useMemo, useState } from "react";
import { Eye, ImagePlus, MousePointerClick, Plus, ReceiptText, Save, Sparkles, Trash2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { BannerPlacement, PromoBanner, ReceiptPromoBlock } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { buildReceiptModel, ReceiptView } from "@/lib/receipt";
import { sampleBill } from "@/modules/settings/invoice/sample";
import { Badge, Button, Dialog, EmptyState, IconButton, Input, Select, Switch, useToast } from "@/ui";
import { BannerCard } from "./guest/PromoStrip";
import { LocalizedInput, pct, Section } from "./ui";

const PLACEMENTS: { value: BannerPlacement; ar: string; en: string }[] = [
  { value: "menu_top", ar: "أول المنيو", en: "Menu top" },
  { value: "table", ar: "منيو الترابيزة (QR)", en: "Table QR menu" },
  { value: "online_top", ar: "صفحة الطلب أونلاين", en: "Online ordering" },
  { value: "checkout", ar: "الدفع", en: "Checkout" },
];
const COLORS = ["#0d5a53", "#c2412d", "#2f6f9f", "#a8700c", "#9a3b6b", "#4b6b3a", "#16211e"];

type Draft = Omit<PromoBanner, "id" | "restaurantId" | "createdAt" | "updatedAt"> & { id?: string };

export default function OwnPromosPage() {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { can, restaurant } = useSession();
  const banners = useLive("promoBanners", { orderBy: [{ field: "sort" }] }).data;
  const promos = useLive("promotions", { where: { active: true } }).data;
  const menu = useLive("menuItems", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const [edit, setEdit] = useState<Draft | null>(null);
  const editable = can("marketing.manage");

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Section
        title={L("بانرات على منيو الـ QR والطلب أونلاين", "Banners on the QR menu & online ordering")}
        subtitle={L("عروضك لزباينك — بتظهر في الوقت اللي تحدده", "Your offers to your own guests — shown when you schedule them")}
        icon={<Sparkles />}
        action={editable ? <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ title: { ar: "", en: "" }, body: { ar: "", en: "" }, badge: "🎁", imageUrl: null, color: COLORS[0], placements: ["menu_top", "table", "online_top"], promotionId: null, itemId: null, window: null, modes: [], active: true, sort: banners.length + 1, stats: { impressions: 0, clicks: 0 } })}>{L("بانر", "Banner")}</Button> : null}
      >
        {banners.length ? (
          <ul className="grid gap-4">
            {banners.map((b) => (
              <li key={b.id} className="grid gap-2">
                <div className={b.active ? "" : "opacity-50 grayscale"}>
                  <BannerCard b={b} onClick={editable ? () => setEdit({ ...b }) : undefined} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                  {b.placements.map((p) => (
                    <Badge key={p} size="sm">{lang === "ar" ? PLACEMENTS.find((x) => x.value === p)?.ar : PLACEMENTS.find((x) => x.value === p)?.en}</Badge>
                  ))}
                  {b.promotionId ? <Badge size="sm" tone="primary">{loc(promos.find((p) => p.id === b.promotionId)?.name)}</Badge> : null}
                  <span className="flex-1" />
                  <span className="inline-flex items-center gap-1"><Eye className="size-3.5" />{b.stats.impressions.toLocaleString("en")}</span>
                  <span className="inline-flex items-center gap-1"><MousePointerClick className="size-3.5" />{b.stats.clicks.toLocaleString("en")} · {b.stats.impressions ? pct(b.stats.clicks / b.stats.impressions, 1) : "—"}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState compact icon={<ImagePlus />} title={L("مفيش بانرات", "No banners")} />
        )}
        <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
          <a className="font-semibold text-primary" href={`${import.meta.env.BASE_URL}r/${restaurant?.slug ?? ""}/t/ZM05`} target="_blank" rel="noreferrer">{L("شوفها على منيو الترابيزة ↗", "See it on a table menu ↗")}</a>
          <a className="font-semibold text-primary" href={`${import.meta.env.BASE_URL}r/${restaurant?.slug ?? ""}`} target="_blank" rel="noreferrer">{L("وعلى الطلب أونلاين ↗", "and on online ordering ↗")}</a>
        </div>
      </Section>

      <ReceiptPromoEditor />

      <Dialog open={!!edit} onClose={() => setEdit(null)} size="lg" title={edit?.id ? L("تعديل البانر", "Edit banner") : L("بانر جديد", "New banner")} footer={edit ? (
        <div className="flex w-full items-center gap-2">
          {edit.id ? <IconButton label={L("امسح", "Delete")} onClick={async () => { await db.remove("promoBanners", edit.id!); setEdit(null); }}><Trash2 /></IconButton> : null}
          <Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label={L("ظاهر", "Visible")} />
          <span className="flex-1" />
          <Button size="lg" icon={<Save className="size-4" />} disabled={!edit.title.ar.trim()} onClick={async () => {
            const { id, ...row } = edit;
            if (id) await db.update("promoBanners", id, row);
            else await db.insert("promoBanners", row);
            setEdit(null);
          }}>{L("احفظ", "Save")}</Button>
        </div>
      ) : undefined}>
        {edit ? (
          <div className="grid gap-4 pb-1">
            <BannerCard b={{ ...edit, title: edit.title.ar ? edit.title : { ar: "العنوان", en: "Title" }, body: edit.body.ar ? edit.body : { ar: "التفاصيل", en: "Details" } }} />
            <LocalizedInput label={L("العنوان", "Title")} value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
            <LocalizedInput label={L("التفاصيل", "Details")} value={edit.body} onChange={(v) => setEdit({ ...edit, body: v })} />
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
              <Input label={L("شارة", "Badge")} value={edit.badge} maxLength={4} onChange={(e) => setEdit({ ...edit, badge: e.target.value })} />
              <div className="grid gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">{L("اللون", "Colour")}</span>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button key={c} type="button" aria-label={c} aria-pressed={edit.color === c} onClick={() => setEdit({ ...edit, color: c })} className={`size-10 rounded-full ring-offset-2 ring-offset-surface ${edit.color === c ? "ring-2 ring-primary" : ""}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-semibold text-ink-2">{L("يظهر فين", "Placements")}</span>
              <div className="flex flex-wrap gap-1.5">
                {PLACEMENTS.map((p) => {
                  const on = edit.placements.includes(p.value);
                  return (
                    <button key={p.value} type="button" aria-pressed={on} onClick={() => setEdit({ ...edit, placements: on ? edit.placements.filter((x) => x !== p.value) : [...edit.placements, p.value] })} className={`h-9 rounded-full border px-3 text-[13px] font-semibold ${on ? "border-primary bg-primary-soft text-primary" : "border-line text-muted"}`}>
                      {lang === "ar" ? p.ar : p.en}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label={L("مربوط بعرض", "Linked offer")} value={edit.promotionId ?? ""} onChange={(e) => setEdit({ ...edit, promotionId: e.target.value || null })} options={[{ value: "", label: "—" }, ...promos.map((p) => ({ value: p.id, label: loc(p.name) }))]} />
              <Select label={L("لما يدوس يفتح صنف", "Tap opens item")} value={edit.itemId ?? ""} onChange={(e) => setEdit({ ...edit, itemId: e.target.value || null })} options={[{ value: "", label: "—" }, ...menu.map((m) => ({ value: m.id, label: loc(m.name) }))]} />
              <Input type="datetime-local" label={L("يبدأ", "Starts")} value={edit.window?.startsAt?.slice(0, 16) ?? ""} onChange={(e) => setEdit({ ...edit, window: { startsAt: e.target.value ? new Date(e.target.value).toISOString() : null, endsAt: edit.window?.endsAt ?? null, from: edit.window?.from, to: edit.window?.to } })} />
              <Input type="datetime-local" label={L("ينتهي", "Ends")} value={edit.window?.endsAt?.slice(0, 16) ?? ""} onChange={(e) => setEdit({ ...edit, window: { startsAt: edit.window?.startsAt ?? null, endsAt: e.target.value ? new Date(e.target.value).toISOString() : null, from: edit.window?.from, to: edit.window?.to } })} />
              <Input type="time" label={L("كل يوم من", "Daily from")} value={edit.window?.from ?? ""} onChange={(e) => setEdit({ ...edit, window: { startsAt: edit.window?.startsAt ?? null, endsAt: edit.window?.endsAt ?? null, from: e.target.value || null, to: edit.window?.to } })} />
              <Input type="time" label={L("لحد", "to")} value={edit.window?.to ?? ""} onChange={(e) => setEdit({ ...edit, window: { startsAt: edit.window?.startsAt ?? null, endsAt: edit.window?.endsAt ?? null, from: edit.window?.from, to: e.target.value || null } })} />
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function ReceiptPromoEditor() {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { can, restaurant } = useSession();
  const settings = useLive("settings").data[0] ?? null;
  const [p, setP] = useState<ReceiptPromoBlock | null>(null);
  useEffect(() => {
    if (settings && !p) setP(settings.invoice.promo ?? { enabled: true, title: { ar: "زيارتك الجاية علينا ١٠٪", en: "10% off your next visit" }, body: { ar: "", en: "" }, code: "NEXT10", qr: "loyalty", url: null, startsAt: null, endsAt: null });
  }, [settings, p]);
  const model = useMemo(() => {
    if (!settings || !p || !restaurant) return null;
    const { bill } = sampleBill(settings.tax);
    if (!bill) return null;
    return buildReceiptModel({
      kind: "SC", bill, tax: settings.tax, invoice: { ...settings.invoice, promo: p, language: lang === "ar" ? "ar" : "en", design: settings.invoice.design ? { ...settings.invoice.design, paper: "80" } : undefined },
      restaurant: { name: restaurant.name, phone: restaurant.phone, slug: restaurant.slug }, branch: null, receiptNo: "POS1-000128", orderNumber: 57, issuedAt: new Date().toISOString(), cashier: null, waiter: null,
      tableLabels: ["7"], guests: 4, mode: "dine_in", customer: null, payments: [{ method: "card", amount: bill.payable, tip: 0 }], tendered: null, change: null, eta: null,
    });
  }, [settings, p, restaurant, lang]);
  if (!p) return null;
  return (
    <Section title={L("عرض على الإيصال", "Receipt promo block")} subtitle={L("كوبون الزيارة الجاية + QR لكارت الولاء أو التقييم", "Next-visit coupon + QR to the loyalty card or feedback")} icon={<ReceiptText />} action={can("settings.edit") || can("marketing.manage") ? <Button size="sm" icon={<Save className="size-4" />} onClick={async () => {
      if (!settings) return;
      await db.update("settings", settings.id, { invoice: { ...settings.invoice, promo: p } });
      toast({ title: L("الإيصال اتحدّث", "Receipt updated"), tone: "success" });
    }}>{L("احفظ", "Save")}</Button> : null}>
      <div className="grid gap-4">
        <Switch checked={p.enabled} onChange={(v) => setP({ ...p, enabled: v })} label={L("اطبع العرض على الإيصال", "Print the promo on receipts")} />
        <LocalizedInput label={L("العنوان", "Title")} value={p.title} onChange={(v) => setP({ ...p, title: v })} />
        <LocalizedInput label={L("التفاصيل", "Details")} value={p.body} onChange={(v) => setP({ ...p, body: v })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={L("كود الكوبون", "Coupon code")} dir="ltr" value={p.code ?? ""} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase() || null })} hint={L("لازم يبقى فيه كوبون بنفس الكود في العروض", "Must match a coupon in Offers")} />
          <Select label={L("الـ QR يفتح", "QR opens")} value={p.qr} onChange={(e) => setP({ ...p, qr: e.target.value as ReceiptPromoBlock["qr"] })} options={[{ value: "loyalty", label: L("كارت الولاء", "Loyalty card") }, { value: "feedback", label: L("التقييم", "Feedback") }, { value: "menu", label: L("المنيو أونلاين", "Online menu") }, { value: "url", label: L("لينك", "Custom URL") }, { value: "none", label: L("من غير QR", "No QR") }]} />
          {p.qr === "url" ? <Input label="URL" dir="ltr" value={p.url ?? ""} onChange={(e) => setP({ ...p, url: e.target.value || null })} /> : null}
        </div>
        {model ? (
          <div className="grid place-items-center rounded-2xl bg-surface-3 p-4">
            <div className="origin-top scale-[0.85] bg-white text-black shadow-sf">
              <ReceiptView model={model} />
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  );
}
