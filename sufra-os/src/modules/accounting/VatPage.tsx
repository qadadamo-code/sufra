/** إقرار القيمة المضافة — output vs input VAT per month (finance vatReturn), settlement entry + period lock (settleVat). */
import { useMemo, useState } from "react";
import { FileCheck2, Lock, Percent } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { Badge, Button, Card, CardHeader, Dialog, Input, Money, Select, Table } from "@/ui";
import { useToast } from "@/ui";
import { addDays, businessDay, monthEnd, monthStart, vatReturn } from "./core";
import { vatDueDate } from "./forecast";
import { fileVatReturn } from "./ops";
import { EstimateNote, ExportButtons, Row, SectionTitle, useBooks, useMoney } from "./ui";

export default function VatPage() {
  const { L, lang } = useT();
  const { m } = useMoney();
  const db = useDb();
  const { can } = useSession();
  const { toast } = useToast();
  const { entries, settings } = useBooks();
  const today = businessDay();
  const months = useMemo(() => {
    const set = new Set(entries.map((e) => e.date.slice(0, 7)));
    set.add(today.slice(0, 7));
    return [...set].sort().reverse();
  }, [entries, today]);
  const filed = useMemo(() => entries.filter((e) => e.sourceType === "vat-return").map((e) => ({ e, from: e.sourceId.split("..")[0], to: e.sourceId.split("..")[1] })), [entries]);
  const defaultMonth = months.find((mm) => !filed.some((f) => f.to >= monthEnd(`${mm}-01`)) && `${mm}-01` < monthStart(today)) ?? months[0];
  const [month, setMonth] = useState(defaultMonth);
  const from = `${month}-01`;
  const to = monthEnd(from);
  const r = useMemo(() => vatReturn(entries, from, to), [entries, from, to]);
  const isFiled = filed.find((f) => f.from <= from && f.to >= to);
  const due = vatDueDate(to, settings.vatDueDay);
  const [confirm, setConfirm] = useState(false);
  const [settleDate, setSettleDate] = useState(today);
  const open = to < today && !isFiled;
  const label = (mm: string) => new Date(`${mm}-15T12:00:00`).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { month: "long", year: "numeric" });

  return (
    <div className="grid gap-5 print-area">
      <div className="flex flex-wrap items-end justify-between gap-3" data-noprint>
        <Select aria-label={L("الشهر", "Month")} value={month} onChange={(e) => setMonth(e.target.value)} options={months.map((mm) => ({ value: mm, label: label(mm) }))} className="min-w-48" />
        <ExportButtons />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={<Percent />} title={L(`إقرار القيمة المضافة — ${label(month)}`, `VAT return — ${label(month)}`)} subtitle={L(`${from} → ${to} · ميعاد السداد ${due}`, `${from} → ${to} · due ${due}`)} action={isFiled ? <Badge tone="ok" icon={<Lock />}>{L("اتقدم واتقفل", "Filed & locked")}</Badge> : to >= today ? <Badge tone="info">{L("الشهر لسه شغال", "Month in progress")}</Badge> : <Badge tone="warn">{L("لسه ماتقدمش", "Not filed")}</Badge>} />
          <SectionTitle>{L("ضريبة المخرجات (المبيعات)", "Output VAT (sales)")}</SectionTitle>
          <Row label={L("المبيعات الخاضعة (الوعاء)", "Taxable sales (base)")} value={m(r.salesBase)} indent />
          <Row label={L("ضريبة المبيعات ١٤٪", "VAT on sales 14%")} value={m(r.outputVat)} strong />
          <SectionTitle>{L("ضريبة المدخلات (المشتريات والمصروفات)", "Input VAT (purchases & expenses)")}</SectionTitle>
          <Row label={L("المشتريات الخاضعة (الوعاء)", "Taxable purchases (base)")} value={m(r.purchasesBase)} indent />
          <Row label={L("ضريبة المدخلات القابلة للخصم", "Deductible input VAT")} value={m(r.inputVat)} strong />
          <div className="mt-2 border-t-2 border-line-strong">
            <Row label={r.net >= 0 ? L("الصافي المستحق لمصلحة الضرائب", "Net payable to ETA") : L("رصيد دائن يُرحَّل للشهر الجاي", "Credit carried forward")} value={m(Math.abs(r.net))} strong tone={r.net >= 0 ? "danger" : "ok"} />
          </div>
          <EstimateNote className="px-5 py-4">{L("الأرقام من الدفاتر؛ المحاسب يراجع الفواتير الضريبية والإعفاءات قبل التقديم على بوابة مصلحة الضرائب", "Figures come from the books; the accountant reviews tax invoices and exemptions before filing on the ETA portal")}</EstimateNote>
        </Card>
        <Card>
          <CardHeader icon={<FileCheck2 />} title={L("تقديم وإقفال", "File & lock")} />
          <div className="grid gap-3 px-5 pb-5 text-[14px]">
            <p className="text-muted">{L("التقديم بيعمل قيد التسوية (مدين ضريبة المخرجات، دائن ضريبة المدخلات، والفرق لحساب مصلحة الضرائب 2301) ويقفل الشهر — مفيش قيود تانية تتسجل فيه.", "Filing posts the settlement entry (Dr output VAT, Cr input VAT, the difference to ETA account 2301) and locks the month — no more postings in it.")}</p>
            {open && can("accounting.post") ? <Button icon={<Lock />} onClick={() => setConfirm(true)}>{L("قدّم الإقرار واقفل الشهر", "File the return & lock")}</Button> : null}
            {isFiled ? <div>{L("قيد التسوية", "Settlement entry")} <span className="font-mono" dir="ltr">{isFiled.e.date}</span> · <Money value={isFiled.e.lines.find((l) => l.account === "2301")?.credit ?? 0} /></div> : null}
            <div className="text-[12.5px] text-muted">{L("الفترة مقفولة لحد", "Books locked through")} <b dir="ltr">{settings.closedThrough ?? "—"}</b></div>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title={L("الإقرارات السابقة", "Filed returns")} />
        <Table dense rows={[...filed].reverse()} rowKey={(f) => f.e.id} columns={[
          { key: "p", header: L("الفترة", "Period"), cell: (f) => <span className="font-mono" dir="ltr">{f.from} → {f.to}</span> },
          { key: "d", header: L("اتقدم", "Filed"), cell: (f) => <span className="font-mono" dir="ltr">{f.e.date}</span> },
          { key: "o", header: L("مخرجات", "Output"), align: "end", cell: (f) => <Money value={f.e.lines.find((l) => l.account === "2201")?.debit ?? 0} compact /> },
          { key: "i", header: L("مدخلات", "Input"), align: "end", hideOnMobile: true, cell: (f) => <Money value={f.e.lines.find((l) => l.account === "1401")?.credit ?? 0} compact /> },
          { key: "n", header: L("الصافي", "Net"), align: "end", cell: (f) => <b><Money value={(f.e.lines.find((l) => l.account === "2301")?.credit ?? 0) - (f.e.lines.find((l) => l.account === "2301")?.debit ?? 0)} compact /></b> },
        ]} />
      </Card>
      <Dialog open={confirm} onClose={() => setConfirm(false)} size="sm" title={L("تأكيد التقديم", "Confirm filing")} description={L(`هيتعمل قيد تسوية بمبلغ ${m(r.net)} والشهر هيتقفل نهائياً.`, `A settlement entry of ${m(r.net)} will be posted and the month locked for good.`)} footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>{L("إلغاء", "Cancel")}</Button>
          <Button icon={<Lock />} onClick={async () => {
            try {
              await fileVatReturn(db, from, to, settleDate);
              toast({ title: L("الإقرار اتسجل والشهر اتقفل", "Return filed and month locked"), tone: "success" });
              setConfirm(false);
            } catch (e) {
              toast({ title: L("ماينفعش", "Not allowed"), description: (e as Error).message, tone: "error" });
            }
          }}>{L("قدّم واقفل", "File & lock")}</Button>
        </div>
      }>
        <Input type="date" label={L("تاريخ قيد التسوية", "Settlement date")} value={settleDate} min={addDays(to, 1)} onChange={(e) => setSettleDate(e.target.value)} />
      </Dialog>
    </div>
  );
}
