import { Receipt } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "pos",
  status: "soon",
  icon: Receipt,
  title: { ar: "الكاشير", en: "POS" },
  description: { ar: "طلبات الصالة والتيك أواي والدفع وتقسيم الشيك", en: "Dine-in and takeaway orders, payments and split bills" },
  permission: "pos.use",
  homeFor: ["cashier"],
  shortcut: "g p",
  nav: { path: "/pos", group: "service", order: 10, mobile: true },
  routes: [{ path: "/pos/*" }],
  keywords: ["cashier", "كاشير", "فاتورة", "bill"],
  features: [
    { ar: "منيو بالصور وتعديلات (الحجم، الطبق الجانبي، الشطة) بلمسة واحدة", en: "Photo menu with one-tap modifiers (size, side, spice)" },
    { ar: "دفع كاش وفيزا ومحفظة وإنستاباي، وتقسيم الشيك بالأصناف أو بالتساوي", en: "Cash, card, wallet and InstaPay; split by item or evenly" },
    { ar: "خدمة ١٢٪ وضريبة ١٤٪ محسوبين بالقرش من sufra-finance", en: "12% service and 14% VAT computed to the piastre by sufra-finance" },
    { ar: "خصم فوق الحد أو إلغاء صنف اتبعت للمطبخ = PIN المدير", en: "Discounts over the limit or voids after firing need a manager PIN" },
  ],
  data: ["menuItems", "checks", "payments"],
});
