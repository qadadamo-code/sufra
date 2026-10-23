import { Landmark } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "accounting",
  status: "soon",
  icon: Landmark,
  title: { ar: "الحسابات", en: "Accounting" },
  description: { ar: "الدفتر والضريبة والإيصالات الإلكترونية", en: "Ledger, VAT and e-receipts" },
  permission: "accounting.view",
  homeFor: ["accountant"],
  shortcut: "g a",
  nav: { path: "/accounting", group: "manage", order: 50 },
  routes: [{ path: "/accounting/*" }],
  features: [
    { ar: "قيد مزدوج لكل بيع ومرتجع ودرج كاش", en: "Double-entry posting for every sale, refund and drawer move" },
    { ar: "إقرار ضريبة القيمة المضافة الشهري", en: "Monthly VAT return" },
    { ar: "إيصالات ETA الإلكترونية وحالتها", en: "ETA e-receipts and their submission status" },
  ],
  data: ["payments", "checks", "auditLog"],
});
