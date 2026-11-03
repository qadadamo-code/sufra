import { useMemo, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { CalendarDays, Coffee, FileText, HandCoins, LogIn, LogOut, MapPin, Palmtree, Plus, Repeat, TimerReset } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { RotaShift } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, EmptyState, Segmented, Spinner, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { useHr, useNow } from "./useHr";
import { HrError, punch } from "./ops";
import { presence } from "./lib/attendance";
import { addDays, dateRange, hm, weekStart } from "./lib/tz";
import { STATION, minutesText } from "./labels";
import { PersonPhoto, Section, useDateFmt } from "./ui";
import { AdvanceCard, AttendanceSummary, DayList, LeaveBalanceCards, LeaveRequestRow, PayslipList, useMonthAttendance } from "./components";
import { AdvanceRequestDialog, LeaveRequestDialog, SwapRequestDialog } from "./forms";
import { SlipPage } from "@/modules/staff/PayrollPage";

export default function MePage() {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="payslip/:slipId" element={<SlipPage back="/me" />} />
    </Routes>
  );
}

type Tab = "week" | "attendance" | "leave" | "advances" | "pay";

function Home() {
  const { L, loc } = useT();
  const hr = useHr();
  const me = hr.session.staff;
  const [tab, setTab] = useState<Tab>("week");
  if (!me) return null;
  const p = hr.profileOf(me.id);
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <PageHeader icon={<PersonPhoto m={me} p={p} size="md" />} kicker={L("أهلاً", "Hi")} title={me.name} subtitle={p?.position ? loc(p.position) : undefined} />
      <ClockCard />
      <Segmented
        block
        label={L("أقسام", "Sections")}
        value={tab}
        onChange={setTab}
        className="overflow-x-auto"
        options={[
          { value: "week", label: L("جدولي", "Schedule") },
          { value: "attendance", label: L("حضوري", "Attendance") },
          { value: "leave", label: L("إجازاتي", "Leave") },
          { value: "advances", label: L("سلف", "Advances") },
          { value: "pay", label: L("مرتبي", "Payslips") },
        ]}
      />
      {tab === "week" ? <MyWeek /> : null}
      {tab === "attendance" ? <MyAttendance /> : null}
      {tab === "leave" ? <MyLeave /> : null}
      {tab === "advances" ? <MyAdvances /> : null}
      {tab === "pay" ? <MyPay /> : null}
    </div>
  );
}

function ClockCard() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const { toast } = useToast();
  const now = useNow(15_000);
  const me = hr.session.staff!;
  const recent = useLive("attendancePunches", { where: { membershipId: me.id }, gte: { at: new Date(now - 16 * 3_600_000).toISOString() } }).data;
  const state = useMemo(() => presence(recent, now).get(me.id), [recent, now, me.id]);
  const today = useLive("rotaShifts", { where: { membershipId: me.id, date: hr.today, published: true } }).data[0];
  const [busy, setBusy] = useState<string | null>(null);
  const [where, setWhere] = useState<string | null>(null);
  const branchId = hr.session.branchId;
  const fence = branchId ? hr.rules.geofences[branchId] : undefined;

  const getFix = () =>
    new Promise<{ lat: number; lng: number; accuracyM: number | null } | null>((res) => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(
        (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }),
        () => res(null),
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      );
    });

  const go = async (kind: "in" | "out" | "break_start" | "break_end") => {
    setBusy(kind);
    setWhere(null);
    try {
      const fix = fence || hr.rules.mobileCheckIn ? await getFix() : null;
      await punch(db, { membershipId: me.id, kind, source: "mobile", branchId, fix });
      toast({ title: kind === "in" ? L("اتسجل حضورك — يوم موفق", "Clocked in — have a good shift") : kind === "out" ? L("اتسجل انصرافك — تسلم إيدك", "Clocked out — thank you") : L("تمام", "Done"), tone: "success" });
    } catch (e) {
      const code = e instanceof HrError ? e.code : "";
      const msg =
        code === "outside" ? L(`إنت برا المطعم (${e instanceof HrError ? e.message : ""} م) — قرّب واعمل تاني أو ابصم على الكاشير`, `You're outside the restaurant (${e instanceof HrError ? e.message : ""} m) — move closer or use the POS clock`)
        : code === "no_location" ? L("محتاجين موقعك — اسمح للمتصفح بالموقع", "We need your location — allow it in the browser")
        : code === "mobile_off" ? L("البصمة من الموبايل مقفولة — ابصم على جهاز المطعم", "Phone check-in is off — use the restaurant's device")
        : String((e as Error).message);
      setWhere(msg);
      toast({ title: msg, tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const since = state ? Math.floor((now - Date.parse(state.since)) / 60000) : 0;
  return (
    <Card className={cn("overflow-hidden p-0", state?.state === "in" && "border-ok/40")}>
      <div className={cn("grid gap-4 p-5 sm:grid-cols-[1fr_auto] sm:items-center", state ? "bg-ok-soft/40" : "bg-surface-2/50")}>
        <div>
          <p className="text-[13px] font-semibold text-muted">{f.day(hr.today, { weekday: "long", day: "numeric", month: "long" })}</p>
          <p className="num mt-1 font-display text-[40px] font-semibold leading-none">{new Date(now).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", timeZone: hr.tz })}</p>
          <p className="mt-2 text-[14px]">
            {today ? (
              <span className="num">{L("ورديتك النهارده", "Today's shift")} <b>{today.start}–{today.end}</b>{today.station ? ` · ${STATION[today.station]?.[lang] ?? today.station}` : ""}</span>
            ) : (
              <span className="text-muted">{L("مفيش وردية ليك النهارده", "No shift for you today")}</span>
            )}
          </p>
          {state ? (
            <Badge className="mt-2" tone={state.state === "in" ? "ok" : "warn"} dot pulse>
              {state.state === "in" ? L(`في الشغل من ${minutesText(since, lang)}`, `In for ${minutesText(since, lang)}`) : L(`في البريك من ${minutesText(since, lang)}`, `On break for ${minutesText(since, lang)}`)}
            </Badge>
          ) : null}
        </div>
        <div className="grid gap-2 sm:w-56">
          {!state ? (
            <Button size="xl" icon={busy === "in" ? <Spinner /> : <LogIn />} disabled={!!busy} onClick={() => go("in")}>{L("سجّل حضور", "Clock in")}</Button>
          ) : (
            <>
              <Button size="xl" variant="danger" icon={busy === "out" ? <Spinner /> : <LogOut />} disabled={!!busy} onClick={() => go("out")}>{L("سجّل انصراف", "Clock out")}</Button>
              <Button variant="secondary" icon={state.state === "break" ? <TimerReset /> : <Coffee />} disabled={!!busy} onClick={() => go(state.state === "break" ? "break_end" : "break_start")}>
                {state.state === "break" ? L("رجعت من البريك", "End break") : L("بريك", "Start break")}
              </Button>
            </>
          )}
        </div>
      </div>
      <p className="flex items-center gap-1.5 border-t border-line px-5 py-2.5 text-[12.5px] text-muted">
        <MapPin className="size-3.5" />
        {where ?? (fence ? L(`بنتأكد إنك جوه المطعم (${fence.radiusM} متر)`, `We check you're inside the restaurant (${fence.radiusM} m)`) : L("بنسجّل موقعك مع البصمة", "Your location is saved with the punch"))}
      </p>
      {state ? <p className="sr-only">{f.time(state.since, hr.tz)}</p> : null}
    </Card>
  );
}

function MyWeek() {
  const { L, lang } = useT();
  const hr = useHr();
  const f = useDateFmt();
  const me = hr.session.staff!;
  const ws = weekStart(hr.today, hr.rules.weekStartsOn);
  const days = dateRange(ws, addDays(ws, 13));
  const shifts = useLive("rotaShifts", { where: { membershipId: me.id, published: true }, gte: { date: ws }, lte: { date: addDays(ws, 13) } }).data;
  const open = useLive("rotaShifts", { where: { published: true }, gte: { date: hr.today }, lte: { date: addDays(ws, 13) } }).data.filter((s) => !s.membershipId);
  const swaps = useLive("shiftSwaps", { where: { fromId: me.id } }).data;
  const [swap, setSwap] = useState<RotaShift | null>(null);
  const hours = (s: RotaShift) => ((hm(s.end) - hm(s.start) + 1440) % 1440 || 1440) / 60 - s.breakMin / 60;
  return (
    <Section title={L("جدولي", "My schedule")} icon={<CalendarDays />} subtitle={L(`${Math.round(shifts.filter((s) => s.date < addDays(ws, 7)).reduce((a, s) => a + hours(s), 0))} ساعة الأسبوع ده`, `${Math.round(shifts.filter((s) => s.date < addDays(ws, 7)).reduce((a, s) => a + hours(s), 0))} hours this week`)}>
      <ul className="grid gap-1.5">
        {days.map((d, i) => {
          const s = shifts.filter((x) => x.date === d);
          const pending = s.find((x) => swaps.some((w) => w.shiftId === x.id && w.status === "pending"));
          return (
            <li key={d}>
              {i === 7 ? <p className="mb-1.5 mt-2 text-[12.5px] font-semibold text-muted">{L("الأسبوع الجاي", "Next week")}</p> : null}
              <div className={cn("flex items-center gap-3 rounded-2xl border px-3 py-2.5", d === hr.today ? "border-brass bg-brass-soft/40" : "border-line", !s.length && "opacity-60")}>
                <span className="w-24 shrink-0 text-[13.5px] font-semibold">{f.day(d)}</span>
                <span className="num min-w-0 flex-1 text-[14.5px]">
                  {s.length ? s.map((x) => <b key={x.id} className="me-2">{x.start}–{x.end}</b>) : L("راحة", "Off")}
                  {s[0]?.station ? <span className="text-[12.5px] text-muted"> · {STATION[s[0].station]?.[lang]}</span> : null}
                </span>
                {pending ? <Badge tone="warn" size="sm">{L("طلب تبديل", "Swap asked")}</Badge> : s.length && d >= hr.today ? (
                  <Button size="sm" variant="ghost" icon={<Repeat />} onClick={() => setSwap(s[0])}>{L("بدّل", "Swap")}</Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {open.length ? (
        <div className="mt-4 rounded-2xl bg-surface-2 p-3">
          <p className="mb-1 text-[13.5px] font-semibold">{L("ورديات مفتوحة محتاجة حد", "Open shifts that need someone")}</p>
          {open.map((s) => (
            <p key={s.id} className="num text-[13.5px] text-muted">{f.day(s.date)} · {s.start}–{s.end}{s.note ? ` · ${s.note}` : ""} — {L("كلّم المدير", "ask your manager")}</p>
          ))}
        </div>
      ) : null}
      {swap ? <SwapRequestDialog shift={swap} onClose={() => setSwap(null)} /> : null}
    </Section>
  );
}

function MyAttendance() {
  const { L } = useT();
  const hr = useHr();
  const me = hr.session.staff!;
  const { days, summary } = useMonthAttendance(me.id, hr.today.slice(0, 7));
  return (
    <Section title={L("حضوري الشهر ده", "My attendance this month")}>
      <AttendanceSummary s={summary} />
      <div className="mt-3">
        <DayList days={days} tz={hr.tz} compact />
      </div>
      <p className="mt-2 text-[12.5px] text-muted">{L("لو في غلط، كلّم المدير يعدّله — كل تعديل بيتسجل.", "If something's wrong, ask your manager to correct it — every correction is logged.")}</p>
    </Section>
  );
}

function MyLeave() {
  const { L } = useT();
  const hr = useHr();
  const me = hr.session.staff!;
  const reqs = useLive("leaveRequests", { where: { membershipId: me.id }, orderBy: [{ field: "from", dir: "desc" }] }).data;
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-4">
      <LeaveBalanceCards membershipId={me.id} />
      <Section title={L("طلباتي", "My requests")} icon={<Palmtree />} action={<Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>{L("اطلب إجازة", "Request leave")}</Button>}>
        <div className="divide-y divide-line">{reqs.length ? reqs.map((r) => <LeaveRequestRow key={r.id} r={r} />) : <EmptyState compact title={L("مفيش طلبات", "No requests")} />}</div>
      </Section>
      {open ? <LeaveRequestDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function MyAdvances() {
  const { L } = useT();
  const hr = useHr();
  const me = hr.session.staff!;
  const list = useLive("advances", { where: { membershipId: me.id }, orderBy: [{ field: "requestedAt", dir: "desc" }] }).data;
  const [open, setOpen] = useState(false);
  return (
    <Section title={L("سلفي", "My advances")} icon={<HandCoins />} action={<Button size="sm" icon={<Plus />} onClick={() => setOpen(true)}>{L("اطلب سلفة", "Request")}</Button>}>
      <div className="grid gap-3">{list.length ? list.map((a) => <AdvanceCard key={a.id} a={a} />) : <EmptyState compact icon={<HandCoins />} title={L("مفيش سلف", "No advances")} />}</div>
      {open ? <AdvanceRequestDialog onClose={() => setOpen(false)} /> : null}
    </Section>
  );
}

function MyPay() {
  const { L } = useT();
  const hr = useHr();
  const me = hr.session.staff!;
  const slips = useLive("payslips", { where: { membershipId: me.id, status: ["approved", "paid"] } }).data;
  return (
    <Section title={L("قسايم المرتب", "Payslips")} icon={<FileText />}>
      <PayslipList slips={slips} to={(s) => `/me/payslip/${s.id}`} />
    </Section>
  );
}
