/** Receipt / invoice designer with a live preview (58 mm, 80 mm, A4), saved to the restaurant's settings. */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { ImagePlus, Printer, RotateCcw, Save, Trash2, Type } from "lucide-react";
import { useSession, useBranch } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { InvoiceDesign, InvoiceTemplate, Localized } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { buildReceiptModel, DEFAULT_DESIGN, printNode, ReceiptView, resolveDesign } from "@/lib/receipt";
import { ETA_PORTAL } from "@/lib/receipt/eta";
import { PageHeader } from "@/shell/PageHeader";
import { Button, Card, Segmented, Switch, useReduced, useToast } from "@/ui";
import { SAMPLE_UUID, sampleBill } from "./sample";
import { SettingsNav } from "../SettingsNav";

const ACCENTS = ["#0d5a53", "#16211e", "#a8700c", "#c2412d", "#2f6f9f", "#6b4fa0"];
type FieldKey = keyof InvoiceDesign["fields"];

/** Downscale an uploaded logo to ≤ 480 px wide PNG (thermal heads are 384–576 dots), keeping settings small. */
async function shrinkLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, 480 / img.width, 240 / img.height);
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function InvoiceDesigner() {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { can, restaurant, staff } = useSession();
  const branch = useBranch();
  const reduced = useReduced();
  const settings = useLive("settings").data[0] ?? null;
  const [tpl, setTpl] = useState<InvoiceTemplate | null>(null);
  const [kind, setKind] = useState<"SC" | "prebill">("SC");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const editable = can("settings.edit");

  useEffect(() => {
    if (settings && !tpl) setTpl({ ...settings.invoice, design: resolveDesign(settings.invoice) });
  }, [settings, tpl]);
  const dirty = !!settings && !!tpl && JSON.stringify({ ...settings.invoice, design: resolveDesign(settings.invoice) }) !== JSON.stringify(tpl);
  const design = tpl?.design ?? DEFAULT_DESIGN;
  const setDesign = (p: Partial<InvoiceDesign>) => setTpl((t) => (t ? { ...t, design: { ...resolveDesign(t), ...p } } : t));
  const setField = (k: FieldKey, v: boolean) => setDesign({ fields: { ...design.fields, [k]: v } });
  const setText = (k: "header" | "footer", l: keyof Localized, v: string) => setTpl((t) => (t ? { ...t, [k]: { ...t[k], [l]: v } } : t));

  const model = useMemo(() => {
    if (!settings || !tpl || !restaurant) return null;
    const { bill } = sampleBill(settings.tax);
    if (!bill) return null;
    return buildReceiptModel({
      kind,
      bill,
      tax: { ...settings.tax, taxId: settings.tax.taxId || "000-000-000" },
      invoice: { ...tpl, paperWidth: design.paper === "58" ? 58 : 80 },
      restaurant: { name: restaurant.name, phone: restaurant.phone },
      branch: branch ? { name: branch.name, address: branch.address, phone: branch.phone } : null,
      receiptNo: kind === "SC" ? "POS1-000128" : null,
      orderNumber: 57,
      issuedAt: new Date().toISOString(),
      cashier: staff?.name ?? "سارة حسني",
      waiter: "أحمد سمير",
      tableLabels: ["7"],
      guests: 4,
      mode: "dine_in",
      customer: { name: "دينا الشافعي", phone: "01005551201" },
      payments: kind === "SC" ? [{ method: "card", amount: bill.payable, tip: 5_000_000 }] : [],
      tendered: null,
      change: null,
      eta: kind === "SC" ? { uuid: SAMPLE_UUID, qr: `${ETA_PORTAL.preprod}/receipts/search/${SAMPLE_UUID}/share/2026-10-23T18:30Z#Total:${(bill.payable / 100_000).toFixed(3)},IssuerRIN:000000000` } : null,
    });
  }, [settings, tpl, restaurant, branch, staff, kind, design.paper]);

  const save = async () => {
    if (!settings || !tpl) return;
    setSaving(true);
    try {
      await db.update("settings", settings.id, { invoice: { ...tpl, paperWidth: design.paper === "58" ? 58 : 80 } });
      await db.audit("settings.invoice", "settings", settings.id, { paper: design.paper, language: tpl.language });
      toast({ title: L("شكل الفاتورة اتحفظ", "Invoice design saved"), tone: "success" });
    } finally {
      setSaving(false);
    }
  };

  const FIELDS: [FieldKey | "showWaiter" | "showQr" | "showLogo", string][] = [
    ["showLogo", L("اللوجو", "Logo")],
    ["branch", L("اسم الفرع", "Branch name")],
    ["address", L("العنوان", "Address")],
    ["phone", L("التليفون", "Phone")],
    ["taxId", L("رقم التسجيل الضريبي", "Tax reg. no (RIN)")],
    ["activityCode", L("كود النشاط", "Activity code")],
    ["orderType", L("نوع الطلب", "Order type")],
    ["table", L("الترابيزة", "Table")],
    ["guests", L("عدد الأفراد", "Guests")],
    ["cashier", L("الكاشير", "Cashier")],
    ["showWaiter", L("الجرسون", "Waiter")],
    ["customer", L("بيانات العميل", "Customer")],
    ["modifiers", L("إضافات الصنف", "Item modifiers")],
    ["itemNotes", L("ملاحظات الصنف", "Item notes")],
    ["serviceVatLines", L("سطر الخدمة والضريبة", "Service & VAT lines")],
    ["payments", L("الدفع والباقي", "Payments & change")],
    ["showQr", L("QR الإيصال الإلكتروني", "ETA QR code")],
    ["etaUuid", L("UUID الإيصال", "ETA UUID")],
  ];
  const fieldOn = (k: (typeof FIELDS)[number][0]) => (k === "showWaiter" || k === "showQr" || k === "showLogo" ? !!tpl?.[k] : design.fields[k]);
  const toggle = (k: (typeof FIELDS)[number][0], v: boolean) => (k === "showWaiter" || k === "showQr" || k === "showLogo" ? setTpl((t) => (t ? { ...t, [k]: v } : t)) : setField(k, v));

  if (!tpl || !settings) return null;
  return (
    <div className="grid gap-6">
      <SettingsNav />
      <PageHeader
        icon={<Printer />}
        title={L("شكل الفاتورة", "Invoice design")}
        subtitle={L("إيصال الكاشير ٥٨/٨٠ مم وفاتورة A4 — عربي وإنجليزي، باللوجو والـ QR", "58/80 mm receipts and A4 invoices — Arabic and English, with logo and QR")}
        actions={
          <>
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} disabled={!dirty} onClick={() => setTpl({ ...settings.invoice, design: resolveDesign(settings.invoice) })}>
              {L("تراجع", "Discard")}
            </Button>
            <Button icon={<Save className="size-4" />} disabled={!dirty || !editable} loading={saving} onClick={save}>
              {L("حفظ", "Save")}
            </Button>
          </>
        }
      />
      {!editable ? <p className="rounded-xl bg-info-soft px-4 py-2.5 text-[14px] text-info">{L("عرض بس — التعديل لصاحب المطعم أو الأدمن.", "View only — owners and admins can edit.")}</p> : null}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <fieldset disabled={!editable} className="grid gap-4">
          <Card className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("مقاس الورق", "Paper")}</p>
                <Segmented block label={L("مقاس الورق", "Paper")} value={design.paper} onChange={(v) => setDesign({ paper: v })} options={[{ value: "58", label: "58mm" }, { value: "80", label: "80mm" }, { value: "a4", label: "A4" }]} />
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("اللغة", "Language")}</p>
                <Segmented block label={L("اللغة", "Language")} value={tpl.language} onChange={(v) => setTpl({ ...tpl, language: v })} options={[{ value: "ar", label: "عربي" }, { value: "en", label: "English" }, { value: "both", label: L("الاتنين", "Both") }]} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="grid size-20 place-items-center overflow-hidden rounded-2xl border border-dashed border-line-strong bg-surface-2">
                {design.logoDataUrl ? <img src={design.logoDataUrl} alt={L("اللوجو", "Logo")} className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-7 text-faint" />}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    try {
                      setDesign({ logoDataUrl: await shrinkLogo(f) });
                      setTpl((t) => (t ? { ...t, showLogo: true } : t));
                    } catch {
                      toast({ title: L("الصورة دي مش نافعة", "That image could not be read"), tone: "error" });
                    }
                    e.target.value = "";
                  }}
                />
                <Button variant="secondary" icon={<ImagePlus className="size-4" />} onClick={() => fileRef.current?.click()}>
                  {design.logoDataUrl ? L("غيّر اللوجو", "Change logo") : L("ارفع لوجو", "Upload logo")}
                </Button>
                {design.logoDataUrl ? (
                  <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => setDesign({ logoDataUrl: null })}>
                    {L("شيل", "Remove")}
                  </Button>
                ) : null}
                <p className="w-full text-[12.5px] text-muted">{L("PNG بخلفية شفافة أحسن. بيتصغّر تلقائيًا ويتطبع أبيض وأسود على الحراري.", "Transparent PNG works best. Auto-downsized; printed black & white on thermal.")}</p>
              </div>
            </div>
          </Card>

          <Card className="grid gap-4 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextBox label={L("الهيدر (عربي)", "Header (Arabic)")} value={tpl.header.ar} onChange={(v) => setText("header", "ar", v)} dir="rtl" />
              <TextBox label={L("الهيدر (إنجليزي)", "Header (English)")} value={tpl.header.en} onChange={(v) => setText("header", "en", v)} dir="ltr" />
              <TextBox label={L("الفوتر (عربي)", "Footer (Arabic)")} value={tpl.footer.ar} onChange={(v) => setText("footer", "ar", v)} dir="rtl" rows={2} />
              <TextBox label={L("الفوتر (إنجليزي)", "Footer (English)")} value={tpl.footer.en} onChange={(v) => setText("footer", "en", v)} dir="ltr" rows={2} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                  <Type className="size-4" /> {L("حجم الخط", "Font size")} <span className="num text-muted">{design.fontSize}px</span>
                </p>
                <input type="range" min={10} max={15} step={0.5} value={design.fontSize} onChange={(e) => setDesign({ fontSize: Number(e.target.value) })} className="w-full accent-[var(--sf-primary)]" aria-label={L("حجم الخط", "Font size")} />
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("لون الفاتورة (A4)", "Accent colour (A4)")}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {ACCENTS.map((c) => (
                    <button key={c} type="button" onClick={() => setDesign({ accent: c })} aria-label={c} aria-pressed={design.accent === c} className={cn("size-9 rounded-full border-2 transition-transform", design.accent === c ? "scale-110 border-ink" : "border-transparent")} style={{ background: c }} />
                  ))}
                  <input type="color" value={design.accent} onChange={(e) => setDesign({ accent: e.target.value })} className="size-9 cursor-pointer rounded-full border border-line bg-transparent" aria-label={L("لون مخصص", "Custom colour")} />
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <p className="mb-1 text-[13px] font-semibold text-ink-2">{L("الحقول اللي تظهر", "Fields to show")}</p>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {FIELDS.map(([k, label]) => (
                <Switch key={k} label={<span className="text-[14.5px] font-medium">{label}</span>} checked={fieldOn(k)} onChange={(v) => toggle(k, v)} />
              ))}
            </div>
          </Card>
        </fieldset>

        <div className="lg:sticky lg:top-20">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Segmented size="sm" label={L("المعاينة", "Preview")} value={kind} onChange={setKind} options={[{ value: "SC", label: L("إيصال", "Receipt") }, { value: "prebill", label: L("شيك مبدئي", "Pre-bill") }]} />
            <Button size="sm" variant="secondary" icon={<Printer className="size-4" />} onClick={() => model && printNode(<ReceiptView model={model} />, design.paper)}>
              {L("اطبع تجربة", "Test print")}
            </Button>
          </div>
          <div className="max-h-[calc(100dvh-10rem)] overflow-auto rounded-[22px] border border-line bg-surface-3 p-5 paper-grain thin-scrollbar">
            {model ? (
              <motion.div key={design.paper} layout={!reduced} initial={reduced ? false : { opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-fit shadow-sf-lg" style={design.paper === "a4" ? { zoom: 0.72 } : undefined}>
                <ReceiptView model={model} />
              </motion.div>
            ) : null}
          </div>
          <p className="mt-2 text-[12.5px] text-muted">
            {L("بيانات تجريبية. الأرقام محسوبة بإعدادات الضرايب الحالية.", "Sample data, priced with the current tax settings.")}
          </p>
        </div>
      </div>
    </div>
  );
}

function TextBox({ label, value, onChange, dir, rows = 1 }: { label: string; value: string; onChange: (v: string) => void; dir: "rtl" | "ltr"; rows?: number }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-semibold text-ink-2">{label}</span>
      <textarea dir={dir} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} maxLength={160} className="resize-none rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] outline-none focus:border-primary focus:shadow-[var(--sf-glow)]" />
    </label>
  );
}
