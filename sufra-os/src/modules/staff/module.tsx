import { IdCard } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "staff",
  status: "soon",
  icon: IdCard,
  title: { ar: "الموظفين", en: "Staff" },
  description: { ar: "الموظفين والأدوار والـ PIN والمرتبات", en: "Staff, roles, PINs and payroll" },
  permission: "staff.view",
  nav: { path: "/staff", group: "manage", order: 40 },
  routes: [{ path: "/staff/*" }],
  features: [
    { ar: "دعوة موظف بالإيميل أو إضافته بـ PIN بس", en: "Invite by email or add PIN-only staff" },
    { ar: "دور لكل موظف وفروع مسموحله بيها", en: "A role per person and the branches they can use" },
    { ar: "المرتبات ظاهرة للمالك والمحاسب بس", en: "Payroll visible to owner and accountant only" },
  ],
  data: ["memberships", "auditLog"],
});
