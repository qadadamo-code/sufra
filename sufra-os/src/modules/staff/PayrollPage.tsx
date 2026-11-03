import { useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowRight, BellRing, Calculator, CheckCircle2, Download, FileText, Landmark, Printer, RefreshCw, Wallet } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { PayMethod, Payslip, PayrollRun } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { printNode } from "@/lib/receipt/print";
import { accountName } from "@/modules/hr/accounts";
import { Badge, Button, Card, Dialog, EmptyState, Input, Select, StatTile, Table, useToast } from "@/ui";
import { useHr } from "@/modules/hr/useHr";
import { approveRun, bankCsv, buildRun, markRunPaid, saveRun, slipsToDrafts, HrError } from "@/modules/hr/ops";
import { payDate } from "@/modules/hr/lib/settings";
import { daysBetween } from "@/modules/hr/lib/tz";
import { payrollJournalLines } from "@/modules/hr/lib/payroll";
import { PAY_METHOD, RUN_STATUS } from "@/modules/hr/labels";
import { EstimateNote, PersonCell, Section, useDateFmt } from "@/modules/hr/ui";
import { PayslipView } from "@/modules/hr/PayslipView";

export default function PayrollPage() {
  return (
    <Routes>
      <Route index element={<Runs />} />
      <Route path="run/:runId" element={<RunDetail />} />
      <Route path="slip/:slipId" element={<SlipPage back="/staff/payroll" />} />
    </Routes>
  );
}

export function PaydayBanner() {
  const { L, lang } = useT();
  const hr = useHr();
  const f = useDateFmt();
  const period = hr.today.slice(0, 7);
  const runs = useLive("payrollRuns", { where: { period } }).data;
  const pd = payDate(period, hr.rules.payDay);
  const left = daysBetween(hr.today, pd);
  const done = runs.some((r) => r.status === "paid");
  if (done || left > hr.rules.reminderDays + 4) return null;
  const late = left < 0;
  return (
    <Card className={`flex flex-wrap items-center gap-3 p-4 ${late ? "border-danger/40 bg-danger-soft/40" : "border-brass/40 bg-brass-soft/50"}`}>
      <BellRing className={late ? "size-5 text-danger" : "size-5 text-brass"} />
      <p className="min-w-0 flex-1 font-semibold">
        {late ? L(`ميعاد الرواتب كان ${f.day(pd)} — لسه ماتصرفتش`, `Pay day was ${f.day(pd)} — salaries not paid yet`) : left === 0 ? L("النهارده ميعاد الرواتب", "Today is pay day") : L(`ميعاد الرواتب (موعد الرواتب) بعد ${left} يوم — ${f.day(pd)}`, `Pay day in ${left} days — ${f.day(pd)}`)}
      </p>
      <Badge tone={runs.some((r) => r.status === "approved") ? "info" : "warn"}>{runs.length ? RUN_STATUS[runs[0].status].label[lang] : L("لسه ماتحسبتش", "Not calculated")}</Badge>
    </Card>
  );
}

function Runs() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const nav = useNavigate();
  const { toast } = useToast();
  const runs = useLive("payrollRuns", { orderBy: [{ field: "period", dir: "desc" }] }).data;
  const [period, setPeriod] = useState(hr.today.slice(0, 7));
  const [branch, setBranch] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const money = (u: number) => formatMoney(u, { lang, currency: hr.currency, whole: true });
  const last = runs.find((r) => r.status === "paid");
  const calc = async () => {
    setBusy(true);
    try {
      const d = await buildRun(db, period, branch || null);
      const run = await saveRun(db, d);
      nav(`run/${run.id}`);
    } catch (e) {
      toast({ title: e instanceof HrError && e.code === "run_locked" ? L("الشهر ده اتعتمد خلاص", "That month is already approved") : String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-5">
      <PaydayBanner />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={<Wallet />} label={L("صافي آخر شهر", "Last month net")} value={last ? money(last.totals.net) : "—"} sub={last ? f.month(last.period) : undefined} />
        <StatTile index={1} tone="brass" icon={<Calculator />} label={L("تكلفة العمالة الكاملة", "Full labour cost")} value={last ? money(last.totals.gross - last.totals.deductions + last.totals.employeeInsurance + last.totals.incomeTax + last.totals.advances + last.totals.employerInsurance + last.totals.eosb) : "—"} sub={L("مع حصة صاحب العمل", "incl. employer share")} />
        <StatTile index={2} tone="info" icon={<Landmark />} label={L("تأمينات + ضرائب", "Insurance + tax")} value={last ? money(last.totals.employeeInsurance + last.totals.employerInsurance + last.totals.incomeTax) : "—"} sub={<EstimateNote />} />
        <StatTile index={3} tone="ok" icon={<BellRing />} label={L("ميعاد الرواتب", "Pay day")} value={f.day(payDate(hr.today.slice(0, 7), hr.rules.payDay), { day: "numeric", month: "short" })} sub={L(`كل شهر يوم ${hr.rules.payDay || "آخر الشهر"}`, `every month on day ${hr.rules.payDay || "last"}`)} />
      </div>
      <Section title={L("احسب رواتب شهر", "Run payroll")} icon={<Calculator />} subtitle={L("الأساسي + الإضافي + البقشيش + الخدمة + الحوافز − الغياب والتأخير − السلف − التأمينات − الضريبة", "Basic + overtime + tips + service + bonuses − absence & lateness − advances − insurance − tax")}>
        <div className="flex flex-wrap items-end gap-3">
          <Input label={L("الشهر", "Month")} type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} />
          <Select label={L("الفرع", "Branch")} value={branch} onChange={(e) => setBranch(e.target.value)} options={[{ value: "", label: L("كل الفروع", "All branches") }, ...hr.session.branches.map((b) => ({ value: b.id, label: b.name[lang] }))]} />
          <Button icon={<Calculator />} loading={busy} onClick={calc}>{L("احسب", "Calculate")}</Button>
        </div>
      </Section>
      <Section title={L("الشهور", "Runs")} icon={<FileText />} bodyClass="px-0 pb-2">
        <Table
          rows={runs}
          rowKey={(r) => r.id}
          onRowClick={(r) => nav(`run/${r.id}`)}
          empty={<EmptyState compact title={L("لسه مفيش رواتب محسوبة", "No payroll runs yet")} />}
          columns={[
            { key: "p", header: L("الشهر", "Month"), cell: (r) => <span className="font-semibold">{f.month(r.period)}</span> },
            { key: "b", header: L("الفرع", "Branch"), cell: (r) => (r.branchId ? hr.session.branches.find((b) => b.id === r.branchId)?.name[lang] : L("كل الفروع", "All")), hideOnMobile: true },
            { key: "n", header: L("الموظفين", "Staff"), cell: (r) => <span className="num">{r.totals.headcount}</span>, align: "center", hideOnMobile: true },
            { key: "g", header: L("الإجمالي", "Gross"), cell: (r) => <span className="num">{money(r.totals.gross)}</span>, align: "end", hideOnMobile: true },
            { key: "net", header: L("الصافي", "Net"), cell: (r) => <span className="num font-bold">{money(r.totals.net)}</span>, align: "end" },
            { key: "s", header: L("الحالة", "Status"), cell: (r) => <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label[lang]}</Badge> },
          ]}
        />
      </Section>
    </div>
  );
}

function RunDetail() {
  const { runId = "" } = useParams();
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const f = useDateFmt();
  const nav = useNavigate();
  const { toast } = useToast();
  const run = useLive("payrollRuns", { where: { id: runId } }).data[0] as PayrollRun | undefined;
  const slips = useLive("payslips", { where: { runId }, orderBy: [{ field: "name" }] }).data;
  const [busy, setBusy] = useState<string | null>(null);
  const [pay, setPay] = useState(false);
  const money = (u: number) => formatMoney(u, { lang, currency: hr.currency });
  const journal = useMemo(() => payrollJournalLines(slipsToDrafts(slips)), [slips]);
  if (!run) return <EmptyState title={L("مش لاقيين الشهر ده", "Run not found")} />;
  const t = run.totals;
  const act = async (k: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(k);
    try {
      await fn();
      toast({ title: ok, tone: "success" });
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(null);
    }
  };
  const download = () => {
    const csv = bankCsv(slips, hr.comps, hr.profiles, run.period, run.country);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `salaries-${run.period}${run.country === "SA" ? "-wps" : ""}.csv`;
    a.click();
  };
  const printAll = () =>
    printNode(
      <div>
        {slips.map((s) => (
          <div key={s.id} style={{ breakAfter: "page" }}>
            <PayslipView slip={s} restaurant={hr.session.restaurant} profile={hr.profileOf(s.membershipId)} lang={lang} currency={hr.currency} />
          </div>
        ))}
      </div>,
      "a4",
    );
  return (
    <div className="grid gap-5">
      <Link to="/staff/payroll" className="inline-flex w-fit items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink">
        <ArrowRight className="size-4 ltr:rotate-180" />
        {L("الرواتب", "Payroll")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[24px]">{L(`رواتب ${f.month(run.period)}`, `Payroll ${f.month(run.period)}`)}</h2>
        <Badge tone={RUN_STATUS[run.status].tone}>{RUN_STATUS[run.status].label[lang]}</Badge>
        <EstimateNote />
        <span className="flex-1" />
        {run.status === "draft" ? (
          <>
            <Button variant="secondary" icon={<RefreshCw />} loading={busy === "re"} onClick={() => act("re", async () => saveRun(db, await buildRun(db, run.period, run.branchId)), L("اتحسبت تاني بآخر حضور", "Recalculated with the latest attendance"))}>{L("احسب تاني", "Recalculate")}</Button>
            <Button icon={<CheckCircle2 />} loading={busy === "ap"} onClick={() => act("ap", () => approveRun(db, run), L("اتعتمد — القيود اتسجلت في الحسابات", "Approved — journal posted to accounting"))}>{L("اعتمد", "Approve")}</Button>
          </>
        ) : null}
        {run.status === "approved" ? <Button icon={<Wallet />} onClick={() => setPay(true)}>{L("اتصرف", "Mark paid")}</Button> : null}
        <Button variant="secondary" icon={<Download />} onClick={download}>{run.country === "SA" ? L("ملف البنك (WPS)", "Bank file (WPS)") : L("ملف تحويل البنك", "Bank transfer CSV")}</Button>
        <Button variant="secondary" icon={<Printer />} onClick={printAll}>{L("اطبع القسايم", "Print payslips")}</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={<Wallet />} label={L("الصافي", "Net pay")} value={money(t.net)} sub={L(`${t.headcount} موظف`, `${t.headcount} staff`)} />
        <StatTile index={1} tone="primary" icon={<Calculator />} label={L("الإجمالي", "Gross")} value={money(t.gross)} sub={L(`بقشيش ${formatMoney(t.tips, { lang, whole: true })} · خدمة ${formatMoney(t.service, { lang, whole: true })}`, `tips ${formatMoney(t.tips, { lang, whole: true })} · service ${formatMoney(t.service, { lang, whole: true })}`)} />
        <StatTile index={2} tone="info" icon={<Landmark />} label={run.country === "EG" ? L("تأمينات (موظف + صاحب عمل)", "Insurance (ee + er)") : "GOSI"} value={money(t.employeeInsurance + t.employerInsurance)} sub={<EstimateNote />} />
        <StatTile index={3} tone="brass" icon={<Landmark />} label={run.country === "EG" ? L("ضريبة كسب العمل", "Salary tax") : L("مخصص نهاية الخدمة", "EOSB accrual")} value={money(run.country === "EG" ? t.incomeTax : t.eosb)} sub={<EstimateNote />} />
      </div>
      <Section title={L("الموظفين", "Employees")} bodyClass="px-0 pb-2">
        <Table
          rows={slips}
          rowKey={(s) => s.id}
          onRowClick={(s) => nav(`/staff/payroll/slip/${s.id}`)}
          columns={[
            { key: "who", header: L("الموظف", "Staff"), cell: (s) => { const m = hr.memberOf(s.membershipId); return m ? <PersonCell m={m} p={hr.profileOf(m.id)} size="sm" sub={s.position} /> : s.name; } },
            { key: "days", header: L("أيام", "Days"), cell: (s) => <span className="num">{s.workedDays}{s.absentDays ? <span className="text-danger"> −{s.absentDays}</span> : null}</span>, align: "center", hideOnMobile: true },
            { key: "gross", header: L("الإجمالي", "Gross"), cell: (s) => <span className="num">{money(s.gross)}</span>, align: "end", hideOnMobile: true },
            { key: "ins", header: L("تأمينات", "Insurance"), cell: (s) => <span className="num text-muted">{money(s.employeeInsurance)}</span>, align: "end", hideOnMobile: true },
            { key: "tax", header: L("ضريبة", "Tax"), cell: (s) => <span className="num text-muted">{money(s.incomeTax)}</span>, align: "end", hideOnMobile: true },
            { key: "adv", header: L("سلف", "Advance"), cell: (s) => (s.advanceRecovered ? <span className="num text-brass">{money(s.advanceRecovered)}</span> : "—"), align: "end", hideOnMobile: true },
            { key: "net", header: L("الصافي", "Net"), cell: (s) => <span className="num font-bold">{money(s.net)}</span>, align: "end" },
            { key: "pm", header: L("الصرف", "Pay by"), cell: (s) => <span className="text-[12.5px] text-muted">{PAY_METHOD[s.payMethod][lang]}</span>, hideOnMobile: true },
          ]}
        />
      </Section>
      <Section title={L("القيد المحاسبي", "Journal entry")} subtitle={run.status === "draft" ? L("هيتسجل لما تعتمد", "Posted when you approve") : L("اتسجل في دفتر الأستاذ", "Posted to the ledger")} bodyClass="px-0 pb-2">
        <Table
          rows={journal}
          rowKey={(l) => l.account}
          dense
          columns={[
            { key: "a", header: L("الحساب", "Account"), cell: (l) => <span><span className="num text-muted">{l.account}</span> · {accountName(l.account, lang)}</span> },
            { key: "d", header: L("مدين", "Debit"), cell: (l) => (l.debit ? <span className="num">{money(l.debit)}</span> : ""), align: "end" },
            { key: "c", header: L("دائن", "Credit"), cell: (l) => (l.credit ? <span className="num">{money(l.credit)}</span> : ""), align: "end" },
          ]}
        />
        <p className="num px-5 pt-2 text-[12.5px] text-muted">
          {L("الإجمالي", "Totals")}: {money(journal.reduce((a, l) => a + l.debit, 0))} = {money(journal.reduce((a, l) => a + l.credit, 0))}
        </p>
      </Section>
      {run.country === "SA" ? <p className="text-[13px] text-muted">{L("السعودية: ملف البنك ده بيتحوّل لملف WPS/مدد (SIF) من بوابة البنك؛ لازم الأرقام تطابق عقود قوى عشان نطاقات.", "KSA: your bank's portal converts this into the WPS/Mudad (SIF) file; figures must match the Qiwa contracts (Nitaqat).")}</p> : null}
      {pay ? <PayRunDialog run={run} onClose={() => setPay(false)} /> : null}
    </div>
  );
}

function PayRunDialog({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [method, setMethod] = useState<PayMethod | "by_person">("by_person");
  return (
    <Dialog
      open
      onClose={onClose}
      title={L("صرف الرواتب", "Pay salaries")}
      footer={
        <Button block icon={<Wallet />} onClick={async () => { await markRunPaid(db, run, method); toast({ title: L("اتسجل الصرف — القسايم ظاهرة للموظفين", "Marked paid — payslips are visible to staff"), tone: "success" }); onClose(); }}>
          {L("تمام، اتصرف", "Mark as paid")}
        </Button>
      }
    >
      <Select label={L("اتصرف إزاي؟", "Paid how?")} value={method} onChange={(e) => setMethod(e.target.value as PayMethod | "by_person")} options={[{ value: "by_person", label: L("زي ما مكتوب لكل موظف", "As set per employee") }, ...Object.entries(PAY_METHOD).map(([k, v]) => ({ value: k, label: v[lang] }))]} />
      <p className="mt-3 text-[13px] text-muted">{L("القيد: من حـ/ رواتب مستحقة (٢٤٠١) إلى حـ/ الخزينة أو البنك", "Journal: Dr salaries payable (2401) / Cr cash or bank")}</p>
    </Dialog>
  );
}

export function SlipPage({ back }: { back: string }) {
  const { slipId = "" } = useParams();
  const { L, lang } = useT();
  const hr = useHr();
  const slip = useLive("payslips", { where: { id: slipId } }).data[0] as Payslip | undefined;
  if (!slip) return <EmptyState title={L("القسيمة مش موجودة", "Payslip not found")} />;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to={back} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink">
          <ArrowRight className="size-4 ltr:rotate-180" />
          {L("رجوع", "Back")}
        </Link>
        <span className="flex-1" />
        <Button variant="secondary" icon={<Printer />} onClick={() => printNode(<PayslipView slip={slip} restaurant={hr.session.restaurant} profile={hr.profileOf(slip.membershipId)} lang={lang} currency={hr.currency} />, "a4")}>
          {L("اطبع", "Print")}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-[20px] border border-line shadow-sf-sm">
        <PayslipView slip={slip} restaurant={hr.session.restaurant} profile={hr.profileOf(slip.membershipId)} lang={lang} currency={hr.currency} />
      </div>
    </div>
  );
}
