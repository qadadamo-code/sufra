import { lazy } from "react";
import { Receipt } from "lucide-react";
import { defineModule } from "../types";
import { useLive } from "@/data/hooks";

/** Open checks on this branch (badge). */
function useOpenChecks() {
  return useLive("checks", { where: { status: ["open", "bill_requested"] } }).data.length || null;
}

export default defineModule({
  id: "pos",
  status: "ready",
  icon: Receipt,
  title: { ar: "الكاشير", en: "POS" },
  description: { ar: "طلبات الصالة والتيك أواي والدليفري، الدفع، تقسيم الشيك، الوردية والإيصال الإلكتروني", en: "Dine-in, takeaway and delivery orders, payments, split bills, shifts and ETA e-receipts" },
  permission: "pos.use",
  homeFor: ["cashier"],
  shortcut: "g p",
  nav: { path: "/pos", group: "service", order: 10, mobile: true, useBadge: useOpenChecks },
  routes: [{ path: "/pos/*", element: lazy(() => import("./PosPage")) }],
  keywords: ["cashier", "كاشير", "فاتورة", "bill", "shift", "وردية", "z report", "eta", "إيصال"],
});
