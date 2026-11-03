/**
 * /accounting — the books, owner-friendly first: السيولة (cash & liquidity) is the landing tab; journal, expenses,
 * treasury, bank reconciliation, VAT, chart of accounts, period close and export sit behind tabs.
 */
import { lazy, Suspense, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Building2, FileDown, Landmark, ListTree, Lock, Percent, Receipt, Vault, Wallet } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { PageHeader } from "@/shell/PageHeader";
import { Skeleton, Tabs } from "@/ui";

const CashPage = lazy(() => import("./CashPage"));
const JournalPage = lazy(() => import("./JournalPage"));
const ExpensesPage = lazy(() => import("./ExpensesPage"));
const TreasuryPage = lazy(() => import("./TreasuryPage"));
const BankPage = lazy(() => import("./BankPage"));
const VatPage = lazy(() => import("./VatPage"));
const ChartPage = lazy(() => import("./ChartPage"));
const ClosePage = lazy(() => import("./ClosePage"));
const ExportPage = lazy(() => import("./ExportPage"));

export type AcctTab = "cash" | "journal" | "expenses" | "treasury" | "bank" | "vat" | "chart" | "close" | "export";

export default function AccountingPage() {
  const { L } = useT();
  const loc = useLocation();
  const nav = useNavigate();
  const seg = (loc.pathname.split("/accounting")[1] ?? "").split("/")[1] || "cash";
  const tab = (["cash", "journal", "expenses", "treasury", "bank", "vat", "chart", "close", "export"].includes(seg) ? seg : "cash") as AcctTab;
  const pendingExp = useLive("expenses", { where: { status: "pending" } }).data.length;
  const pendingTr = useLive("cashTransfers", { where: { status: "pending" } }).data.length;
  const pendingJd = useLive("journalDrafts", { where: { status: "pending" } }).data.length;
  const unmatched = useLive("bankLines", { where: { status: "unmatched" } }).data.length;

  const items = useMemo(
    () => [
      { value: "cash" as const, label: L("السيولة", "Cash"), icon: <Wallet /> },
      { value: "journal" as const, label: L("القيود", "Journal"), icon: <BookOpen />, count: pendingJd || undefined },
      { value: "expenses" as const, label: L("المصروفات", "Expenses"), icon: <Receipt />, count: pendingExp || undefined },
      { value: "treasury" as const, label: L("الخزنة والعهدة", "Safe & petty"), icon: <Vault />, count: pendingTr || undefined },
      { value: "bank" as const, label: L("تسوية البنك", "Bank rec"), icon: <Building2 />, count: unmatched || undefined },
      { value: "vat" as const, label: L("القيمة المضافة", "VAT"), icon: <Percent /> },
      { value: "chart" as const, label: L("دليل الحسابات", "Chart"), icon: <ListTree /> },
      { value: "close" as const, label: L("إقفال الفترة", "Period close"), icon: <Lock /> },
      { value: "export" as const, label: L("تصدير", "Export"), icon: <FileDown /> },
    ],
    [L, pendingExp, pendingTr, pendingJd, unmatched],
  );

  return (
    <div className="mx-auto grid max-w-[1400px] gap-5">
      <PageHeader icon={<Landmark />} title={L("الحسابات", "Accounting")} subtitle={L("فلوسك فين، رايحة فين، والدفاتر مظبوطة", "Where the money is, where it's going, and books that balance")} />
      <Tabs value={tab} onChange={(v) => nav(v === "cash" ? "/accounting" : `/accounting/${v}`)} items={items} label={L("أقسام الحسابات", "Accounting sections")} />
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        {tab === "cash" ? <CashPage /> : null}
        {tab === "journal" ? <JournalPage /> : null}
        {tab === "expenses" ? <ExpensesPage /> : null}
        {tab === "treasury" ? <TreasuryPage /> : null}
        {tab === "bank" ? <BankPage /> : null}
        {tab === "vat" ? <VatPage /> : null}
        {tab === "chart" ? <ChartPage /> : null}
        {tab === "close" ? <ClosePage /> : null}
        {tab === "export" ? <ExportPage /> : null}
      </Suspense>
    </div>
  );
}
