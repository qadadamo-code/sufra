/**
 * Tax profile (feeds @finance/tax for every bill) + Egyptian ETA e-receipt setup, with a live bill preview.
 * Client id/secret for ETA are never entered here: they belong to the server function that submits receipts.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, BadgeCheck, Building2, Calculator, CheckCircle2, KeyRound, Landmark, Percent, Receipt, Save, RotateCcw, ServerCog } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { EtaSettings, OrderMode, TaxSettings as Tax } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { DEFAULT_ETA, etaReadiness, etaSettingsOf } from "@/lib/receipt/eta";
import { PageHeader } from "@/shell/PageHeader";
import { AnimatedMoney, Badge, Button, Card, CardHeader, Input, Segmented, Select, Switch, useToast } from "@/ui";
import { sampleBill } from "../invoice/sample";
import { SettingsNav } from "../SettingsNav";

const pctText = (bp: number) => String(bp / 100);
const toBp = (s: string) => Math.max(0, Math.min(10_000, Math.round(Number(s || 0) * 100)));

export default function TaxSettings() {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { can } = useSession();
  const settings = useLive("settings").data[0] ?? null;
  const [tax, setTax] = useState<Tax | null>(null);
  const [eta, setEta] = useState<EtaSettings>(DEFAULT_ETA);
  const [saving, setSaving] = useState(false);
  const editable = can("settings.tax");

  useEffect(() => {
    if (settings && !tax) {
      setTax(settings.tax);
      setEta(etaSettingsOf(settings));
    }
  }, [settings, tax]);
  const dirty = !!settings && !!tax && (JSON.stringify(settings.tax) !== JSON.stringify(tax) || JSON.stringify(etaSettingsOf(settings)) !== JSON.stringify(eta));
  const set = (p: Partial<Tax>) => setTax((t) => (t ? { ...t, ...p } : t));
  const setE = (p: Partial<EtaSettings>) => setEta((e) => ({ ...e, ...p }));
  const ready = useMemo(() => (settings && tax ? etaReadiness({ ...settings, tax, eta }) : { ok: false, missing: [] }), [settings, tax, eta]);
  const serviceMode: "T9" | "T17" | "none" = !tax?.serviceCode ? "none" : tax.serviceCode.type === "T17" ? "T17" : "T9";

  const previews = useMemo(() => {
    if (!tax) return [];
    return (["dine_in", "takeaway", "delivery"] as OrderMode[]).map((m) => ({ mode: m, ...sampleBill(tax, m, m === "delivery" ? 35 : 0) }));
  }, [tax]);

  const save = async () => {
    if (!settings || !tax) return;
    setSaving(true);
    try {
      await db.update("settings", settings.id, { tax, eta });
      await db.audit("settings.tax", "settings", settings.id, { vatRate: tax.vatRate, serviceRate: tax.serviceRate, priceMode: tax.priceMode, serviceCode: tax.serviceCode, eta: { environment: eta.environment, enabled: eta.enabled } });
      toast({ title: L("إعدادات الضرايب اتحفظت", "Tax settings saved"), description: L("الشيكات الجديدة هتتحسب بيها فورًا", "New checks are priced with them right away"), tone: "success" });
    } finally {
      setSaving(false);
    }
  };

  if (!tax || !settings) return null;
  const MODE_LABEL: Record<OrderMode, string> = { dine_in: L("صالة", "Dine-in"), takeaway: L("تيك أواي", "Takeaway"), delivery: L("دليفري", "Delivery") };
  const MISSING: Record<string, string> = { rin: L("رقم التسجيل (٩ أرقام)", "RIN (9 digits)"), activity: L("كود النشاط", "Activity code"), serial: L("سيريال الجهاز", "POS serial"), tradeName: L("الاسم التجاري", "Trade name"), address: L("عنوان الفرع", "Branch address") };

  return (
    <div className="grid gap-6">
      <SettingsNav />
      <PageHeader
        icon={<Landmark />}
        title={L("الضرايب والإيصال الإلكتروني", "Tax & e-receipts")}
        subtitle={L("ضريبة القيمة المضافة، الخدمة، ومصلحة الضرائب (ETA)", "VAT, service charge and the Egyptian Tax Authority (ETA)")}
        actions={
          <>
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} disabled={!dirty} onClick={() => (setTax(settings.tax), setEta(etaSettingsOf(settings)))}>
              {L("تراجع", "Discard")}
            </Button>
            <Button icon={<Save className="size-4" />} disabled={!dirty || !editable} loading={saving} onClick={save}>
              {L("حفظ", "Save")}
            </Button>
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <fieldset disabled={!editable} className="grid gap-5">
          <Card>
            <CardHeader icon={<Percent />} title={L("ضريبة القيمة المضافة", "VAT")} subtitle={L("المحاسب بيحدد لو الفرع خاضع (القرار ٨٢/٢٠١٧ و٢٨٥/٢٠٢١)", "Your accountant decides whether this outlet is liable (Decrees 82/2017, 285/2021)")} />
            <div className="grid gap-4 px-5 pb-5">
              <Switch label={L("الفرع مسجل في القيمة المضافة", "Outlet is VAT-registered")} checked={tax.vatRegistered} onChange={(v) => set({ vatRegistered: v })} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Input label={L("نسبة الضريبة %", "VAT rate %")} value={pctText(tax.vatRate)} onChange={(e) => set({ vatRate: toBp(e.target.value) })} inputMode="decimal" dir="ltr" disabled={!tax.vatRegistered} />
                <Input label={L("نوع الضريبة (ETA)", "Tax type (ETA)")} value={tax.vatCode.type} onChange={(e) => set({ vatCode: { ...tax.vatCode, type: e.target.value.toUpperCase() } })} dir="ltr" disabled={!tax.vatRegistered} />
                <Input label={L("النوع الفرعي", "Sub-type")} value={tax.vatCode.subType} onChange={(e) => set({ vatCode: { ...tax.vatCode, subType: e.target.value.toUpperCase() } })} dir="ltr" disabled={!tax.vatRegistered} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("أسعار المنيو", "Menu prices")}</p>
                  <Segmented block label={L("أسعار المنيو", "Menu prices")} value={tax.priceMode} onChange={(v) => set({ priceMode: v })} options={[{ value: "exclusive", label: L("من غير ضريبة وخدمة", "Exclusive") }, { value: "inclusive", label: L("شاملة", "Inclusive") }]} />
                </div>
                <Switch label={L("ضريبة على رسوم التوصيل", "VAT on delivery fee")} checked={tax.vatOnDelivery} onChange={(v) => set({ vatOnDelivery: v })} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Receipt />} title={L("الخدمة", "Service charge")} subtitle={L("عادةً ١٢٪ على الصالة بس", "Usually 12%, dine-in only")} />
            <div className="grid gap-4 px-5 pb-5">
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <Input label={L("نسبة الخدمة %", "Service %")} value={pctText(tax.serviceRate)} onChange={(e) => set({ serviceRate: toBp(e.target.value) })} inputMode="decimal" dir="ltr" />
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("تتحسب على", "Applies to")}</p>
                  <div className="flex flex-wrap gap-2">
                    {(["dine_in", "takeaway", "delivery"] as OrderMode[]).map((m) => {
                      const on = tax.serviceModes.includes(m);
                      return (
                        <button key={m} type="button" aria-pressed={on} onClick={() => set({ serviceModes: on ? tax.serviceModes.filter((x) => x !== m) : [...tax.serviceModes, m] })} className={cn("h-11 rounded-xl border px-4 font-semibold", on ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-surface-2")}>
                          {MODE_LABEL[m]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("الخدمة على الإيصال الإلكتروني", "Service on the e-receipt")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Choice on={serviceMode === "T9"} onClick={() => set({ serviceCode: { type: "T9", subType: "SC01" }, vatOnService: true })} title="T9 / SC01" body={L("الخدمة جوه وعاء الضريبة (ضريبة على الخدمة). ده رأي مصلحة الضرائب في الـ FAQ.", "Service inside the VAT base (VAT on service). The ETA FAQ position.")} />
                  <Choice on={serviceMode === "T17"} onClick={() => set({ serviceCode: { type: "T17", subType: "SC03" }, vatOnService: false })} title="T17 / SC03" body={L("الخدمة رسم برة وعاء الضريبة — بس لو المحاسب قرر كده.", "Service as a fee outside the VAT base — only if your accountant rules so.")} />
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader icon={<Building2 />} title={L("بيانات التسجيل", "Registration")} />
            <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
              <Input label={L("رقم التسجيل الضريبي (RIN)", "Tax registration no (RIN)")} value={tax.taxId} onChange={(e) => set({ taxId: e.target.value.replace(/[^\d-]/g, "") })} dir="ltr" placeholder="123-456-789" error={tax.taxId && !/^\d{9}$/.test(tax.taxId.replace(/\D/g, "")) ? L("٩ أرقام", "9 digits") : undefined} />
              <Input label={L("السجل التجاري", "Commercial register")} value={tax.commercialRegister} onChange={(e) => set({ commercialRegister: e.target.value })} dir="ltr" />
              <Select
                label={L("كود النشاط", "Activity code")}
                value={["5610", "5630", "5621", "5629"].includes(tax.activityCode) ? tax.activityCode : "5610"}
                onChange={(e) => set({ activityCode: e.target.value })}
                options={[
                  { value: "5610", label: L("5610 — مطاعم", "5610 — Restaurants") },
                  { value: "5630", label: L("5630 — كافيهات ومشروبات", "5630 — Cafés & beverages") },
                  { value: "5621", label: L("5621 — تجهيز حفلات", "5621 — Event catering") },
                  { value: "5629", label: L("5629 — خدمات طعام أخرى", "5629 — Other food service") },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              icon={<BadgeCheck />}
              title={L("الإيصال الإلكتروني (ETA)", "ETA e-receipts")}
              subtitle={L("كل شيك بيتقفل بيطلع إيصال متسلسل بـ UUID و QR", "Every closed check issues a chained receipt with a UUID and QR")}
              action={ready.ok ? <Badge tone="ok" icon={<CheckCircle2 className="size-3.5" />}>{L("جاهز", "Ready")}</Badge> : <Badge tone="warn" icon={<AlertTriangle className="size-3.5" />}>{L("ناقص بيانات", "Incomplete")}</Badge>}
            />
            <div className="grid gap-4 px-5 pb-5">
              <Switch label={L("اطلع إيصال إلكتروني لكل شيك", "Issue an e-receipt for every check")} checked={eta.enabled} onChange={(v) => setE({ enabled: v })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[13px] font-semibold text-ink-2">{L("البيئة", "Environment")}</p>
                  <Segmented block label={L("البيئة", "Environment")} value={eta.environment} onChange={(v) => setE({ environment: v })} options={[{ value: "preprod", label: L("تجريبي (preprod)", "Pre-production") }, { value: "prod", label: L("إنتاج", "Production") }]} />
                </div>
                <Input label={L("سيريال جهاز الـ POS المسجل", "Registered POS serial")} value={eta.posSerial} onChange={(e) => setE({ posSerial: e.target.value })} dir="ltr" placeholder="SUFRA-POS-0001" />
                <Input label={L("الاسم التجاري (زي المسجل)", "Trade name (as registered)")} value={eta.tradeName} onChange={(e) => setE({ tradeName: e.target.value })} />
                <Select label={L("الدفع المقسوم بيتبعت كـ", "Split tender reported as")} value={eta.splitTender} onChange={(e) => setE({ splitTender: e.target.value as EtaSettings["splitTender"] })} options={[{ value: "dominant", label: L("الطريقة الأكبر", "Largest tender") }, { value: "others", label: L("أخرى (O)", "Others (O)") }]} />
              </div>
              <div className="grid gap-3 sm:grid-cols-5">
                <Input label={L("المحافظة", "Governorate")} value={eta.branchAddress.governate} onChange={(e) => setE({ branchAddress: { ...eta.branchAddress, governate: e.target.value } })} />
                <Input label={L("المدينة/الحي", "City / area")} value={eta.branchAddress.regionCity} onChange={(e) => setE({ branchAddress: { ...eta.branchAddress, regionCity: e.target.value } })} />
                <div className="sm:col-span-2">
                  <Input label={L("الشارع", "Street")} value={eta.branchAddress.street} onChange={(e) => setE({ branchAddress: { ...eta.branchAddress, street: e.target.value } })} />
                </div>
                <Input label={L("رقم المبنى", "Building no")} value={eta.branchAddress.buildingNumber} onChange={(e) => setE({ branchAddress: { ...eta.branchAddress, buildingNumber: e.target.value } })} dir="ltr" />
              </div>
              <Input label={L("بادئة كود الصنف (EGS)", "Item code prefix (EGS)")} value={eta.itemCodePrefix} onChange={(e) => setE({ itemCodePrefix: e.target.value })} dir="ltr" placeholder={`EG-${tax.taxId.replace(/\D/g, "") || "000000000"}-`} hint={L("الأكواد لازم تتسجل على بوابة المصلحة قبل الإنتاج", "Codes must be registered on the ETA portal before production")} />
              <div className="flex items-start gap-3 rounded-2xl border border-line bg-surface-2 p-4">
                <KeyRound className="mt-0.5 size-5 shrink-0 text-muted" />
                <div className="min-w-0 flex-1 text-[13.5px]">
                  <p className="font-semibold">{L("بيانات الدخول (client id / secret)", "Credentials (client id / secret)")}</p>
                  <p className="mt-0.5 text-muted">{L("دول أسرار السيرفر: بيتحطوا في متغيرات البيئة لدالة api/eta-submit، مش في المتصفح ولا في قاعدة البيانات اللي التابلت بيقراها.", "These are server secrets: set them as environment variables of the api/eta-submit function — never in the browser or in rows the tablet can read.")}</p>
                  <div className="mt-2">
                    <Switch label={<span className="flex items-center gap-1.5 text-[13.5px]"><ServerCog className="size-4" />{L("دالة السيرفر متظبطة", "Server function configured")}</span>} checked={eta.credentialsConfigured} onChange={(v) => setE({ credentialsConfigured: v })} />
                  </div>
                </div>
              </div>
              {!ready.ok ? (
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-semibold text-warn">{L("ناقص:", "Missing:")}</span>
                  {ready.missing.map((m) => (
                    <Badge key={m} tone="warn" size="sm">
                      {MISSING[m]}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </Card>
        </fieldset>

        <div className="grid gap-4 xl:sticky xl:top-20">
          <Card>
            <CardHeader icon={<Calculator />} title={L("معاينة الحساب", "Live bill preview")} subtitle={L("نفس الأصناف، كل نوع طلب — محسوبة بـ @finance/tax", "Same lines, each order type — priced by @finance/tax")} />
            <div className="grid gap-3 px-5 pb-5">
              {previews.map((p) => (
                <div key={p.mode} className="rounded-2xl border border-line bg-surface-2/60 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold">{MODE_LABEL[p.mode]}</span>
                    <AnimatedMoney value={p.totals.total} className="text-[20px] font-semibold" />
                  </div>
                  <dl className="grid gap-0.5 text-[13.5px]">
                    <Row l={L("الأصناف", "Items")} v={p.totals.subtotal} lang={lang} />
                    {p.totals.service ? <Row l={`${L("خدمة", "Service")} ${pctText(tax.serviceRate)}% · ${tax.serviceCode?.type ?? ""}${tax.priceMode === "inclusive" ? ` (${L("شاملة", "incl.")})` : ""}`} v={p.totals.service} lang={lang} /> : null}
                    {p.totals.vat ? <Row l={`${L("ضريبة", "VAT")} ${pctText(tax.vatRate)}% · ${tax.vatCode.type}${tax.priceMode === "inclusive" ? ` (${L("شاملة", "incl.")})` : ""}`} v={p.totals.vat} lang={lang} /> : null}
                    {p.totals.deliveryFee ? <Row l={L("توصيل", "Delivery")} v={p.totals.deliveryFee} lang={lang} /> : null}
                  </dl>
                </div>
              ))}
              <p className="text-[12.5px] text-muted">{L("الضريبة بتتقرّب لكل سطر لقرشين (زي حساب المصلحة)، والإجمالي لأقرب قرش.", "Tax is rounded per line to 2 decimals (as ETA recomputes it); the total to the piastre.")}</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ l, v, lang }: { l: string; v: number; lang: "ar" | "en" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{l}</dt>
      <dd className="num">{formatMoney(v, { lang })}</dd>
    </div>
  );
}

function Choice({ on, onClick, title, body }: { on: boolean; onClick: () => void; title: string; body: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("rounded-2xl border-2 p-3.5 text-start transition-colors", on ? "border-primary bg-primary-soft/50" : "border-line hover:border-line-strong")}>
      <span className="num block font-bold">{title}</span>
      <span className="mt-1 block text-[13px] text-muted">{body}</span>
    </button>
  );
}
