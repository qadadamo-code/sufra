/** تصدير — journal CSV (generic / Odoo / QuickBooks / Zoho Books) + the suggested account mapping. */
import { useState } from "react";
import { FileDown } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { Button, Card, CardHeader, Segmented, Switch, Table } from "@/ui";
import { ACCOUNT_MAP, journalExport, summariseSales, type ExportTarget } from "./integrations";
import { downloadCsv, PeriodPicker, useBooks, usePeriod } from "./ui";

export default function ExportPage() {
  const { L, loc, lang } = useT();
  const { entries, chart, settings } = useBooks();
  const branches = useLive("branches").data;
  const [target, setTarget] = useState<ExportTarget>("generic");
  const [period, setPeriod] = usePeriod("last_month");
  const [summary, setSummary] = useState(true);
  const [closedOnly, setClosedOnly] = useState(false);
  const inRange = entries.filter((e) => e.date >= period.from && e.date <= period.to && (!closedOnly || (settings.closedThrough && e.date <= settings.closedThrough)));
  const list = summary ? summariseSales(inRange) : inRange;
  const branchName = (id: string | null) => (id ? loc(branches.find((b) => b.id === id)?.name ?? { ar: id, en: id }) : "");
  const download = () => {
    const x = journalExport(target, list, chart, { branchName, currency: "EGP" });
    downloadCsv(`sufra_journal_${target}_${period.from}_${period.to}`, x.header, x.rows);
  };
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader icon={<FileDown />} title={L("تصدير دفتر اليومية", "Export the journal")} subtitle={L("لمحاسبك على Odoo أو QuickBooks أو Zoho Books أو أي برنامج — ملف CSV سطر لكل حركة", "For your accountant on Odoo, QuickBooks, Zoho Books or anything else — CSV, one row per line")} />
        <div className="grid gap-4 px-5 pb-5">
          <Segmented label={L("البرنامج", "Target")} value={target} onChange={setTarget} options={[{ value: "generic", label: L("عام", "Generic") }, { value: "odoo", label: "Odoo" }, { value: "quickbooks", label: "QuickBooks" }, { value: "zoho", label: "Zoho Books" }]} />
          <PeriodPicker value={period} onChange={setPeriod} />
          <Switch checked={summary} onChange={setSummary} label={L("اجمع المبيعات في قيد واحد لكل يوم", "Summarise sales into one entry per day")} description={L("أنضف في البرنامج الخارجي — كل إيصال بيفضل موجود في سُفرة", "Cleaner in the external package — every receipt stays in Sufra")} />
          <Switch checked={closedOnly} onChange={setClosedOnly} label={L("الفترات المقفولة بس", "Closed periods only")} description={settings.closedThrough ? L(`مقفول لحد ${settings.closedThrough}`, `Closed through ${settings.closedThrough}`) : undefined} />
          <div className="flex flex-wrap items-center gap-3">
            <Button icon={<FileDown />} onClick={download} disabled={!list.length}>{L(`نزّل ${list.length} قيد`, `Download ${list.length} entries`)}</Button>
            <span className="text-[12.5px] text-muted">{L("المرجع الثابت لكل قيد بيمنع التكرار لو استوردت مرتين", "Each entry carries a stable id, so importing twice doesn't duplicate")}</span>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title={L("ربط الحسابات المقترح", "Suggested account mapping")} subtitle={L("المحاسب يأكده مرة واحدة", "Your accountant confirms it once")} />
        <Table dense rows={ACCOUNT_MAP} rowKey={(r) => r.code} columns={[
          { key: "c", header: L("حساب سُفرة", "Sufra account"), cell: (r) => <span><span className="font-mono text-[12.5px] text-muted">{r.code}</span> {chart.get(r.code)?.name[lang]}</span> },
          { key: "o", header: "Odoo", cell: (r) => r.odoo },
          { key: "q", header: "QuickBooks", hideOnMobile: true, cell: (r) => r.quickbooks },
          { key: "z", header: "Zoho Books", hideOnMobile: true, cell: (r) => r.zoho },
        ]} />
        <p className="px-5 py-3 text-[12.5px] text-muted">{L("الربط التلقائي (إرسال القيود كل ليلة) متصمم ومش متفعّل لسه — محتاج حساب البرنامج عند المالك.", "Automatic sync (nightly push) is designed but not enabled — it needs the owner's account on that package.")}</p>
      </Card>
    </div>
  );
}
