import { Users } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "customers",
  status: "soon",
  icon: Users,
  title: { ar: "الزباين", en: "Customers" },
  description: { ar: "ملفات الزباين والزيارات ونقاط الولاء", en: "Guest profiles, visits and loyalty points" },
  permission: "customers.view",
  shortcut: "g c",
  nav: { path: "/customers", group: "manage", order: 20 },
  routes: [{ path: "/customers/*" }],
  features: [
    { ar: "بحث بالموبايل، وتاريخ الزيارات والطلبات", en: "Find by phone; visit and order history" },
    { ar: "نقاط ولاء على كل جنيه", en: "Loyalty points on every pound" },
    { ar: "ملاحظات زي «قهوة مظبوط دايمًا»", en: "Notes like \"always medium-sweet coffee\"" },
  ],
  data: ["customers"],
});
