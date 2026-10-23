import { Settings } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "settings",
  status: "soon",
  icon: Settings,
  title: { ar: "الإعدادات", en: "Settings" },
  description: { ar: "المطعم والفواتير والضرايب والمستخدمين", en: "Restaurant, invoices, tax and users" },
  permission: "settings.view",
  shortcut: "g s",
  nav: { path: "/settings", group: "admin", order: 10 },
  routes: [
    { path: "/settings", title: { ar: "عام", en: "General" } },
    { path: "/settings/invoice", title: { ar: "الفاتورة", en: "Invoice" } },
    { path: "/settings/tax", title: { ar: "الضرايب", en: "Tax" }, permission: "settings.tax" },
    { path: "/settings/users", title: { ar: "المستخدمين", en: "Users" }, permission: "staff.manage" },
  ],
  tabs: [
    { path: "/settings", title: { ar: "عام", en: "General" } },
    { path: "/settings/invoice", title: { ar: "الفاتورة", en: "Invoice" } },
    { path: "/settings/tax", title: { ar: "الضرايب", en: "Tax" } },
    { path: "/settings/users", title: { ar: "المستخدمين", en: "Users" } },
  ],
  features: [
    { ar: "شكل الفاتورة: الهيدر والفوتر واللوجو والـ QR وعرض الورق", en: "Invoice layout: header, footer, logo, QR and paper width" },
    { ar: "ملف الضريبة: ١٤٪ (T1/V009) وخدمة ١٢٪ (T9/SC01) والأسعار شاملة ولا لأ", en: "Tax profile: 14% (T1/V009), 12% service (T9/SC01), inclusive or not" },
    { ar: "حد الخصم اللي محتاج PIN مدير، وقفل الشاشة التلقائي", en: "Discount approval limit and auto-lock time" },
    { ar: "الطابعات والمحطات وطلب الـ QR", en: "Printers, stations and QR ordering" },
  ],
  data: ["settings", "printers", "kitchenStations"],
});
