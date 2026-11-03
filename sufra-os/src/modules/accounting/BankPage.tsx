/** تسوية البنك — import the bank statement CSV, auto-match to deposits / settlements / payments, manual match, unmatched list. */
import { useMemo, useRef, useState } from "react";
import { Building2, Check, EyeOff, FileUp, Link2, Sparkles, Undo2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { BankStatementLine } from "@/data/accountingTypes";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Input, Money, Segmented, Select, StatTile, Table, useToast, type Column } from "@/ui";
import { ACC } from "./chart";
import { balanceOf } from "./core";
import { bankCandidates, reconSummary } from "./bank";
import { bookLine, ignoreLine, importBankCsv, matchLine, runAutoMatch, unmatchLine } from "./ops";
import { entryNo, srcLabel } from "./JournalPage";
import { useBooks, useMoney } from "./ui";

export default function BankPage() {
  const { L, loc, lang } = useT();
  const { w } = useMoney();
  const db = useDb();
  const { can } = useSession();
  const { toast } = useToast();
  const { entries } = useBooks();
  const banks = useLive("cashAccounts", { where: { kind: "bank" }, orderBy: [{ field: "sort" }] }).data;
  const [bankId, setBankId] = useState("");
  const bank = banks.find((b) => b.id === bankId) ?? banks[0];
  const lines = useLive("bankLines", { where: { cashAccountId: bank?.id ?? "-" }, orderBy: [{ field: "date", dir: "desc" }] }, { enabled: !!bank }).data;
  const [filter, setFilter] = useState<"unmatched" | "matched" | "all">("unmatched");
  const [open, setOpen] = useState<BankStatementLine | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canPost = can("accounting.post");

  const matchedIds = useMemo(() => new Set(lines.map((l) => l.matchedEntryId).filter(Boolean) as string[]), [lines]);
  const candidates = useMemo(() => (bank ? bankCandidates(entries, bank.glCode) : []), [entries, bank]);
  const firstLine = lines.length ? lines[lines.length - 1].date : null;
  const openBook = useMemo(() => candidates.filter((c) => !matchedIds.has(c.id) && firstLine && c.date >= firstLine), [candidates, matchedIds, firstLine]);
  const book = bank ? balanceOf(entries, bank.glCode) : 0;
  const summary = reconSummary(lines, book, openBook.reduce((a, c) => a + c.amount, 0));
  const rows = lines.filter((l) => filter === "all" || (filter === "matched" ? l.status !== "unmatched" : l.status === "unmatched"));
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const cols: Column<BankStatementLine>[] = [
    { key: "d", header: L("التاريخ", "Date"), cell: (l) => <span className="font-mono text-[13px]" dir="ltr">{l.date}</span>, width: "110px" },
    { key: "x", header: L("البيان في كشف البنك", "Bank description"), cell: (l) => <span className="line-clamp-1 font-mono text-[12.5px]" dir="ltr">{l.description}{l.reference ? <span className="text-faint"> · {l.reference}</span> : null}</span> },
    { key: "m", header: L("مطابق مع", "Matched to"), hideOnMobile: true, cell: (l) => {
      const e = l.matchedEntryId ? byId.get(l.matchedEntryId) : null;
      return e ? <span className="text-[13px]">{entryNo(e)} · {srcLabel(e.sourceType, lang)} {l.matchKind === "auto" ? <Badge size="sm" tone="info">{L("آلي", "auto")}</Badge> : null}</span> : l.status === "ignored" ? <Badge size="sm">{L("متجاهل", "Ignored")}</Badge> : <Badge size="sm" tone="warn">{L("مش متطابق", "Unmatched")}</Badge>;
    } },
    { key: "a", header: L("المبلغ", "Amount"), align: "end", cell: (l) => <span className={cn("font-mono", l.amount < 0 ? "text-danger" : "text-ok")}><Money value={l.amount} compact signed /></span> },
  ];

  const auto = async () => {
    if (!bank) return;
    setBusy(true);
    const n = await runAutoMatch(db, bank.id);
    setBusy(false);
    toast({ title: L(`${n} حركة اتطابقت آلياً`, `${n} lines matched automatically`), tone: n ? "success" : "default" });
  };

  if (!bank) return <EmptyState icon={<Building2 />} title={L("مفيش حساب بنكي", "No bank account")} body={L("ضيف حساب بنكي من «الخزنة والعهدة»", "Add one under “Safe & petty”")} />;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {banks.length > 1 ? <Select aria-label={L("الحساب البنكي", "Bank account")} value={bank.id} onChange={(e) => setBankId(e.target.value)} options={banks.map((b) => ({ value: b.id, label: loc(b.name) }))} className="min-w-56" /> : <div className="text-[15px] font-semibold">{loc(bank.name)} <span className="font-mono text-[12.5px] text-muted" dir="ltr">•••• {bank.last4}</span></div>}
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            try {
              const r = await importBankCsv(db, bank.id, await file.text());
              toast({ title: L(`اتقرا ${r.read} سطر — جديد ${r.added}، مكرر ${r.skipped}`, `Read ${r.read} lines — ${r.added} new, ${r.skipped} duplicates`), tone: "success" });
            } catch (err) {
              toast({ title: L("الملف مش مفهوم", "Could not read the file"), description: (err as Error).message, tone: "error" });
            }
          }} />
          {canPost ? <Button variant="outline" icon={<FileUp />} onClick={() => fileRef.current?.click()}>{L("استيراد كشف CSV", "Import CSV statement")}</Button> : null}
          {canPost ? <Button icon={<Sparkles />} loading={busy} onClick={auto}>{L("مطابقة آلية", "Auto-match")}</Button> : null}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatTile index={0} icon={<Building2 />} label={L("رصيد كشف البنك", "Statement balance")} value={summary.statement == null ? "—" : w(summary.statement)} sub={lines[0] ? L(`آخر حركة ${lines[0].date}`, `Last line ${lines[0].date}`) : undefined} />
        <StatTile index={1} icon={<Building2 />} tone="info" label={L("رصيد الدفاتر", "Book balance")} value={w(summary.book)} sub={<span dir="ltr">GL {bank.glCode}</span>} />
        <StatTile index={2} icon={<EyeOff />} tone="warn" label={L("في البنك ومش في الدفاتر", "In bank, not in books")} value={w(summary.unmatchedBank)} sub={L(`${lines.filter((l) => l.status === "unmatched").length} حركة`, `${lines.filter((l) => l.status === "unmatched").length} lines`)} />
        <StatTile index={3} icon={<Link2 />} tone={summary.difference ? "danger" : "ok"} label={L("في الدفاتر ومش في البنك", "In books, not in bank")} value={w(summary.unmatchedBook)} sub={L(`${openBook.length} قيد (شيكات/إيداعات في الطريق)`, `${openBook.length} entries (in transit)`)} />
      </section>

      <Card>
        <CardHeader icon={<Building2 />} title={L("كشف الحساب", "Statement lines")} action={<Segmented size="sm" label={L("فلتر", "Filter")} value={filter} onChange={setFilter} options={[{ value: "unmatched", label: L("مش متطابق", "Unmatched") }, { value: "matched", label: L("متطابق", "Matched") }, { value: "all", label: L("الكل", "All") }]} />} />
        <Table columns={cols} rows={rows} rowKey={(l) => l.id} onRowClick={canPost ? setOpen : undefined} dense empty={<EmptyState compact icon={<Check />} title={L("كله متطابق 👌", "All reconciled")} />} />
        <p className="px-5 py-3 text-[12.5px] text-muted">{L("المطابقة الآلية: نفس المبلغ بالظبط وفرق تاريخ لحد ٣ أيام، كل قيد مرة واحدة. صيغة الملف: التاريخ، البيان، المرجع، مدين/دائن أو المبلغ، الرصيد — عربي أو إنجليزي.", "Auto-match: exact amount within 3 days, each entry used once. File: date, description, reference, debit/credit or amount, balance — Arabic or English headers.")}</p>
      </Card>

      {open ? <MatchDialog line={open} candidates={candidates.filter((c) => !matchedIds.has(c.id) || c.id === open.matchedEntryId)} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function MatchDialog({ line, candidates, onClose }: { line: BankStatementLine; candidates: ReturnType<typeof bankCandidates>; onClose: () => void }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { chart } = useBooks();
  const [account, setAccount] = useState<string>(line.amount < 0 ? ACC.bankCharges : ACC.otherIncome);
  const [memo, setMemo] = useState(line.description);
  const near = candidates
    .map((c) => ({ ...c, gap: Math.abs(Date.parse(c.date) - Date.parse(line.date)) / 86_400_000 }))
    .filter((c) => Math.sign(c.amount) === Math.sign(line.amount) && c.gap <= 20)
    .sort((a, b) => Number(a.amount !== line.amount) - Number(b.amount !== line.amount) || a.gap - b.gap)
    .slice(0, 8);
  const done = (t: string) => {
    toast({ title: t, tone: "success" });
    onClose();
  };
  return (
    <Dialog open onClose={onClose} size="lg" title={L("مطابقة حركة بنك", "Match a bank line")} description={<span className="font-mono" dir="ltr">{line.date} · {line.description} · {(line.amount / 100_000).toFixed(2)}</span>}>
      <div className="grid gap-4">
        {line.status !== "unmatched" ? (
          <Button variant="outline" icon={<Undo2 />} onClick={async () => { await unmatchLine(db, line); done(L("اتلغت المطابقة", "Unmatched")); }}>{L("إلغاء المطابقة", "Undo match")}</Button>
        ) : null}
        <div>
          <div className="mb-2 text-[13px] font-semibold text-muted">{L("قيود قريبة", "Nearby entries")}</div>
          {near.length ? (
            <ul className="grid gap-1.5">
              {near.map((c) => (
                <li key={c.id}>
                  <button type="button" className={cn("flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-start text-[13.5px] hover:bg-surface-2", c.amount === line.amount ? "border-ok/50" : "border-line")} onClick={async () => { await matchLine(db, line, c.id); done(L("اتطابقت", "Matched")); }}>
                    <span className="min-w-0"><span className="font-mono text-[12px] text-muted" dir="ltr">{c.date}</span> · <span className="line-clamp-1 inline">{c.memo}</span></span>
                    <span className={cn("font-mono", c.amount === line.amount ? "text-ok" : "text-muted")}><Money value={c.amount} compact signed /></span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState compact title={L("مفيش قيود قريبة بنفس الاتجاه", "No nearby entries in the same direction")} />}
        </div>
        <Card className="grid gap-2 p-4">
          <div className="text-[13px] font-semibold">{L("مش موجودة في الدفاتر؟ سجّلها", "Not in the books? Book it")}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select aria-label={L("الحساب المقابل", "Counter account")} value={account} onChange={(e) => setAccount(e.target.value)} options={[...chart.values()].filter((a) => a.active && a.code !== ACC.bank).map((a) => ({ value: a.code, label: `${a.code} · ${a.name[lang]}` }))} />
            <Input aria-label={L("البيان", "Memo")} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={async () => {
              try {
                await bookLine(db, line, account, memo);
                done(L("اتسجلت واتطابقت", "Booked and matched"));
              } catch (e) {
                toast({ title: L("ماينفعش", "Not allowed"), description: (e as Error).message, tone: "error" });
              }
            }}>{L("سجّل قيد", "Book entry")}</Button>
            <Button size="sm" variant="ghost" icon={<EyeOff />} onClick={async () => { await ignoreLine(db, line); done(L("اتجاهلت", "Ignored")); }}>{L("تجاهل", "Ignore")}</Button>
          </div>
        </Card>
      </div>
    </Dialog>
  );
}
