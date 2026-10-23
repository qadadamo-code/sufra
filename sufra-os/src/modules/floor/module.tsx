import { LayoutGrid } from "lucide-react";
import { defineModule } from "../types";
import { useOpenCalls } from "../badges";

export default defineModule({
  id: "floor",
  status: "soon",
  icon: LayoutGrid,
  title: { ar: "الصالة", en: "Floor" },
  description: { ar: "خريطة الترابيزات، الحجوزات، ودمج وفصل الشيكات", en: "Table map, reservations, merging and splitting checks" },
  permission: "floor.view",
  homeFor: ["manager"],
  shortcut: "g f",
  nav: { path: "/floor", group: "service", order: 20, mobile: true, useBadge: useOpenCalls },
  routes: [{ path: "/floor/*" }],
  keywords: ["tables", "ترابيزات", "map"],
  features: [
    { ar: "خريطة حقيقية للصالة والتراس بالسنتيمتر، والكراسي بتتحسب من مقاس الترابيزة", en: "True-to-scale hall and terrace; seats computed from table size" },
    { ar: "زق ترابيزتين جنب بعض = شيك واحد، وترجع تفصلهم بأصنافهم", en: "Push two tables together for one check; split them back by origin table" },
    { ar: "حالة كل ترابيزة لحظة بلحظة: قاعدين، طلبوا، طالبين الحساب، محتاجة تتشال", en: "Live status per table: seated, ordered, bill asked, needs clearing" },
    { ar: "اقتراح أنسب ترابيزة للحجز أو للي واقف مستني", en: "Best-table suggestions for bookings and walk-ins" },
  ],
  data: ["tables", "zones", "checks", "reservations"],
});
