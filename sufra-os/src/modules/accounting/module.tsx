import { lazy } from "react";
import { Landmark } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { defineModule } from "../types";

/** live badge: expenses / transfers / manual journals waiting for approval (only for people who can approve) */
function useApprovalsBadge() {
  const { can } = useSession();
  const on = can("accounting.post");
  const a = useLive("expenses", { where: { status: "pending" } }, { enabled: on }).data.length;
  const b = useLive("cashTransfers", { where: { status: "pending" } }, { enabled: on }).data.length;
  const c = useLive("journalDrafts", { where: { status: "pending" } }, { enabled: on }).data.length;
  return on ? a + b + c || null : null;
}

/**
 * Accounting, cash & liquidity (Wave 3): السيولة, journal (drill-down, manual journals with approval, reversals),
 * expenses + recurring, safe / petty cash / transfers, bank reconciliation, VAT return, chart of accounts, period close,
 * export. Other modules post through `./api.ts` (postJournal). Schema: supabase/migrations/0011_accounting.sql.
 */
export default defineModule({
  id: "accounting",
  status: "ready",
  icon: Landmark,
  title: { ar: "الحسابات", en: "Accounting" },
  description: { ar: "السيولة والقيود والمصروفات والبنك والضريبة", en: "Cash, journal, expenses, bank and VAT" },
  permission: "accounting.view",
  homeFor: ["accountant"],
  shortcut: "g a",
  nav: { path: "/accounting", group: "manage", order: 50, useBadge: useApprovalsBadge },
  routes: [{ path: "/accounting/*", element: lazy(() => import("./AccountingPage")) }],
  keywords: ["سيولة", "خزنة", "عهدة", "مصروفات", "قيد", "بنك", "تسوية", "ضريبة", "cash", "safe", "petty", "expense", "journal", "bank", "reconciliation", "vat", "ledger"],
  data: ["ledgerEntries", "expenses", "cashTransfers", "bankLines", "glAccounts"],
});
