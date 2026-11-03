import { useMemo, useState, type DragEvent } from "react";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Megaphone, Plus, Repeat, Save, Trash2, X } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { RotaShift, ShiftTemplate } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, type Units } from "@/lib/money";
import { Badge, Button, Dialog, EmptyState, IconButton, Input, Select, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { copyWeek, decideSwap, publishWeek, saveShift, moveShift } from "@/modules/hr/ops";
import { addDays, dateRange, hm, weekStart, weekday } from "@/modules/hr/lib/tz";
import { effectiveComp } from "@/modules/hr/lib/payroll";
import { STATION, SWAP_STATUS, hmRange } from "@/modules/hr/labels";
import { PersonPhoto, Section, useDateFmt } from "@/modules/hr/ui";

const shiftHours = (s: Pick<RotaShift, "start" | "end" | "breakMin">) => {
  let d = hm(s.end) - hm(s.start);
  if (d <= 0) d += 1440;
  return Math.max(0, d - (s.breakMin || 0)) / 60;
};
const WEEKDAY_FACTOR = [0.95, 0.85, 0.85, 0.9, 1.25, 1.35, 1.1]; // Sun … Sat (Thu/Fri nights are the busy ones)

export default function SchedulePage() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const { toast } = useToast();
  const branchId = hr.session.branchId ?? hr.session.branches[0]?.id ?? "";
  const [week, setWeek] = useState(() => weekStart(hr.today, hr.rules.weekStartsOn));
  const days = dateRange(week, addDays(week, 6));
  const shifts = useLive("rotaShifts", { where: { branchId }, gte: { date: week }, lte: { date: addDays(week, 6) } }).data;
  const templates = useLive("shiftTemplates", { orderBy: [{ field: "sort" }] }).data;
  const swaps = useLive("shiftSwaps", { where: { status: "pending" } }).data;
  const since = useMemo(() => new Date(Date.parse(`${addDays(week, -28)}T00:00:00Z`)).toISOString(), [week]);
  const checks = useLive("checks", { where: { status: "paid", branchId }, gte: { createdAt: since } }).data;
  const [station, setStation] = useState<string>("all");
  const [edit, setEdit] = useState<Partial<RotaShift> | null>(null);
  const [drag, setDrag] = useState<{ kind: "shift"; shift: RotaShift } | { kind: "tpl"; tpl: ShiftTemplate } | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const people = hr.active.filter((m) => m.role !== "owner" || shifts.some((s) => s.membershipId === m.id)).filter((m) => station === "all" || hr.profileOf(m.id)?.station === station);
  const unpublished = shifts.filter((s) => !s.published).length;

  // labour cost per hour (owner/accountant only) and the sales forecast per day
  const costPerHour = (mid: string | null): Units => {
    if (!mid || !hr.canPay) return 0;
    const c = effectiveComp(hr.compOf(mid), hr.rules);
    const fixed = c.monthlySalary + c.allowances.housing + c.allowances.transport + c.allowances.meal + c.allowances.other;
    const base = c.salaryType === "monthly" ? fixed / 208 : c.salaryType === "daily" ? c.dailyRate / hr.rules.workHoursPerDay : c.hourlyRate;
    return Math.round(base * (1 + (c.insured ? hr.rules.insuranceEG.employerBps / 10_000 : 0)));
  };
  const forecast = (d: string): Units => {
    const wd = weekday(d);
    const hist = checks.filter((c) => weekday(c.createdAt.slice(0, 10)) === wd);
    const distinctDays = new Set(hist.map((c) => c.createdAt.slice(0, 10))).size;
    if (distinctDays >= 2) return Math.round(hist.reduce((a, c) => a + c.total, 0) / distinctDays);
    return Math.round(hr.rules.expectedDailySales * WEEKDAY_FACTOR[wd]);
  };
  const perDay = days.map((d) => {
    const ds = shifts.filter((s) => s.date === d && (station === "all" || s.station === station || hr.profileOf(s.membershipId)?.station === station));
    const hours = ds.reduce((a, s) => a + shiftHours(s), 0);
    const cost = ds.reduce((a, s) => a + shiftHours(s) * costPerHour(s.membershipId), 0);
    return { d, hours, cost, sales: forecast(d), people: new Set(ds.map((s) => s.membershipId)).size };
  });
  const tot = perDay.reduce((a, x) => ({ hours: a.hours + x.hours, cost: a.cost + x.cost, sales: a.sales + x.sales }), { hours: 0, cost: 0, sales: 0 });
  const labourPct = tot.sales ? (tot.cost / tot.sales) * 100 : 0;

  const drop = async (e: DragEvent, membershipId: string | null, date: string) => {
    e.preventDefault();
    setOver(null);
    if (!drag) return;
    if (drag.kind === "shift") await moveShift(db, drag.shift, { membershipId, date }, e.altKey || e.ctrlKey || e.metaKey);
    else await saveShift(db, { branchId, membershipId, date, start: drag.tpl.start, end: drag.tpl.end, breakMin: drag.tpl.breakMin, station: drag.tpl.station ?? hr.profileOf(membershipId)?.station ?? null, templateId: drag.tpl.id });
    setDrag(null);
  };
  const cellKey = (mid: string | null, d: string) => `${mid ?? "open"}|${d}`;
  const tplColor = (s: RotaShift) => templates.find((t) => t.id === s.templateId)?.color ?? "var(--sf-primary)";

  const Cell = ({ mid, d }: { mid: string | null; d: string }) => {
    const list = shifts.filter((s) => s.membershipId === mid && s.date === d);
    const k = cellKey(mid, d);
    const off = mid ? (hr.profileOf(mid)?.weeklyOff ?? []).includes(weekday(d)) : false;
    return (
      <td
        className={cn("h-[68px] min-w-[112px] border-b border-s border-line p-1 align-top transition-colors", over === k && "bg-primary-soft", d === hr.today && "bg-brass-soft/30", off && !list.length && "bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--sf-surface-3)_6px,var(--sf-surface-3)_7px)]")}
        onDragOver={(e) => {
          if (!hr.canManage) return;
          e.preventDefault();
          setOver(k);
        }}
        onDragLeave={() => setOver((o) => (o === k ? null : o))}
        onDrop={(e) => drop(e, mid, d)}
      >
        <div className="grid gap-1">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              draggable={hr.canManage}
              onDragStart={() => setDrag({ kind: "shift", shift: s })}
              onClick={() => hr.canManage && setEdit(s)}
              className={cn("group w-full rounded-lg border-s-[3px] px-1.5 py-1 text-start text-[12px] leading-tight shadow-sf-sm", s.published ? "bg-surface" : "border border-dashed border-line-strong bg-surface-2")}
              style={{ borderInlineStartColor: tplColor(s) }}
              title={s.published ? undefined : L("مسودة — مش منشور", "Draft — not published")}
            >
              <span className="num block font-bold">{hmRange(s.start, s.end)}</span>
              <span className="block truncate text-muted">{s.station ? (STATION[s.station]?.[lang] ?? s.station) : ""}{s.note ? ` · ${s.note}` : ""}</span>
            </button>
          ))}
          {!list.length && hr.canManage ? (
            <button type="button" onClick={() => setEdit({ branchId, membershipId: mid, date: d, start: templates[0]?.start ?? "16:00", end: templates[0]?.end ?? "00:00", breakMin: 30, station: hr.profileOf(mid)?.station ?? null })} className="grid h-[58px] w-full place-items-center rounded-lg text-faint opacity-0 hover:bg-surface-2 hover:text-muted focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-60 [tr:hover_&]:opacity-100" aria-label={L("أضف وردية", "Add shift")}>
              {off ? <span className="text-[11px]">{L("راحة", "off")}</span> : <Plus className="size-4" />}
            </button>
          ) : null}
        </div>
      </td>
    );
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface p-1">
          <IconButton label={L("الأسبوع اللي فات", "Previous week")} onClick={() => setWeek(addDays(week, -7))}><ChevronRight className="ltr:rotate-180" /></IconButton>
          <button className="h-11 rounded-xl px-3 text-[14px] font-bold hover:bg-surface-2" onClick={() => setWeek(weekStart(hr.today, hr.rules.weekStartsOn))}>
            {f.day(week, { day: "numeric", month: "short" })} – {f.day(addDays(week, 6), { day: "numeric", month: "short" })}
          </button>
          <IconButton label={L("الأسبوع الجاي", "Next week")} onClick={() => setWeek(addDays(week, 7))}><ChevronLeft className="ltr:rotate-180" /></IconButton>
        </div>
        <Select aria-label={L("القسم", "Station")} value={station} onChange={(e) => setStation(e.target.value)} options={[{ value: "all", label: L("كل الأقسام", "All stations") }, ...Object.entries(STATION).map(([k, v]) => ({ value: k, label: v[lang] }))]} />
        <span className="flex-1" />
        {hr.canManage ? (
          <>
            <Button variant="secondary" icon={<Copy />} onClick={async () => { const n = await copyWeek(db, branchId, addDays(week, -7), week); toast({ title: L(`اتنسخ ${n} وردية من الأسبوع اللي فات`, `Copied ${n} shifts from last week`), tone: "success" }); }}>
              {L("انسخ الأسبوع اللي فات", "Copy last week")}
            </Button>
            <Button icon={<Megaphone />} disabled={!unpublished} onClick={async () => { const n = await publishWeek(db, branchId, week, addDays(week, 6)); toast({ title: L(`اتنشر ${n} وردية — الفريق يقدر يشوف جدوله`, `Published ${n} shifts — the team can see their schedule`), tone: "success" }); }}>
              {L("انشر الجدول", "Publish")} {unpublished ? <span className="num rounded-full bg-white/20 px-1.5 text-[12px]">{unpublished}</span> : null}
            </Button>
          </>
        ) : null}
      </div>

      {/* labour vs sales forecast */}
      <div className="grid gap-3 rounded-[20px] border border-line bg-surface p-4 shadow-sf-sm">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="font-bold">{L("تكلفة العمالة مقابل المبيعات المتوقعة", "Labour cost vs forecast sales")}</p>
          <p className="num text-[14px] text-muted">{L("ساعات", "Hours")} <b className="text-ink">{Math.round(tot.hours)}</b></p>
          {hr.canPay ? (
            <>
              <p className="num text-[14px] text-muted">{L("التكلفة", "Cost")} <b className="text-ink">{formatMoney(tot.cost, { lang, whole: true, currency: hr.currency })}</b></p>
              <p className="num text-[14px] text-muted">{L("المبيعات المتوقعة", "Forecast sales")} <b className="text-ink">{formatMoney(tot.sales, { lang, whole: true, currency: hr.currency })}</b></p>
              <Badge tone={labourPct <= hr.rules.labourTargetBps / 100 ? "ok" : "warn"}>{L(`العمالة ${labourPct.toFixed(1)}٪ (الهدف ${hr.rules.labourTargetBps / 100}٪)`, `labour ${labourPct.toFixed(1)}% (target ${hr.rules.labourTargetBps / 100}%)`)}</Badge>
            </>
          ) : (
            <p className="text-[13px] text-muted">{L("التكلفة بالفلوس ظاهرة للمالك والمحاسب", "Cost in money is shown to owner & accountant")}</p>
          )}
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {perDay.map((x) => {
            const pct = x.sales ? (x.cost / x.sales) * 100 : 0;
            const max = Math.max(...perDay.map((y) => y.sales)) || 1;
            return (
              <div key={x.d} className="min-w-0 text-center">
                <div className="relative mx-auto flex h-16 w-full max-w-12 items-end justify-center gap-0.5" aria-hidden>
                  <span className="w-1/2 rounded-t bg-primary/25" style={{ height: `${(x.sales / max) * 100}%` }} />
                  {hr.canPay ? <span className={cn("w-1/2 rounded-t", pct > hr.rules.labourTargetBps / 100 ? "bg-warn" : "bg-primary")} style={{ height: `${Math.min(100, (x.cost / max) * 100 * 3)}%` }} /> : <span className="w-1/2 rounded-t bg-primary" style={{ height: `${Math.min(100, x.hours * 1.5)}%` }} />}
                </div>
                <p className="mt-1 truncate text-[11.5px] font-semibold">{f.day(x.d, { weekday: "short" })}</p>
                <p className="num truncate text-[11px] text-muted">{hr.canPay ? `${pct.toFixed(0)}%` : `${Math.round(x.hours)}h`}</p>
              </div>
            );
          })}
        </div>
      </div>

      {hr.canManage && templates.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-muted">{L("اسحب قالب على الجدول:", "Drag a template onto the grid:")}</span>
          {templates.map((t) => (
            <span key={t.id} draggable onDragStart={() => setDrag({ kind: "tpl", tpl: t })} className="num inline-flex h-9 cursor-grab items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[13px] font-semibold shadow-sf-sm active:cursor-grabbing">
              <span className="size-2.5 rounded-full" style={{ background: t.color }} />
              {t.name[lang]} {hmRange(t.start, t.end)}
            </span>
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-[20px] border border-line bg-surface shadow-sf-sm thin-scrollbar">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky start-0 z-[2] min-w-[150px] border-b border-line bg-surface-2 px-3 py-2 text-start text-[12px] font-semibold text-muted">{L("الموظف", "Staff")}</th>
              {days.map((d) => (
                <th key={d} className={cn("border-b border-s border-line bg-surface-2 px-2 py-2 text-[12px] font-semibold", d === hr.today ? "text-brass" : "text-muted")}>
                  {f.day(d, { weekday: "short", day: "numeric" })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="sticky start-0 z-[1] border-b border-line bg-surface px-3 text-start">
                <span className="text-[13px] font-semibold text-brass">{L("ورديات مفتوحة", "Open shifts")}</span>
              </th>
              {days.map((d) => <Cell key={d} mid={null} d={d} />)}
            </tr>
            {people.map((m) => {
              const hrs = shifts.filter((s) => s.membershipId === m.id).reduce((a, s) => a + shiftHours(s), 0);
              return (
                <tr key={m.id} className="group">
                  <th className="sticky start-0 z-[1] border-b border-line bg-surface px-3 py-1.5 text-start font-normal">
                    <div className="flex items-center gap-2">
                      <PersonPhoto m={m} p={hr.profileOf(m.id)} size="sm" />
                      <div className="min-w-0">
                        <p className="max-w-[110px] truncate text-[13px] font-semibold">{m.name}</p>
                        <p className="num text-[11.5px] text-muted">{L(`${Math.round(hrs)} ساعة`, `${Math.round(hrs)} h`)}</p>
                      </div>
                    </div>
                  </th>
                  {days.map((d) => <Cell key={d} mid={m.id} d={d} />)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[12.5px] text-muted">{L("اسحب الوردية لشخص أو يوم تاني لنقلها — مع Alt/Ctrl بتتنسخ. المتقطّع = مسودة لسه مانتشرتش.", "Drag a shift to move it — hold Alt/Ctrl to copy. Dashed = draft, not published yet.")}</p>

      <Section title={L("طلبات تبديل الورديات", "Shift swap requests")} icon={<Repeat />}>
        {swaps.length ? (
          <ul className="divide-y divide-line">
            {swaps.map((sw) => {
              const sh = shifts.find((s) => s.id === sw.shiftId);
              const from = hr.memberOf(sw.fromId);
              const to = hr.memberOf(sw.toId);
              return (
                <li key={sw.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{from?.name} → {to?.name ?? L("أي حد", "anyone")}</p>
                    <p className="num text-[13px] text-muted">{sh ? `${f.day(sh.date)} ${hmRange(sh.start, sh.end)}` : ""} · {sw.reason}</p>
                  </div>
                  <Badge tone={SWAP_STATUS[sw.status].tone}>{SWAP_STATUS[sw.status].label[lang]}</Badge>
                  {hr.canManage ? (
                    <>
                      <Button size="sm" variant="soft" icon={<Check />} disabled={!sw.toId} onClick={() => decideSwap(db, sw.id, true)}>{L("وافق", "Approve")}</Button>
                      <Button size="sm" variant="ghost" icon={<X />} onClick={() => decideSwap(db, sw.id, false)}>{L("ارفض", "Reject")}</Button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={<CalendarDays />} title={L("مفيش طلبات تبديل", "No swap requests")} />
        )}
      </Section>
      {edit ? <ShiftDialog shift={edit} templates={templates} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function ShiftDialog({ shift, templates, onClose }: { shift: Partial<RotaShift>; templates: ShiftTemplate[]; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const [s, setS] = useState(shift);
  const set = <K extends keyof RotaShift>(k: K, v: RotaShift[K]) => setS((x) => ({ ...x, [k]: v }));
  const save = async () => {
    await saveShift(db, s);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={s.id ? L("تعديل وردية", "Edit shift") : L("وردية جديدة", "New shift")}
      footer={
        <>
          {s.id ? <Button variant="danger-soft" icon={<Trash2 />} onClick={async () => { await db.remove("rotaShifts", s.id!); await db.audit("rota.delete", "rotaShifts", s.id!, { date: s.date }); onClose(); }}>{L("امسح", "Delete")}</Button> : null}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
          <Button icon={<Save />} onClick={save}>{L("احفظ", "Save")}</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <button key={t.id} type="button" onClick={() => setS({ ...s, start: t.start, end: t.end, breakMin: t.breakMin, templateId: t.id, station: s.station ?? t.station })} className={cn("num inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold", s.templateId === t.id ? "border-primary bg-primary-soft text-primary" : "border-line")}>
              <span className="size-2 rounded-full" style={{ background: t.color }} />
              {t.name[lang]} {hmRange(t.start, t.end)}
            </button>
          ))}
        </div>
        <Select label={L("الموظف", "Staff")} value={s.membershipId ?? ""} onChange={(e) => set("membershipId", e.target.value || null)} options={[{ value: "", label: L("وردية مفتوحة", "Open shift") }, ...hr.active.map((m) => ({ value: m.id, label: m.name }))]} />
        <Input label={L("اليوم", "Day")} type="date" value={s.date ?? ""} onChange={(e) => set("date", e.target.value)} />
        <Input label={L("من", "From")} type="time" value={s.start ?? ""} onChange={(e) => set("start", e.target.value)} />
        <Input label={L("لحد", "To")} type="time" value={s.end ?? ""} onChange={(e) => set("end", e.target.value)} hint={s.start && s.end && hm(s.end) <= hm(s.start) ? L("بتعدّي نص الليل", "crosses midnight") : undefined} />
        <Input label={L("بريك (دقيقة)", "Break (min)")} type="number" min={0} value={s.breakMin ?? 0} onChange={(e) => set("breakMin", Number(e.target.value) || 0)} />
        <Select label={L("القسم", "Station")} value={s.station ?? ""} onChange={(e) => set("station", e.target.value || null)} options={[{ value: "", label: "—" }, ...Object.entries(STATION).map(([k, v]) => ({ value: k, label: v[lang] }))]} />
        <div className="sm:col-span-2">
          <Input label={L("ملاحظة", "Note")} value={s.note ?? ""} onChange={(e) => set("note", e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}
