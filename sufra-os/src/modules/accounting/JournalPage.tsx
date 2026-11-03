/** القيود — every journal entry (POS, payments, delivery, payroll, purchases, expenses, manual), drill-down, manual journals with approval, reversals. */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Check, ExternalLink, FilePlus2, Plus, Search, Trash2, Undo2, X } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { JournalDraft, JournalLineRow } from "@/data/accountingTypes";
import type { LedgerEntry } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Input, Money, Select, Table, Textarea, useToast, type Column, type Tone } from "@/ui";
import { SOURCE } from "./api";
import { businessDay, entryTotal, reversalIndex } from "./core";
import { approveDraft, rejectDraft, requestReversal, submitManualJournal } from "./ops";
import { accName, dec, downloadCsv, Num, parseEgp, PeriodPicker, useBooks, useMoney, usePeriod } from "./ui";

export const SOURCE_LABEL: Record<string, { ar: string; en: string; tone: Tone }> = {
  receipt: { ar: "بيع", en: "Sale", tone: "ok" },
  "return-receipt": { ar: "مرتجع", en: "Return", tone: "danger" },
  "z-summary": { ar: "ملخص يومي", en: "Daily summary", tone: "ok" },
  "cash-move": { ar: "حركة درج", en: "Drawer move", tone: "neutral" },
  "drawer-count": { ar: "عجز/زيادة", en: "Over/short", tone: "warn" },
  "cash-transfer": { ar: "تحويل نقدية", en: "Cash transfer", tone: "info" },
  payout: { ar: "تسوية", en: "Settlement", tone: "info" },
  expense: { ar: "مصروف", en: "Expense", tone: "brass" },
  "expense.payment": { ar: "سداد مصروف", en: "Expense paid", tone: "brass" },
  "purchase-invoice": { ar: "مشتريات", en: "Purchase", tone: "brass" },
  "supplier.payment": { ar: "سداد مورد", en: "Supplier payment", tone: "brass" },
  cogs: { ar: "تكلفة مبيعات", en: "Cost of sales", tone: "neutral" },
  waste: { ar: "هالك", en: "Waste", tone: "warn" },
  payroll: { ar: "مرتبات", en: "Payroll", tone: "primary" },
  "payroll.payment": { ar: "صرف مرتبات", en: "Salaries paid", tone: "primary" },
  "service.payout": { ar: "توزيع خدمة", en: "Service payout", tone: "primary" },
  "tips.payout": { ar: "صرف تيبس", en: "Tips paid", tone: "primary" },
  "tax.payment": { ar: "سداد ضرايب", en: "Tax payment", tone: "warn" },
  "vat-return": { ar: "إقرار ضريبي", en: "VAT return", tone: "warn" },
  depreciation: { ar: "إهلاك", en: "Depreciation", tone: "neutral" },
  manual: { ar: "قيد يدوي", en: "Manual", tone: "info" },
  reversal: { ar: "عكس قيد", en: "Reversal", tone: "danger" },
  "opening-balance": { ar: "أرصدة افتتاحية", en: "Opening", tone: "neutral" },
  "bank-line": { ar: "حركة بنك", en: "Bank line", tone: "info" },
  "gift_card.sale": { ar: "بيع كارت هدية", en: "Gift card sale", tone: "brass" },
  "gift_card.redeem": { ar: "استخدام كارت", en: "Gift card used", tone: "brass" },
  "gift_card.refund": { ar: "رد كارت", en: "Gift card refund", tone: "brass" },
};
export const srcLabel = (t: string, lang: "ar" | "en") => SOURCE_LABEL[t]?.[lang] ?? t;
export const entryNo = (e: Pick<LedgerEntry, "id">) => `JE-${e.id.slice(0, 6).toUpperCase()}`;

export default function JournalPage() {
  const { L, lang } = useT();
  const { m } = useMoney();
  const { can } = useSession();
  const { entries, chart } = useBooks();
  const drafts = useLive("journalDrafts", { orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const [period, setPeriod] = usePeriod("30d");
  const [type, setType] = useState("");
  const [account, setAccount] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LedgerEntry | null>(null);
  const [compose, setCompose] = useState(false);
  const reversed = useMemo(() => reversalIndex(entries), [entries]);
  const canPost = can("accounting.post");

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return entries
      .filter((e) => e.date >= period.from && e.date <= period.to && (!type || e.sourceType === type) && (!account || e.lines.some((l) => l.account === account)) && (!s || `${e.memo} ${e.sourceId} ${entryNo(e)}`.toLowerCase().includes(s)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [entries, period, type, account, q]);
  const shown = rows.slice(0, 400);
  const types = useMemo(() => [...new Set(entries.map((e) => e.sourceType))].sort(), [entries]);
  const total = rows.reduce((a, e) => a + (account ? e.lines.filter((l) => l.account === account).reduce((b, l) => b + l.debit - l.credit, 0) : entryTotal(e)), 0);

  const cols: Column<LedgerEntry>[] = [
    { key: "d", header: L("التاريخ", "Date"), cell: (e) => <span className="font-mono text-[13px]" dir="ltr">{e.date}</span>, width: "110px" },
    { key: "n", header: L("رقم", "No."), hideOnMobile: true, cell: (e) => <span className="font-mono text-[12.5px] text-muted" dir="ltr">{entryNo(e)}</span> },
    { key: "t", header: L("النوع", "Type"), cell: (e) => <Badge size="sm" tone={SOURCE_LABEL[e.sourceType]?.tone ?? "neutral"}>{srcLabel(e.sourceType, lang)}</Badge> },
    { key: "m", header: L("البيان", "Memo"), cell: (e) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="line-clamp-1 max-w-[42ch]">{e.memo}</span>
        {reversed.has(e.id) ? <Badge size="sm" tone="danger">{L("معكوس", "Reversed")}</Badge> : null}
      </span>
    ) },
    { key: "a", header: account ? L("حركة الحساب", "Account movement") : L("المبلغ", "Amount"), align: "end", cell: (e) => <Money value={account ? e.lines.filter((l) => l.account === account).reduce((b, l) => b + l.debit - l.credit, 0) : entryTotal(e)} compact signed={!!account} /> },
  ];

  const exportCsv = () => {
    const header = ["entry_no", "entry_id", "date", "source_type", "source_id", "memo", "account_code", "account_name_ar", "account_name_en", "debit", "credit", "branch", "drawer", "supplier"];
    const data = rows.flatMap((e) => e.lines.map((l) => [entryNo(e), e.id, e.date, e.sourceType, e.sourceId, e.memo, l.account, chart.get(l.account)?.name.ar ?? "", chart.get(l.account)?.name.en ?? "", dec(l.debit), dec(l.credit), l.dims?.branch ?? e.branchId ?? "", l.dims?.drawer ?? "", l.dims?.supplier ?? ""]));
    downloadCsv(`journal_${period.from}_${period.to}`, header, data);
  };

  const pending = drafts.filter((d) => d.status === "pending");

  return (
    <div className="grid gap-5">
      {pending.length ? <DraftsCard drafts={pending} /> : null}
      <Card>
        <CardHeader icon={<BookOpen />} title={L("دفتر اليومية", "Journal")} subtitle={L(`${rows.length} قيد · ${m(total)}`, `${rows.length} entries · ${m(total)}`)} action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={exportCsv}>CSV</Button>
            {canPost ? <Button size="sm" icon={<FilePlus2 />} onClick={() => setCompose(true)}>{L("قيد يدوي", "Manual journal")}</Button> : null}
          </div>
        } />
        <div className="flex flex-wrap items-end gap-2 px-5 pb-4">
          <PeriodPicker value={period} onChange={setPeriod} />
          <Select aria-label={L("النوع", "Type")} value={type} onChange={(e) => setType(e.target.value)} options={[{ value: "", label: L("كل الأنواع", "All types") }, ...types.map((t) => ({ value: t, label: srcLabel(t, lang) }))]} className="min-w-40" />
          <Select aria-label={L("الحساب", "Account")} value={account} onChange={(e) => setAccount(e.target.value)} options={[{ value: "", label: L("كل الحسابات", "All accounts") }, ...[...chart.values()].map((a) => ({ value: a.code, label: `${a.code} · ${a.name[lang]}` }))]} className="min-w-48" />
          <Input aria-label={L("بحث", "Search")} icon={<Search />} placeholder={L("بحث في البيان أو المرجع", "Search memo or reference")} value={q} onChange={(e) => setQ(e.target.value)} wrapClassName="min-w-56 flex-1" />
        </div>
        <Table columns={cols} rows={shown} rowKey={(e) => e.id} onRowClick={setOpen} dense empty={<EmptyState compact title={L("مفيش قيود في الفترة دي", "No entries in this period")} />} />
        {rows.length > shown.length ? <p className="px-5 py-3 text-[12.5px] text-muted">{L(`بيظهر أول ${shown.length} — ضيّق الفلتر أو صدّر CSV`, `Showing the first ${shown.length} — narrow the filter or export CSV`)}</p> : null}
      </Card>
      <EntrySheet entry={open} onClose={() => setOpen(null)} onOpen={setOpen} />
      <ManualJournalDialog open={compose} onClose={() => setCompose(false)} />
    </div>
  );
}

/* ───────── pending manual journals / reversals ───────── */

function DraftsCard({ drafts }: { drafts: JournalDraft[] }) {
  const { L, lang } = useT();
  const db = useDb();
  const { staff, role, can } = useSession();
  const { toast } = useToast();
  const { chart } = useBooks();
  const members = useLive("memberships").data;
  const who = (id: string | null) => members.find((x) => x.id === id)?.name ?? "—";
  const act = async (d: JournalDraft, ok: boolean) => {
    try {
      if (ok) await approveDraft(db, d, { id: staff?.id ?? null, role });
      else await rejectDraft(db, d, "");
      toast({ title: ok ? L("القيد اترحّل", "Journal posted") : L("القيد اترفض", "Journal rejected"), tone: ok ? "success" : "default" });
    } catch (e) {
      toast({ title: L("ماينفعش", "Not allowed"), description: (e as Error).message, tone: "error" });
    }
  };
  return (
    <Card className="border-info/40">
      <CardHeader icon={<Check />} title={L("قيود مستنية موافقة", "Journals waiting for approval")} subtitle={L("لازم شخص تاني غير اللي عمل القيد يوافق (المالك يقدر يوافق على قيده)", "A second person must approve (the owner may approve their own)")} />
      <ul className="grid gap-3 px-5 pb-5">
        {drafts.map((d) => (
          <li key={d.id} className="rounded-xl border border-line bg-surface-2/60 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{d.kind === "reversal" ? L("عكس قيد: ", "Reverse: ") : ""}{d.memo}</div>
                <div className="text-[12.5px] text-muted"><span dir="ltr">{d.date}</span> · {L("طلب", "by")} {who(d.requestedBy)}</div>
              </div>
              {can("accounting.post") ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" icon={<X />} onClick={() => act(d, false)}>{L("رفض", "Reject")}</Button>
                  <Button size="sm" icon={<Check />} onClick={() => act(d, true)}>{L("موافقة وترحيل", "Approve & post")}</Button>
                </div>
              ) : null}
            </div>
            <LinesTable lines={d.lines} chart={chart} lang={lang} className="mt-2" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function LinesTable({ lines, chart, lang, className }: { lines: JournalLineRow[]; chart: ReturnType<typeof useBooks>["chart"]; lang: "ar" | "en"; className?: string }) {
  const { L } = useT();
  const dr = lines.reduce((a, l) => a + l.debit, 0);
  const cr = lines.reduce((a, l) => a + l.credit, 0);
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-[12px] text-muted">
            <th className="py-1.5 text-start font-semibold">{L("الحساب", "Account")}</th>
            <th className="py-1.5 text-end font-semibold">{L("مدين", "Debit")}</th>
            <th className="py-1.5 text-end font-semibold">{L("دائن", "Credit")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t border-line/70">
              <td className="py-1.5">
                <span className="font-mono text-[12px] text-muted" dir="ltr">{l.account}</span> {accName(chart, l.account, lang)}
                {l.dims?.drawer ? <span className="ms-1 text-[11.5px] text-faint">· {l.dims.drawer}</span> : null}
                {l.dims?.supplier ? <span className="ms-1 text-[11.5px] text-faint">· {l.dims.supplier}</span> : null}
              </td>
              <td className="py-1.5 text-end font-mono tabular-nums">{l.debit ? <Num value={l.debit} /> : ""}</td>
              <td className="py-1.5 text-end font-mono tabular-nums">{l.credit ? <Num value={l.credit} /> : ""}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-line-strong font-semibold">
            <td className="py-1.5">{L("الإجمالي", "Total")}</td>
            <td className="py-1.5 text-end font-mono tabular-nums"><Num value={dr} /></td>
            <td className={cn("py-1.5 text-end font-mono tabular-nums", dr !== cr && "text-danger")}><Num value={cr} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ───────── entry detail + drill-down ───────── */

function EntrySheet({ entry, onClose, onOpen }: { entry: LedgerEntry | null; onClose: () => void; onOpen: (e: LedgerEntry) => void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { can } = useSession();
  const { toast } = useToast();
  const { entries, chart } = useBooks();
  const [reason, setReason] = useState("");
  const receipts = useLive("receipts", { where: { receiptNo: entry?.sourceId ?? "-" } }, { enabled: !!entry && (entry.sourceType === "receipt" || entry.sourceType === "return-receipt") }).data;
  const expense = useLive("expenses", { where: { id: entry?.sourceId ?? "-" } }, { enabled: !!entry && entry.sourceType.startsWith("expense") }).data[0];
  const transfer = useLive("cashTransfers", { where: { id: entry?.sourceId ?? "-" } }, { enabled: !!entry && entry.sourceType === "cash-transfer" }).data[0];
  const draft = useLive("journalDrafts", { where: { id: entry?.sourceId ?? "-" } }, { enabled: !!entry && entry.sourceType === "manual" }).data[0];
  const accounts = useLive("cashAccounts").data;
  if (!entry) return <Dialog open={false} onClose={onClose} />;
  const rev = reversalIndex(entries).get(entry.id);
  const orig = entry.sourceType === SOURCE.reversal ? entries.find((e) => e.id === entry.sourceId) : null;
  const revEntry = rev ? entries.find((e) => e.id === rev) : null;
  const link: Record<string, string> = { receipt: "/orders", "return-receipt": "/orders", "cash-move": "/pos/shift", "drawer-count": "/pos/shift", payout: "/payments", "purchase-invoice": "/inventory", "supplier.payment": "/inventory", cogs: "/inventory", waste: "/inventory", payroll: "/staff", "payroll.payment": "/staff", "gift_card.sale": "/marketing", "gift_card.redeem": "/marketing" };
  const name = (id: string) => loc(accounts.find((a) => a.id === id)?.name ?? { ar: "—", en: "—" });

  const reverse = async () => {
    try {
      await requestReversal(db, entry.id, reason || L("تصحيح", "Correction"));
      toast({ title: L("طلب العكس اتبعت للموافقة", "Reversal sent for approval"), tone: "success" });
      setReason("");
      onClose();
    } catch (e) {
      toast({ title: L("ماينفعش", "Not allowed"), description: (e as Error).message, tone: "error" });
    }
  };

  return (
    <Dialog open onClose={onClose} variant="sheet-end" size="lg" title={<span className="flex items-center gap-2">{entryNo(entry)} <Badge tone={SOURCE_LABEL[entry.sourceType]?.tone ?? "neutral"}>{srcLabel(entry.sourceType, lang)}</Badge></span>} description={<span dir="ltr">{entry.date}</span>}>
      <div className="grid gap-4">
        <p className="text-[15px]">{entry.memo}</p>
        <LinesTable lines={entry.lines} chart={chart} lang={lang} />
        <Card className="p-4">
          <div className="mb-2 text-[13px] font-semibold text-muted">{L("المستند الأصلي", "Source document")}</div>
          <div className="grid gap-1.5 text-[14px]">
            <div><span className="text-muted">{L("المرجع", "Reference")}: </span><span className="font-mono" dir="ltr">{entry.sourceId}</span></div>
            {receipts[0] ? (
              <div className="grid gap-1">
                <div>{L("إيصال", "Receipt")} <b className="font-mono" dir="ltr">{receipts[0].receiptNo}</b> · <Money value={receipts[0].bill.payable} /> · {receipts[0].payments.map((p) => p.method).join(" + ")}</div>
                <div className="text-[12.5px] text-muted">{receipts[0].bill.lines.slice(0, 6).map((l) => `${l.qty}× ${loc(l.name)}`).join("، ")}</div>
                {receipts[0].etaUuid ? <div className="text-[12px] text-muted">ETA: <span className="font-mono" dir="ltr">{receipts[0].etaUuid.slice(0, 18)}…</span> · {receipts[0].etaStatus}</div> : null}
              </div>
            ) : null}
            {expense ? (
              <div className="flex gap-3">
                {expense.receiptPhoto ? <img src={expense.receiptPhoto} alt={L("صورة الفاتورة", "Receipt photo")} className="h-28 w-20 rounded-lg border border-line object-cover" /> : null}
                <div>
                  <div className="font-semibold">{expense.vendor}</div>
                  <div className="text-muted">{expense.description}</div>
                  <div><Money value={expense.total} /> {expense.vat ? <span className="text-[12.5px] text-muted">({L("منها ضريبة", "incl. VAT")} <Money value={expense.vat} />)</span> : null}</div>
                </div>
              </div>
            ) : null}
            {transfer ? <div>{name(transfer.fromId)} → {name(transfer.toId)} · <Money value={transfer.amount} />{transfer.counted != null && transfer.counted !== transfer.amount ? <> · {L("اتعد", "counted")} <Money value={transfer.counted} /></> : null}</div> : null}
            {draft ? <div className="text-muted">{L("قيد يدوي — اتعمل واتوافق عليه من شخصين", "Manual journal — made and approved by two people")}</div> : null}
            {orig ? <button type="button" className="text-start text-primary underline underline-offset-2" onClick={() => onOpen(orig)}>{L("القيد الأصلي", "Original entry")} {entryNo(orig)}</button> : null}
            {revEntry ? <button type="button" className="text-start text-danger underline underline-offset-2" onClick={() => onOpen(revEntry)}>{L("اتعكس بالقيد", "Reversed by")} {entryNo(revEntry)}</button> : null}
            {link[entry.sourceType] ? <Link to={link[entry.sourceType]} className="inline-flex items-center gap-1 text-primary"><ExternalLink className="size-3.5" />{L("افتح الشاشة", "Open screen")}</Link> : null}
          </div>
        </Card>
        {can("accounting.post") && !rev && entry.sourceType !== SOURCE.reversal ? (
          <Card className="grid gap-2 p-4">
            <div className="text-[13px] font-semibold">{L("عكس القيد", "Reverse this entry")}</div>
            <p className="text-[12.5px] text-muted">{L("القيود مابتتعدلش ولا بتتمسح. العكس بيعمل قيد مضاد بتاريخ النهارده (بعد موافقة شخص تاني).", "Entries are never edited or deleted. Reversing posts the mirror entry today (after a second person approves).")}</p>
            <div className="flex flex-wrap gap-2">
              <Input aria-label={L("السبب", "Reason")} placeholder={L("السبب", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} wrapClassName="flex-1 min-w-48" />
              <Button variant="danger-soft" icon={<Undo2 />} onClick={reverse}>{L("اطلب العكس", "Request reversal")}</Button>
            </div>
          </Card>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ───────── manual journal composer ───────── */

type DraftLine = { account: string; debit: string; credit: string };

function ManualJournalDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { chart, settings } = useBooks();
  const [date, setDate] = useState(businessDay());
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }]);
  const [busy, setBusy] = useState(false);
  const parsed = lines.map((l) => ({ account: l.account, debit: parseEgp(l.debit || "0") ?? NaN, credit: parseEgp(l.credit || "0") ?? NaN }));
  const dr = parsed.reduce((a, l) => a + (l.debit || 0), 0);
  const cr = parsed.reduce((a, l) => a + (l.credit || 0), 0);
  const options = [{ value: "", label: L("اختار حساب", "Pick an account") }, ...[...chart.values()].filter((a) => a.active).map((a) => ({ value: a.code, label: `${a.code} · ${a.name[lang]}` }))];
  const set = (i: number, p: Partial<DraftLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const save = async () => {
    setBusy(true);
    try {
      await submitManualJournal(db, { date, memo, lines: parsed.filter((l) => l.account && (l.debit || l.credit)) as JournalLineRow[] });
      toast({ title: L("القيد اتبعت للموافقة", "Journal sent for approval"), tone: "success" });
      setMemo("");
      setLines([{ account: "", debit: "", credit: "" }, { account: "", debit: "", credit: "" }]);
      onClose();
    } catch (e) {
      toast({ title: L("القيد مش مظبوط", "Journal is not valid"), description: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} size="xl" title={L("قيد يدوي", "Manual journal")} description={L(`أي قيد يدوي محتاج موافقة شخص تاني${settings.journalApprovalLimit ? "" : ""}.`, "Every manual journal needs a second person's approval.")} footer={
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <span className={cn("font-mono text-[14px]", dr === cr && dr > 0 ? "text-ok" : "text-danger")} dir="ltr">Dr <Num value={dr} /> · Cr <Num value={cr} /></span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
          <Button loading={busy} disabled={dr !== cr || dr === 0 || !memo.trim()} onClick={save}>{L("ابعت للموافقة", "Send for approval")}</Button>
        </div>
      </div>
    }>
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Input type="date" label={L("التاريخ", "Date")} value={date} onChange={(e) => setDate(e.target.value)} />
          <Textarea label={L("البيان", "Memo")} rows={1} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_110px_auto] items-end gap-2 max-sm:grid-cols-2">
            <Select aria-label={L("الحساب", "Account")} value={l.account} onChange={(e) => set(i, { account: e.target.value })} options={options} className="max-sm:col-span-2" />
            <Input aria-label={L("مدين", "Debit")} placeholder={L("مدين", "Debit")} inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            <Input aria-label={L("دائن", "Credit")} placeholder={L("دائن", "Credit")} inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            <Button variant="ghost" aria-label={L("شيل السطر", "Remove line")} icon={<Trash2 />} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Button variant="soft" size="sm" icon={<Plus />} className="justify-self-start" onClick={() => setLines((ls) => [...ls, { account: "", debit: "", credit: "" }])}>{L("سطر", "Line")}</Button>
      </div>
    </Dialog>
  );
}
