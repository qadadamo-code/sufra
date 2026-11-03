/** Request forms used by /me (for yourself) and /staff (managers recording on someone's behalf). */
import { useState } from "react";
import { HandCoins, Palmtree, Repeat, Send } from "lucide-react";
import { useDb } from "@/data/hooks";
import type { LeaveType, RotaShift } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney, type Units } from "@/lib/money";
import { Button, Dialog, Input, Select, Textarea, useToast } from "@/ui";
import { useHr } from "./useHr";
import { decideLeave, HrError, requestAdvance, requestLeave, requestSwap } from "./ops";
import { fitsBalance, leaveDays } from "./lib/leave";
import { addMonths, addDays } from "./lib/tz";
import { installmentSchedule } from "./lib/advances";
import { effectiveComp } from "./lib/payroll";
import { LEAVE_TYPE, hmRange } from "./labels";
import { MoneyInput, NumberInput, useDateFmt } from "./ui";
import { useLeaveBalance } from "./components";

export function LeaveRequestDialog({ onClose, managerMode }: { onClose: () => void; managerMode?: boolean }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const { toast } = useToast();
  const me = hr.session.staff?.id ?? "";
  const [who, setWho] = useState(managerMode ? "" : me);
  const [type, setType] = useState<LeaveType>("annual");
  const [from, setFrom] = useState(addDays(hr.today, 1));
  const [to, setTo] = useState(addDays(hr.today, 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const bal = useLeaveBalance(who || me);
  const days = to >= from ? leaveDays(from, to, hr.profileOf(who)?.weeklyOff ?? []) : 0;
  const fits = fitsBalance(type, days, bal);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await requestLeave(db, { membershipId: who, type, from, to, reason });
      if (managerMode) await decideLeave(db, r, true, L("سجّلها المدير", "Recorded by manager"));
      toast({ title: managerMode ? L("الإجازة اتسجلت", "Leave recorded") : L("الطلب اتبعت للمدير", "Request sent to your manager"), tone: "success" });
      onClose();
    } catch (e) {
      toast({ title: e instanceof HrError ? L("راجع التواريخ", "Check the dates") : String(e), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={managerMode ? L("سجّل إجازة", "Record leave") : L("اطلب إجازة", "Request leave")}
      footer={<Button block icon={<Send />} loading={busy} disabled={!who || days <= 0} onClick={submit}>{managerMode ? L("سجّل", "Record") : L("ابعت الطلب", "Send request")}</Button>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {managerMode ? <Select label={L("الموظف", "Staff")} value={who} onChange={(e) => setWho(e.target.value)} options={[{ value: "", label: "—" }, ...hr.active.map((m) => ({ value: m.id, label: m.name }))]} /> : null}
        <Select label={L("نوع الإجازة", "Type")} value={type} onChange={(e) => setType(e.target.value as LeaveType)} options={(Object.keys(LEAVE_TYPE) as LeaveType[]).map((k) => ({ value: k, label: LEAVE_TYPE[k][lang] }))} />
        <Input label={L("من", "From")} type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
        <Input label={L("لحد", "To")} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        <div className="sm:col-span-2 flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2.5 text-[14px]">
          <Palmtree className="size-4 text-primary" />
          <span className="flex-1">{L(`${days} يوم شغل`, `${days} working days`)}</span>
          {type === "annual" || type === "casual" ? <span className={fits ? "text-muted" : "font-semibold text-danger"}>{L(`المتاح ${type === "casual" ? bal.casual.available : bal.annual.available}`, `available ${type === "casual" ? bal.casual.available : bal.annual.available}`)}</span> : null}
        </div>
        <div className="sm:col-span-2">
          <Textarea label={L("السبب", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={type === "sick" ? L("الشهادة المرضية مع المدير", "Medical certificate with the manager") : ""} />
        </div>
      </div>
    </Dialog>
  );
}

export function AdvanceRequestDialog({ onClose, managerMode }: { onClose: () => void; managerMode?: boolean }) {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const { toast } = useToast();
  const me = hr.session.staff?.id ?? "";
  const [who, setWho] = useState(managerMode ? "" : me);
  const [amount, setAmount] = useState<Units>(0);
  const [n, setN] = useState(hr.rules.advances.defaultInstallments);
  const [start, setStart] = useState(addMonths(hr.today.slice(0, 7), hr.today.slice(8) > String(hr.rules.payDay).padStart(2, "0") ? 1 : 0));
  const [reason, setReason] = useState("");
  const comp = hr.compOf(who);
  const cap = comp ? Math.round((effectiveComp(comp, hr.rules).monthlySalary * hr.rules.advances.maxBps) / 10_000) : 0;
  const sched = amount > 0 ? installmentSchedule(amount, n, start) : [];
  return (
    <Dialog
      open
      onClose={onClose}
      title={managerMode ? L("سلفة لموظف", "Advance for staff") : L("اطلب سلفة", "Request an advance")}
      footer={
        <Button
          block
          icon={<Send />}
          disabled={!who || amount <= 0}
          onClick={async () => {
            await requestAdvance(db, { membershipId: who, amount, installments: n, startPeriod: start, reason });
            toast({ title: L("الطلب اتبعت — المدير هيوافق والمحاسب يصرف", "Sent — a manager approves, accounts pays out"), tone: "success" });
            onClose();
          }}
        >
          {L("ابعت الطلب", "Send request")}
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {managerMode ? <Select label={L("الموظف", "Staff")} value={who} onChange={(e) => setWho(e.target.value)} options={[{ value: "", label: "—" }, ...hr.active.map((m) => ({ value: m.id, label: m.name }))]} /> : null}
        <MoneyInput label={L("المبلغ", "Amount")} value={amount} onChange={setAmount} hint={cap ? L(`الحد المعتاد ${formatMoney(cap, { lang, compact: true })} (نص المرتب)`, `usual limit ${formatMoney(cap, { lang, compact: true })} (half a salary)`) : undefined} />
        <NumberInput label={L("عدد الأقساط", "Instalments")} value={n} min={1} onChange={(v) => setN(Math.max(1, Math.min(12, Math.round(v))))} suffix={L("شهر", "months")} />
        <Input label={L("أول قسط مع مرتب", "First instalment with")} type="month" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        <div className="sm:col-span-2">
          <Input label={L("السبب", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {sched.length ? (
          <div className="sm:col-span-2 rounded-2xl bg-surface-2 p-3 text-[13.5px]">
            <p className="mb-1 flex items-center gap-1.5 font-semibold"><HandCoins className="size-4 text-brass" />{L("هتتخصم كده:", "Deducted like this:")}</p>
            <p className="num text-muted">{sched.map((s) => `${f.month(s.period)}: ${formatMoney(s.amount, { lang, compact: true })}`).join(" · ")}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

export function SwapRequestDialog({ shift, onClose }: { shift: RotaShift; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onClose={onClose}
      title={L("اطلب تبديل الوردية", "Ask to swap this shift")}
      description={`${f.day(shift.date)} · ${hmRange(shift.start, shift.end)}`}
      footer={
        <Button block icon={<Repeat />} onClick={async () => { await requestSwap(db, shift, to || null, reason); toast({ title: L("الطلب اتبعت للمدير", "Sent to your manager"), tone: "success" }); onClose(); }}>
          {L("ابعت", "Send")}
        </Button>
      }
    >
      <div className="grid gap-4">
        <Select label={L("مين ياخدها؟", "Who takes it?")} value={to} onChange={(e) => setTo(e.target.value)} options={[{ value: "", label: L("أي حد فاضي", "Anyone free") }, ...hr.active.filter((m) => m.id !== shift.membershipId && m.role !== "owner").map((m) => ({ value: m.id, label: m.name }))]} />
        <Textarea label={L("السبب", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  );
}
