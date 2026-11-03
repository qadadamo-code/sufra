/** المصروفات — categories, receipt photo, input VAT, paid from cash / bank / on credit, approvals and recurring bills. */
import { useMemo, useRef, useState } from "react";
import { Camera, Check, Plus, Receipt, RefreshCw, Repeat, X } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { Expense, ExpenseCategory, RecurringExpense } from "@/data/accountingTypes";
import { useT } from "@/i18n/i18n";
import { Badge, BarChart, Button, Card, CardHeader, Dialog, EmptyState, Input, Money, Select, Switch, Table, useToast, type Column } from "@/ui";
import { businessDay } from "./core";
import { approveExpense, createExpense, EXPENSE_GL, payAccruedExpense, raiseRecurring, rejectExpense, saveRecurring } from "./ops";
import { EstimateNote, fileToSmallJpeg, parseEgp, PeriodPicker, useMoney, usePeriod } from "./ui";

export const CATEGORY: Record<ExpenseCategory, { ar: string; en: string }> = {
  rent: { ar: "إيجار", en: "Rent" }, electricity: { ar: "كهرباء", en: "Electricity" }, water: { ar: "مياه", en: "Water" }, gas: { ar: "غاز", en: "Gas" }, internet: { ar: "إنترنت وتليفون", en: "Internet & phone" },
  maintenance: { ar: "صيانة", en: "Maintenance" }, cleaning: { ar: "نظافة", en: "Cleaning" }, marketing: { ar: "دعاية وتسويق", en: "Marketing" }, licenses: { ar: "رخص ورسوم", en: "Licences & fees" },
  professional: { ar: "أتعاب مهنية", en: "Professional fees" }, software: { ar: "برامج واشتراكات", en: "Software" }, transport: { ar: "انتقالات", en: "Transport" }, bank: { ar: "مصاريف بنكية", en: "Bank charges" },
  supplies: { ar: "مستلزمات تشغيل", en: "Supplies" }, staff_meals: { ar: "وجبات العاملين", en: "Staff meals" }, other: { ar: "أخرى", en: "Other" },
};
const CATS = Object.keys(CATEGORY) as ExpenseCategory[];

export default function ExpensesPage() {
  const { L, loc, lang } = useT();
  const { w } = useMoney();
  const db = useDb();
  const { staff, role, can } = useSession();
  const { toast } = useToast();
  const [period, setPeriod] = usePeriod("month");
  const [cat, setCat] = useState("");
  const [compose, setCompose] = useState(false);
  const [open, setOpen] = useState<Expense | null>(null);
  const [editRec, setEditRec] = useState<RecurringExpense | "new" | null>(null);
  const all = useLive("expenses", { orderBy: [{ field: "date", dir: "desc" }] }).data;
  const accounts = useLive("cashAccounts", { orderBy: [{ field: "sort" }] }).data;
  const recurring = useLive("recurringExpenses").data;
  const members = useLive("memberships").data;
  const canPost = can("accounting.post");
  const accName = (id: string | null) => (id ? loc(accounts.find((a) => a.id === id)?.name ?? { ar: "—", en: "—" }) : L("آجل (على الحساب)", "On credit"));

  const rows = useMemo(() => all.filter((e) => e.date >= period.from && e.date <= period.to && (!cat || e.category === cat) && e.status !== "rejected"), [all, period, cat]);
  const pending = all.filter((e) => e.status === "pending");
  const posted = rows.filter((e) => e.status === "posted");
  const byCat = useMemo(() => {
    const m = new Map<ExpenseCategory, number>();
    for (const e of posted) m.set(e.category, (m.get(e.category) ?? 0) + e.net);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [posted]);
  const total = posted.reduce((a, e) => a + e.total, 0);
  const vat = posted.reduce((a, e) => a + e.vat, 0);
  const due = recurring.filter((r) => r.active && (!r.lastRaisedFor || r.lastRaisedFor < businessDay().slice(0, 7)) && r.dayOfMonth <= Number(businessDay().slice(8))).length;

  const decide = async (e: Expense, ok: boolean) => {
    try {
      if (ok) await approveExpense(db, e, { id: staff?.id ?? null, role });
      else await rejectExpense(db, e);
      toast({ title: ok ? L("المصروف اتسجل في الدفاتر", "Expense posted") : L("المصروف اترفض", "Expense rejected"), tone: ok ? "success" : "default" });
      setOpen(null);
    } catch (err) {
      toast({ title: L("ماينفعش", "Not allowed"), description: (err as Error).message, tone: "error" });
    }
  };

  const cols: Column<Expense>[] = [
    { key: "d", header: L("التاريخ", "Date"), cell: (e) => <span className="font-mono text-[13px]" dir="ltr">{e.date}</span>, width: "110px" },
    { key: "c", header: L("البند", "Category"), cell: (e) => <Badge size="sm" tone="brass">{loc(CATEGORY[e.category])}</Badge> },
    { key: "v", header: L("البيان", "Description"), cell: (e) => (
      <span className="flex min-w-0 items-center gap-2">
        {e.receiptPhoto ? <Camera className="size-3.5 shrink-0 text-muted" aria-label={L("فيه صورة", "Has photo")} /> : null}
        <span className="line-clamp-1">{e.description} <span className="text-muted">· {e.vendor}</span></span>
      </span>
    ) },
    { key: "p", header: L("اتدفع من", "Paid from"), hideOnMobile: true, cell: (e) => <span className="text-[13px] text-ink-2">{accName(e.paidFromId)}</span> },
    { key: "s", header: L("الحالة", "Status"), cell: (e) => <Badge size="sm" tone={e.status === "posted" ? "ok" : e.status === "pending" ? "warn" : "neutral"}>{e.status === "posted" ? L("مترحّل", "Posted") : e.status === "pending" ? L("مستني موافقة", "Pending") : L("مرفوض", "Rejected")}</Badge> },
    { key: "t", header: L("المبلغ", "Amount"), align: "end", cell: (e) => <Money value={e.total} compact /> },
  ];

  return (
    <div className="grid gap-5">
      {pending.length ? (
        <Card className="border-warn/40">
          <CardHeader icon={<Check />} title={L("مصروفات مستنية موافقة", "Expenses waiting for approval")} />
          <ul className="grid gap-2 px-5 pb-5">
            {pending.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
                {e.receiptPhoto ? <img src={e.receiptPhoto} alt={L("صورة الفاتورة", "Receipt photo")} className="h-14 w-11 rounded-md border border-line object-cover" /> : <Receipt className="size-5 text-muted" />}
                <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setOpen(e)}>
                  <div className="font-semibold">{e.description}</div>
                  <div className="text-[12.5px] text-muted">{e.vendor} · {loc(CATEGORY[e.category])} · {accName(e.paidFromId)} · {members.find((m) => m.id === e.createdBy)?.name ?? ""}</div>
                </button>
                <Money value={e.total} className="font-mono font-semibold" />
                {canPost ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" icon={<X />} onClick={() => decide(e, false)}>{L("رفض", "Reject")}</Button>
                    <Button size="sm" icon={<Check />} onClick={() => decide(e, true)}>{L("موافقة", "Approve")}</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={<Receipt />} title={L("المصروفات", "Expenses")} subtitle={L(`${posted.length} مصروف · ${w(total)} · ضريبة مدخلات ${w(vat)}`, `${posted.length} expenses · ${w(total)} · input VAT ${w(vat)}`)} action={<Button size="sm" icon={<Plus />} onClick={() => setCompose(true)}>{L("مصروف جديد", "New expense")}</Button>} />
          <div className="flex flex-wrap items-end gap-2 px-5 pb-4">
            <PeriodPicker value={period} onChange={setPeriod} />
            <Select aria-label={L("البند", "Category")} value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: "", label: L("كل البنود", "All categories") }, ...CATS.map((c) => ({ value: c, label: loc(CATEGORY[c]) }))]} className="min-w-40" />
          </div>
          <Table columns={cols} rows={rows.slice(0, 80)} rowKey={(e) => e.id} onRowClick={setOpen} dense empty={<EmptyState compact title={L("مفيش مصروفات", "No expenses")} />} />
        </Card>
        <Card>
          <CardHeader title={L("حسب البند", "By category")} />
          <div className="px-5 pb-5">
            {byCat.length ? (
              <BarChart data={byCat.slice(0, 8).map(([c, v]) => ({ key: c, label: loc(CATEGORY[c]).slice(0, 6), value: v, tip: `${loc(CATEGORY[c])} · ${w(v)}` }))} height={170} ariaLabel={L("المصروفات حسب البند", "Expenses by category")} />
            ) : <EmptyState compact title="—" />}
            <ul className="mt-3 grid gap-1.5 text-[13.5px]">
              {byCat.map(([c, v]) => (
                <li key={c} className="flex justify-between"><span>{loc(CATEGORY[c])}</span><Money value={v} whole className="font-mono" /></li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader icon={<Repeat />} title={L("مصروفات ثابتة شهرية", "Recurring expenses")} subtitle={L("بتتعمل لوحدها كل شهر في يومها وتستنى موافقتك", "Raised automatically on their day each month, waiting for approval")} action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" icon={<RefreshCw />} disabled={!due} onClick={async () => {
              const n = await raiseRecurring(db);
              toast({ title: L(`${n.length} مصروف اتعمل`, `${n.length} expenses raised`), tone: "success" });
            }}>{L(`اعمل المستحق (${due})`, `Raise due (${due})`)}</Button>
            {canPost ? <Button size="sm" variant="soft" icon={<Plus />} onClick={() => setEditRec("new")}>{L("إضافة", "Add")}</Button> : null}
          </div>
        } />
        <Table dense rows={recurring} rowKey={(r) => r.id} onRowClick={canPost ? setEditRec : undefined} columns={[
          { key: "d", header: L("يوم", "Day"), cell: (r) => <span className="font-mono">{r.dayOfMonth}</span>, width: "70px" },
          { key: "n", header: L("البيان", "Description"), cell: (r) => <span>{r.description} <span className="text-muted">· {r.vendor}</span></span> },
          { key: "c", header: L("البند", "Category"), hideOnMobile: true, cell: (r) => loc(CATEGORY[r.category]) },
          { key: "f", header: L("من", "From"), hideOnMobile: true, cell: (r) => accName(r.paidFromId) },
          { key: "a", header: L("المبلغ", "Amount"), align: "end", cell: (r) => <span className={r.active ? "" : "text-faint line-through"}><Money value={r.net + r.vat} compact /></span> },
        ]} />
      </Card>

      <ExpenseDialog open={compose} onClose={() => setCompose(false)} />
      <ExpenseDetail expense={open} onClose={() => setOpen(null)} onDecide={decide} canPost={canPost} accName={accName} />
      {editRec ? <RecurringDialog row={editRec === "new" ? null : editRec} onClose={() => setEditRec(null)} /> : null}
      <EstimateNote>{L("ضريبة المدخلات بتتخصم بس لو الفاتورة ضريبية سليمة ومسجلة على منظومة الفاتورة الإلكترونية", "Input VAT is deductible only on a valid e-invoice registered with ETA")}</EstimateNote>
      <span className="hidden">{lang}</span>
    </div>
  );
}

function ExpenseDetail({ expense: e, onClose, onDecide, canPost, accName }: { expense: Expense | null; onClose: () => void; onDecide: (e: Expense, ok: boolean) => void; canPost: boolean; accName: (id: string | null) => string }) {
  const { L, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const accounts = useLive("cashAccounts", { where: { active: true } }).data;
  const [payFrom, setPayFrom] = useState("");
  if (!e) return <Dialog open={false} onClose={onClose} />;
  return (
    <Dialog open onClose={onClose} variant="sheet-end" title={e.description} description={`${e.vendor} · ${loc(CATEGORY[e.category])}`} footer={e.status === "pending" && canPost ? (
      <div className="flex w-full justify-end gap-2">
        <Button variant="ghost" icon={<X />} onClick={() => onDecide(e, false)}>{L("رفض", "Reject")}</Button>
        <Button icon={<Check />} onClick={() => onDecide(e, true)}>{L("موافقة وترحيل", "Approve & post")}</Button>
      </div>
    ) : undefined}>
      <div className="grid gap-3 text-[14px]">
        {e.receiptPhoto ? <img src={e.receiptPhoto} alt={L("صورة الفاتورة", "Receipt photo")} className="max-h-80 w-full rounded-xl border border-line object-contain bg-surface-2" /> : <div className="rounded-xl border border-dashed border-line p-6 text-center text-muted">{L("مفيش صورة فاتورة", "No receipt photo")}</div>}
        <div className="grid grid-cols-2 gap-2">
          <div><div className="text-[12px] text-muted">{L("التاريخ", "Date")}</div><span dir="ltr">{e.date}</span></div>
          <div><div className="text-[12px] text-muted">{L("رقم الفاتورة", "Invoice no.")}</div>{e.invoiceNo || "—"}</div>
          <div><div className="text-[12px] text-muted">{L("الصافي", "Net")}</div><Money value={e.net} /></div>
          <div><div className="text-[12px] text-muted">{L("ضريبة مدخلات", "Input VAT")}</div><Money value={e.vat} /></div>
          <div><div className="text-[12px] text-muted">{L("الإجمالي", "Total")}</div><b><Money value={e.total} /></b></div>
          <div><div className="text-[12px] text-muted">{L("اتدفع من", "Paid from")}</div>{accName(e.paidFromId)}</div>
          <div><div className="text-[12px] text-muted">{L("الحساب", "GL account")}</div><span className="font-mono" dir="ltr">{e.glCode}</span></div>
          {e.dueDate ? <div><div className="text-[12px] text-muted">{L("ميعاد السداد", "Due")}</div><span dir="ltr">{e.dueDate}</span></div> : null}
        </div>
        {e.status === "posted" && !e.paidFromId && canPost ? (
          <Card className="grid gap-2 p-3">
            <div className="text-[13px] font-semibold">{L("سداد المصروف الآجل", "Pay this accrued expense")}</div>
            <div className="flex gap-2">
              <Select aria-label={L("من", "From")} value={payFrom} onChange={(x) => setPayFrom(x.target.value)} options={[{ value: "", label: L("اختار", "Choose") }, ...accounts.filter((a) => a.kind !== "provider").map((a) => ({ value: a.id, label: loc(a.name) }))]} className="min-w-44" />
              <Button disabled={!payFrom} onClick={async () => {
                await payAccruedExpense(db, e, payFrom);
                toast({ title: L("اتسدد", "Paid"), tone: "success" });
                onClose();
              }}>{L("سداد", "Pay")}</Button>
            </div>
          </Card>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ExpenseDialog({ open, onClose, defaults }: { open: boolean; onClose: () => void; defaults?: Partial<{ category: ExpenseCategory; paidFromId: string }> }) {
  const { L, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const accounts = useLive("cashAccounts", { where: { active: true }, orderBy: [{ field: "sort" }] }).data;
  const [f, setF] = useState({ date: businessDay(), category: defaults?.category ?? ("supplies" as ExpenseCategory), vendor: "", description: "", invoiceNo: "", amount: "", withVat: false, vat: "", paidFromId: defaults?.paidFromId ?? "", dueDate: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const gross = parseEgp(f.amount || "");
  const vatAuto = gross != null && f.withVat ? Math.round((gross * 14) / 114 / 1000) * 1000 : 0;
  const vatAmt = f.withVat ? (f.vat ? (parseEgp(f.vat) ?? vatAuto) : vatAuto) : 0;
  const save = async () => {
    if (gross == null || gross <= 0 || !f.description.trim()) return;
    setBusy(true);
    try {
      await createExpense(db, { date: f.date, category: f.category, vendor: f.vendor, description: f.description, invoiceNo: f.invoiceNo, net: gross - vatAmt, vat: vatAmt, paidFromId: f.paidFromId || null, dueDate: f.paidFromId ? null : f.dueDate || null, receiptPhoto: photo });
      toast({ title: L("المصروف اتسجل ومستني الموافقة", "Expense saved — waiting for approval"), tone: "success" });
      setF({ ...f, vendor: "", description: "", invoiceNo: "", amount: "", vat: "" });
      setPhoto(null);
      onClose();
    } catch (e) {
      toast({ title: L("ماتسجلش", "Not saved"), description: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={L("مصروف جديد", "New expense")} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
        <Button loading={busy} disabled={gross == null || gross <= 0 || !f.description.trim()} onClick={save}>{L("حفظ", "Save")}</Button>
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={L("البند", "Category")} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })} options={CATS.map((c) => ({ value: c, label: loc(CATEGORY[c]) }))} />
        <Input type="date" label={L("التاريخ", "Date")} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Input label={L("البيان", "Description")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="sm:col-span-2" />
        <Input label={L("المورد / الجهة", "Vendor")} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
        <Input label={L("رقم الفاتورة", "Invoice no.")} value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} />
        <Input label={L("المبلغ الإجمالي (ج.م)", "Total amount (EGP)")} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={f.amount && gross == null ? L("رقم مش مظبوط", "Not a valid amount") : undefined} />
        <Select label={L("اتدفع من", "Paid from")} value={f.paidFromId} onChange={(e) => setF({ ...f, paidFromId: e.target.value })} options={[{ value: "", label: L("آجل — هيتدفع بعدين", "On credit — pay later") }, ...accounts.filter((a) => a.kind !== "provider").map((a) => ({ value: a.id, label: loc(a.name) }))]} />
        {!f.paidFromId ? <Input type="date" label={L("ميعاد السداد", "Due date")} value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /> : null}
        <div className="sm:col-span-2">
          <Switch checked={f.withVat} onChange={(v) => setF({ ...f, withVat: v })} label={L("فاتورة ضريبية (فيها ١٤٪ قيمة مضافة)", "Tax invoice (includes 14% VAT)")} description={f.withVat ? L(`ضريبة المدخلات: ${(vatAmt / 100_000).toFixed(2)} ج.م — تتخصم في الإقرار`, `Input VAT: EGP ${(vatAmt / 100_000).toFixed(2)} — deductible on the return`) : undefined} />
        </div>
        {f.withVat ? <Input label={L("الضريبة (لو مختلفة)", "VAT (if different)")} inputMode="decimal" value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} /> : null}
        <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) setPhoto(await fileToSmallJpeg(file).catch(() => null));
          }} />
          <Button variant="outline" icon={<Camera />} onClick={() => fileRef.current?.click()}>{photo ? L("غيّر الصورة", "Change photo") : L("صوّر الفاتورة", "Photo of receipt")}</Button>
          {photo ? <img src={photo} alt={L("صورة الفاتورة", "Receipt photo")} className="h-16 w-12 rounded-md border border-line object-cover" /> : null}
          <span className="text-[12px] text-muted">{L(`الحساب: ${EXPENSE_GL[f.category]}`, `GL: ${EXPENSE_GL[f.category]}`)}</span>
        </div>
      </div>
    </Dialog>
  );
}

function RecurringDialog({ row, onClose }: { row: RecurringExpense | null; onClose: () => void }) {
  const { L, loc } = useT();
  const db = useDb();
  const accounts = useLive("cashAccounts", { where: { active: true } }).data;
  const [f, setF] = useState({
    category: row?.category ?? ("rent" as ExpenseCategory), vendor: row?.vendor ?? "", description: row?.description ?? "", amount: row ? ((row.net + row.vat) / 100_000).toFixed(2) : "", withVat: !!row?.vat,
    dayOfMonth: String(row?.dayOfMonth ?? 1), paidFromId: row?.paidFromId ?? "", active: row?.active ?? true,
  });
  const gross = parseEgp(f.amount);
  const vat = gross && f.withVat ? Math.round((gross * 14) / 114 / 1000) * 1000 : 0;
  return (
    <Dialog open onClose={onClose} title={row ? L("تعديل مصروف ثابت", "Edit recurring expense") : L("مصروف ثابت جديد", "New recurring expense")} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
        <Button disabled={!gross || !f.description} onClick={async () => {
          await saveRecurring(db, { id: row?.id, branchId: row?.branchId ?? db.branchId, category: f.category, glCode: EXPENSE_GL[f.category], vendor: f.vendor, description: f.description, net: gross! - vat, vat, dayOfMonth: Math.max(1, Math.min(31, Number(f.dayOfMonth) || 1)), paidFromId: f.paidFromId || null, active: f.active, lastRaisedFor: row?.lastRaisedFor ?? null });
          onClose();
        }}>{L("حفظ", "Save")}</Button>
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={L("البند", "Category")} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })} options={CATS.map((c) => ({ value: c, label: loc(CATEGORY[c]) }))} />
        <Input label={L("يوم في الشهر", "Day of month")} inputMode="numeric" value={f.dayOfMonth} onChange={(e) => setF({ ...f, dayOfMonth: e.target.value })} />
        <Input label={L("البيان", "Description")} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <Input label={L("الجهة", "Vendor")} value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} />
        <Input label={L("المبلغ (ج.م)", "Amount (EGP)")} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <Select label={L("بيتدفع من", "Paid from")} value={f.paidFromId} onChange={(e) => setF({ ...f, paidFromId: e.target.value })} options={[{ value: "", label: L("آجل", "On credit") }, ...accounts.filter((a) => a.kind !== "provider").map((a) => ({ value: a.id, label: loc(a.name) }))]} />
        <Switch checked={f.withVat} onChange={(v) => setF({ ...f, withVat: v })} label={L("فيه ١٤٪ ضريبة", "Includes 14% VAT")} />
        <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={L("شغّال", "Active")} />
      </div>
    </Dialog>
  );
}
