import { useMemo, useState } from "react";
import { CalendarRange, Check, ChevronLeft, ChevronRight, Inbox, Plus, Scale, X } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { LeaveRequest } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, EmptyState, IconButton, Table, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { decideLeave, takenByType } from "@/modules/hr/ops";
import { accruedAnnual, annualEntitlement, balances, fitsBalance } from "@/modules/hr/lib/leave";
import { addMonths, dateRange, periodBounds, weekday } from "@/modules/hr/lib/tz";
import { LEAVE_COLOR, LEAVE_TYPE, WEEKDAYS } from "@/modules/hr/labels";
import { PersonCell, PersonPhoto, Section, useDateFmt } from "@/modules/hr/ui";
import { LeaveRequestRow } from "@/modules/hr/components";
import { LeaveRequestDialog } from "@/modules/hr/forms";

export default function LeavePage() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const { toast } = useToast();
  const reqs = useLive("leaveRequests", { orderBy: [{ field: "from", dir: "desc" }] }).data;
  const bals = useLive("leaveBalances").data;
  const [month, setMonth] = useState(hr.today.slice(0, 7));
  const [adding, setAdding] = useState(false);
  const year = Number(hr.today.slice(0, 4));

  const balOf = useMemo(() => {
    return (mid: string) => {
      const p = hr.profileOf(mid);
      const row = bals.find((b) => b.membershipId === mid && b.year === year && b.type === "annual");
      const ent = row?.entitlement ?? annualEntitlement({ hireDate: p?.hireDate ?? hr.today, birthDate: p?.birthDate ?? null }, hr.today, hr.rules.leave);
      return { ent, ...balances({ entitlement: ent, accrued: accruedAnnual(ent, { hireDate: p?.hireDate ?? hr.today }, hr.today), carried: row?.carried ?? 0, adjustment: row?.adjustment ?? 0, taken: takenByType(reqs, mid, year), pending: takenByType(reqs, mid, year, ["pending"]) }, hr.rules.leave) };
    };
  }, [bals, reqs, hr, year]);

  const pending = reqs.filter((r) => r.status === "pending");
  const decide = async (r: LeaveRequest, ok: boolean) => {
    await decideLeave(db, r, ok);
    toast({ title: ok ? L("اتوافق على الإجازة", "Leave approved") : L("الطلب اترفض", "Request rejected"), tone: ok ? "success" : "default" });
  };
  const { from, to } = periodBounds(month);
  const days = dateRange(from, to);
  const lead = (weekday(from) - hr.rules.weekStartsOn + 7) % 7;
  const onDay = (d: string) => reqs.filter((r) => r.status === "approved" && r.from <= d && r.to >= d);

  return (
    <div className="grid gap-5">
      <Section title={L("طلبات مستنية ردك", "Waiting for your decision")} icon={<Inbox />} action={hr.canManage ? <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>{L("سجّل إجازة", "Record leave")}</Button> : null}>
        {pending.length ? (
          <ul className="divide-y divide-line">
            {pending.map((r) => {
              const m = hr.memberOf(r.membershipId);
              const b = balOf(r.membershipId);
              const fits = fitsBalance(r.type, r.days, b);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  {m ? <PersonPhoto m={m} p={hr.profileOf(m.id)} /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{m?.name} · {LEAVE_TYPE[r.type][lang]} · {L(`${r.days} يوم`, `${r.days} days`)}</p>
                    <p className="text-[13px] text-muted">
                      {f.day(r.from)}{r.to !== r.from ? ` → ${f.day(r.to)}` : ""} · {r.reason}
                    </p>
                    <p className={cn("text-[12.5px]", fits ? "text-muted" : "font-semibold text-danger")}>
                      {r.type === "annual" || r.type === "casual" ? L(`الرصيد المتاح ${r.type === "casual" ? b.casual.available : b.annual.available} يوم`, `available ${r.type === "casual" ? b.casual.available : b.annual.available} days`) : ""}
                      {!fits ? L(" — أكتر من الرصيد", " — exceeds the balance") : ""}
                    </p>
                  </div>
                  {hr.canManage ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="soft" icon={<Check />} onClick={() => decide(r, true)}>{L("وافق", "Approve")}</Button>
                      <Button size="sm" variant="ghost" icon={<X />} onClick={() => decide(r, false)}>{L("ارفض", "Reject")}</Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={<Inbox />} title={L("مفيش طلبات جديدة", "No pending requests")} />
        )}
      </Section>

      <Section
        title={L("تقويم الإجازات", "Leave calendar")}
        icon={<CalendarRange />}
        action={
          <div className="flex items-center gap-1">
            <IconButton size="sm" label={L("الشهر اللي فات", "Previous month")} onClick={() => setMonth(addMonths(month, -1))}><ChevronRight className="ltr:rotate-180" /></IconButton>
            <span className="min-w-28 text-center text-[14px] font-semibold">{f.month(month)}</span>
            <IconButton size="sm" label={L("الشهر الجاي", "Next month")} onClick={() => setMonth(addMonths(month, 1))}><ChevronLeft className="ltr:rotate-180" /></IconButton>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-center text-[11.5px] font-semibold text-muted">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>{WEEKDAYS[(hr.rules.weekStartsOn + i) % 7][lang]}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: lead }, (_, i) => <span key={`x${i}`} />)}
          {days.map((d) => {
            const on = onDay(d);
            return (
              <div key={d} className={cn("min-h-[62px] rounded-xl border border-line p-1 text-start", d === hr.today && "border-brass bg-brass-soft/30")}>
                <p className="num text-[11.5px] font-semibold text-muted">{Number(d.slice(8))}</p>
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {on.slice(0, 4).map((r) => {
                    const m = hr.memberOf(r.membershipId);
                    return (
                      <span key={r.id} title={`${m?.name} · ${LEAVE_TYPE[r.type][lang]}`} className="max-w-full truncate rounded px-1 text-[10.5px] font-semibold text-white" style={{ background: LEAVE_COLOR[r.type] }}>
                        {m?.name.split(" ")[0]}
                      </span>
                    );
                  })}
                  {on.length > 4 ? <span className="text-[10.5px] text-muted">+{on.length - 4}</span> : null}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-[12.5px] text-muted">
          {(["annual", "casual", "sick", "unpaid"] as const).map((t) => (
            <span key={t} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: LEAVE_COLOR[t] }} />{LEAVE_TYPE[t][lang]}</span>
          ))}
        </div>
      </Section>

      <Section title={L(`الأرصدة ${year}`, `Balances ${year}`)} icon={<Scale />} subtitle={L("اعتيادي ٢١ يوم (١٥ أول سنة، ٣٠ بعد ١٠ سنين أو سن ٥٠) · عارضة ٦ من الاعتيادي", "Annual 21 days (15 in year one, 30 after 10 years or age 50) · casual 6 from annual")} bodyClass="px-0 pb-2">
        <Table
          rows={hr.active.filter((m) => m.role !== "owner")}
          rowKey={(m) => m.id}
          columns={[
            { key: "who", header: L("الموظف", "Staff"), cell: (m) => <PersonCell m={m} p={hr.profileOf(m.id)} size="sm" /> },
            { key: "ent", header: L("الاستحقاق", "Entitled"), cell: (m) => <span className="num">{balOf(m.id).ent}</span>, align: "center", hideOnMobile: true },
            { key: "acc", header: L("المتراكم", "Accrued"), cell: (m) => <span className="num">{balOf(m.id).annual.accrued}</span>, align: "center", hideOnMobile: true },
            { key: "taken", header: L("خد", "Taken"), cell: (m) => <span className="num">{balOf(m.id).annual.taken}</span>, align: "center" },
            { key: "avail", header: L("المتاح", "Available"), cell: (m) => <Badge tone={balOf(m.id).annual.available > 0 ? "ok" : "warn"}>{balOf(m.id).annual.available}</Badge>, align: "center" },
            { key: "casual", header: L("عارضة", "Casual"), cell: (m) => <span className="num">{balOf(m.id).casual.available}/{hr.rules.leave.casual}</span>, align: "center", hideOnMobile: true },
            { key: "sick", header: L("مرضي", "Sick"), cell: (m) => <span className="num">{balOf(m.id).sick.taken}</span>, align: "center", hideOnMobile: true },
          ]}
        />
      </Section>

      <Section title={L("كل الطلبات", "All requests")}>
        <div className="divide-y divide-line">
          {reqs.filter((r) => r.status !== "pending").slice(0, 30).map((r) => (
            <LeaveRequestRow key={r.id} r={r} right={<span className="text-[13px] text-muted">{hr.memberOf(r.membershipId)?.name}</span>} />
          ))}
        </div>
      </Section>
      {adding ? <LeaveRequestDialog onClose={() => setAdding(false)} managerMode /> : null}
    </div>
  );
}
