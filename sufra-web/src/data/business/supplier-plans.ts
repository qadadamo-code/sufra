/**
 * Sufra for suppliers — subscription + commission per sale.
 *
 * EDIT HERE to change supplier pricing. Money in integer piastres; rates in percent.
 * A supplier pays: monthly subscription + commission on every DELIVERED order (cancelled/returned lines are not
 * charged) + an optional payment-collection fee when Sufra collects from the restaurant. Sufra's fees carry VAT 14%.
 */
import { egp } from "./plans";

export type SupplierPlanId = "starter" | "growth" | "distributor";

export interface SupplierPlan {
  id: SupplierPlanId;
  ar: string;
  en: string;
  taglineAr: string;
  taglineEn: string;
  /** monthly subscription, piastres before VAT */
  monthly: number;
  /** commission on delivered order value (before VAT), percent */
  commissionPct: number;
  /** minimum commission per order, piastres (0 = none) */
  minCommission: number;
  /** maximum commission per order, piastres (0 = no cap) */
  maxCommission: number;
  products: number | null;
  highlight?: boolean;
  featuresAr: string[];
  featuresEn: string[];
}

export const SUPPLIER_PLANS: SupplierPlan[] = [
  {
    id: "starter",
    ar: "بداية",
    en: "Starter",
    taglineAr: "من غير اشتراك — بتدفع لما تبيع بس",
    taglineEn: "No subscription — pay only when you sell",
    monthly: 0,
    commissionPct: 6,
    minCommission: egp(15),
    maxCommission: 0,
    products: 50,
    featuresAr: ["كتالوج لحد 50 منتج", "طلبات وفواتير", "شات مع المطاعم", "تحصيل عن طريق سُفرة"],
    featuresEn: ["Up to 50 products", "Orders & invoices", "Chat with restaurants", "Collection via Sufra"],
  },
  {
    id: "growth",
    ar: "نمو",
    en: "Growth",
    taglineAr: "للموردين اللي بيوزّعوا كل يوم",
    taglineEn: "For suppliers delivering every day",
    monthly: egp(1490),
    commissionPct: 3.5,
    minCommission: egp(10),
    maxCommission: egp(1500),
    products: 500,
    highlight: true,
    featuresAr: ["كتالوج لحد 500 منتج", "فاتورة إلكترونية B2B مدمجة", "مناطق وأيام توصيل", "تحليلات المبيعات", "ظهور أعلى في البحث"],
    featuresEn: ["Up to 500 products", "Built-in B2B e-invoice", "Delivery areas & days", "Sales analytics", "Better search placement"],
  },
  {
    id: "distributor",
    ar: "موزّع",
    en: "Distributor",
    taglineAr: "مخازن كبيرة وأساطيل توزيع",
    taglineEn: "Large warehouses & fleets",
    monthly: egp(3990),
    commissionPct: 2,
    minCommission: 0,
    maxCommission: egp(2500),
    products: null,
    featuresAr: ["منتجات بلا حدود", "مخازن متعددة", "API للمخزون والأسعار", "مدير حساب", "مكان مميز في الصفحة الرئيسية للموردين"],
    featuresEn: ["Unlimited products", "Multiple warehouses", "Stock & price API", "Account manager", "Featured placement"],
  },
];

/** Fee for collecting payment from the restaurant on the supplier's behalf (card / wallet / InstaPay), percent. */
export const PAYMENT_COLLECTION_PCT = 1.5;
/** VAT on Sufra's own fees. */
export const SUPPLIER_FEE_VAT = 0.14;

export const SUPPLIER_FAQ: { qAr: string; qEn: string; aAr: string; aEn: string }[] = [
  { qAr: "العمولة بتتحسب على إيه؟", qEn: "What is commission charged on?", aAr: "على قيمة الطلب اللي اتسلّم فعلًا قبل الضريبة. الطلبات الملغية والمرتجعات مش بتتحسب.", aEn: "On the delivered order value before VAT. Cancelled orders and returns are not charged." },
  { qAr: "إمتى بستلم فلوسي؟", qEn: "When do I get paid?", aAr: "لو التحصيل عن طريق سُفرة: كل أسبوع على حسابك البنكي أو إنستاباي بعد خصم العمولة. ولو بتحصّل بنفسك، بنبعتلك كشف حساب شهري بالعمولة.", aEn: "If Sufra collects: weekly to your bank/InstaPay, net of commission. If you collect yourself, we send a monthly commission statement." },
  { qAr: "الفاتورة الإلكترونية؟", qEn: "E-invoicing?", aAr: "كل طلب بيطلع فاتورة إلكترونية B2B (نوع i) باسم المطعم ورقمه الضريبي وتتبعت لمصلحة الضرايب من باقة نمو وفوق.", aEn: "Every order produces a B2B e-invoice (type i) to the restaurant's tax ID, submitted to the ETA from Growth up." },
  { qAr: "أقدر أتواصل مع المطعم مباشرة؟", qEn: "Can I talk to restaurants directly?", aAr: "أيوه، فيه شات مباشر لكل طلب، والمطعم يقدر يطلب منك برّه سُفرة لو حب.", aEn: "Yes — every order has a direct chat, and restaurants can also contact you directly." },
  { qAr: "فيه عقد؟", qEn: "Is there a contract?", aAr: "لأ، اشتراك شهري تلغيه وقت ما تحب.", aEn: "No — month to month, cancel any time." },
];
