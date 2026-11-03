import { useMemo, useState } from "react";
import { Ban, Clock, Copy, Fingerprint, History, Link2, MapPin, Plus, RefreshCw, Router, Upload, Users } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { AttendancePunch, PunchKind } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Dialog, EmptyState, Input, Segmented, Select, StatTile, Table, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { addManualPunch, evaluateRange, importPunches, registerDevice, rotateDeviceSecret, saveProfile, voidPunch, HrError } from "@/modules/hr/ops";
import { presence, summarize, type DayEval } from "@/modules/hr/lib/attendance";
import { addDays, businessDate, periodBounds, zonedToMs } from "@/modules/hr/lib/tz";
import { parseAttendanceCsv, type CsvPunch } from "@/modules/hr/lib/zkteco";
import { PUNCH_KIND, PUNCH_SOURCE, minutesText } from "@/modules/hr/labels";
import { DayBadge, PersonCell, PersonPhoto, Section, useDateFmt } from "@/modules/hr/ui";

export default function AttendancePage() {
  const { L, lang } = useT();
  const hr = useHr();
  const f = useDateFmt();
  const [date, setDate] = useState(hr.today);
  const [view, setView] = useState<"day" | "month">("day");
  const [fix, setFix] = useState<{ membershipId: string; date: string } | null>(null);
  const from = view === "day" ? date : periodBounds(date.slice(0, 7)).from;
  const to = view === "day" ? date : periodBounds(date.slice(0, 7)).to;
  const shifts = useLive("rotaShifts", { gte: { date: from }, lte: { date: to } }).data;
  const punches = useLive("attendancePunches", { gte: { at: new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString() }, lte: { at: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString() } }).data;
  const leaves = useLive("leaveRequests", { where: { status: "approved" } }).data;
  const recent = useLive("attendancePunches", { gte: { at: new Date(hr.now - 16 * 3_600_000).toISOString() } }).data;
  const here = useMemo(() => presence(recent, hr.now), [recent, hr.now]);
  const data = { shifts, punches, leaves };

  const rows = useMemo(
    () =>
      hr.members
        .map((m) => {
          const days = evaluateRange(m.id, from, to, data, hr.rules, hr.tz, hr.now);
          return { m, days, day: days[days.length - 1] as DayEval | undefined, sum: summarize(days) };
        })
        .filter((r) => r.days.some((d) => d.scheduledMin > 0 || d.workedMin > 0 || d.status === "leave")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hr.members, from, to, shifts, punches, leaves, hr.rules, hr.tz, hr.now],
  );
  const scheduledToday = rows.filter((r) => r.day && r.day.scheduledMin > 0);
  const late = rows.filter((r) => (r.day?.lateMin ?? 0) > 0).length;
  const missing = rows.filter((r) => r.day?.status === "absent").length;
  const unmapped = punches.filter((p) => !p.membershipId && !p.voided);

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} tone="ok" icon={<Users />} label={L("في الشغل دلوقتي", "In right now")} value={here.size} sub={L(`من ${scheduledToday.length} عليهم وردية`, `of ${scheduledToday.length} scheduled`)} />
        <StatTile index={1} tone="warn" icon={<Clock />} label={L("متأخرين", "Late")} value={late} sub={view === "day" ? f.day(date) : f.month(date.slice(0, 7))} />
        <StatTile index={2} tone="danger" icon={<Ban />} label={view === "day" && date === hr.today ? L("لسه ماجوش / غياب", "Not in / absent") : L("غياب", "Absent")} value={missing} />
        <StatTile index={3} tone="info" icon={<Fingerprint />} label={L("بصمات مش متربطة", "Unlinked fingerprints")} value={unmapped.length} sub={L("اربطها بالموظف تحت", "link them below")} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label={L("العرض", "View")} value={view} onChange={setView} options={[{ value: "day", label: L("يوم", "Day") }, { value: "month", label: L("شهر", "Month") }]} />
        {view === "day" ? <Input aria-label={L("اليوم", "Day")} type="date" value={date} max={hr.today} onChange={(e) => e.target.value && setDate(e.target.value)} /> : <Input aria-label={L("الشهر", "Month")} type="month" value={date.slice(0, 7)} onChange={(e) => e.target.value && setDate(`${e.target.value}-01`)} />}
        {view === "day" ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setDate(addDays(date, -1))}>{L("اليوم اللي قبله", "Previous day")}</Button>
            {date !== hr.today ? <Button variant="ghost" size="sm" onClick={() => setDate(hr.today)}>{L("النهارده", "Today")}</Button> : null}
          </>
        ) : null}
      </div>

      {view === "day" && date === hr.today ? (
        <Section title={L("مين موجود دلوقتي", "Who's in now")} icon={<Clock />} subtitle={L("بيتحدث لوحده من كل الأجهزة", "Live from every device")}>
          {scheduledToday.length || here.size ? (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[...new Set([...scheduledToday.map((r) => r.m.id), ...here.keys()])].map((id) => {
                const m = hr.memberOf(id);
                if (!m) return null;
                const r = rows.find((x) => x.m.id === id);
                const h = here.get(id);
                const sh = shifts.find((s) => s.membershipId === id && s.date === hr.today && s.published);
                return (
                  <li key={id} className={cn("flex items-center gap-3 rounded-2xl border p-3", h ? "border-ok/40 bg-ok-soft/40" : "border-line")}>
                    <PersonPhoto m={m} p={hr.profileOf(id)} status={h ? (h.state === "in" ? "online" : "away") : null} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{m.name}</p>
                      <p className="num truncate text-[12.5px] text-muted">
                        {sh ? `${sh.start}–${sh.end}` : L("بدون وردية", "no shift")}
                        {h ? ` · ${L("من", "since")} ${f.time(h.since, hr.tz)}` : ""}
                      </p>
                    </div>
                    {r?.day ? <DayBadge status={h?.state === "break" ? "working" : r.day.status} notYet={r.day.status === "absent" && r.day.deductionDays === 0} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState compact icon={<Users />} title={L("مفيش حد عليه وردية النهارده", "Nobody is scheduled today")} />
          )}
        </Section>
      ) : null}

      <Section title={view === "day" ? L(`الحضور — ${f.day(date)}`, `Attendance — ${f.day(date)}`) : L(`ملخص ${f.month(date.slice(0, 7))}`, `${f.month(date.slice(0, 7))} summary`)} icon={<History />} bodyClass="px-0 pb-2">
        {view === "day" ? (
          <Table
            rows={rows}
            rowKey={(r) => r.m.id}
            onRowClick={hr.canManage ? (r) => setFix({ membershipId: r.m.id, date }) : undefined}
            empty={<EmptyState compact title={L("مفيش ورديات اليوم ده", "No shifts that day")} />}
            columns={[
              { key: "who", header: L("الموظف", "Staff"), cell: (r) => <PersonCell m={r.m} p={hr.profileOf(r.m.id)} size="sm" /> },
              { key: "shift", header: L("الوردية", "Shift"), cell: (r) => <span className="num">{shifts.filter((s) => s.membershipId === r.m.id && s.date === date).map((s) => `${s.start}–${s.end}`).join(" · ") || "—"}</span>, hideOnMobile: true },
              { key: "in", header: L("حضور", "In"), cell: (r) => <span className="num">{r.day?.firstIn ? f.time(r.day.firstIn, hr.tz) : "—"}</span> },
              { key: "out", header: L("انصراف", "Out"), cell: (r) => <span className="num">{r.day?.lastOut ? f.time(r.day.lastOut, hr.tz) : "—"}</span> },
              { key: "worked", header: L("شغل", "Worked"), cell: (r) => <span className="num">{r.day?.workedMin ? minutesText(r.day.workedMin, lang) : "—"}</span>, hideOnMobile: true },
              { key: "late", header: L("تأخير", "Late"), cell: (r) => (r.day?.lateMin ? <span className="num text-warn">{minutesText(r.day.lateMin, lang)}</span> : "—"), hideOnMobile: true },
              { key: "ot", header: L("إضافي", "OT"), cell: (r) => (r.day && r.day.overtimeMin + r.day.restDayMin ? <span className="num text-primary">{minutesText(r.day.overtimeMin + r.day.restDayMin, lang)}</span> : "—"), hideOnMobile: true },
              { key: "st", header: L("الحالة", "Status"), cell: (r) => (r.day ? <DayBadge status={r.day.status} notYet={r.day.status === "absent" && r.day.deductionDays === 0} /> : null) },
            ]}
          />
        ) : (
          <Table
            rows={rows}
            rowKey={(r) => r.m.id}
            columns={[
              { key: "who", header: L("الموظف", "Staff"), cell: (r) => <PersonCell m={r.m} p={hr.profileOf(r.m.id)} size="sm" /> },
              { key: "score", header: L("الالتزام", "Score"), cell: (r) => <Badge tone={r.sum.score >= 90 ? "ok" : r.sum.score >= 75 ? "warn" : "danger"}>{r.sum.score}%</Badge> },
              { key: "days", header: L("أيام شغل", "Days"), cell: (r) => <span className="num">{r.sum.workedDays}/{r.sum.scheduledDays}</span>, align: "center" },
              { key: "late", header: L("تأخير", "Late"), cell: (r) => <span className="num">{r.sum.lateCount} · {minutesText(r.sum.lateMin, lang)}</span>, hideOnMobile: true },
              { key: "abs", header: L("غياب", "Absent"), cell: (r) => <span className={cn("num", r.sum.absentDays && "font-bold text-danger")}>{r.sum.absentDays}</span>, align: "center" },
              { key: "ot", header: L("إضافي", "Overtime"), cell: (r) => <span className="num">{minutesText(r.sum.overtimeMin + r.sum.restDayMin, lang)}</span>, hideOnMobile: true },
              { key: "ded", header: L("خصم (يوم)", "Deduct (days)"), cell: (r) => <span className="num">{r.sum.lateDeductionDays + r.sum.absentDays * hr.rules.absenceDays}</span>, align: "center", hideOnMobile: true },
            ]}
          />
        )}
      </Section>

      {unmapped.length && hr.canManage ? <UnmappedPunches punches={unmapped} /> : null}
      {hr.canManage ? <DevicesSection /> : null}
      {hr.canManage ? <CsvImport /> : null}
      {fix ? <CorrectionDialog {...fix} onClose={() => setFix(null)} /> : null}
    </div>
  );
}

function CorrectionDialog({ membershipId, date, onClose }: { membershipId: string; date: string; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const { toast } = useToast();
  const m = hr.memberOf(membershipId)!;
  const all = useLive("attendancePunches", { where: { membershipId }, gte: { at: new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString() }, lte: { at: new Date(Date.parse(`${date}T00:00:00Z`) + 2 * 86_400_000).toISOString() } }).data;
  const punches = all.filter((p) => businessDate(Date.parse(p.at), hr.tz) === date).sort((a, b) => (a.at < b.at ? -1 : 1));
  const [kind, setKind] = useState<PunchKind>("out");
  const [time, setTime] = useState("23:30");
  const [reason, setReason] = useState("");
  const add = async () => {
    try {
      // times before 05:00 belong to the next calendar day of this business day
      const cal = Number(time.slice(0, 2)) < 5 ? addDays(date, 1) : date;
      await addManualPunch(db, { membershipId, at: new Date(zonedToMs(cal, time, hr.tz)).toISOString(), kind, reason });
      setReason("");
      toast({ title: L("اتسجل التعديل — موجود في سجل التعديلات", "Correction saved — it's in the audit log"), tone: "success" });
    } catch (e) {
      toast({ title: e instanceof HrError && e.code === "reason" ? L("اكتب سبب التعديل", "Write a reason") : String(e), tone: "error" });
    }
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={L(`تعديل حضور ${m.name}`, `Correct ${m.name}'s attendance`)} description={f.day(date, { weekday: "long", day: "numeric", month: "long" })}>
      <ul className="divide-y divide-line">
        {punches.map((p) => (
          <li key={p.id} className={cn("flex items-center gap-3 py-2.5", p.voided && "opacity-50")}>
            {p.photoUrl ? <img src={p.photoUrl} alt="" className="size-10 rounded-lg object-cover" /> : <span className="grid size-10 place-items-center rounded-lg bg-surface-3 text-muted">{p.source === "mobile" ? <MapPin className="size-4" /> : p.source === "device" ? <Fingerprint className="size-4" /> : <Clock className="size-4" />}</span>}
            <div className="min-w-0 flex-1">
              <p className={cn("font-semibold", p.voided && "line-through")}>
                <span className="num">{f.time(p.at, hr.tz)}</span> · {PUNCH_KIND[p.kind][lang]}
              </p>
              <p className="truncate text-[12.5px] text-muted">
                {PUNCH_SOURCE[p.source][lang]}
                {p.distanceM !== null ? ` · ${L(`على بعد ${p.distanceM} م`, `${p.distanceM} m away`)}` : ""}
                {p.note ? ` · ${p.note}` : ""}
                {p.correctedBy ? ` · ${L("عدّله", "by")} ${hr.memberOf(p.correctedBy)?.name ?? ""}` : ""}
              </p>
            </div>
            {!p.voided ? (
              <Button size="sm" variant="danger-soft" icon={<Ban />} onClick={async () => { const r = window.prompt(L("سبب الإلغاء", "Reason")); if (r) await voidPunch(db, p as AttendancePunch, r); }}>
                {L("إلغاء", "Void")}
              </Button>
            ) : (
              <Badge tone="neutral">{L("ملغي", "Voided")}</Badge>
            )}
          </li>
        ))}
        {!punches.length ? <li className="py-3 text-muted">{L("مفيش بصمات اليوم ده", "No punches that day")}</li> : null}
      </ul>
      <div className="mt-4 grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
        <Select label={L("النوع", "Kind")} value={kind} onChange={(e) => setKind(e.target.value as PunchKind)} options={Object.entries(PUNCH_KIND).map(([k, v]) => ({ value: k, label: v[lang] }))} />
        <Input label={L("الساعة", "Time")} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        <Input label={L("السبب (إجباري)", "Reason (required)")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L("نسي يبصم — اتأكدت من الكاميرا", "Forgot to clock out — checked CCTV")} />
        <Button icon={<Plus />} disabled={!reason.trim()} onClick={add}>{L("أضف", "Add")}</Button>
      </div>
    </Dialog>
  );
}

function UnmappedPunches({ punches }: { punches: AttendancePunch[] }) {
  const { L } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const users = [...new Set(punches.map((p) => p.deviceUserId ?? "?"))];
  return (
    <Section title={L("بصمات من الجهاز مش مربوطة بموظف", "Device punches not linked to anyone")} icon={<Link2 />} subtitle={L("اختار مين صاحب الرقم ده — هيتربط للأبد", "Pick who owns this device number — linked from now on")}>
      <ul className="divide-y divide-line">
        {users.map((u) => {
          const ps = punches.filter((p) => (p.deviceUserId ?? "?") === u);
          return (
            <li key={u} className="flex flex-wrap items-center gap-3 py-2.5">
              <Fingerprint className="size-5 text-muted" />
              <p className="min-w-0 flex-1">
                <b className="num">#{u}</b> · {L(`${ps.length} بصمة`, `${ps.length} punches`)} · <span className="num text-muted">{f.time(ps[0].at, hr.tz)}</span>
              </p>
              <Select
                aria-label={L("اربط بموظف", "Link to staff")}
                value=""
                onChange={async (e) => {
                  const mid = e.target.value;
                  if (!mid) return;
                  await saveProfile(db, mid, { deviceUserId: u });
                  for (const p of ps) await db.update("attendancePunches", p.id, { membershipId: mid });
                  await db.audit("attendance.device.link", "staffProfiles", null, { deviceUserId: u, membershipId: mid, punches: ps.length });
                }}
                options={[{ value: "", label: L("اربط بـ…", "Link to…") }, ...hr.active.map((m) => ({ value: m.id, label: m.name }))]}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function DevicesSection() {
  const { L } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const devices = useLive("attendanceDevices").data;
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<{ serial: string; secret: string } | null>(null);
  const server = typeof location !== "undefined" ? location.host : "sufra-planet-crm.vercel.app";
  return (
    <Section title={L("أجهزة البصمة", "Fingerprint terminals")} icon={<Router />} subtitle={L("ZKTeco (ADMS) بيبعت البصمات أول بأول", "ZKTeco (ADMS) pushes punches in real time")} action={<Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>{L("جهاز", "Terminal")}</Button>}>
      {devices.length ? (
        <ul className="grid gap-2.5 sm:grid-cols-2">
          {devices.map((d) => {
            const online = d.lastSeenAt && hr.now - Date.parse(d.lastSeenAt) < 15 * 60_000;
            return (
              <li key={d.id} className="flex items-center gap-3 rounded-2xl border border-line p-3">
                <span className={cn("grid size-11 place-items-center rounded-xl", online ? "bg-ok-soft text-ok" : "bg-surface-3 text-muted")}><Fingerprint className="size-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{d.name}</p>
                  <p className="num truncate text-[12.5px] text-muted">{d.model} · SN {d.serial} · {d.lastSeenAt ? `${L("آخر اتصال", "seen")} ${f.time(d.lastSeenAt, hr.tz)}` : L("لسه ماتصلش", "never connected")}</p>
                </div>
                <Badge tone={online ? "ok" : "neutral"} dot pulse={!!online}>{online ? L("متصل", "Online") : L("مش متصل", "Offline")}</Badge>
                <Button size="sm" variant="ghost" icon={<RefreshCw />} onClick={async () => setSecret({ serial: d.serial, secret: await rotateDeviceSecret(db, d.id) })} aria-label={L("مفتاح جديد", "New key")} />
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState compact icon={<Fingerprint />} title={L("مفيش أجهزة متسجلة", "No terminals yet")} body={L("ولو مفيش جهاز، الفريق يقدر يبصم بالـ PIN على الكاشير أو من موبايله", "Without one the team clocks in with a PIN at the POS or from their phone")} />
      )}
      {open ? <AddDevice onClose={() => setOpen(false)} onDone={(s) => { setOpen(false); setSecret(s); }} /> : null}
      {secret ? (
        <Dialog open onClose={() => setSecret(null)} title={L("إعداد الجهاز", "Terminal setup")} description={L("المفتاح بيظهر مرة واحدة بس — احفظه", "The key is shown only once — keep it")}>
          <ol className="grid list-decimal gap-2 ps-5 text-[14px]">
            <li>{L("على الجهاز: القائمة ← الاتصال ← إعدادات السيرفر (Cloud Server)", "On the terminal: Menu → Comm. → Cloud Server Setting")}</li>
            <li>
              {L("عنوان السيرفر", "Server address")}: <code className="num rounded bg-surface-3 px-1.5">{server}</code> · {L("بورت", "port")} <code className="num">443</code> · HTTPS
            </li>
            <li>
              {L("لو الجهاز أو البرنامج الوسيط بيقبل رابط كامل", "If the terminal/relay accepts a full URL")}: <code className="num break-all rounded bg-surface-3 px-1.5">https://{server}/api/attendance-push?key={secret.secret}</code>
            </li>
            <li>{L("لو الجهاز مابيقبلش مفتاح: سجّل IP الفرع الثابت في الجهاز ده (allowed IPs)", "If it can't send a key: register the branch's fixed IP on this terminal (allowed IPs)")}</li>
          </ol>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-brass-soft px-3 py-2">
            <code className="num flex-1 text-[16px] font-bold text-brass-text">{secret.secret}</code>
            <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => navigator.clipboard?.writeText(secret.secret)}>{L("انسخ", "Copy")}</Button>
          </div>
        </Dialog>
      ) : null}
    </Section>
  );
}

function AddDevice({ onClose, onDone }: { onClose: () => void; onDone: (s: { serial: string; secret: string }) => void }) {
  const { L } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const [f, setF] = useState({ name: "", serial: "", model: "ZKTeco", ips: "" });
  return (
    <Dialog
      open
      onClose={onClose}
      title={L("سجّل جهاز بصمة", "Register a terminal")}
      footer={
        <Button
          onClick={async () => {
            try {
              const r = await registerDevice(db, { branchId: hr.session.branchId ?? hr.session.branches[0]?.id ?? "", name: f.name, serial: f.serial, model: f.model, timezone: hr.tz, allowedIps: f.ips.split(/[\s,]+/).filter(Boolean) });
              onDone({ serial: f.serial, secret: r.secret });
            } catch (e) {
              toast({ title: e instanceof HrError && e.code === "serial_taken" ? L("الرقم ده متسجل قبل كده", "Serial already registered") : L("الرقم التسلسلي مش صح", "Invalid serial"), tone: "error" });
            }
          }}
        >
          {L("سجّل", "Register")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={L("الاسم", "Name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={L("بصمة باب العاملين", "Staff entrance")} />
        <Input label={L("الرقم التسلسلي (SN)", "Serial number (SN)")} dir="ltr" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} placeholder="CQZ7231460021" />
        <Input label={L("الموديل", "Model")} dir="ltr" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
        <Input label={L("IP الفرع الثابت (اختياري)", "Branch fixed IP (optional)")} dir="ltr" value={f.ips} onChange={(e) => setF({ ...f, ips: e.target.value })} />
      </div>
    </Dialog>
  );
}

function CsvImport() {
  const { L } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const [rows, setRows] = useState<CsvPunch[] | null>(null);
  const [errors, setErrors] = useState(0);
  const map = Object.fromEntries(hr.profiles.filter((p) => p.deviceUserId).map((p) => [p.deviceUserId!, p.membershipId]));
  return (
    <Section title={L("استيراد ملف حضور (CSV)", "Import attendance (CSV)")} icon={<Upload />} subtitle={L("من برنامج ZKTeco أو أي إكسل: رقم الموظف + التاريخ والوقت + الحالة", "From ZKTeco software or any spreadsheet: user no. + date/time + state")}>
      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong p-5 text-[14px] font-semibold text-muted hover:bg-surface-2">
        <Upload className="size-5" />
        {L("اختار ملف CSV", "Choose a CSV file")}
        <input
          type="file"
          accept=".csv,.txt,text/csv"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const r = parseAttendanceCsv(await file.text());
            setRows(r.punches);
            setErrors(r.errors.length);
            e.target.value = "";
          }}
        />
      </label>
      {rows ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 p-3 text-[14px]">
          <span>{L(`${rows.length} بصمة · ${rows.filter((r) => map[r.userId]).length} متربطة بموظفين`, `${rows.length} punches · ${rows.filter((r) => map[r.userId]).length} linked to staff`)}{errors ? L(` · ${errors} سطر فيه مشكلة`, ` · ${errors} bad lines`) : ""}</span>
          <span className="flex-1" />
          <Button
            icon={<Upload />}
            onClick={async () => {
              const r = await importPunches(db, rows, { serial: "CSV", source: "csv", branchId: hr.session.branchId, tz: hr.tz, map });
              toast({ title: L(`اتضاف ${r.added} · متكرر ${r.duplicates} · مش متربط ${r.unmapped}`, `Added ${r.added} · duplicates ${r.duplicates} · unlinked ${r.unmapped}`), tone: "success" });
              setRows(null);
            }}
          >
            {L("استورد", "Import")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
