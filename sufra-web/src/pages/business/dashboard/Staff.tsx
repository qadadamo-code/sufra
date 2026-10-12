import { useMemo, useState } from "react";
import { Check, Minus, UserPlus } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { UserTable } from "@/components/business/UserTable";
import { Card, Segmented } from "@/components/business/kit";
import { ROLE_NAMES, STAFF } from "@/data/business/demo";

const PERMS: { ar: string; en: string; roles: string[] }[] = [
  { ar: "فتح وقفل الوردية", en: "Open/close shift", roles: ["owner", "manager", "cashier"] },
  { ar: "خصم على الفاتورة", en: "Discount a bill", roles: ["owner", "manager"] },
  { ar: "إلغاء صنف بعد الطلب", en: "Void after sending", roles: ["owner", "manager"] },
  { ar: "دمج وتقسيم الفواتير", en: "Merge & split bills", roles: ["owner", "manager", "cashier", "waiter"] },
  { ar: "تعديل المنيو والأسعار", en: "Edit menu & prices", roles: ["owner", "manager"] },
  { ar: "استلام بضاعة", en: "Receive goods", roles: ["owner", "manager", "chef"] },
  { ar: "التقارير المالية", en: "Financial reports", roles: ["owner"] },
];
const ROLES = ["owner", "manager", "cashier", "waiter", "chef"] as const;

export default function Staff() {
  const { L, lang } = useLang();
  const [branch, setBranch] = useState<"all" | "الزمالك" | "المعادي">("all");
  const list = useMemo(() => STAFF.filter((s) => branch === "all" || s.branch === branch), [branch]);
  const status = (s: (typeof STAFF)[number]["status"]) =>
    s === "on" ? { label: L("في الوردية", "On shift"), tone: "ok" as const } : s === "break" ? { label: L("بريك", "Break"), tone: "warn" as const } : s === "leave" ? { label: L("إجازة", "On leave"), tone: "primary" as const } : { label: L("برّه الوردية", "Off"), tone: "muted" as const };
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label={L("الفرع", "Branch")} value={branch} onChange={setBranch} options={[{ id: "all", label: L("كل الفروع", "All branches") }, { id: "الزمالك", label: L("الزمالك", "Zamalek") }, { id: "المعادي", label: L("المعادي", "Maadi") }]} />
        <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => notify({ title: L("دعوة موظف", "Invite staff"), detail: L("في النسخة الحقيقية بتبعت لينك على واتساب برقم سري للكاشير.", "In the real app this sends a WhatsApp link with a POS PIN."), tone: "brass", icon: "bell" })}>
          <UserPlus className="size-4" aria-hidden />
          {L("ضيف موظف", "Add staff")}
        </button>
      </div>
      <UserTable
        caption={L("فريق العمل", "Staff")}
        headers={{ user: L("الموظف", "Employee"), role: L("الدور", "Role"), status: L("الحالة", "Status"), lastSeen: L("آخر ظهور", "Last seen") }}
        extraHeader={L("الفرع", "Branch")}
        users={list.map((s) => ({
          id: s.id,
          name: lang === "ar" ? s.name : s.nameEn,
          email: s.email,
          role: ROLE_NAMES[s.role][lang],
          status: status(s.status),
          lastSeen: lang === "ar" ? s.lastSeen : s.lastSeen.replace("الآن", "now").replace(/منذ (\d+) د/, "$1 min ago").replace(/منذ (\d+) أيام/, "$1 days ago").replace("أمس", "yesterday").replace(" م", " pm"),
          extra: <span className="text-[13px] text-muted-foreground">{lang === "ar" ? s.branch : s.branch === "الزمالك" ? "Zamalek" : "Maadi"}</span>,
        }))}
      />
      <Card className="p-0">
        <h3 className="border-b p-4 font-sans text-[15px] font-semibold">{L("الأدوار والصلاحيات", "Roles & permissions")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13.5px]">
            <caption className="sr-only">{L("مصفوفة الصلاحيات", "Permission matrix")}</caption>
            <thead>
              <tr className="border-b text-[12px] text-muted-foreground">
                <th scope="col" className="p-3 text-start">{L("الصلاحية", "Permission")}</th>
                {ROLES.map((r) => <th key={r} scope="col" className="p-3 text-center">{ROLE_NAMES[r][lang]}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMS.map((p) => (
                <tr key={p.en} className="border-b last:border-0">
                  <th scope="row" className="p-3 text-start font-medium">{lang === "ar" ? p.ar : p.en}</th>
                  {ROLES.map((r) => (
                    <td key={r} className="p-3 text-center">{p.roles.includes(r) ? <Check className="mx-auto size-4 text-primary" aria-label={L("مسموح", "Allowed")} /> : <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label={L("ممنوع", "Not allowed")} />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
