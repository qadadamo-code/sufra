/** دليل الحسابات — editable chart (Egyptian restaurant default), balances, cost centres per branch. */
import { useMemo, useState } from "react";
import { ListTree, Lock, Plus, Search } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { GlAccount, GlAccountType, GlGroup } from "@/data/accountingTypes";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Dialog, Input, Money, Select, Switch, useToast } from "@/ui";
import { CHART_HEADERS } from "./chart";
import { balances } from "./core";
import { saveGlAccount } from "./ops";
import { useBooks } from "./ui";

const GROUPS: GlGroup[] = ["cash", "bank", "clearing", "receivable", "inventory", "tax_asset", "prepaid", "fixed_asset", "payable", "tax", "staff_liability", "deposit", "accrued", "equity", "revenue", "other_income", "cogs", "labour", "occupancy", "fees", "opex", "other_expense"];

export default function ChartPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const { entries } = useBooks();
  const rows = useLive("glAccounts", { orderBy: [{ field: "code" }] }).data;
  const centres = useLive("costCentres").data;
  const branches = useLive("branches").data;
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<GlAccount | "new" | null>(null);
  const bal = useMemo(() => balances(entries), [entries]);
  const s = q.trim().toLowerCase();
  const visible = rows.filter((a) => !s || a.code.includes(s) || a.name.ar.includes(q.trim()) || a.name.en.toLowerCase().includes(s));
  const typeLabel: Record<GlAccountType, string> = { asset: L("أصول", "Asset"), liability: L("التزامات", "Liability"), equity: L("حقوق ملكية", "Equity"), revenue: L("إيرادات", "Revenue"), expense: L("مصروفات", "Expense") };

  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader icon={<ListTree />} title={L("دليل الحسابات", "Chart of accounts")} subtitle={L("الأكواد اللي عليها قفل بيستخدمها النظام في القيود التلقائية — تقدر تغير اسمها بس", "Locked codes are used by automatic postings — they can be renamed only")} action={can("accounting.post") ? <Button size="sm" icon={<Plus />} onClick={() => setEdit("new")}>{L("حساب جديد", "New account")}</Button> : null} />
        <div className="px-5 pb-3"><Input aria-label={L("بحث", "Search")} icon={<Search />} placeholder={L("كود أو اسم", "Code or name")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="divide-y divide-line">
          {CHART_HEADERS.filter((h) => !h.parent).map((top) => {
            const subs = CHART_HEADERS.filter((h) => h.parent === top.code);
            const groups = subs.length ? subs : [top];
            return (
              <section key={top.code} className="py-2">
                <h3 className="px-5 py-1.5 text-[13px] font-semibold text-brass">{top.code} · {lang === "ar" ? top.ar : top.en}</h3>
                {groups.map((g) => {
                  const list = visible.filter((a) => (a.parentCode ?? a.code[0]) === g.code || (!subs.length && a.code[0] === top.code));
                  if (!list.length) return null;
                  return (
                    <div key={g.code}>
                      {subs.length ? <div className="px-7 pt-1.5 text-[12.5px] font-semibold text-muted">{g.code} · {lang === "ar" ? g.ar : g.en}</div> : null}
                      <ul>
                        {list.map((a) => {
                          const b = bal.get(a.code)?.balance ?? 0;
                          const shown = a.type === "asset" || a.type === "expense" ? b : -b;
                          return (
                            <li key={a.id}>
                              <button type="button" disabled={!can("accounting.post")} onClick={() => setEdit(a)} className={cn("flex w-full items-center gap-3 px-5 py-2 ps-10 text-start text-[14px] hover:bg-surface-2 disabled:hover:bg-transparent", !a.active && "opacity-50")}>
                                <span className="w-14 shrink-0 font-mono text-[12.5px] text-muted" dir="ltr">{a.code}</span>
                                <span className="min-w-0 flex-1 truncate">{loc(a.name)}</span>
                                {a.system ? <Lock className="size-3.5 text-faint" aria-label={L("حساب نظام", "System account")} /> : null}
                                <Badge size="sm" className="max-sm:hidden">{typeLabel[a.type]}</Badge>
                                <span className="w-32 shrink-0 text-end font-mono text-[13px] tabular-nums"><Money value={shown} compact /></span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </Card>
      <Card>
        <CardHeader title={L("مراكز التكلفة", "Cost centres")} subtitle={L("كل فرع مركز تكلفة؛ القيود بتتحلل حسب الفرع", "Each branch is a cost centre; entries are analysed by branch")} />
        <ul className="divide-y divide-line px-5 pb-3">
          {centres.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2.5 text-[14px]">
              <span><span className="font-mono text-[12.5px] text-muted">{c.code}</span> · {loc(c.name)}</span>
              <span className="text-[13px] text-muted">{c.branchId ? loc(branches.find((b) => b.id === c.branchId)?.name ?? { ar: "", en: "" }) : L("مشترك", "Shared")}</span>
            </li>
          ))}
        </ul>
      </Card>
      {edit ? <AccountDialog row={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function AccountDialog({ row, onClose }: { row: GlAccount | null; onClose: () => void }) {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [f, setF] = useState({ code: row?.code ?? "", ar: row?.name.ar ?? "", en: row?.name.en ?? "", type: row?.type ?? ("expense" as GlAccountType), group: row?.group ?? ("opex" as GlGroup), parentCode: row?.parentCode ?? "65", note: row?.note ?? "", active: row?.active ?? true });
  const sys = !!row?.system;
  return (
    <Dialog open onClose={onClose} title={row ? `${row.code} · ${row.name.ar}` : L("حساب جديد", "New account")} footer={
      <div className="flex w-full justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{L("إلغاء", "Cancel")}</Button>
        <Button disabled={!f.code || !f.ar} onClick={async () => {
          try {
            await saveGlAccount(db, { id: row?.id, code: f.code, name: { ar: f.ar, en: f.en || f.ar }, type: f.type, group: f.group, parentCode: f.parentCode || null, note: f.note, active: f.active });
            onClose();
          } catch (e) {
            toast({ title: L("ماتحفظش", "Not saved"), description: (e as Error).message, tone: "error" });
          }
        }}>{L("حفظ", "Save")}</Button>
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={L("الكود", "Code")} inputMode="numeric" disabled={sys} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.replace(/\D/g, "") })} />
        <Select label={L("النوع", "Type")} disabled={sys} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as GlAccountType })} options={["asset", "liability", "equity", "revenue", "expense"].map((t) => ({ value: t, label: t }))} />
        <Input label={L("الاسم بالعربي", "Arabic name")} value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} />
        <Input label={L("الاسم بالإنجليزي", "English name")} value={f.en} onChange={(e) => setF({ ...f, en: e.target.value })} />
        <Select label={L("مجموعة التقارير", "Report group")} value={f.group} onChange={(e) => setF({ ...f, group: e.target.value as GlGroup })} options={GROUPS.map((g) => ({ value: g, label: g }))} />
        <Select label={L("تحت", "Parent")} value={f.parentCode} onChange={(e) => setF({ ...f, parentCode: e.target.value })} options={CHART_HEADERS.map((h) => ({ value: h.code, label: `${h.code} · ${h.ar}` }))} />
        <Input label={L("ملاحظة", "Note")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className="sm:col-span-2" />
        <Switch checked={f.active} disabled={sys} onChange={(v) => setF({ ...f, active: v })} label={L("شغّال", "Active")} description={sys ? L("حساب نظام — مايتقفلش", "System account — cannot be deactivated") : undefined} />
      </div>
    </Dialog>
  );
}
