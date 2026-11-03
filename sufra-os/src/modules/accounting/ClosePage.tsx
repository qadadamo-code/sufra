/** إقفال الفترة — lock months after review (never reopened), plus the accounting settings the forecast and alerts use. */
import { useState } from "react";
import { CheckCircle2, Lock, Settings2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { Badge, Button, Card, CardHeader, Dialog, Input, Table, useToast } from "@/ui";
import { closePeriod, ensureSettings } from "./api";
import { addDays, businessDay, monthEnd, monthStart, trialBalance } from "./core";
import { parseEgp, useBooks, useMoney } from "./ui";

export default function ClosePage() {
  const { L } = useT();
  const { m } = useMoney();
  const db = useDb();
  const { can } = useSession();
  const { toast } = useToast();
  const { entries, chart, settings, settingsRow } = useBooks();
  const members = useLive("memberships").data;
  const pendingDrafts = useLive("journalDrafts", { where: { status: "pending" } }).data;
  const pendingExp = useLive("expenses", { where: { status: "pending" } }).data;
  const unmatched = useLive("bankLines", { where: { status: "unmatched" } }).data;
  const lastMonthEnd = addDays(monthStart(businessDay()), -1);
  const [through, setThrough] = useState(lastMonthEnd);
  const [confirm, setConfirm] = useState(false);
  const tb = trialBalance(entries.filter((e) => e.date <= through), chart);
  const checks = [
    { ok: tb.totals.balance === 0, label: L(`ميزان المراجعة متزن (${m(tb.totals.debit)})`, `Trial balance balances (${m(tb.totals.debit)})`) },
    { ok: !pendingDrafts.some((d) => d.date <= through), label: L("مفيش قيود يدوية مستنية في الفترة", "No pending manual journals in the period") },
    { ok: !pendingExp.some((e) => e.date <= through), label: L("مفيش مصروفات مستنية في الفترة", "No pending expenses in the period") },
    { ok: !unmatched.some((l) => l.date <= through), label: L("كشف البنك متسوّي لحد التاريخ ده", "Bank statement reconciled through this date"), soft: true },
    { ok: entries.some((e) => e.sourceType === "vat-return" && (e.sourceId.split("..")[1] ?? "") >= through) || through < monthEnd(through), label: L("إقرار القيمة المضافة اتقدم", "VAT return filed"), soft: true },
  ];
  const blocked = checks.some((c) => !c.ok && !c.soft) || (!!settings.closedThrough && through <= settings.closedThrough);

  return (
    <div className="grid gap-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Lock />} title={L("إقفال الفترة", "Close the period")} subtitle={L("بعد الإقفال مفيش قيود تتسجل بتاريخ قبله — والإقفال مايترجعش", "Once closed no entry can be dated on or before it — closing cannot be undone")} action={<Badge tone="primary" icon={<Lock />}>{settings.closedThrough ?? L("مفيش", "none")}</Badge>} />
          <div className="grid gap-3 px-5 pb-5">
            <Input type="date" label={L("اقفل لحد", "Close through")} value={through} onChange={(e) => setThrough(e.target.value)} />
            <ul className="grid gap-1.5 text-[14px]">
              {checks.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle2 className={c.ok ? "size-4 text-ok" : c.soft ? "size-4 text-warn" : "size-4 text-danger"} />
                  <span className={c.ok ? "" : c.soft ? "text-warn" : "text-danger"}>{c.label}</span>
                </li>
              ))}
            </ul>
            {can("accounting.post") ? <Button icon={<Lock />} disabled={blocked} onClick={() => setConfirm(true)}>{L("اقفل الفترة", "Close period")}</Button> : null}
          </div>
        </Card>
        <SettingsCard />
      </div>
      <Card>
        <CardHeader title={L("سجل الإقفال", "Close history")} />
        <Table dense rows={[...(settingsRow?.closeHistory ?? [])].reverse()} rowKey={(h) => h.at + h.through} columns={[
          { key: "t", header: L("لحد", "Through"), cell: (h) => <span className="font-mono" dir="ltr">{h.through}</span> },
          { key: "a", header: L("امتى", "When"), cell: (h) => <span className="font-mono text-[13px]" dir="ltr">{h.at.slice(0, 16).replace("T", " ")}</span> },
          { key: "b", header: L("مين", "By"), cell: (h) => members.find((x) => x.id === h.by)?.name ?? "—" },
          { key: "n", header: L("ملاحظة", "Note"), cell: (h) => h.note },
        ]} />
      </Card>
      <Dialog open={confirm} onClose={() => setConfirm(false)} size="sm" title={L("تأكيد الإقفال", "Confirm close")} description={L(`الدفاتر هتتقفل لحد ${through}. ده مايترجعش.`, `Books will be locked through ${through}. This cannot be undone.`)} footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>{L("إلغاء", "Cancel")}</Button>
          <Button icon={<Lock />} onClick={async () => {
            try {
              await closePeriod(db, through, L("إقفال شهري", "Month-end close"));
              toast({ title: L("الفترة اتقفلت", "Period closed"), tone: "success" });
              setConfirm(false);
            } catch (e) {
              toast({ title: L("ماينفعش", "Not allowed"), description: (e as Error).message, tone: "error" });
            }
          }}>{L("اقفل", "Close")}</Button>
        </div>
      } />
    </div>
  );
}

function SettingsCard() {
  const { L } = useT();
  const db = useDb();
  const { can } = useSession();
  const { toast } = useToast();
  const { settings } = useBooks();
  const egp = (u: number) => String(Math.round(u / 100_000));
  const [f, setF] = useState({
    payrollDay: String(settings.payrollDay), payrollEstimate: egp(settings.payrollEstimate), vatDueDay: String(settings.vatDueDay), lowCash: egp(settings.lowCashThreshold), overShort: egp(settings.overShortAlert),
    foodCost: String(settings.defaultFoodCostBp / 100), terms: String(settings.supplierTermsDays),
  });
  const n = (s: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number(s) || lo));
  return (
    <Card>
      <CardHeader icon={<Settings2 />} title={L("إعدادات الحسابات", "Accounting settings")} subtitle={L("بتأثر على توقع السيولة والتنبيهات وهندسة المنيو", "Drive the cash forecast, alerts and menu engineering")} />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        <Input label={L("يوم صرف المرتبات", "Payroll day")} inputMode="numeric" value={f.payrollDay} onChange={(e) => setF({ ...f, payrollDay: e.target.value })} />
        <Input label={L("صافي المرتبات الشهري التقريبي (ج.م)", "Monthly net payroll estimate (EGP)")} inputMode="numeric" value={f.payrollEstimate} onChange={(e) => setF({ ...f, payrollEstimate: e.target.value })} />
        <Input label={L("يوم سداد القيمة المضافة (الشهر التالي)", "VAT due day (following month)")} inputMode="numeric" value={f.vatDueDay} onChange={(e) => setF({ ...f, vatDueDay: e.target.value })} />
        <Input label={L("حد الأمان للسيولة (ج.م)", "Low-cash safety line (EGP)")} inputMode="numeric" value={f.lowCash} onChange={(e) => setF({ ...f, lowCash: e.target.value })} />
        <Input label={L("تنبيه عجز/زيادة فوق (ج.م)", "Over/short alert above (EGP)")} inputMode="numeric" value={f.overShort} onChange={(e) => setF({ ...f, overShort: e.target.value })} />
        <Input label={L("نسبة تكلفة الطعام الافتراضية ٪", "Default food cost %")} inputMode="decimal" value={f.foodCost} onChange={(e) => setF({ ...f, foodCost: e.target.value })} />
        <Input label={L("مدة سداد الموردين (يوم)", "Supplier terms (days)")} inputMode="numeric" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
        {can("accounting.post") ? (
          <Button className="self-end" onClick={async () => {
            const s = await ensureSettings(db);
            await db.update("accountingSettings", s.id, {
              payrollDay: n(f.payrollDay, 1, 31), payrollEstimate: parseEgp(f.payrollEstimate) ?? 0, vatDueDay: n(f.vatDueDay, 1, 31), lowCashThreshold: parseEgp(f.lowCash) ?? 0, overShortAlert: parseEgp(f.overShort) ?? 0,
              defaultFoodCostBp: Math.round(n(f.foodCost, 1, 90) * 100), supplierTermsDays: n(f.terms, 0, 120),
            });
            toast({ title: L("اتحفظ", "Saved"), tone: "success" });
          }}>{L("حفظ", "Save")}</Button>
        ) : null}
      </div>
    </Card>
  );
}
