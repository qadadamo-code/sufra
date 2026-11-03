/** Pieces shared by the manager screens (/staff) and self-service (/me). */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, FileText, HandCoins } from "lucide-react";
import type { Advance, LeaveRequest, Payslip } from "@/data/types";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { Badge, EmptyState, Meter } from "@/ui";
import { useHr } from "./useHr";
import { evaluateRange } from "./ops";
import { summarize, type DayEval } from "./lib/attendance";
import { accruedAnnual, annualEntitlement, balances } from "./lib/leave";
import { installmentSchedule } from "./lib/advances";
import { periodBounds } from "./lib/tz";
import { ADVANCE_STATUS, LEAVE_STATUS, LEAVE_TYPE, RUN_STATUS, minutesText } from "./labels";
import { DayBadge, Kpi, useDateFmt } from "./ui";

/** A person's attendance for a month: evaluated days + summary. */
export function useMonthAttendance(membershipId: string, period: string) {
  const hr = useHr();
  const { from, to } = periodBounds(period);
  const shifts = useLive("rotaShifts", { where: { membershipId }, gte: { date: from }, lte: { date: to } }).data;
  const punches = useLive("attendancePunches", { where: { membershipId }, gte: { at: `${from}T00:00:00` }, lte: { at: `${to}T23:59:59` } }).data;
  const nextDay = useLive("attendancePunches", { where: { membershipId }, gte: { at: `${to}T23:59:59` }, limit: 4, orderBy: [{ field: "at" }] }).data;
  const leaves = useLive("leaveRequests", { where: { membershipId, status: "approved" } }).data;
  const days = useMemo(() => evaluateRange(membershipId, from, to, { shifts, punches: [...punches, ...nextDay], leaves }, hr.rules, hr.tz, hr.now), [membershipId, from, to, shifts, punches, nextDay, leaves, hr.rules, hr.tz, hr.now]);
  return { days, summary: summarize(days), punches, shifts };
}

export function AttendanceSummary({ s }: { s: ReturnType<typeof summarize> }) {
  const { L, lang } = useT();
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Kpi label={L("نسبة الالتزام", "Attendance score")} value={`${s.score}%`} tone={s.score >= 90 ? "ok" : s.score >= 75 ? "warn" : "danger"} sub={L(`${s.workedDays} يوم شغل`, `${s.workedDays} days worked`)} />
      <Kpi label={L("تأخير", "Late")} value={s.lateCount} tone={s.lateCount ? "warn" : undefined} sub={minutesText(s.lateMin, lang)} />
      <Kpi label={L("غياب", "Absent")} value={s.absentDays} tone={s.absentDays ? "danger" : undefined} sub={L(`${s.leaveDays} يوم إجازة`, `${s.leaveDays} leave days`)} />
      <Kpi label={L("وقت إضافي", "Overtime")} value={minutesText(s.overtimeMin + s.restDayMin, lang)} tone={s.overtimeMin ? "primary" : undefined} sub={s.missingOut ? L(`${s.missingOut} مرة من غير انصراف`, `${s.missingOut} missing clock-outs`) : undefined} />
    </div>
  );
}

export function DayList({ days, tz, onPick, compact }: { days: DayEval[]; tz: string; onPick?: (d: DayEval) => void; compact?: boolean }) {
  const { L, lang } = useT();
  const f = useDateFmt();
  const shown = [...days].reverse().filter((d) => d.status !== "off" || d.workedMin > 0);
  if (!shown.length) return <EmptyState compact icon={<CalendarClock />} title={L("مفيش أيام لسه", "No days yet")} />;
  return (
    <ul className="divide-y divide-line">
      {shown.map((d) => (
        <li key={d.date}>
          <button type="button" disabled={!onPick} onClick={() => onPick?.(d)} className={cn("flex w-full items-center gap-3 py-2.5 text-start", onPick && "hover:bg-surface-2/70 rounded-xl px-2 -mx-2")}>
            <span className="w-24 shrink-0 text-[13.5px] font-semibold">{f.day(d.date)}</span>
            <span className="tabular-nums min-w-0 flex-1 truncate text-[13.5px] text-muted">
              {d.firstIn ? f.time(d.firstIn, tz) : "—"} → {d.lastOut ? f.time(d.lastOut, tz) : "—"}
              {!compact && d.workedMin ? ` · ${minutesText(d.workedMin, lang)}` : ""}
              {d.lateMin ? <span className="text-warn"> · {L("تأخير", "late")} {minutesText(d.lateMin, lang)}</span> : null}
              {d.overtimeMin || d.restDayMin ? <span className="text-primary"> · +{minutesText(d.overtimeMin + d.restDayMin, lang)}</span> : null}
            </span>
            <DayBadge status={d.status} notYet={d.status === "absent" && d.deductionDays === 0} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Leave balance for one person this year (annual / casual / sick). */
export function useLeaveBalance(membershipId: string) {
  const hr = useHr();
  const year = Number(hr.today.slice(0, 4));
  const reqs = useLive("leaveRequests", { where: { membershipId } }).data;
  const bal = useLive("leaveBalances", { where: { membershipId, year } }).data;
  const p = hr.profileOf(membershipId);
  return useMemo(() => {
    const annualRow = bal.find((b) => b.type === "annual");
    const ent = annualRow?.entitlement ?? annualEntitlement({ hireDate: p?.hireDate ?? hr.today, birthDate: p?.birthDate ?? null }, hr.today, hr.rules.leave);
    const accrued = accruedAnnual(ent, { hireDate: p?.hireDate ?? hr.today }, hr.today);
    const yr = reqs.filter((r) => r.from.startsWith(String(year)));
    const by = (st: LeaveRequest["status"]) => yr.filter((r) => r.status === st).reduce<Partial<Record<LeaveRequest["type"], number>>>((a, r) => ({ ...a, [r.type]: (a[r.type] ?? 0) + r.days }), {});
    return { ...balances({ entitlement: ent, accrued, carried: annualRow?.carried ?? 0, adjustment: annualRow?.adjustment ?? 0, taken: by("approved"), pending: by("pending") }, hr.rules.leave), requests: reqs, entitlement: ent };
  }, [bal, reqs, p, hr.today, hr.rules.leave, year]);
}

export function LeaveBalanceCards({ membershipId }: { membershipId: string }) {
  const { L, lang } = useT();
  const b = useLeaveBalance(membershipId);
  const items = [
    { k: "annual", label: LEAVE_TYPE.annual[lang], v: b.annual, sub: L(`من ${b.entitlement} يوم السنة دي`, `of ${b.entitlement} days this year`) },
    { k: "casual", label: LEAVE_TYPE.casual[lang], v: b.casual, sub: L("من رصيد الاعتيادي", "from the annual balance") },
    { k: "sick", label: LEAVE_TYPE.sick[lang], v: b.sick, sub: L("مدفوعة", "paid") },
  ];
  return (
    <div className="grid gap-2.5 sm:grid-cols-3">
      {items.map((x) => (
        <div key={x.k} className="rounded-2xl border border-line p-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-semibold">{x.label}</p>
            <p className="num font-display text-[24px] font-semibold">{x.v.available}</p>
          </div>
          <Meter className="mt-2" label={x.label} value={x.v.taken} max={Math.max(1, x.v.taken + Math.max(0, x.v.available))} tone={x.k === "sick" ? "danger" : "primary"} />
          <p className="mt-1.5 text-[12.5px] text-muted">
            {L(`خد ${x.v.taken}`, `${x.v.taken} taken`)}
            {x.v.pending ? L(` · ${x.v.pending} مستني`, ` · ${x.v.pending} pending`) : ""} · {x.sub}
          </p>
        </div>
      ))}
    </div>
  );
}

export function LeaveRequestRow({ r, right }: { r: LeaveRequest; right?: React.ReactNode }) {
  const { L, lang } = useT();
  const f = useDateFmt();
  const st = LEAVE_STATUS[r.status];
  return (
    <div className="flex flex-wrap items-center gap-3 py-2.5">
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--sf-${r.type === "sick" ? "danger" : r.type === "casual" ? "brass" : "primary"})` }} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {LEAVE_TYPE[r.type][lang]} · {L(`${r.days} يوم`, `${r.days} d`)}
        </p>
        <p className="truncate text-[13px] text-muted">
          {f.day(r.from)}
          {r.to !== r.from ? ` → ${f.day(r.to)}` : ""}
          {r.reason ? ` · ${r.reason}` : ""}
        </p>
      </div>
      <Badge tone={st.tone}>{st.label[lang]}</Badge>
      {right}
    </div>
  );
}

export function AdvanceCard({ a, right }: { a: Advance; right?: React.ReactNode }) {
  const { L, lang } = useT();
  const f = useDateFmt();
  const hr = useHr();
  const st = ADVANCE_STATUS[a.status];
  const sched = installmentSchedule(a.amount, a.installments, a.startPeriod);
  const pctDone = a.amount ? a.recovered / a.amount : 0;
  return (
    <div className="rounded-2xl border border-line p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <HandCoins className="size-4 text-brass" />
        <p className="num font-display text-[20px] font-semibold">{formatMoney(a.amount, { lang, currency: hr.currency, compact: true })}</p>
        <Badge tone={st.tone}>{st.label[lang]}</Badge>
        <span className="flex-1" />
        {right}
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {a.reason || L("سلفة", "Advance")} · {L(`${a.installments} قسط من ${f.month(a.startPeriod)}`, `${a.installments} instalments from ${f.month(a.startPeriod)}`)}
      </p>
      {a.status === "paid" || a.status === "settled" ? (
        <>
          <Meter className="mt-2.5" label={L("المسدَّد", "Recovered")} value={pctDone} tone="ok" />
          <p className="tabular-nums mt-1 text-[12.5px] text-muted">
            {L("اتخصم", "Recovered")} {formatMoney(a.recovered, { lang, currency: hr.currency, compact: true })} · {L("باقي", "left")} {formatMoney(a.amount - a.recovered, { lang, currency: hr.currency, compact: true })}
          </p>
        </>
      ) : (
        <p className="tabular-nums mt-1.5 text-[12.5px] text-muted">{sched.map((s) => `${f.month(s.period)}: ${formatMoney(s.amount, { lang, compact: true, bare: true })}`).join(" · ")}</p>
      )}
    </div>
  );
}

export function PayslipList({ slips, to }: { slips: Payslip[]; to: (s: Payslip) => string }) {
  const { L, lang } = useT();
  const f = useDateFmt();
  const hr = useHr();
  if (!slips.length) return <EmptyState compact icon={<FileText />} title={L("لسه مفيش قسايم مرتب", "No payslips yet")} />;
  return (
    <ul className="divide-y divide-line">
      {[...slips].sort((a, b) => (a.period < b.period ? 1 : -1)).map((s) => (
        <li key={s.id}>
          <Link to={to(s)} className="flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-surface-2/70 -mx-2">
            <FileText className="size-5 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{f.month(s.period)}</span>
              <span className="block text-[12.5px] text-muted">{RUN_STATUS[s.status].label[lang]}</span>
            </span>
            <span className="num font-display text-[18px] font-semibold">{formatMoney(s.net, { lang, currency: hr.currency })}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
