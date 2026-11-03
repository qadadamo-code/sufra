/** الخزنة والعهدة — drawer → safe → bank transfers with counts and approvals, petty cash, places money is kept. */
import { useMemo, useState } from "react";
import { ArrowLeftRight, Check, PiggyBank, Plus, Settings2, Vault, X } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { CashAccount, CashTransfer } from "@/data/accountingTypes";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Input, Meter, Money, Select, Switch, Table, useToast, type Column } from "@/ui";
import { ACC } from "./chart";
import { businessDay } from "./core";
import { approveTransfer, rejectTransfer, requestTransfer, saveCashAccount } from "./ops";
import { cashPosition } from "./treasury";
import { ExpenseDialog } from "./ExpensesPage";
import { KIND_ICON } from "./CashPage";
import { parseEgp, useBooks, useMoney } from "./ui";

const NOTES = [200, 100, 50, 20, 10, 5, 1] as const;

export default function TreasuryPage() {
  const { L, loc } = useT();
  const { w } = useMoney();
  const db = useDb();
  const { staff, role, can } = useSession();
  const { toast } = useToast();
  const { entries } = useBooks();
  const accounts = useLive("cashAccounts", { orderBy: [{ field: "sort" }] }).data;
  const transfers = useLive("cashTransfers", { orderBy: [{ field: "date", dir: "desc" }] }).data;
  const members = useLive("memberships").data;
  const pettyExp = useLive("expenses", { orderBy: [{ field: "date", dir: "desc" }], limit: 400 }).data;
  const [compose, setCompose] = useState(false);
  const [count, setCount] = useState<CashTransfer | null>(null);
  const [edit, setEdit] = useState<CashAccount | "new" | null>(null);
  const [petty, setPetty] = useState(false);
  const position = useMemo(() => cashPosition(accounts, entries), [accounts, entries]);
  const bal = (id: string) => position.rows.find((r) => r.account.id === id)?.balance ?? 0;
  const name = (id: string) => loc(accounts.find((a) => a.id === id)?.name ?? { ar: "—", en: "—" });
  const pending = transfers.filter((t) => t.status === "pending");
  const pettyAcc = accounts.find((a) => a.kind === "petty");
  const pettyRecent = pettyAcc ? pettyExp.filter((e) => e.paidFromId === pettyAcc.id && e.status !== "rejected").slice(0, 8) : [];

  const cols: Column<CashTransfer>[] = [
    { key: "d", header: L("التاريخ", "Date"), cell: (t) => <span className="font-mono text-[13px]" dir="ltr">{t.date}</span>, width: "110px" },
    { key: "f", header: L("من → إلى", "From → to"), cell: (t) => <span>{name(t.fromId)} <span className="text-muted">→</span> {name(t.toId)}</span> },
    { key: "n", header: L("ملاحظة", "Note"), hideOnMobile: true, cell: (t) => <span className="text-[13px] text-muted">{t.note || t.reference}</span> },
    { key: "s", header: L("الحالة", "Status"), cell: (t) => <Badge size="sm" tone={t.status === "posted" ? "ok" : t.status === "pending" ? "warn" : "neutral"}>{t.status === "posted" ? L("اتسجل", "Posted") : t.status === "pending" ? L("مستني", "Pending") : L("مرفوض", "Rejected")}</Badge> },
    { key: "a", header: L("المبلغ", "Amount"), align: "end", cell: (t) => (
      <span className="font-mono">
        <Money value={t.amount} compact />
        {t.counted != null && t.counted !== t.amount ? <span className={cn("ms-1 text-[12px]", t.counted < t.amount ? "text-danger" : "text-ok")}>({t.counted < t.amount ? "−" : "+"}{w(Math.abs(t.counted - t.amount))})</span> : null}
      </span>
    ) },
  ];

  return (
    <div className="grid gap-5">
      {pending.length ? (
        <Card className="border-warn/40">
          <CardHeader icon={<Check />} title={L("تحويلات مستنية استلام وعد", "Transfers waiting to be counted")} subtitle={L("اللي بيستلم يعد ويأكد — الفرق بيتسجل عجز/زيادة", "The receiving side counts and confirms — any gap posts as over/short")} />
          <ul className="grid gap-2 px-5 pb-5">
            {pending.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
                <ArrowLeftRight className="size-5 text-muted" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{name(t.fromId)} → {name(t.toId)}</div>
                  <div className="text-[12.5px] text-muted">{t.note} · {members.find((m) => m.id === t.requestedBy)?.name ?? ""} · <span dir="ltr">{t.date}</span></div>
                </div>
                <Money value={t.amount} className="font-mono font-semibold" />
                {can("accounting.post") || role === "manager" ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" icon={<X />} onClick={async () => { await rejectTransfer(db, t, L("مرفوض", "rejected")); }}>{L("رفض", "Reject")}</Button>
                    <Button size="sm" icon={<Check />} onClick={() => setCount(t)}>{L("عد واستلام", "Count & accept")}</Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={<ArrowLeftRight />} title={L("حركة النقدية", "Cash movements")} subtitle={L("الدرج → الخزنة → البنك، وتعويض العهدة", "Till → safe → bank, petty cash top-ups")} action={<Button size="sm" icon={<Plus />} onClick={() => setCompose(true)}>{L("تحويل جديد", "New transfer")}</Button>} />
          <Table columns={cols} rows={transfers.slice(0, 120)} rowKey={(t) => t.id} dense empty={<EmptyState compact title={L("مفيش تحويلات", "No transfers")} />} />
        </Card>
        <div className="grid content-start gap-4">
          {pettyAcc ? (
            <Card>
              <CardHeader icon={<PiggyBank />} title={L("العهدة النثرية", "Petty cash")} action={<Button size="sm" variant="soft" icon={<Plus />} onClick={() => setPetty(true)}>{L("مصروف", "Spend")}</Button>} />
              <div className="px-5 pb-4">
                <div className="font-mono text-[24px] font-semibold" dir="ltr"><Money value={bal(pettyAcc.id)} /></div>
                {pettyAcc.limit ? <Meter className="mt-2" value={Math.max(0, bal(pettyAcc.id))} max={pettyAcc.limit} label={L(`العهدة ${w(pettyAcc.limit)} — التعويض بيرجعها لكامل المبلغ`, `Imprest ${w(pettyAcc.limit)} — top-ups restore it`)} /> : null}
                <ul className="mt-3 divide-y divide-line text-[13.5px]">
                  {pettyRecent.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="min-w-0 truncate">{e.description}{e.status === "pending" ? <Badge size="sm" tone="warn" className="ms-1">{L("مستني", "pending")}</Badge> : null}</span>
                      <Money value={e.total} compact className="font-mono" />
                    </li>
                  ))}
                </ul>
                {pettyAcc.limit && bal(pettyAcc.id) < pettyAcc.limit ? (
                  <Button size="sm" variant="outline" className="mt-3" onClick={async () => {
                    const safe = accounts.find((a) => a.kind === "safe");
                    if (!safe) return;
                    await requestTransfer(db, { fromId: safe.id, toId: pettyAcc.id, amount: pettyAcc.limit! - bal(pettyAcc.id), note: L("تعويض العهدة", "Petty cash top-up") });
                    toast({ title: L("طلب التعويض اتعمل", "Top-up requested"), tone: "success" });
                  }}>{L(`عوّض ${w(pettyAcc.limit - bal(pettyAcc.id))} من الخزنة`, `Top up ${w(pettyAcc.limit - bal(pettyAcc.id))} from the safe`)}</Button>
                ) : null}
              </div>
            </Card>
          ) : null}
          <Card>
            <CardHeader icon={<Vault />} title={L("أماكن الفلوس", "Where money is kept")} action={can("accounting.post") ? <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setEdit("new")}>{L("إضافة", "Add")}</Button> : null} />
            <ul className="divide-y divide-line px-5 pb-3">
              {accounts.map((a) => {
                const Icon = KIND_ICON[a.kind];
                return (
                  <li key={a.id} className={cn("flex items-center gap-3 py-2.5", !a.active && "opacity-50")}>
                    <Icon className="size-4 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{loc(a.name)} <span className="font-mono text-[11.5px] text-faint" dir="ltr">{a.glCode}</span></span>
                    <Money value={bal(a.id)} whole className="font-mono text-[13.5px]" />
                    {can("accounting.post") ? <Button size="sm" variant="ghost" aria-label={L("تعديل", "Edit")} icon={<Settings2 />} onClick={() => setEdit(a)} /> : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <TransferDialog open={compose} onClose={() => setCompose(false)} accounts={accounts} balance={bal} />
      {count ? <CountDialog t={count} onClose={() => setCount(null)} onDone={async (c) => {
        try {
          await approveTransfer(db, count, { id: staff?.id ?? null, role }, c);
          toast({ title: L("اتسجل في الدفاتر", "Posted"), tone: "success" });
          setCount(null);
        } catch (e) {
          toast({ title: L("ماينفعش", "Not allowed"), description: (e as Error).message, tone: "error" });
        }
      }} /> : null}
      {edit ? <CashAccountDialog row={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
      <ExpenseDialog open={petty} onClose={() => setPetty(false)} defaults={{ category: "supplies", paidFromId: pettyAcc?.id }} />
    </div>
  );
}

function Denominations({ value, onChange }: { value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const { L } = useT();
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {NOTES.map((n) => (
        <Input key={n} label={`${n}`} inputMode="numeric" aria-label={L(`عدد ورق ${n}`, `Count of ${n} notes`)} value={value[n] ? String(value[n]) : ""} onChange={(e) => onChange({ ...value, [n]: Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0) })} />
      ))}
    </div>
  );
}
const denomTotal = (d: Record<string, number>) => Object.entries(d).reduce((a, [k, v]) => a + Number(k) * v * 100_000, 0);

function TransferDialog({ open, onClose, accounts, balance }: { open: boolean; onClose: () => void; accounts: CashAccount[]; balance: (id: string) => number }) {
  const { L, loc } = useT();
  const { w } = useMoney();
  const db = useDb();
  const { toast } = useToast();
  const usable = accounts.filter((a) => a.active);
  const [f, setF] = useState({ fromId: usable.find((a) => a.kind === "drawer")?.id ?? "", toId: usable.find((a) => a.kind === "safe")?.id ?? "", amount: "", note: "", reference: "", date: businessDay() });
  const [den, setDen] = useState<Record<string, number>>({});
  const [useDen, setUseDen] = useState(false);
  const amount = useDen ? denomTotal(den) : parseEgp(f.amount);
  const from = usable.find((a) => a.id === f.fromId);
  const opts = usable.map((a) => ({ value: a.id, label: `${loc(a.name)} · ${w(balance(a.id))}` }));
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={L("تحويل نقدية", "Cash transfer")} description={L("بيتسجل في الدفاتر بعد ما الطرف التاني يعد ويأكد", "Posts to the books once the receiving side counts and confirms")} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
        <Button disabled={!amount || f.fromId === f.toId} onClick={async () => {
          try {
            await requestTransfer(db, { ...f, amount: amount!, denominations: useDen ? den : null });
            toast({ title: L("التحويل مستني الاستلام", "Transfer waiting to be received"), tone: "success" });
            onClose();
          } catch (e) {
            toast({ title: L("ماينفعش", "Not allowed"), description: (e as Error).message, tone: "error" });
          }
        }}>{L("ابعت", "Send")}</Button>
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={L("من", "From")} value={f.fromId} onChange={(e) => setF({ ...f, fromId: e.target.value })} options={opts} />
        <Select label={L("إلى", "To")} value={f.toId} onChange={(e) => setF({ ...f, toId: e.target.value })} options={opts} />
        <Switch checked={useDen} onChange={setUseDen} label={L("عد بالفئات", "Count by notes")} />
        {useDen ? <div className="sm:col-span-2"><Denominations value={den} onChange={setDen} /><div className="mt-2 font-mono text-[15px]">= <Money value={denomTotal(den)} /></div></div> : <Input label={L("المبلغ (ج.م)", "Amount (EGP)")} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} hint={from ? L(`الرصيد ${w(balance(from.id))}`, `Balance ${w(balance(from.id))}`) : undefined} />}
        <Input type="date" label={L("التاريخ", "Date")} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        <Input label={L("ملاحظة", "Note")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Input label={L("رقم إيصال الإيداع", "Deposit slip no.")} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
      </div>
    </Dialog>
  );
}

function CountDialog({ t, onClose, onDone }: { t: CashTransfer; onClose: () => void; onDone: (counted: number) => void }) {
  const { L } = useT();
  const { w } = useMoney();
  const [v, setV] = useState((t.amount / 100_000).toFixed(2));
  const c = parseEgp(v);
  const diff = c == null ? 0 : c - t.amount;
  return (
    <Dialog open onClose={onClose} size="sm" title={L("عد المبلغ المستلم", "Count what arrived")} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
        <Button disabled={c == null} onClick={() => onDone(c!)}>{L("تأكيد وترحيل", "Confirm & post")}</Button>
      </div>
    }>
      <div className="grid gap-3">
        <div className="text-[14px]">{L("المبلغ المرسل", "Sent")}: <b><Money value={t.amount} /></b></div>
        <Input label={L("المعدود فعلاً (ج.م)", "Actually counted (EGP)")} inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
        {diff ? <Badge tone={diff < 0 ? "danger" : "ok"}>{diff < 0 ? L(`عجز ${w(-diff)}`, `Short ${w(-diff)}`) : L(`زيادة ${w(diff)}`, `Over ${w(diff)}`)}</Badge> : null}
      </div>
    </Dialog>
  );
}

function CashAccountDialog({ row, onClose }: { row: CashAccount | null; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [f, setF] = useState({
    kind: row?.kind ?? ("bank" as CashAccount["kind"]), ar: row?.name.ar ?? "", en: row?.name.en ?? "", glCode: row?.glCode ?? ACC.bank2, institution: row?.institution ?? "", last4: row?.last4 ?? "", limit: row?.limit ? (row.limit / 100_000).toFixed(0) : "", active: row?.active ?? true,
  });
  const GL: Record<CashAccount["kind"], string> = { drawer: ACC.cash, safe: ACC.safe, petty: ACC.pettyCash, bank: ACC.bank2, wallet: ACC.walletClearing, provider: ACC.cardClearing };
  const kinds: { value: CashAccount["kind"]; label: string }[] = [
    { value: "drawer", label: L("درج كاشير", "Till") }, { value: "safe", label: L("خزنة", "Safe") }, { value: "petty", label: L("عهدة نثرية", "Petty cash") }, { value: "bank", label: L("حساب بنكي", "Bank account") },
    { value: "wallet", label: L("محفظة (فودافون كاش / إنستاباي)", "Wallet (Vodafone Cash / InstaPay)") }, { value: "provider", label: L("بوابة دفع / تطبيق", "Gateway / app") },
  ];
  return (
    <Dialog open onClose={onClose} title={row ? L("تعديل", "Edit") : L("مكان جديد للفلوس", "New cash account")} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
        <Button disabled={!f.ar} onClick={async () => {
          try {
            await saveCashAccount(db, { id: row?.id, kind: f.kind, name: { ar: f.ar, en: f.en || f.ar }, glCode: f.glCode, branchId: row?.branchId ?? db.branchId, institution: f.institution, last4: f.last4 || null, limit: f.limit ? Number(f.limit) * 100_000 : null, active: f.active, sort: row?.sort ?? 99 });
            onClose();
          } catch (e) {
            toast({ title: L("ماتحفظش", "Not saved"), description: (e as Error).message, tone: "error" });
          }
        }}>{L("حفظ", "Save")}</Button>
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label={L("النوع", "Kind")} value={f.kind} disabled={!!row} onChange={(e) => { const k = e.target.value as CashAccount["kind"]; setF({ ...f, kind: k, glCode: GL[k] }); }} options={kinds} />
        <Input label={L("كود الحساب في الدليل", "GL code")} value={f.glCode} onChange={(e) => setF({ ...f, glCode: e.target.value.replace(/\D/g, "") })} />
        <Input label={L("الاسم بالعربي", "Name (Arabic)")} value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} />
        <Input label={L("الاسم بالإنجليزي", "Name (English)")} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} />
        <Input label={f.kind === "drawer" ? L("كود الجهاز (POS1)", "Device code (POS1)") : L("البنك / الجهة", "Institution")} value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} />
        <Input label={L("آخر ٤ أرقام بس", "Last 4 digits only")} inputMode="numeric" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
        <Input label={L("الحد (ج.م)", "Limit (EGP)")} inputMode="numeric" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/\D/g, "") })} />
        <Switch checked={f.active} onChange={(v) => setF({ ...f, active: v })} label={L("شغّال", "Active")} />
      </div>
    </Dialog>
  );
}
