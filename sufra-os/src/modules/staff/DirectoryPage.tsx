import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Clock, FileWarning, Palmtree, Phone, Plus, Search, Shuffle, UserPlus, Users } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import { ROLES, ROLE_LABEL, type Role } from "@/auth/roles";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { Badge, Button, Card, Dialog, EmptyState, Input, Segmented, Select, StatTile, Switch, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { createStaff, documentAlerts, HrError } from "@/modules/hr/ops";
import { presence } from "@/modules/hr/lib/attendance";
import { DOC_KIND, SALARY_TYPE } from "@/modules/hr/labels";
import { MoneyInput, PersonPhoto } from "@/modules/hr/ui";
import type { SalaryType } from "@/data/hrTypes";
import { cn } from "@/lib/cn";

const COLORS = ["#0d5a53", "#a8700c", "#c2412d", "#2f6f9f", "#1d7f4a", "#6b4fa0", "#9a3b6b", "#4b6b3a", "#3a5f7a", "#7a5a12"];

export default function DirectoryPage() {
  const { L, lang, loc } = useT();
  const hr = useHr();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<Role | "all">("all");
  const [show, setShow] = useState<"active" | "inactive">("active");
  const [adding, setAdding] = useState(false);
  const since = useMemo(() => new Date(hr.now - 16 * 3_600_000).toISOString(), [hr.now]);
  const punches = useLive("attendancePunches", { gte: { at: since } }).data;
  const leaves = useLive("leaveRequests", { where: { status: "approved" }, lte: { from: hr.today }, gte: { to: hr.today } }).data;
  const here = useMemo(() => presence(punches, hr.now), [punches, hr.now]);

  const list = hr.members
    .filter((m) => (show === "active" ? m.active : !m.active))
    .filter((m) => role === "all" || m.role === role)
    .filter((m) => !q.trim() || matches(`${m.name} ${m.phone ?? ""} ${loc(hr.profileOf(m.id)?.position)}`, q));
  const alerts = hr.active.flatMap((m) => documentAlerts(hr.profileOf(m.id), hr.today).map((a) => ({ ...a, m })));

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={<Users />} label={L("الفريق", "Team")} value={hr.active.length} sub={L(`${hr.members.length - hr.active.length} موقوف`, `${hr.members.length - hr.active.length} inactive`)} />
        <StatTile index={1} tone="ok" icon={<Clock />} label={L("في الشغل دلوقتي", "In right now")} value={here.size} sub={L(`${[...here.values()].filter((h) => h.state === "break").length} في البريك`, `${[...here.values()].filter((h) => h.state === "break").length} on break`)} />
        <StatTile index={2} tone="info" icon={<Palmtree />} label={L("إجازة النهارده", "On leave today")} value={leaves.length} />
        <StatTile index={3} tone={alerts.length ? "danger" : "ok"} icon={<FileWarning />} label={L("مستندات محتاجة تجديد", "Documents to renew")} value={alerts.length} sub={L("شهادات صحية وبطايق", "health certificates & IDs")} />
      </div>

      {alerts.length ? (
        <Card className="border-danger/30 bg-danger-soft/40 p-4">
          <p className="mb-2 flex items-center gap-2 font-bold text-danger">
            <AlertTriangle className="size-4" />
            {L("تنبيهات المستندات", "Document alerts")}
          </p>
          <ul className="grid gap-1.5 text-[14px] sm:grid-cols-2">
            {alerts.slice(0, 8).map((a, i) => (
              <li key={i}>
                <button className="flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start hover:bg-surface/70" onClick={() => nav(`/staff/p/${a.m.id}`)}>
                  <PersonPhoto m={a.m} p={hr.profileOf(a.m.id)} size="sm" />
                  <span className="min-w-0 flex-1 truncate">
                    <b>{a.m.name}</b> — {DOC_KIND[a.kind as keyof typeof DOC_KIND]?.[lang] ?? a.kind}
                  </span>
                  <Badge tone={a.state === "soon" ? "warn" : "danger"} size="sm">
                    {a.state === "missing" ? L("مش موجودة — إجبارية لمتداولي الأغذية", "Missing — required for food handlers") : a.state === "expired" ? L(`منتهية ${a.expiresAt}`, `Expired ${a.expiresAt}`) : L(`بتنتهي ${a.expiresAt}`, `Expires ${a.expiresAt}`)}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <Input wrapClassName="min-w-56 flex-1" icon={<Search />} placeholder={L("دوّر بالاسم أو الموبايل أو الوظيفة", "Search name, phone or job")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L("بحث", "Search")} />
        <Select aria-label={L("الدور", "Role")} value={role} onChange={(e) => setRole(e.target.value as Role | "all")} options={[{ value: "all", label: L("كل الأدوار", "All roles") }, ...ROLES.filter((r) => r !== "platform_admin").map((r) => ({ value: r, label: ROLE_LABEL[r][lang] }))]} />
        <Segmented label={L("الحالة", "Status")} value={show} onChange={setShow} options={[{ value: "active", label: L("شغالين", "Active") }, { value: "inactive", label: L("موقوفين", "Inactive") }]} />
        {hr.canManage ? (
          <Button icon={<UserPlus />} onClick={() => setAdding(true)}>
            {L("موظف جديد", "Add staff")}
          </Button>
        ) : null}
      </div>

      {list.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => {
            const p = hr.profileOf(m.id);
            const h = here.get(m.id);
            const a = documentAlerts(p, hr.today);
            const onLeave = leaves.some((l) => l.membershipId === m.id);
            return (
              <li key={m.id}>
                <Card interactive className="flex h-full cursor-pointer items-center gap-3.5 p-4" onClick={() => nav(`/staff/p/${m.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && nav(`/staff/p/${m.id}`)} aria-label={m.name}>
                  <PersonPhoto m={m} p={p} size="lg" status={h ? (h.state === "in" ? "online" : "away") : null} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-bold">{m.name}</p>
                    <p className="truncate text-[13px] text-muted">{p?.position ? loc(p.position) : ROLE_LABEL[m.role][lang]}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge size="sm" tone="neutral">{ROLE_LABEL[m.role][lang]}</Badge>
                      {h ? <Badge size="sm" tone={h.state === "in" ? "ok" : "warn"} dot>{h.state === "in" ? L("في الشغل", "In") : L("بريك", "Break")}</Badge> : null}
                      {onLeave ? <Badge size="sm" tone="info">{L("إجازة", "Leave")}</Badge> : null}
                      {a.length ? <Badge size="sm" tone="danger" icon={<FileWarning className="size-3" />}>{a.length}</Badge> : null}
                      {!m.hasPin ? <Badge size="sm" tone="warn">{L("بدون PIN", "No PIN")}</Badge> : null}
                    </div>
                  </div>
                  {m.phone ? (
                    <a href={`tel:${m.phone}`} onClick={(e) => e.stopPropagation()} className="grid size-11 shrink-0 place-items-center rounded-xl text-muted hover:bg-surface-3 hover:text-ink" aria-label={L(`اتصل بـ ${m.name}`, `Call ${m.name}`)}>
                      <Phone className="size-[18px]" />
                    </a>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={<Users />} title={L("مفيش حد هنا", "Nobody here")} body={L("غيّر البحث أو أضف موظف جديد", "Change the search or add someone")} />
      )}
      {adding ? <AddStaffDialog onClose={() => setAdding(false)} onCreated={(id) => nav(`/staff/p/${id}`)} /> : null}
    </div>
  );
}

function AddStaffDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const isOwner = hr.session.role === "owner";
  const roles = ROLES.filter((r) => r !== "platform_admin" && r !== "owner" && (isOwner || r !== "admin"));
  const [f, setF] = useState({
    name: "", role: "waiter" as Role, phone: "", email: "", invite: false, pin: String(1000 + Math.floor(Math.random() * 9000)), positionAr: "", positionEn: "", hireDate: hr.today,
    foodHandler: true, salaryType: "monthly" as SalaryType, salary: 0, branchIds: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    setBusy(true);
    try {
      const m = await createStaff(db, {
        name: f.name, role: f.role, phone: f.phone, email: f.invite ? f.email : null, branchIds: f.branchIds, pin: f.pin || null, color: COLORS[Math.floor(Math.random() * COLORS.length)],
        profile: { hireDate: f.hireDate, position: { ar: f.positionAr || ROLE_LABEL[f.role].ar, en: f.positionEn || ROLE_LABEL[f.role].en }, foodHandler: f.foodHandler },
        comp: hr.canPay && f.salary > 0 ? { salaryType: f.salaryType, monthlySalary: f.salaryType === "monthly" ? f.salary : 0, dailyRate: f.salaryType === "daily" ? f.salary : undefined, hourlyRate: f.salaryType === "hourly" ? f.salary : Math.round(f.salary / 208 / 1000) * 1000, insured: true } : null,
      });
      toast({ title: L(`${m.name} اتضاف — الـ PIN ${f.pin}`, `${m.name} added — PIN ${f.pin}`), tone: "success" });
      onCreated(m.id);
      onClose();
    } catch (e) {
      const code = e instanceof HrError ? e.code : "";
      toast({ title: code === "pin" ? L("الـ PIN لازم ٤–٦ أرقام", "PIN must be 4–6 digits") : code === "name" ? L("اكتب الاسم", "Enter a name") : String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={L("موظف جديد", "New staff member")}
      description={L("هيقدر يدخل على أجهزة المطعم بالـ PIN، ولو ليه إيميل يدخل من موبايله كمان", "Signs in on shared devices with the PIN; with an email also from their own phone")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
          <Button icon={<Plus />} loading={busy} disabled={!f.name.trim()} onClick={save}>{L("أضف", "Add")}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={L("الاسم بالكامل", "Full name")} value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        <Select label={L("الدور (الصلاحيات)", "Role (permissions)")} value={f.role} onChange={(e) => set("role", e.target.value as Role)} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r][lang] }))} />
        <Input label={L("الوظيفة بالعربي", "Job title (Arabic)")} placeholder={ROLE_LABEL[f.role].ar} value={f.positionAr} onChange={(e) => set("positionAr", e.target.value)} />
        <Input label={L("الوظيفة بالإنجليزي", "Job title (English)")} placeholder={ROLE_LABEL[f.role].en} value={f.positionEn} onChange={(e) => set("positionEn", e.target.value)} dir="ltr" />
        <Input label={L("الموبايل", "Mobile")} inputMode="tel" dir="ltr" placeholder="010…" value={f.phone} onChange={(e) => set("phone", e.target.value)} />
        <Input
          label={L("PIN للأجهزة المشتركة", "PIN for shared devices")}
          inputMode="numeric"
          dir="ltr"
          maxLength={6}
          value={f.pin}
          onChange={(e) => set("pin", e.target.value.replace(/\D/g, ""))}
          end={<button type="button" className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-3" aria-label={L("PIN عشوائي", "Random PIN")} onClick={() => set("pin", String(1000 + Math.floor(Math.random() * 9000)))}><Shuffle className="size-4" /></button>}
        />
        <Input label={L("تاريخ التعيين", "Hire date")} type="date" value={f.hireDate} onChange={(e) => set("hireDate", e.target.value)} />
        {hr.session.branches.length > 1 ? (
          <Select label={L("الفرع", "Branch")} value={f.branchIds[0] ?? ""} onChange={(e) => set("branchIds", e.target.value ? [e.target.value] : [])} options={[{ value: "", label: L("كل الفروع", "All branches") }, ...hr.session.branches.map((b) => ({ value: b.id, label: b.name[lang] }))]} />
        ) : null}
        <div className="sm:col-span-2 grid gap-1 rounded-2xl border border-line p-3">
          <Switch checked={f.foodHandler} onChange={(v) => set("foodHandler", v)} label={L("بيتعامل مع الأكل", "Handles food")} description={L("الشهادة الصحية إجبارية — هننبهك لو ناقصة أو قربت تخلص", "Health certificate required — you'll get alerts when missing or expiring")} />
          <Switch checked={f.invite} onChange={(v) => set("invite", v)} label={L("يدخل من موبايله بالإيميل", "Sign in from their phone by email")} description={L("هيوصله دعوة يعمل باسورد", "They get an invite to set a password")} />
          {f.invite ? <Input label={L("الإيميل", "Email")} type="email" dir="ltr" value={f.email} onChange={(e) => set("email", e.target.value)} /> : null}
        </div>
        {hr.canPay ? (
          <div className={cn("sm:col-span-2 grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-2")}>
            <Segmented block label={L("نوع المرتب", "Pay type")} value={f.salaryType} onChange={(v) => set("salaryType", v)} options={(["monthly", "daily", "hourly"] as SalaryType[]).map((s) => ({ value: s, label: SALARY_TYPE[s][lang] }))} />
            <MoneyInput label={f.salaryType === "monthly" ? L("المرتب الأساسي الشهري", "Monthly basic") : f.salaryType === "daily" ? L("اليومية", "Daily rate") : L("سعر الساعة", "Hourly rate")} value={f.salary} onChange={(v) => set("salary", v)} />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
