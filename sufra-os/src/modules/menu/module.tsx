import { BookOpen } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "menu",
  status: "soon",
  icon: BookOpen,
  title: { ar: "المنيو", en: "Menu" },
  description: { ar: "الأصناف والأسعار والإضافات والمحطات", en: "Items, prices, modifiers and stations" },
  permission: "menu.edit",
  shortcut: "g m",
  nav: { path: "/menu", group: "manage", order: 10 },
  routes: [{ path: "/menu/*" }],
  features: [
    { ar: "أصناف بالعربي والإنجليزي، صور، وتكلفة لحساب الربح", en: "Bilingual items with photos and cost for margins" },
    { ar: "مجموعات إضافات (إجباري/اختياري، أقل وأكتر عدد)", en: "Modifier groups (required/optional, min/max)" },
    { ar: "كل صنف يروح لمحطته في المطبخ وطابعتها", en: "Each item routes to its kitchen station and printer" },
    { ar: "تعديل السعر يطلع على الكاشير والـ QR في نفس اللحظة", en: "Price changes reach the POS and QR menu instantly" },
  ],
  data: ["menuCategories", "menuItems", "modifierGroups", "modifiers"],
});
