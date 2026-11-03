/** Copy for HR enums (AR Egyptian dialect / EN). */
import type { ContractType, LeaveStatus, LeaveType, PayMethod, PunchKind, PunchSource, SalaryType, StaffDocKind, AdvanceStatus, PayrollStatus, SwapStatus } from "@/data/hrTypes";
import type { Localized } from "@/data/types";
import type { Tone } from "@/ui";
import type { DayStatus } from "./lib/attendance";

const L = (ar: string, en: string): Localized => ({ ar, en });

export const DOC_KIND: Record<StaffDocKind, Localized> = {
  national_id: L("بطاقة الرقم القومي", "National ID"),
  health_certificate: L("الشهادة الصحية", "Health certificate"),
  contract: L("عقد العمل", "Employment contract"),
  criminal_record: L("فيش وتشبيه", "Criminal record"),
  military_status: L("موقف التجنيد", "Military status"),
  iqama: L("الإقامة", "Iqama"),
  passport: L("جواز السفر", "Passport"),
  work_permit: L("تصريح عمل", "Work permit"),
  other: L("مستند آخر", "Other document"),
};

export const CONTRACT: Record<ContractType, Localized> = {
  permanent: L("دائم", "Permanent"),
  fixed_term: L("محدد المدة", "Fixed term"),
  part_time: L("بارت تايم", "Part time"),
  probation: L("فترة اختبار", "Probation"),
  daily: L("يومية", "Daily"),
};

export const SALARY_TYPE: Record<SalaryType, Localized> = { monthly: L("شهري", "Monthly"), daily: L("يومية", "Daily"), hourly: L("بالساعة", "Hourly") };
export const PAY_METHOD: Record<PayMethod, Localized> = { cash: L("كاش", "Cash"), bank: L("تحويل بنكي", "Bank transfer"), wallet: L("محفظة (فودافون كاش…)", "Mobile wallet"), instapay: L("إنستاباي", "InstaPay") };

export const LEAVE_TYPE: Record<LeaveType, Localized> = {
  annual: L("اعتيادية", "Annual"),
  casual: L("عارضة", "Casual"),
  sick: L("مرضية", "Sick"),
  unpaid: L("بدون مرتب", "Unpaid"),
  hajj: L("حج / عمرة", "Hajj"),
  maternity: L("وضع", "Maternity"),
  other: L("أخرى", "Other"),
};
export const LEAVE_COLOR: Record<LeaveType, string> = { annual: "#0d5a53", casual: "#a8700c", sick: "#c2412d", unpaid: "#5b6a64", hajj: "#6b4fa0", maternity: "#9a3b6b", other: "#2f6f9f" };

export const LEAVE_STATUS: Record<LeaveStatus, { label: Localized; tone: Tone }> = {
  pending: { label: L("مستني الموافقة", "Pending"), tone: "warn" },
  approved: { label: L("موافَق", "Approved"), tone: "ok" },
  rejected: { label: L("مرفوض", "Rejected"), tone: "danger" },
  cancelled: { label: L("اتلغى", "Cancelled"), tone: "neutral" },
};

export const ADVANCE_STATUS: Record<AdvanceStatus, { label: Localized; tone: Tone }> = {
  requested: { label: L("طلب جديد", "Requested"), tone: "warn" },
  approved: { label: L("موافَق — مستني الصرف", "Approved — to pay"), tone: "info" },
  rejected: { label: L("مرفوض", "Rejected"), tone: "danger" },
  paid: { label: L("اتصرفت — بتتخصم", "Paid — recovering"), tone: "primary" },
  settled: { label: L("خلصت", "Settled"), tone: "ok" },
};

export const RUN_STATUS: Record<PayrollStatus, { label: Localized; tone: Tone }> = {
  draft: { label: L("مسودة", "Draft"), tone: "warn" },
  approved: { label: L("معتمد — مستني الصرف", "Approved — to pay"), tone: "info" },
  paid: { label: L("اتصرف", "Paid"), tone: "ok" },
};

export const SWAP_STATUS: Record<SwapStatus, { label: Localized; tone: Tone }> = {
  pending: { label: L("مستني المدير", "Waiting for manager"), tone: "warn" },
  accepted: { label: L("الزميل وافق", "Colleague accepted"), tone: "info" },
  approved: { label: L("اتبدّل", "Swapped"), tone: "ok" },
  rejected: { label: L("مرفوض", "Rejected"), tone: "danger" },
  cancelled: { label: L("اتلغى", "Cancelled"), tone: "neutral" },
};

export const PUNCH_KIND: Record<PunchKind, Localized> = { in: L("حضور", "In"), out: L("انصراف", "Out"), break_start: L("بداية بريك", "Break start"), break_end: L("نهاية بريك", "Break end") };
export const PUNCH_SOURCE: Record<PunchSource, Localized> = { pin: L("PIN على الكاشير", "PIN at POS"), selfie: L("سيلفي على الجهاز", "Selfie at POS"), mobile: L("موبايل + موقع", "Phone + location"), device: L("جهاز البصمة", "Fingerprint"), csv: L("ملف مستورد", "CSV import"), manual: L("تعديل مدير", "Manager correction") };

export const DAY_STATUS: Record<DayStatus, { label: Localized; tone: Tone }> = {
  on_time: { label: L("في المعاد", "On time"), tone: "ok" },
  late: { label: L("متأخر", "Late"), tone: "warn" },
  absent: { label: L("غياب", "Absent"), tone: "danger" },
  leave: { label: L("إجازة", "On leave"), tone: "info" },
  off: { label: L("راحة", "Day off"), tone: "neutral" },
  upcoming: { label: L("لسه وردية", "Upcoming"), tone: "neutral" },
  working: { label: L("في الشغل", "Working"), tone: "primary" },
  missing_out: { label: L("ناسي يبصم انصراف", "No clock-out"), tone: "warn" },
  extra: { label: L("شغل يوم راحته", "Rest-day work"), tone: "brass" },
};

export const STATION: Record<string, Localized> = {
  floor: L("الصالة", "Floor"),
  cashier: L("الكاشير", "Cashier"),
  bar: L("البار", "Bar"),
  grill: L("الشوّاية", "Grill"),
  hot: L("المطبخ السخن", "Hot kitchen"),
  cold: L("البارد", "Cold"),
  pastry: L("الحلويات", "Pastry"),
  delivery: L("الدليفري", "Delivery"),
  office: L("الإدارة", "Office"),
};

/** "2h 05m" / "٢س ٥د" style */
export function minutesText(min: number, lang: "ar" | "en"): string {
  const h = Math.floor(Math.abs(min) / 60);
  const m = Math.abs(min) % 60;
  if (lang === "ar") return h ? `${h}س${m ? ` ${m}د` : ""}` : `${m}د`;
  return h ? `${h}h${m ? ` ${String(m).padStart(2, "0")}m` : ""}` : `${m}m`;
}

export const WEEKDAYS: Localized[] = [L("الحد", "Sun"), L("الاتنين", "Mon"), L("التلات", "Tue"), L("الأربع", "Wed"), L("الخميس", "Thu"), L("الجمعة", "Fri"), L("السبت", "Sat")];
