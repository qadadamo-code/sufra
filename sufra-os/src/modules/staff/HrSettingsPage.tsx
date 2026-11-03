import { useEffect, useState } from "react";
import { BellRing, Clock, Coins, Crosshair, Landmark, MapPin, Palmtree, Plus, Save, Scale, Timer, Trash2 } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { ShiftTemplate } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, major, UNITS_PER_MAJOR } from "@/lib/money";
import { Button, Input, Segmented, Select, Switch, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { DEFAULT_HR, EG_TAX_BRACKETS_2026, type HrSettings } from "@/modules/hr/lib/settings";
import { STATION } from "@/modules/hr/labels";
import { EstimateNote, MoneyInput, NumberInput, Section } from "@/modules/hr/ui";

const pctIn = (bps: number) => bps / 100;
const bpsOf = (pct: number) => Math.round(pct * 100);

export default function HrSettingsPage() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const [s, setS] = useState<HrSettings>(hr.rules);
  useEffect(() => setS(hr.rules), [hr.settings?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof HrSettings>(k: K, v: HrSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const branchId = hr.session.branchId ?? hr.session.branches[0]?.id ?? "";
  const fence = s.geofences[branchId] ?? { lat: 0, lng: 0, radiusM: 150 };
  const setFence = (f: typeof fence) => set("geofences", { ...s.geofences, [branchId]: f });
  const save = async () => {
    if (!hr.settings) return;
    await db.update("settings", hr.settings.id, { hr: s });
    await db.audit("settings.hr", "settings", hr.settings.id, {});
    toast({ title: L("الإعدادات اتحفظت", "Settings saved"), tone: "success" });
  };
  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => setFence({ ...fence, lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }),
      () => toast({ title: L("مش قادرين نجيب الموقع — اسمح للمتصفح", "Couldn't get your location — allow it in the browser"), tone: "error" }),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  return (
    <div className="grid gap-5">
      <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/90 p-3 shadow-sf-sm backdrop-blur">
        <Segmented label={L("الدولة", "Country")} value={s.country} onChange={(v) => set("country", v)} options={[{ value: "EG", label: L("مصر", "Egypt") }, { value: "SA", label: L("السعودية", "Saudi Arabia") }]} />
        <span className="flex-1" />
        <Button icon={<Save />} onClick={save}>{L("احفظ الإعدادات", "Save settings")}</Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title={L("ميعاد الرواتب", "Pay day")} icon={<BellRing />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberInput label={L("يوم الصرف في الشهر", "Day of the month")} hint={L("٠ = آخر يوم في الشهر", "0 = last day of the month")} value={s.payDay} min={0} onChange={(v) => set("payDay", Math.max(0, Math.min(28, Math.round(v))))} />
            <NumberInput label={L("فكّرني قبلها بـ", "Remind me before")} value={s.reminderDays} min={0} suffix={L("يوم", "days")} onChange={(v) => set("reminderDays", Math.round(v))} />
          </div>
        </Section>

        <Section title={L("الحضور من الموبايل", "Phone check-in")} icon={<MapPin />} subtitle={L("الموظف يبصم من موبايله لما يكون جوه المطعم بس", "Staff clock in from their phone only inside the restaurant")}>
          <Switch checked={s.mobileCheckIn} onChange={(v) => set("mobileCheckIn", v)} label={L("مسموح البصمة من الموبايل", "Allow phone check-in")} />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Input label={L("خط العرض", "Latitude")} dir="ltr" inputMode="decimal" value={fence.lat || ""} onChange={(e) => setFence({ ...fence, lat: Number(e.target.value) || 0 })} />
            <Input label={L("خط الطول", "Longitude")} dir="ltr" inputMode="decimal" value={fence.lng || ""} onChange={(e) => setFence({ ...fence, lng: Number(e.target.value) || 0 })} />
            <NumberInput label={L("نص القطر", "Radius")} suffix={L("متر", "m")} value={fence.radiusM} min={30} step={10} onChange={(v) => setFence({ ...fence, radiusM: Math.max(30, Math.round(v)) })} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" icon={<Crosshair />} onClick={locate}>{L("استخدم مكاني دلوقتي (وأنا في المطعم)", "Use my location (I'm at the restaurant)")}</Button>
            {fence.lat ? <a className="inline-flex h-9 items-center text-[13px] font-semibold text-primary" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${fence.lat}&mlon=${fence.lng}#map=18/${fence.lat}/${fence.lng}`}>{L("شوف على الخريطة ↗", "View on map ↗")}</a> : null}
          </div>
          <div className="mt-3">
            <Select label={L("صورة سيلفي عند البصمة على جهاز الكاشير", "Selfie at the shared-device clock")} value={s.kioskSelfie} onChange={(e) => set("kioskSelfie", e.target.value as HrSettings["kioskSelfie"])} options={[{ value: "off", label: L("لا", "Off") }, { value: "optional", label: L("اختياري", "Optional") }, { value: "required", label: L("إجباري", "Required") }]} />
          </div>
        </Section>

        <Section title={L("التأخير والغياب", "Lateness & absence")} icon={<Clock />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberInput label={L("سماح التأخير", "Grace period")} suffix={L("دقيقة", "min")} value={s.graceMin} onChange={(v) => set("graceMin", Math.round(v))} />
            <NumberInput label={L("خصم الغياب بدون إذن", "Absence deduction")} suffix={L("يوم", "days")} step={0.5} value={s.absenceDays} onChange={(v) => set("absenceDays", v)} />
          </div>
          <p className="mt-4 mb-2 text-[13.5px] font-semibold">{L("خصم التأخير (بالأيام)", "Lateness deduction (days' pay)")}</p>
          <TierEditor tiers={s.lateTiers} onChange={(v) => set("lateTiers", v)} />
          <p className="mt-4 mb-2 text-[13.5px] font-semibold">{L("خصم الانصراف بدري", "Early-leave deduction")}</p>
          <TierEditor tiers={s.earlyTiers} onChange={(v) => set("earlyTiers", v)} />
        </Section>

        <Section title={L("الوقت الإضافي والبريك", "Overtime & breaks")} icon={<Timer />} subtitle={L("قانون العمل: +٣٥٪ نهار، +٧٠٪ ليل، ضعف يوم الراحة", "Labour Law: +35% day, +70% night, double on the rest day")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberInput label={L("يتحسب إضافي بعد", "Counts after")} suffix={L("دقيقة", "min")} value={s.overtime.afterMin} onChange={(v) => set("overtime", { ...s.overtime, afterMin: Math.round(v) })} />
            <NumberInput label={L("سعر ساعة الإضافي (نهار)", "Day OT rate")} suffix="%" value={pctIn(s.overtime.dayBps)} onChange={(v) => set("overtime", { ...s.overtime, dayBps: bpsOf(v) })} />
            <NumberInput label={L("إضافي ليلي", "Night OT rate")} suffix="%" value={pctIn(s.overtime.nightBps)} onChange={(v) => set("overtime", { ...s.overtime, nightBps: bpsOf(v) })} />
            <NumberInput label={L("يوم الراحة", "Rest-day rate")} suffix="%" value={pctIn(s.overtime.restDayBps)} onChange={(v) => set("overtime", { ...s.overtime, restDayBps: bpsOf(v) })} />
            <NumberInput label={L("ساعات اليوم", "Hours per day")} value={s.workHoursPerDay} onChange={(v) => set("workHoursPerDay", v)} />
            <NumberInput label={L("اليومية = الشهري ÷", "Daily wage = monthly ÷")} value={s.daysPerMonth} onChange={(v) => set("daysPerMonth", v)} />
          </div>
          <div className="mt-3">
            <Switch checked={s.breaks.paid} onChange={(v) => set("breaks", { ...s.breaks, paid: v })} label={L("البريك مدفوع", "Breaks are paid")} />
          </div>
        </Section>

        <Section title={L("الخدمة والبقشيش", "Service charge & tips")} icon={<Coins />} subtitle={L("الـ ١٢٪ خدمة بتتوزع على الفريق بالنقاط × الساعات", "The 12% service charge is shared by points × hours")}>
          <Switch checked={s.servicePool.enabled} onChange={(v) => set("servicePool", { ...s.servicePool, enabled: v })} label={L("توزيع الخدمة على الفريق", "Share service charge with staff")} />
          <div className="mt-2 grid gap-4 sm:grid-cols-2">
            <NumberInput label={L("نصيب الفريق من الخدمة", "Staff share of service")} suffix="%" value={pctIn(s.servicePool.staffShareBps)} onChange={(v) => set("servicePool", { ...s.servicePool, staffShareBps: bpsOf(Math.min(100, v)) })} />
            <Select label={L("التوزيع", "Split by")} value={s.servicePool.method} onChange={(e) => set("servicePool", { ...s.servicePool, method: e.target.value as HrSettings["servicePool"]["method"] })} options={[{ value: "points_hours", label: L("النقاط × الساعات", "Points × hours") }, { value: "points", label: L("النقاط", "Points") }, { value: "hours", label: L("الساعات", "Hours") }]} />
          </div>
          <div className="mt-3 grid gap-2">
            <Switch checked={s.tipsPool.enabled} onChange={(v) => set("tipsPool", { ...s.tipsPool, enabled: v })} label={L("البقشيش من الكاشير يدخل المرتب", "POS tips go through payroll")} />
            <Select label={L("البقشيش", "Tips")} value={s.tipsPool.method} onChange={(e) => set("tipsPool", { ...s.tipsPool, method: e.target.value as HrSettings["tipsPool"]["method"] })} options={[{ value: "hours", label: L("يتقسم بالساعات", "Pooled by hours") }, { value: "equal", label: L("بالتساوي", "Equally") }, { value: "by_taker", label: L("لكل واحد بقشيشه", "Each keeps their own") }]} />
          </div>
        </Section>

        {s.country === "EG" ? (
          <Section title={L("التأمينات الاجتماعية — مصر", "Social insurance — Egypt")} icon={<Landmark />} subtitle={L("قانون ١٤٨ لسنة ٢٠١٩", "Law 148/2019")} action={<EstimateNote />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberInput label={L("حصة الموظف", "Employee")} suffix="%" step={0.25} value={pctIn(s.insuranceEG.employeeBps)} onChange={(v) => set("insuranceEG", { ...s.insuranceEG, employeeBps: bpsOf(v) })} />
              <NumberInput label={L("حصة صاحب العمل", "Employer")} suffix="%" step={0.25} value={pctIn(s.insuranceEG.employerBps)} onChange={(v) => set("insuranceEG", { ...s.insuranceEG, employerBps: bpsOf(v) })} />
              <MoneyInput label={L(`أقل أجر اشتراك ${s.insuranceEG.year}`, `Minimum insurable wage ${s.insuranceEG.year}`)} value={s.insuranceEG.minWage} onChange={(v) => set("insuranceEG", { ...s.insuranceEG, minWage: v })} />
              <MoneyInput label={L(`أقصى أجر اشتراك ${s.insuranceEG.year}`, `Maximum insurable wage ${s.insuranceEG.year}`)} value={s.insuranceEG.maxWage} onChange={(v) => set("insuranceEG", { ...s.insuranceEG, maxWage: v })} />
            </div>
          </Section>
        ) : (
          <Section title="GOSI" icon={<Landmark />} subtitle={L("راجع النسب على gosi.gov.sa", "Verify rates on gosi.gov.sa")} action={<EstimateNote />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberInput label={L("سعودي (قديم) — الموظف", "Saudi legacy — employee")} suffix="%" step={0.25} value={pctIn(s.ksa.legacy.employeeBps)} onChange={(v) => set("ksa", { ...s.ksa, legacy: { ...s.ksa.legacy, employeeBps: bpsOf(v) } })} />
              <NumberInput label={L("سعودي (قديم) — المنشأة", "Saudi legacy — employer")} suffix="%" step={0.25} value={pctIn(s.ksa.legacy.employerBps)} onChange={(v) => set("ksa", { ...s.ksa, legacy: { ...s.ksa.legacy, employerBps: bpsOf(v) } })} />
              <NumberInput label={L("مشترك جديد — الموظف", "New entrant — employee")} suffix="%" step={0.25} value={pctIn(s.ksa.newEntrant.employeeBps)} onChange={(v) => set("ksa", { ...s.ksa, newEntrant: { ...s.ksa.newEntrant, employeeBps: bpsOf(v) } })} />
              <NumberInput label={L("مشترك جديد — المنشأة", "New entrant — employer")} suffix="%" step={0.25} value={pctIn(s.ksa.newEntrant.employerBps)} onChange={(v) => set("ksa", { ...s.ksa, newEntrant: { ...s.ksa.newEntrant, employerBps: bpsOf(v) } })} />
              <NumberInput label={L("غير سعودي — أخطار مهنية", "Non-Saudi — occupational hazards")} suffix="%" value={pctIn(s.ksa.nonSaudiEmployerBps)} onChange={(v) => set("ksa", { ...s.ksa, nonSaudiEmployerBps: bpsOf(v) })} />
              <MoneyInput label={L("أقصى أساس اشتراك", "Max contribution base")} value={s.ksa.maxBase} onChange={(v) => set("ksa", { ...s.ksa, maxBase: v })} />
            </div>
          </Section>
        )}

        {s.country === "EG" ? (
          <Section title={L("ضريبة كسب العمل", "Salary tax")} icon={<Scale />} subtitle={L("الشرايح السنوية بعد الإعفاء الشخصي", "Annual brackets after the personal exemption")} action={<EstimateNote />}>
            <Switch checked={s.taxEG.enabled} onChange={(v) => set("taxEG", { ...s.taxEG, enabled: v })} label={L("احسب الضريبة في الرواتب", "Withhold salary tax in payroll")} />
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <MoneyInput label={L("الإعفاء الشخصي السنوي", "Annual personal exemption")} value={s.taxEG.exemption} onChange={(v) => set("taxEG", { ...s.taxEG, exemption: v })} />
              <div className="self-end">
                <Switch checked={s.taxEG.highEarnerRule} onChange={(v) => set("taxEG", { ...s.taxEG, highEarnerRule: v })} label={L("الدخل العالي يفقد الشرايح الأقل", "High earners lose lower bands")} description={L("قانون ٣٠ لسنة ٢٠٢٣ (فوق ٦٠٠ ألف)", "Law 30/2023 (above EGP 600k)")} />
              </div>
            </div>
            <table className="mt-3 w-full text-[13.5px]">
              <thead>
                <tr className="text-[12px] text-muted">
                  <th className="py-1 text-start">{L("لحد (سنوي)", "Up to (annual)")}</th>
                  <th className="py-1 text-start">{L("النسبة", "Rate")}</th>
                </tr>
              </thead>
              <tbody>
                {s.taxEG.brackets.map((b, i) => (
                  <tr key={i}>
                    <td className="py-1 pe-2">
                      {b.upTo === null ? <span className="text-muted">{L("أكتر من كده", "and above")}</span> : <Input aria-label={L("الحد", "Limit")} dir="ltr" inputMode="decimal" className="h-9" value={b.upTo / UNITS_PER_MAJOR} onChange={(e) => set("taxEG", { ...s.taxEG, brackets: s.taxEG.brackets.map((x, j) => (j === i ? { ...x, upTo: major(Number(e.target.value) || 0) } : x)) })} />}
                    </td>
                    <td className="py-1">
                      <Input aria-label={L("النسبة", "Rate")} dir="ltr" inputMode="decimal" className="h-9" value={b.bps / 100} onChange={(e) => set("taxEG", { ...s.taxEG, brackets: s.taxEG.brackets.map((x, j) => (j === i ? { ...x, bps: bpsOf(Number(e.target.value) || 0) } : x)) })} end={<span className="pe-2 text-muted">%</span>} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => set("taxEG", { ...s.taxEG, brackets: EG_TAX_BRACKETS_2026, exemption: DEFAULT_HR.taxEG.exemption, highEarnerRule: true })}>{L("رجّع شرايح ٢٠٢٦", "Reset to 2026 brackets")}</Button>
              <p className="text-[12px] text-muted">{L("المصدر:", "Source:")} {s.taxEG.source}</p>
            </div>
          </Section>
        ) : null}

        <Section title={L("الإجازات", "Leave")} icon={<Palmtree />} subtitle={L("قانون العمل ١٤ لسنة ٢٠٢٥", "Labour Law 14/2025")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberInput label={L("أول سنة (بعد ٦ شهور)", "First year (after 6 months)")} suffix={L("يوم", "days")} value={s.leave.annualFirstYear} onChange={(v) => set("leave", { ...s.leave, annualFirstYear: v })} />
            <NumberInput label={L("اعتيادي", "Annual")} suffix={L("يوم", "days")} value={s.leave.annual} onChange={(v) => set("leave", { ...s.leave, annual: v })} />
            <NumberInput label={L("بعد ١٠ سنين أو سن ٥٠", "After 10 years or age 50")} suffix={L("يوم", "days")} value={s.leave.annualSenior} onChange={(v) => set("leave", { ...s.leave, annualSenior: v })} />
            <NumberInput label={L("عارضة", "Casual")} suffix={L("يوم", "days")} value={s.leave.casual} onChange={(v) => set("leave", { ...s.leave, casual: v })} />
            <NumberInput label={L("مرضي مدفوع", "Paid sick")} suffix={L("يوم", "days")} value={s.leave.sickPaid} onChange={(v) => set("leave", { ...s.leave, sickPaid: v })} />
          </div>
          <div className="mt-2">
            <Switch checked={s.leave.casualFromAnnual} onChange={(v) => set("leave", { ...s.leave, casualFromAnnual: v })} label={L("العارضة بتتخصم من الاعتيادي", "Casual counts against annual")} />
          </div>
        </Section>

        <Section title={L("توقعات تكلفة العمالة", "Labour forecast")} icon={<Coins />}>
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyInput label={L("مبيعات يوم عادي (لو مفيش تاريخ)", "Typical daily sales (no history)")} value={s.expectedDailySales} onChange={(v) => set("expectedDailySales", v)} hint={formatMoney(s.expectedDailySales * 30, { lang, whole: true }) + L(" في الشهر", " a month")} />
            <NumberInput label={L("هدف تكلفة العمالة", "Labour cost target")} suffix="%" value={pctIn(s.labourTargetBps)} onChange={(v) => set("labourTargetBps", bpsOf(v))} />
          </div>
        </Section>
      </div>
      <TemplatesSection />
    </div>
  );
}

function TierEditor({ tiers, onChange }: { tiers: { fromMin: number; days: number }[]; onChange: (t: { fromMin: number; days: number }[]) => void }) {
  const { L } = useT();
  return (
    <div className="grid gap-2">
      {tiers.map((t, i) => (
        <div key={i} className="flex items-center gap-2 text-[14px]">
          <span className="text-muted">{L("من", "from")}</span>
          <Input aria-label={L("دقايق", "Minutes")} dir="ltr" inputMode="numeric" className="h-9 w-20" value={t.fromMin} onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, fromMin: Number(e.target.value) || 0 } : x)))} />
          <span className="text-muted">{L("دقيقة ← خصم", "min → deduct")}</span>
          <Input aria-label={L("أيام", "Days")} dir="ltr" inputMode="decimal" className="h-9 w-20" value={t.days} onChange={(e) => onChange(tiers.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) || 0 } : x)))} />
          <span className="text-muted">{L("يوم", "day")}</span>
          <button type="button" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label={L("امسح", "Remove")} onClick={() => onChange(tiers.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus />} className="w-fit" onClick={() => onChange([...tiers, { fromMin: (tiers[tiers.length - 1]?.fromMin ?? 0) + 30, days: 1 }])}>{L("درجة", "Tier")}</Button>
    </div>
  );
}

function TemplatesSection() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const tpls = useLive("shiftTemplates", { orderBy: [{ field: "sort" }] }).data;
  const upd = (t: ShiftTemplate, patch: Partial<ShiftTemplate>) => db.update("shiftTemplates", t.id, patch);
  return (
    <Section title={L("قوالب الورديات", "Shift templates")} icon={<Clock />} action={<Button size="sm" icon={<Plus />} onClick={() => db.insert("shiftTemplates", { branchId: hr.session.branchId, name: { ar: "وردية", en: "Shift" }, start: "12:00", end: "20:00", breakMin: 30, station: null, color: "#2f6f9f", sort: tpls.length })}>{L("قالب", "Template")}</Button>}>
      <ul className="grid gap-2">
        {tpls.map((t) => (
          <li key={t.id} className="grid grid-cols-2 items-end gap-2 rounded-2xl border border-line p-2.5 sm:grid-cols-[auto_1fr_1fr_auto_auto_auto_1fr_auto]">
            <input type="color" aria-label={L("اللون", "Colour")} value={t.color} onChange={(e) => upd(t, { color: e.target.value })} className="size-11 cursor-pointer rounded-xl border border-line bg-transparent" />
            <Input aria-label={L("الاسم", "Name")} value={t.name.ar} onChange={(e) => upd(t, { name: { ...t.name, ar: e.target.value } })} />
            <Input aria-label="Name (EN)" dir="ltr" value={t.name.en} onChange={(e) => upd(t, { name: { ...t.name, en: e.target.value } })} />
            <Input aria-label={L("من", "From")} type="time" value={t.start} onChange={(e) => upd(t, { start: e.target.value })} />
            <Input aria-label={L("لحد", "To")} type="time" value={t.end} onChange={(e) => upd(t, { end: e.target.value })} />
            <Input aria-label={L("بريك", "Break")} type="number" className="w-20" value={t.breakMin} onChange={(e) => upd(t, { breakMin: Number(e.target.value) || 0 })} />
            <Select aria-label={L("القسم", "Station")} value={t.station ?? ""} onChange={(e) => upd(t, { station: e.target.value || null })} options={[{ value: "", label: "—" }, ...Object.entries(STATION).map(([k, v]) => ({ value: k, label: v[lang] }))]} />
            <button type="button" className="grid size-11 place-items-center rounded-xl text-muted hover:bg-danger-soft hover:text-danger" aria-label={L("امسح", "Delete")} onClick={() => db.remove("shiftTemplates", t.id)}><Trash2 className="size-4" /></button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
