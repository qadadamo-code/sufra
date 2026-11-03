/**
 * Settings → ZATCA (/settings/zatca): seller data in the national-address format, EGS units (one per POS device) and the
 * onboarding wizard (CSR → OTP → compliance CSID → compliance checks → production CSID), CSID expiry, readiness checklist
 * and an Arabic step-by-step guide. Keys and CSID secrets are created and kept on the server (/api/zatca-onboard, Vault);
 * a "demo" unit keeps a key in this browser for the offline demo only and can never be onboarded.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, BadgeCheck, BookOpen, CheckCircle2, Circle, Cpu, FlaskConical, KeyRound, Landmark, Plus, RotateCcw, Save, ServerCog, ShieldCheck, Stamp } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Settings } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { ago } from "@/lib/time";
import { zatcaFetch, ZatcaApiError } from "@/lib/zatca/client";
import { buildCsr, keyPairFromSecret } from "@/lib/zatca/crypto";
import { createEgsUnit, demoKeyOf } from "@/lib/zatca/issue";
import type { EgsStatus, ZatcaEgsUnit, ZatcaSettings as Z } from "@/lib/zatca/model";
import { complianceSamples, sampleTypes } from "@/lib/zatca/samples";
import { KSA_TAX, zatcaReadiness, zatcaSettingsOf } from "@/lib/zatca/settings";
import { signInvoice, verifyInvoiceXml } from "@/lib/zatca/sign";
import { checkInvoice, checkSeller } from "@/lib/zatca/validate";
import { uuid } from "@/lib/id";
import { deviceCode } from "@/modules/pos/sale";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, CardHeader, Dialog, Input, Segmented, Select, Switch, useToast, type Tone } from "@/ui";
import { SettingsNav } from "../SettingsNav";

const STEPS: { id: EgsStatus | "csr"; ar: string; en: string }[] = [
  { id: "csr", ar: "طلب الشهادة (CSR)", en: "CSR" },
  { id: "compliance", ar: "شهادة الامتثال", en: "Compliance CSID" },
  { id: "checks_passed", ar: "فواتير الاختبار", en: "Compliance checks" },
  { id: "production", ar: "شهادة الإنتاج", en: "Production CSID" },
];
const STATUS_TONE: Record<EgsStatus, Tone> = { new: "neutral", compliance: "info", checks_passed: "brass", production: "ok", expired: "danger", revoked: "danger" };
const STATUS_LABEL: Record<EgsStatus, { ar: string; en: string }> = {
  new: { ar: "جديدة", en: "New" },
  compliance: { ar: "معاها شهادة امتثال", en: "Compliance CSID" },
  checks_passed: { ar: "عدّت الاختبارات", en: "Checks passed" },
  production: { ar: "شغالة (إنتاج)", en: "Live (production)" },
  expired: { ar: "الشهادة انتهت", en: "CSID expired" },
  revoked: { ar: "ملغاة", en: "Revoked" },
};

export default function ZatcaSettings() {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { can, restaurant, branchId, branches } = useSession();
  const settings = useLive("settings").data[0] ?? null;
  const units = useLive("zatcaEgsUnits").data;
  const [z, setZ] = useState<Z | null>(null);
  const [saving, setSaving] = useState(false);
  const [otpFor, setOtpFor] = useState<ZatcaEgsUnit | null>(null);
  const [csrFor, setCsrFor] = useState<{ unit: ZatcaEgsUnit; pem: string } | null>(null);
  const [dry, setDry] = useState<{ unit: ZatcaEgsUnit; rows: { type: string; ok: boolean; issues: string[] }[] } | null>(null);
  const editable = can("settings.tax");

  useEffect(() => {
    if (settings && !z) setZ(zatcaSettingsOf(settings));
  }, [settings, z]);
  const dirty = !!settings && !!z && JSON.stringify(zatcaSettingsOf(settings)) !== JSON.stringify(z);
  const ready = useMemo(() => zatcaReadiness(settings && z ? { ...settings, zatca: z } : settings, units), [settings, z, units]);
  const sellerIssues = useMemo(() => (z ? checkSeller({ name: z.seller.nameAr, vatNumber: z.seller.vatNumber, id: { scheme: z.seller.idScheme, value: z.seller.idValue }, address: z.seller.address }) : []), [z]);
  const fieldError = (f: string) => sellerIssues.find((i) => i.field === f)?.message[lang];
  if (!settings || !z) return null;

  const set = (p: Partial<Z>) => setZ((x) => (x ? { ...x, ...p } : x));
  const setSeller = (p: Partial<Z["seller"]>) => setZ((x) => (x ? { ...x, seller: { ...x.seller, ...p } } : x));
  const setAddr = (p: Partial<Z["seller"]["address"]>) => setZ((x) => (x ? { ...x, seller: { ...x.seller, address: { ...x.seller.address, ...p } } } : x));
  const ksa = restaurant?.country === "SA";

  const save = async (extra: Partial<Settings> = {}) => {
    setSaving(true);
    try {
      await db.update("settings", settings.id, { zatca: z, ...extra });
      await db.audit("settings.zatca", "settings", settings.id, { enabled: z.enabled, environment: z.environment, custody: z.keyCustody, vat: z.seller.vatNumber });
      toast({ title: L("إعدادات هيئة الزكاة اتحفظت", "ZATCA settings saved"), tone: "success" });
    } finally {
      setSaving(false);
    }
  };
  const applyKsaTax = () => void save({ tax: { ...settings.tax, ...KSA_TAX, taxId: z.seller.vatNumber, commercialRegister: z.seller.idValue } });

  const call = async (unit: ZatcaEgsUnit, action: "csr" | "compliance" | "checks" | "production" | "renew", otp?: string) => {
    if (unit.keyCustody === "demo_browser") {
      toast({ title: L("وحدة تجريبية — مينفعش تتسجل في هيئة الزكاة", "Demo unit — it can't be onboarded with ZATCA"), description: L("اعمل وحدة بمفتاح على السيرفر", "Create a server-custody unit"), tone: "warn" });
      return;
    }
    try {
      const r = await zatcaFetch<{ ok: boolean; csrPem?: string }>("zatca-onboard", { restaurantId: settings.restaurantId, egsId: unit.id, action, ...(otp ? { otp } : {}) });
      if (r.csrPem) setCsrFor({ unit, pem: r.csrPem });
      toast({ title: r.ok ? L("تم", "Done") : L("فيه مشاكل — راجع التفاصيل", "Some checks failed"), tone: r.ok ? "success" : "warn" });
    } catch (e) {
      const err = e as ZatcaApiError;
      toast({
        title: err.status === 501 ? L("التسجيل مع هيئة الزكاة مش متظبط على السيرفر", "ZATCA onboarding isn't configured on the server") : L("ماقدرناش نكمل", "Couldn't complete"),
        description: err.detail ?? err.code,
        tone: "warn",
      });
    }
  };

  /** demo units: local dry run of the six compliance documents (our own checks, not ZATCA's) */
  const dryRun = (unit: ZatcaEgsUnit) => {
    const k = demoKeyOf(unit.id);
    const seller = { name: z.seller.nameAr, vatNumber: z.seller.vatNumber, id: { scheme: z.seller.idScheme, value: z.seller.idValue }, address: z.seller.address };
    const docs = complianceSamples(seller, unit.invoiceTypes, new Date(), uuid, (input) => signInvoice(input, input.kind === "simplified" && k && unit.demoCertificate ? { secretKey: k.secretKey, certificate: unit.demoCertificate } : null));
    setDry({
      unit,
      rows: docs.map((d) => {
        const issues = checkInvoice(d.input).map((i) => `${i.rule}: ${i.message[lang]}`);
        if (d.input.kind === "simplified") {
          const v = verifyInvoiceXml(d.result.xml);
          if (!v.ok) issues.push(...v.checks.filter((c) => !c.ok).map((c) => c.id));
        }
        return { type: d.type, ok: issues.length === 0, issues };
      }),
    });
  };

  const addUnit = async () => {
    const b = branchId ?? branches[0]?.id;
    if (!b || !restaurant) return;
    const dev = deviceCode();
    if (units.some((u) => u.branchId === b && u.device === dev)) {
      toast({ title: L(`الجهاز ${dev} متسجل بالفعل`, `Device ${dev} already has a unit`), tone: "warn" });
      return;
    }
    await createEgsUnit(db, { branchId: b, device: dev, settings: { ...settings, zatca: z }, restaurant });
    toast({ title: L(`اتعملت وحدة EGS للجهاز ${dev}`, `EGS unit created for ${dev}`), tone: "success" });
  };

  const stepDone = (u: ZatcaEgsUnit, i: number) => {
    const order: (EgsStatus | "csr")[] = ["csr", "compliance", "checks_passed", "production"];
    const reached = u.status === "production" ? 3 : u.status === "checks_passed" ? 2 : u.status === "compliance" ? 1 : u.csrPem || u.publicKey ? 0 : -1;
    return i <= reached && order[i] !== undefined;
  };

  return (
    <div className="grid gap-6">
      <SettingsNav />
      <PageHeader
        icon={<Stamp />}
        title={L("هيئة الزكاة — فاتورة", "ZATCA e-invoicing")}
        subtitle={L("المرحلة الثانية: الربط والتكامل مع منصة فاتورة", "FATOORA Phase 2 integration")}
        actions={
          <>
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} disabled={!dirty} onClick={() => setZ(zatcaSettingsOf(settings))}>
              {L("تراجع", "Discard")}
            </Button>
            <Button icon={<Save className="size-4" />} disabled={!dirty || !editable} loading={saving} onClick={() => void save()}>
              {L("حفظ", "Save")}
            </Button>
          </>
        }
      />

      <Card className="border-info/30 bg-info-soft/40 p-4 text-[14px]">
        <p className="flex items-start gap-2">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-info" />
          <span>
            <span className="font-semibold">{L("مش «معتمد» لسه:", "Not certified yet:")}</span>{" "}
            {L(
              "الالتزام الفعلي محتاج إن كل وحدة تعدّي اختبارات الامتثال في بيئة هيئة الزكاة بكود OTP من صاحب المنشأة (بوابة فاتورة). لحد ما ده يحصل، سُفرة بتبني الفواتير وتختمها وتربطها، لكن مفيش حاجة معتمدة.",
              "Real compliance requires each unit to pass ZATCA's compliance checks in their environment with the owner's OTP (Fatoora portal). Until then Sufra builds, stamps and chains invoices, but nothing is certified.",
            )}
          </span>
        </p>
      </Card>

      {!ksa ? (
        <Card className="p-4 text-[14px] text-muted">
          {L("المطعم ده مسجّل في مصر — الإيصالات بتروح لمصلحة الضرائب (ETA). هيئة الزكاة للمطاعم السعودية بس.", "This restaurant is registered in Egypt — receipts go to the ETA. ZATCA applies to Saudi restaurants only.")}{" "}
          <Link to="/settings/tax" className="font-semibold text-primary hover:underline">
            {L("إعدادات الضرايب", "Tax settings")}
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader icon={<Landmark />} title={L("١ · بيانات المنشأة", "1 · Seller")} subtitle={L("زي ما هي في شهادة التسجيل في ضريبة القيمة المضافة والعنوان الوطني", "Exactly as on the VAT certificate and the national address")} />
            <div className="grid gap-4 p-4 pt-0 sm:grid-cols-2 sm:p-5 sm:pt-0">
              <div className="sm:col-span-2">
                <Switch checked={z.enabled} onChange={(v) => set({ enabled: v })} label={L("إصدار فواتير هيئة الزكاة من الكاشير", "Issue ZATCA invoices from the POS")} description={L("لما تكون شغالة، كل شيك بيتقفل بيطلع فاتورة مبسطة (أو ضريبية لو فيه مشتري B2B) بدل إيصال ETA", "When on, every closed check issues a simplified invoice (or a standard one with a B2B buyer) instead of an ETA receipt")} disabled={!editable || !ksa} />
              </div>
              <Input label={L("الاسم المسجّل (عربي — إلزامي)", "Registered name (Arabic — mandatory)")} value={z.seller.nameAr} onChange={(e) => setSeller({ nameAr: e.target.value })} error={fieldError("seller.name")} disabled={!editable} wrapClassName="sm:col-span-2" />
              <Input label={L("الاسم بالإنجليزي (اختياري)", "English name (optional)")} value={z.seller.nameEn} onChange={(e) => setSeller({ nameEn: e.target.value })} disabled={!editable} dir="ltr" wrapClassName="sm:col-span-2" />
              <Input label={L("الرقم الضريبي (١٥ رقم)", "VAT number (15 digits)")} inputMode="numeric" dir="ltr" value={z.seller.vatNumber} onChange={(e) => setSeller({ vatNumber: e.target.value.replace(/\D/g, "").slice(0, 15) })} error={z.seller.vatNumber ? fieldError("seller.vatNumber") : undefined} hint={L("يبدأ وينتهي بـ ٣", "Starts and ends with 3")} disabled={!editable} />
              <div className="grid grid-cols-[7.5rem_1fr] gap-2">
                <Select label={L("نوع المعرّف", "ID type")} value={z.seller.idScheme} onChange={(e) => setSeller({ idScheme: e.target.value as Z["seller"]["idScheme"] })} options={[{ value: "CRN", label: L("سجل تجاري", "CR") }, { value: "MOM", label: "MOMRAH" }, { value: "MLS", label: "MHRSD" }, { value: "700", label: "700" }, { value: "SAG", label: "MISA" }, { value: "OTH", label: L("أخرى", "Other") }]} disabled={!editable} />
                <Input label={L("رقم السجل التجاري", "CR number")} dir="ltr" value={z.seller.idValue} onChange={(e) => setSeller({ idValue: e.target.value.replace(/[^A-Za-z0-9]/g, "") })} error={z.seller.idValue ? fieldError("seller.id") : undefined} disabled={!editable} />
              </div>
              <p className="text-[13px] font-semibold text-muted sm:col-span-2">{L("العنوان الوطني", "National address")}</p>
              <Input label={L("رقم المبنى (٤ أرقام)", "Building no. (4 digits)")} inputMode="numeric" dir="ltr" value={z.seller.address.building} onChange={(e) => setAddr({ building: e.target.value.replace(/\D/g, "").slice(0, 4) })} error={z.seller.address.building ? fieldError("seller.address.building") : undefined} disabled={!editable} />
              <Input label={L("الشارع", "Street")} value={z.seller.address.street} onChange={(e) => setAddr({ street: e.target.value })} disabled={!editable} />
              <Input label={L("الحي", "District")} value={z.seller.address.district} onChange={(e) => setAddr({ district: e.target.value })} disabled={!editable} />
              <Input label={L("المدينة", "City")} value={z.seller.address.city} onChange={(e) => setAddr({ city: e.target.value })} disabled={!editable} />
              <Input label={L("الرمز البريدي (٥ أرقام)", "Postal code (5 digits)")} inputMode="numeric" dir="ltr" value={z.seller.address.postalCode} onChange={(e) => setAddr({ postalCode: e.target.value.replace(/\D/g, "").slice(0, 5) })} error={z.seller.address.postalCode ? fieldError("seller.address.postalCode") : undefined} disabled={!editable} />
              <Input label={L("الرقم الإضافي", "Additional no.")} inputMode="numeric" dir="ltr" value={z.seller.address.additionalNo ?? ""} onChange={(e) => setAddr({ additionalNo: e.target.value.replace(/\D/g, "").slice(0, 4) })} disabled={!editable} />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<ServerCog />} title={L("٢ · الربط", "2 · Connection")} />
            <div className="grid gap-4 p-4 pt-0 sm:p-5 sm:pt-0">
              <Segmented
                label={L("البيئة", "Environment")}
                value={z.environment}
                onChange={(v) => set({ environment: v })}
                options={[{ value: "sandbox", label: L("المطورين", "Sandbox") }, { value: "simulation", label: L("المحاكاة", "Simulation") }, { value: "production", label: L("الإنتاج", "Production") }]}
              />
              <Segmented
                label={L("أنواع الفواتير", "Invoice types")}
                value={z.invoiceTypes}
                onChange={(v) => set({ invoiceTypes: v })}
                options={[{ value: "1100", label: L("مبسطة + ضريبية (B2B)", "Simplified + standard (B2B)") }, { value: "0100", label: L("مبسطة بس", "Simplified only") }]}
              />
              <Segmented
                label={L("مكان المفتاح الخاص", "Private key custody")}
                value={z.keyCustody}
                onChange={(v) => set({ keyCustody: v })}
                options={[{ value: "server", label: L("السيرفر (إنتاج)", "Server (production)") }, { value: "demo_browser", label: L("الجهاز (تجريبي)", "Device (demo)") }]}
              />
              {z.keyCustody === "demo_browser" ? (
                <p className="flex items-start gap-2 rounded-xl bg-warn-soft px-3 py-2 text-[13px] text-warn">
                  <FlaskConical className="mt-0.5 size-4 shrink-0" />
                  {L("تجريبي: المفتاح وشهادة موقّعة ذاتيًا على التابلت. الفواتير بتتختم وتتطبع بس عمرها ما بتتبعت لهيئة الزكاة.", "Demo: key + self-signed certificate on the tablet. Invoices are stamped and printed but never sent to ZATCA.")}
                </p>
              ) : (
                <p className="text-[13px] text-muted">{L("المفتاح بيتولد ويتخزن في Supabase Vault على السيرفر، وأسرار شهادة CSID كمان. التابلت عمره ما بيشوفهم.", "The key is generated and kept in Supabase Vault on the server, with the CSID secrets. Tablets never see them.")}</p>
              )}
              <Button variant="secondary" icon={<BadgeCheck className="size-4" />} disabled={!editable || !ksa} onClick={applyKsaTax}>
                {L("طبّق ملف ضريبة السعودية (١٥٪ شامل، بدون خدمة)", "Apply the KSA tax profile (15% inclusive, no service charge)")}
              </Button>
            </div>
          </Card>
        </div>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader icon={<CheckCircle2 />} title={L("جاهزية التشغيل", "Readiness")} subtitle={ready.ok ? L("كله تمام", "All set") : L(`${ready.items.filter((i) => !i.ok).length} باقيين`, `${ready.items.filter((i) => !i.ok).length} to go`)} />
            <ul className="grid gap-2 p-4 pt-0 sm:p-5 sm:pt-0">
              {ready.items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-[14px]">
                  {i.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-4 shrink-0 text-faint" />}
                  <span className={cn(i.ok ? "text-ink" : "text-ink-2")}>
                    {i.label[lang]}
                    {i.hint ? <span className="block text-[12.5px] text-warn">{i.hint[lang]}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Guide />
        </div>
      </div>

      <Card>
        <CardHeader
          icon={<Cpu />}
          title={L("٣ · وحدات الفوترة (EGS)", "3 · EGS units")}
          subtitle={L("وحدة لكل جهاز كاشير: ليها مفتاحها وشهادتها وعداد الفواتير (ICV) وسلسلة الهاش (PIH)", "One per POS device: its own key, certificate, counter (ICV) and hash chain (PIH)")}
          action={
            <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} disabled={!editable || !ksa} onClick={() => void addUnit()}>
              {L(`وحدة للجهاز ده (${deviceCode()})`, `Unit for this device (${deviceCode()})`)}
            </Button>
          }
        />
        <div className="grid gap-3 p-4 pt-0 sm:p-5 sm:pt-0">
          {units.length === 0 ? <p className="text-[14px] text-muted">{L("لسه مفيش وحدات. الكاشير بيعمل وحدة تلقائي أول ما يقفل أول شيك، أو اعملها من هنا.", "No units yet. The POS creates one on its first closed check, or add one here.")}</p> : null}
          {units.map((u) => {
            const exp = u.production?.expiresAt ?? u.compliance?.expiresAt ?? null;
            return (
              <div key={u.id} className="rounded-2xl border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold">
                      <span className="num">{u.device}</span>
                      <Badge tone={STATUS_TONE[u.status]} size="sm">
                        {STATUS_LABEL[u.status][lang]}
                      </Badge>
                      {u.keyCustody === "demo_browser" ? (
                        <Badge tone="warn" size="sm" icon={<FlaskConical className="size-3" />}>
                          {L("تجريبي", "Demo")}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="num mt-0.5 truncate text-[12px] text-muted" dir="ltr">
                      {u.serial}
                    </p>
                  </div>
                  <div className="text-end text-[12.5px] text-muted">
                    {exp ? (
                      <>
                        {L("الشهادة سارية لحد", "CSID valid until")} <span className="num">{exp.slice(0, 10)}</span>
                      </>
                    ) : u.demoCertificate ? (
                      L("شهادة تجريبية موقعة ذاتيًا", "Self-signed demo certificate")
                    ) : (
                      L("مفيش شهادة لسه", "No certificate yet")
                    )}
                    <span className="block">{L("اتعملت", "Created")} {ago(u.createdAt, lang)}</span>
                  </div>
                </div>
                <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {STEPS.map((s, i) => (
                    <li key={s.id} className={cn("flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[12.5px] font-semibold", stepDone(u, i) ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-muted")}>
                      {stepDone(u, i) ? <CheckCircle2 className="size-4 shrink-0" /> : <span className="num grid size-4 shrink-0 place-items-center rounded-full border text-[10px]">{i + 1}</span>}
                      {lang === "ar" ? s.ar : s.en}
                    </li>
                  ))}
                </ol>
                {u.lastError ? <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-danger"><AlertTriangle className="size-4" /> {u.lastError}</p> : null}
                {Object.keys(u.checks).length ? (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(u.checks).map(([k, v]) => (
                      <Badge key={k} size="sm" tone={v === "pass" ? "ok" : v === "warn" ? "brass" : "danger"}>
                        {k}
                      </Badge>
                    ))}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {u.keyCustody === "demo_browser" ? (
                    <>
                      <Button size="sm" variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => {
                        const k = demoKeyOf(u.id);
                        if (!k) return toast({ title: L("المفتاح التجريبي مش على الجهاز ده", "The demo key isn't on this device"), tone: "warn" });
                        setCsrFor({ unit: u, pem: buildCsr(keyPairFromSecret(k.secretKey), { env: z.environment, commonName: u.name, egsSerial: u.serial, vatNumber: z.seller.vatNumber, orgUnit: branches.find((b) => b.id === u.branchId)?.name.en ?? "Main", orgName: z.seller.nameAr, invoiceTypes: u.invoiceTypes, location: `${z.seller.address.building} ${z.seller.address.street}, ${z.seller.address.city}`, industry: z.industry }).pem });
                      }}>
                        {L("اعرض الـ CSR", "Show CSR")}
                      </Button>
                      <Button size="sm" variant="secondary" icon={<FlaskConical className="size-4" />} onClick={() => dryRun(u)}>
                        {L(`جرّب الاختبارات محليًا (${sampleTypes(u.invoiceTypes).length})`, `Local dry run (${sampleTypes(u.invoiceTypes).length} docs)`)}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" icon={<KeyRound className="size-4" />} disabled={!editable} onClick={() => void call(u, "csr")}>
                        {L("ولّد مفتاح و CSR على السيرفر", "Generate key + CSR on the server")}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={!editable || !u.csrPem} onClick={() => setOtpFor(u)}>
                        {L("أدخل كود OTP", "Enter OTP")}
                      </Button>
                      <Button size="sm" variant="secondary" disabled={!editable || u.status !== "compliance"} onClick={() => void call(u, "checks")}>
                        {L("اختبارات الامتثال", "Run compliance checks")}
                      </Button>
                      <Button size="sm" disabled={!editable || u.status !== "checks_passed"} onClick={() => void call(u, "production")}>
                        {L("اطلب شهادة الإنتاج", "Get production CSID")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <Link to="/pos/zatca" className="text-[14px] font-semibold text-primary hover:underline">
            {L("طابور الفواتير ←", "Invoice queue →")}
          </Link>
        </div>
      </Card>

      <OtpDialog unit={otpFor} onClose={() => setOtpFor(null)} onSubmit={(u, otp) => void call(u, "compliance", otp)} />
      <Dialog open={!!csrFor} onClose={() => setCsrFor(null)} size="lg" title="CSR" description={csrFor?.unit.serial}>
        <pre className="num max-h-[50dvh] overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-surface-3 p-4 text-[11.5px] thin-scrollbar" dir="ltr">
          {csrFor?.pem}
        </pre>
        <p className="mt-2 text-[12.5px] text-muted">{L("فيه المفتاح العام بس. المفتاح الخاص عمره ما بيظهر هنا.", "Contains the public key only. The private key is never shown.")}</p>
      </Dialog>
      <Dialog open={!!dry} onClose={() => setDry(null)} size="md" title={L("تجربة محلية للاختبارات", "Local compliance dry run")} description={L("فحوصات سُفرة بس — مش اختبار هيئة الزكاة", "Sufra's own checks — not ZATCA's")}>
        <ul className="grid gap-2">
          {dry?.rows.map((r) => (
            <li key={r.type} className="flex items-start gap-2 text-[14px]">
              {r.ok ? <CheckCircle2 className="mt-0.5 size-4 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 text-danger" />}
              <span>
                <span className="num font-semibold">{r.type}</span>
                {r.issues.map((i) => (
                  <span key={i} className="block text-[12.5px] text-danger">
                    {i}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

function OtpDialog({ unit, onClose, onSubmit }: { unit: ZatcaEgsUnit | null; onClose: () => void; onSubmit: (u: ZatcaEgsUnit, otp: string) => void }) {
  const { L } = useT();
  const [otp, setOtp] = useState("");
  useEffect(() => setOtp(""), [unit?.id]);
  return (
    <Dialog
      open={!!unit}
      onClose={onClose}
      size="sm"
      title={L("كود OTP من بوابة فاتورة", "OTP from the Fatoora portal")}
      description={L("الكود صالح حوالي ساعة. صاحب المنشأة بيطلعه من fatoora.zatca.gov.sa → تسجيل وحدة جديدة.", "Valid for about an hour. The owner generates it at fatoora.zatca.gov.sa → onboard new solution unit.")}
      footer={
        <Button disabled={!/^\d{6}$/.test(otp)} onClick={() => (unit && onSubmit(unit, otp), onClose())}>
          {L("اطلب شهادة الامتثال", "Request compliance CSID")}
        </Button>
      }
    >
      <Input label="OTP" inputMode="numeric" dir="ltr" autoComplete="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} className="num text-center text-[22px] tracking-[0.4em]" />
    </Dialog>
  );
}

function Guide() {
  const { L, lang } = useT();
  const steps: { ar: ReactNode; en: ReactNode }[] = [
    { ar: "سجّل دخول بوابة فاتورة (fatoora.zatca.gov.sa) بحساب المنشأة في بوابة الزكاة.", en: "Sign in to the Fatoora portal (fatoora.zatca.gov.sa) with the business's ZATCA account." },
    { ar: "اختار «تسجيل وحدة حل جديدة» وولّد كود OTP (صالح حوالي ساعة).", en: "Choose “Onboard new solution unit” and generate an OTP (valid for about an hour)." },
    { ar: "هنا: ولّد المفتاح والـ CSR لكل جهاز كاشير، وبعدين ادخل الكود.", en: "Here: generate the key + CSR for each POS device, then enter the OTP." },
    { ar: "سُفرة بتبعت فاتورة اختبار من كل نوع (مبسطة/ضريبية × فاتورة/دائن/مدين) لحد ما كلها تعدّي.", en: "Sufra sends a test document of every type (simplified/standard × invoice/credit/debit) until all pass." },
    { ar: "اطلب شهادة الإنتاج — من بعدها الفواتير بتتبلّغ/تتعتمد تلقائي.", en: "Request the production CSID — from then on invoices are reported/cleared automatically." },
    { ar: "جدّد الشهادة قبل ما تنتهي، ولو جهاز اتسرق أو اتغير الغِ شهادته من البوابة.", en: "Renew the CSID before it expires; revoke it from the portal if a device is lost or replaced." },
  ];
  return (
    <Card>
      <CardHeader icon={<BookOpen />} title={L("دليل التسجيل خطوة بخطوة", "Step-by-step onboarding guide")} />
      <ol className="grid gap-2.5 p-4 pt-0 sm:p-5 sm:pt-0">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2.5 text-[14px]">
            <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-bold text-primary">{i + 1}</span>
            <span>{lang === "ar" ? s.ar : s.en}</span>
          </li>
        ))}
      </ol>
      <p className="px-4 pb-4 text-[12.5px] text-muted sm:px-5">
        {L("المرحلة الثانية إلزامية على موجات؛ الموجة ٢٤ (إيرادات فوق ٣٧٥ ألف ريال) آخر ميعادها ٣٠ يونيو ٢٠٢٦ — يعني تقريبًا كل مطعم مسجل في الضريبة.", "Phase 2 rolls out in waves; wave 24 (turnover above SAR 375k) was due 30 June 2026 — i.e. nearly every VAT-registered restaurant.")}
      </p>
    </Card>
  );
}
