import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Camera, FileText, KeyRound, Phone, Plus, Save, ShieldCheck, Trash2, UserX, UserCheck, Wallet } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { StaffCompensation, StaffDocKind, StaffDocument, StaffProfile } from "@/data/types";
import { ROLES, ROLE_LABEL, type Role } from "@/auth/roles";
import { useT } from "@/i18n/i18n";
import { uuid } from "@/lib/id";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Card, Dialog, EmptyState, Input, Segmented, Select, Switch, Textarea, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { changeRole, documentAlerts, saveCompensation, saveProfile, setStaffActive } from "@/modules/hr/ops";
import { CONTRACT, DOC_KIND, PAY_METHOD, SALARY_TYPE, STATION, WEEKDAYS } from "@/modules/hr/labels";
import { MoneyInput, NumberInput, PersonPhoto, Section, useDateFmt } from "@/modules/hr/ui";
import { AdvanceCard, AttendanceSummary, DayList, LeaveBalanceCards, LeaveRequestRow, useMonthAttendance } from "@/modules/hr/components";
import { fileToDataUrl } from "@/modules/hr/image";
import { effectiveComp, NO_ALLOWANCES } from "@/modules/hr/lib/payroll";
import { serviceYears } from "@/modules/hr/lib/statutory";
import type { ContractType, PayMethod, SalaryType } from "@/data/hrTypes";

type Tab = "file" | "docs" | "pay" | "attendance" | "leave" | "advances";

export default function ProfilePage() {
  const { membershipId = "" } = useParams();
  const { L, lang, loc } = useT();
  const hr = useHr();
  const db = useDb();
  const { toast } = useToast();
  const m = hr.memberOf(membershipId);
  const p = hr.profileOf(membershipId);
  const [tab, setTab] = useState<Tab>("file");
  const [pinOpen, setPinOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  if (!m) return <EmptyState title={L("الموظف مش موجود", "Staff member not found")} action={<Link className="font-semibold text-primary" to="/staff">{L("رجوع للفريق", "Back to team")}</Link>} />;
  const years = p ? serviceYears(p.hireDate, hr.today) : 0;
  const alerts = documentAlerts(p, hr.today);
  const setPhoto = async (f: File | undefined) => {
    if (!f) return;
    await saveProfile(db, m.id, { photoUrl: await fileToDataUrl(f, 240) });
    toast({ title: L("الصورة اتحفظت", "Photo saved"), tone: "success" });
  };
  const tabs: { value: Tab; label: string }[] = [
    { value: "file", label: L("الملف", "File") },
    { value: "docs", label: L("المستندات", "Documents") },
    ...(hr.canPay ? [{ value: "pay" as Tab, label: L("المرتب", "Pay") }] : []),
    { value: "attendance", label: L("الحضور", "Attendance") },
    { value: "leave", label: L("الإجازات", "Leave") },
    { value: "advances", label: L("السلف", "Advances") },
  ];
  return (
    <div className="grid gap-5">
      <Link to="/staff" className="inline-flex w-fit items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink">
        <ArrowRight className="size-4 ltr:rotate-180" />
        {L("الفريق", "Team")}
      </Link>
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <button type="button" className="group relative" onClick={() => hr.canManage && photoRef.current?.click()} aria-label={L("غيّر الصورة", "Change photo")}>
          <PersonPhoto m={m} p={p} size="xl" />
          {hr.canManage ? (
            <span className="absolute -bottom-1 -end-1 grid size-8 place-items-center rounded-full border border-line bg-surface text-ink-2 shadow-sf-sm">
              <Camera className="size-4" />
            </span>
          ) : null}
        </button>
        <input ref={photoRef} type="file" accept="image/*" capture="user" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0])} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[24px]">{m.name}</h2>
          <p className="text-muted">
            {p?.position ? loc(p.position) : ROLE_LABEL[m.role][lang]} · {L(`${years.toFixed(1)} سنة خدمة`, `${years.toFixed(1)} years`)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="primary">{ROLE_LABEL[m.role][lang]}</Badge>
            {!m.active ? <Badge tone="danger">{L("موقوف", "Inactive")}</Badge> : null}
            {m.hasPin ? <Badge tone="neutral" icon={<KeyRound className="size-3" />}>PIN</Badge> : <Badge tone="warn">{L("بدون PIN", "No PIN")}</Badge>}
            {m.email ? <Badge tone="info">{m.email}</Badge> : null}
            {alerts.length ? <Badge tone="danger">{L(`${alerts.length} مستند محتاج تجديد`, `${alerts.length} documents to renew`)}</Badge> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {m.phone ? (
            <a href={`tel:${m.phone}`} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line px-4 font-semibold hover:bg-surface-2">
              <Phone className="size-4" />
              <span dir="ltr" className="num">{m.phone}</span>
            </a>
          ) : null}
          {hr.canManage ? (
            <>
              <Button variant="secondary" icon={<KeyRound />} onClick={() => setPinOpen(true)}>{L("PIN جديد", "New PIN")}</Button>
              {hr.session.role === "owner" || hr.session.role === "admin" ? <Button variant="secondary" icon={<ShieldCheck />} onClick={() => setRoleOpen(true)}>{L("الدور والفروع", "Role & branches")}</Button> : null}
              {m.id !== hr.session.staff?.id && m.role !== "owner" ? (
                <Button
                  variant={m.active ? "danger-soft" : "soft"}
                  icon={m.active ? <UserX /> : <UserCheck />}
                  onClick={async () => {
                    const reason = m.active ? (window.prompt(L("سبب الإيقاف (استقالة، إنهاء خدمة…)", "Reason (resigned, terminated…)")) ?? null) : "";
                    if (reason === null) return;
                    await setStaffActive(db, m, !m.active, reason);
                    toast({ title: m.active ? L("اتوقف — مش هيقدر يدخل تاني", "Deactivated — can no longer sign in") : L("رجع للشغل", "Reactivated"), tone: "success" });
                  }}
                >
                  {m.active ? L("إيقاف", "Deactivate") : L("تفعيل", "Reactivate")}
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>
      <Segmented label={L("أقسام الملف", "File sections")} value={tab} onChange={setTab} options={tabs} className="max-w-full overflow-x-auto" />
      {tab === "file" ? <FileTab key={p?.id ?? "new"} membershipId={m.id} p={p ?? null} /> : null}
      {tab === "docs" ? <DocsTab membershipId={m.id} p={p ?? null} /> : null}
      {tab === "pay" && hr.canPay ? <PayTab key={hr.compOf(m.id)?.id ?? "none"} membershipId={m.id} c={hr.compOf(m.id) ?? null} /> : null}
      {tab === "attendance" ? <AttendanceTab membershipId={m.id} /> : null}
      {tab === "leave" ? <LeaveTab membershipId={m.id} /> : null}
      {tab === "advances" ? <AdvancesTab membershipId={m.id} /> : null}
      {pinOpen ? <PinDialog membershipId={m.id} name={m.name} onClose={() => setPinOpen(false)} /> : null}
      {roleOpen ? <RoleDialog membershipId={m.id} onClose={() => setRoleOpen(false)} /> : null}
    </div>
  );
}

function FileTab({ membershipId, p }: { membershipId: string; p: StaffProfile | null }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const [f, setF] = useState<Partial<StaffProfile>>(() => ({ ...(p ?? {}) }));
  const set = <K extends keyof StaffProfile>(k: K, v: StaffProfile[K]) => setF((x) => ({ ...x, [k]: v }));
  const ro = !hr.canManage;
  const save = async () => {
    const { id: _i, restaurantId: _r, createdAt: _c, updatedAt: _u, membershipId: _m, ...patch } = f as StaffProfile;
    await saveProfile(db, membershipId, patch);
    await db.audit("staff.profile", "staffProfiles", p?.id ?? null, { membershipId });
    toast({ title: L("الملف اتحفظ", "File saved"), tone: "success" });
  };
  return (
    <Section title={L("بيانات الموظف", "Employee details")} icon={<FileText />} action={!ro ? <Button size="sm" icon={<Save />} onClick={save}>{L("احفظ", "Save")}</Button> : null}>
      <fieldset disabled={ro} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Input label={L("الوظيفة", "Job title")} value={f.position?.ar ?? ""} onChange={(e) => set("position", { ar: e.target.value, en: f.position?.en ?? "" })} />
        <Input label={L("الوظيفة (EN)", "Job title (EN)")} dir="ltr" value={f.position?.en ?? ""} onChange={(e) => set("position", { ar: f.position?.ar ?? "", en: e.target.value })} />
        <Select label={L("القسم في الجدول", "Rota station")} value={f.station ?? ""} onChange={(e) => set("station", e.target.value || null)} options={[{ value: "", label: "—" }, ...Object.entries(STATION).map(([k, v]) => ({ value: k, label: v[lang] }))]} />
        <Input label={L("الرقم القومي / الإقامة", "National ID / Iqama")} dir="ltr" inputMode="numeric" value={f.nationalId ?? ""} onChange={(e) => set("nationalId", e.target.value || null)} />
        <Select label={L("الجنسية", "Nationality")} value={f.nationality ?? "EG"} onChange={(e) => set("nationality", e.target.value)} options={[{ value: "EG", label: L("مصري", "Egyptian") }, { value: "SA", label: L("سعودي", "Saudi") }, { value: "SD", label: L("سوداني", "Sudanese") }, { value: "SY", label: L("سوري", "Syrian") }, { value: "OT", label: L("أخرى", "Other") }]} />
        <Input label={L("تاريخ الميلاد", "Birth date")} type="date" value={f.birthDate ?? ""} onChange={(e) => set("birthDate", e.target.value || null)} />
        <Input label={L("تاريخ التعيين", "Hire date")} type="date" value={f.hireDate ?? ""} onChange={(e) => set("hireDate", e.target.value)} />
        <Select label={L("نوع العقد", "Contract")} value={f.contractType ?? "permanent"} onChange={(e) => set("contractType", e.target.value as ContractType)} options={Object.entries(CONTRACT).map(([k, v]) => ({ value: k, label: v[lang] }))} />
        <Input label={L("نهاية العقد", "Contract end")} type="date" value={f.contractEnd ?? ""} onChange={(e) => set("contractEnd", e.target.value || null)} />
        <Input label={L("رقمه على جهاز البصمة", "Fingerprint device user no.")} dir="ltr" inputMode="numeric" value={f.deviceUserId ?? ""} onChange={(e) => set("deviceUserId", e.target.value.trim() || null)} />
        <Input label={L("العنوان", "Address")} value={f.address ?? ""} onChange={(e) => set("address", e.target.value || null)} />
        <div className="grid gap-1.5">
          <span className="text-[13.5px] font-semibold text-ink-2">{L("يوم الراحة", "Weekly day off")}</span>
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((w, i) => {
              const on = (f.weeklyOff ?? []).includes(i);
              return (
                <button key={i} type="button" aria-pressed={on} onClick={() => set("weeklyOff", on ? (f.weeklyOff ?? []).filter((x) => x !== i) : [...(f.weeklyOff ?? []), i])} className={`h-9 rounded-lg border px-2 text-[12.5px] font-semibold ${on ? "border-primary bg-primary-soft text-primary" : "border-line text-muted"}`}>
                  {w[lang]}
                </button>
              );
            })}
          </div>
        </div>
        <Input label={L("اسم للطوارئ", "Emergency contact")} value={f.emergencyContact?.name ?? ""} onChange={(e) => set("emergencyContact", { name: e.target.value, phone: f.emergencyContact?.phone ?? "", relation: f.emergencyContact?.relation ?? "" })} />
        <Input label={L("موبايل الطوارئ", "Emergency phone")} dir="ltr" inputMode="tel" value={f.emergencyContact?.phone ?? ""} onChange={(e) => set("emergencyContact", { name: f.emergencyContact?.name ?? "", phone: e.target.value, relation: f.emergencyContact?.relation ?? "" })} />
        <Input label={L("صلة القرابة", "Relation")} value={f.emergencyContact?.relation ?? ""} onChange={(e) => set("emergencyContact", { name: f.emergencyContact?.name ?? "", phone: f.emergencyContact?.phone ?? "", relation: e.target.value })} />
        <div className="sm:col-span-2 lg:col-span-3">
          <Switch checked={!!f.foodHandler} onChange={(v) => set("foodHandler", v)} label={L("بيتعامل مع الأكل", "Handles food")} description={L("الشهادة الصحية إجبارية في مصر لكل اللي بيتعاملوا مع الأكل", "In Egypt a health certificate is mandatory for food handlers")} />
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Textarea label={L("ملاحظات", "Notes")} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </fieldset>
    </Section>
  );
}

function DocsTab({ membershipId, p }: { membershipId: string; p: StaffProfile | null }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const [edit, setEdit] = useState<StaffDocument | null>(null);
  const docs = p?.documents ?? [];
  const alerts = documentAlerts(p, hr.today);
  const save = async (d: StaffDocument) => {
    const next = docs.some((x) => x.id === d.id) ? docs.map((x) => (x.id === d.id ? d : x)) : [...docs, d];
    await saveProfile(db, membershipId, { documents: next });
    await db.audit("staff.document", "staffProfiles", p?.id ?? null, { kind: d.kind, expiresAt: d.expiresAt });
    setEdit(null);
  };
  return (
    <Section
      title={L("المستندات", "Documents")}
      subtitle={L("هننبهك قبل ما أي مستند يخلص بـ ٣٠ يوم", "Alerts 30 days before anything expires")}
      icon={<FileText />}
      action={hr.canManage ? <Button size="sm" icon={<Plus />} onClick={() => setEdit({ id: uuid(), kind: "health_certificate", number: "", issuedAt: hr.today, expiresAt: null, fileUrl: null, note: "" })}>{L("مستند", "Document")}</Button> : null}
    >
      {alerts.some((a) => a.state === "missing") ? <p className="mb-3 rounded-xl bg-danger-soft px-3 py-2 text-[14px] font-semibold text-danger">{L("الشهادة الصحية ناقصة — إجبارية لمتداولي الأغذية", "Health certificate missing — required for food handlers")}</p> : null}
      {docs.length ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {docs.map((d) => {
            const a = alerts.find((x) => x.kind === d.kind && x.expiresAt === d.expiresAt);
            return (
              <li key={d.id}>
                <button type="button" disabled={!hr.canManage} onClick={() => setEdit(d)} className="flex w-full items-center gap-3 rounded-2xl border border-line p-3 text-start hover:bg-surface-2">
                  {d.fileUrl ? <img src={d.fileUrl} alt="" className="size-12 rounded-lg object-cover" /> : <span className="grid size-12 place-items-center rounded-lg bg-surface-3 text-muted"><FileText className="size-5" /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{DOC_KIND[d.kind][lang]}</span>
                    <span className="num block truncate text-[12.5px] text-muted">{d.number || "—"} · {d.expiresAt ? L(`لحد ${f.day(d.expiresAt, { day: "numeric", month: "short", year: "numeric" })}`, `until ${f.day(d.expiresAt, { day: "numeric", month: "short", year: "numeric" })}`) : L("مالوش تاريخ انتهاء", "no expiry")}</span>
                  </span>
                  {a ? <Badge tone={a.state === "soon" ? "warn" : "danger"} size="sm">{a.state === "soon" ? L("قرب يخلص", "Expiring") : L("منتهي", "Expired")}</Badge> : <Badge tone="ok" size="sm">{L("ساري", "Valid")}</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact icon={<FileText />} title={L("مفيش مستندات", "No documents")} />
      )}
      {edit ? <DocDialog doc={edit} onClose={() => setEdit(null)} onSave={save} onDelete={async () => { await saveProfile(db, membershipId, { documents: docs.filter((x) => x.id !== edit.id) }); setEdit(null); }} /> : null}
    </Section>
  );
}

function DocDialog({ doc, onClose, onSave, onDelete }: { doc: StaffDocument; onClose: () => void; onSave: (d: StaffDocument) => void; onDelete: () => void }) {
  const { L, lang } = useT();
  const [d, setD] = useState(doc);
  return (
    <Dialog
      open
      onClose={onClose}
      title={DOC_KIND[d.kind][lang]}
      footer={
        <>
          <Button variant="danger-soft" icon={<Trash2 />} onClick={onDelete}>{L("امسح", "Delete")}</Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
          <Button icon={<Save />} onClick={() => onSave(d)}>{L("احفظ", "Save")}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label={L("النوع", "Type")} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as StaffDocKind })} options={Object.entries(DOC_KIND).map(([k, v]) => ({ value: k, label: v[lang] }))} />
        <Input label={L("الرقم", "Number")} dir="ltr" value={d.number} onChange={(e) => setD({ ...d, number: e.target.value })} />
        <Input label={L("تاريخ الإصدار", "Issued")} type="date" value={d.issuedAt ?? ""} onChange={(e) => setD({ ...d, issuedAt: e.target.value || null })} />
        <Input label={L("تاريخ الانتهاء", "Expires")} type="date" value={d.expiresAt ?? ""} onChange={(e) => setD({ ...d, expiresAt: e.target.value || null })} />
        <label className="sm:col-span-2 flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-line-strong p-3 hover:bg-surface-2">
          {d.fileUrl ? <img src={d.fileUrl} alt="" className="size-14 rounded-lg object-cover" /> : <Camera className="size-6 text-muted" />}
          <span className="text-[14px] font-semibold">{L("صوّر أو ارفع صورة المستند", "Photo or upload the document")}</span>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => e.target.files?.[0] && setD({ ...d, fileUrl: await fileToDataUrl(e.target.files[0], 900, 0.7) })} />
        </label>
        <div className="sm:col-span-2">
          <Input label={L("ملاحظة", "Note")} value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} />
        </div>
      </div>
    </Dialog>
  );
}

function PayTab({ membershipId, c }: { membershipId: string; c: StaffCompensation | null }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const e = effectiveComp(c, hr.rules);
  const [f, setF] = useState({ ...e, insurableWage: c?.insurableWage ?? null, bankName: c?.bankName ?? "", iban: c?.iban ?? "", walletNumber: c?.walletNumber ?? "" });
  useEffect(() => setF({ ...e, insurableWage: c?.insurableWage ?? null, bankName: c?.bankName ?? "", iban: c?.iban ?? "", walletNumber: c?.walletNumber ?? "" }), [c?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    await saveCompensation(db, membershipId, {
      salaryType: f.salaryType, monthlySalary: f.monthlySalary, dailyRate: f.dailyRate, hourlyRate: f.hourlyRate, allowances: f.allowances, insurableWage: f.insurableWage, insured: f.insured,
      gosiScheme: f.gosiScheme, servicePoints: f.servicePoints, tipsEligible: f.tipsEligible, payMethod: f.payMethod, bankName: f.bankName || null, iban: f.iban || null, walletNumber: f.walletNumber || null,
    });
    toast({ title: L("بيانات المرتب اتحفظت", "Pay details saved"), tone: "success" });
  };
  const fixed = f.monthlySalary + f.allowances.housing + f.allowances.transport + f.allowances.meal + f.allowances.other;
  return (
    <Section title={L("المرتب وطريقة الصرف", "Pay & payout")} subtitle={L("ظاهر للمالك والأدمن والمحاسب بس", "Visible to owner, admin and accountant only")} icon={<Wallet />} action={<Button size="sm" icon={<Save />} onClick={save}>{L("احفظ", "Save")}</Button>}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Segmented block className="sm:col-span-2 lg:col-span-3" label={L("نوع المرتب", "Pay type")} value={f.salaryType} onChange={(v) => set("salaryType", v as SalaryType)} options={(["monthly", "daily", "hourly"] as SalaryType[]).map((s) => ({ value: s, label: SALARY_TYPE[s][lang] }))} />
        {f.salaryType === "monthly" ? <MoneyInput label={L("الأساسي الشهري", "Monthly basic")} value={f.monthlySalary} onChange={(v) => set("monthlySalary", v)} /> : null}
        {f.salaryType === "daily" ? <MoneyInput label={L("اليومية", "Daily rate")} value={f.dailyRate} onChange={(v) => set("dailyRate", v)} /> : null}
        {f.salaryType === "hourly" ? <MoneyInput label={L("سعر الساعة", "Hourly rate")} value={f.hourlyRate} onChange={(v) => set("hourlyRate", v)} /> : null}
        {f.salaryType === "monthly" ? (
          <>
            <MoneyInput label={L("بدل سكن", "Housing")} value={f.allowances.housing} onChange={(v) => set("allowances", { ...NO_ALLOWANCES, ...f.allowances, housing: v })} />
            <MoneyInput label={L("بدل انتقالات", "Transport")} value={f.allowances.transport} onChange={(v) => set("allowances", { ...f.allowances, transport: v })} />
            <MoneyInput label={L("بدل وجبة", "Meal")} value={f.allowances.meal} onChange={(v) => set("allowances", { ...f.allowances, meal: v })} />
            <MoneyInput label={L("بدلات أخرى", "Other")} value={f.allowances.other} onChange={(v) => set("allowances", { ...f.allowances, other: v })} />
          </>
        ) : null}
        <NumberInput label={L("نقاط الخدمة", "Service points")} hint={L("نصيبه من الـ ١٢٪ خدمة", "share of the 12% service pool")} value={f.servicePoints} onChange={(v) => set("servicePoints", v)} step={0.5} />
        <div className="sm:col-span-2 lg:col-span-3 grid gap-1 rounded-2xl border border-line p-3">
          <Switch checked={f.tipsEligible} onChange={(v) => set("tipsEligible", v)} label={L("بياخد من البقشيش", "Shares the tips pool")} />
          <Switch checked={f.insured} onChange={(v) => set("insured", v)} label={hr.rules.country === "EG" ? L("مؤمَّن عليه (تأمينات اجتماعية)", "Socially insured") : L("مسجَّل في GOSI", "Registered in GOSI")} description={hr.rules.country === "EG" ? L(`أجر الاشتراك بين ${formatMoney(hr.rules.insuranceEG.minWage, { lang, compact: true })} و${formatMoney(hr.rules.insuranceEG.maxWage, { lang, compact: true })}`, `insurable wage between ${formatMoney(hr.rules.insuranceEG.minWage, { lang, compact: true })} and ${formatMoney(hr.rules.insuranceEG.maxWage, { lang, compact: true })}`) : undefined} />
          {f.insured && hr.rules.country === "EG" ? (
            <MoneyInput label={L("أجر الاشتراك التأميني (فاضي = الثابت)", "Declared insurable wage (empty = fixed pay)")} hint={L(`الثابت الحالي ${formatMoney(fixed, { lang, compact: true })}`, `fixed pay now ${formatMoney(fixed, { lang, compact: true })}`)} value={f.insurableWage ?? 0} onChange={(v) => set("insurableWage", v || null)} />
          ) : null}
          {hr.rules.country === "SA" ? <Select label={L("نظام GOSI للسعوديين", "GOSI scheme (Saudis)")} value={f.gosiScheme} onChange={(e) => set("gosiScheme", e.target.value as "legacy" | "new")} options={[{ value: "legacy", label: L("قبل يوليو ٢٠٢٤", "Before Jul 2024") }, { value: "new", label: L("مشترك جديد", "New entrant") }]} /> : null}
        </div>
        <Select label={L("طريقة صرف المرتب", "Salary paid by")} value={f.payMethod} onChange={(e) => set("payMethod", e.target.value as PayMethod)} options={Object.entries(PAY_METHOD).map(([k, v]) => ({ value: k, label: v[lang] }))} />
        {f.payMethod === "bank" ? (
          <>
            <Input label={L("البنك", "Bank")} value={f.bankName} onChange={(e) => set("bankName", e.target.value)} />
            <Input label="IBAN" dir="ltr" value={f.iban} onChange={(e) => set("iban", e.target.value.toUpperCase().replace(/\s/g, ""))} />
          </>
        ) : null}
        {f.payMethod === "wallet" || f.payMethod === "instapay" ? <Input label={L("رقم المحفظة / إنستاباي", "Wallet / InstaPay")} dir="ltr" inputMode="tel" value={f.walletNumber} onChange={(e) => set("walletNumber", e.target.value)} /> : null}
      </div>
    </Section>
  );
}

function AttendanceTab({ membershipId }: { membershipId: string }) {
  const { L } = useT();
  const hr = useHr();
  const [period, setPeriod] = useState(hr.today.slice(0, 7));
  const { days, summary } = useMonthAttendance(membershipId, period);
  return (
    <Section title={L("الحضور", "Attendance")} action={<Input aria-label={L("الشهر", "Month")} type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="h-9" />}>
      <AttendanceSummary s={summary} />
      <div className="mt-3">
        <DayList days={days} tz={hr.tz} />
      </div>
    </Section>
  );
}

function LeaveTab({ membershipId }: { membershipId: string }) {
  const { L } = useT();
  const reqs = useLive("leaveRequests", { where: { membershipId }, orderBy: [{ field: "from", dir: "desc" }] }).data;
  return (
    <div className="grid gap-4">
      <LeaveBalanceCards membershipId={membershipId} />
      <Section title={L("الطلبات", "Requests")}>
        <div className="divide-y divide-line">{reqs.length ? reqs.map((r) => <LeaveRequestRow key={r.id} r={r} />) : <EmptyState compact title={L("مفيش طلبات", "No requests")} />}</div>
      </Section>
    </div>
  );
}

function AdvancesTab({ membershipId }: { membershipId: string }) {
  const { L } = useT();
  const list = useLive("advances", { where: { membershipId }, orderBy: [{ field: "requestedAt", dir: "desc" }] }).data;
  return <div className="grid gap-3 sm:grid-cols-2">{list.length ? list.map((a) => <AdvanceCard key={a.id} a={a} />) : <EmptyState compact title={L("مفيش سلف", "No advances")} />}</div>;
}

function PinDialog({ membershipId, name, onClose }: { membershipId: string; name: string; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [pin, setPin] = useState(String(1000 + Math.floor(Math.random() * 9000)));
  return (
    <Dialog open onClose={onClose} size="sm" title={L(`PIN جديد لـ ${name}`, `New PIN for ${name}`)} footer={<Button block disabled={!/^\d{4,6}$/.test(pin)} onClick={async () => { await db.repo.auth.setPin(db.restaurantId, membershipId, pin); await db.update("memberships", membershipId, { hasPin: true }); await db.audit("staff.pin", "memberships", membershipId, {}); toast({ title: L(`الـ PIN بقى ${pin}`, `PIN is now ${pin}`), tone: "success" }); onClose(); }}>{L("احفظ", "Save")}</Button>}>
      <Input label="PIN" inputMode="numeric" dir="ltr" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className="num text-center text-[22px] tracking-[0.4em]" />
    </Dialog>
  );
}

function RoleDialog({ membershipId, onClose }: { membershipId: string; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const m = hr.memberOf(membershipId)!;
  const [role, setRole] = useState<Role>(m.role);
  const [branches, setBranches] = useState<string[]>(m.branchIds);
  const roles = ROLES.filter((r) => r !== "platform_admin" && (hr.session.role === "owner" || (r !== "owner" && r !== "admin")));
  return (
    <Dialog open onClose={onClose} title={L("الدور والفروع", "Role & branches")} footer={<Button onClick={async () => { await changeRole(db, m, role, branches); onClose(); }}>{L("احفظ", "Save")}</Button>}>
      <div className="grid gap-4">
        <Select label={L("الدور", "Role")} value={role} onChange={(e) => setRole(e.target.value as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r][lang] }))} />
        <div className="grid gap-1">
          {hr.session.branches.map((b) => (
            <Switch key={b.id} checked={!branches.length || branches.includes(b.id)} onChange={(v) => setBranches(v ? [...branches, b.id] : (branches.length ? branches : hr.session.branches.map((x) => x.id)).filter((x) => x !== b.id))} label={b.name[lang]} />
          ))}
        </div>
      </div>
    </Dialog>
  );
}
