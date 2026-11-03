/**
 * Default chart of accounts for an Egyptian restaurant. Starts from sufra-finance's `ACCOUNTS` (the codes its posting
 * rules use) and adds the accounts a restaurant accountant expects: safe, petty cash, gateways, staff liabilities,
 * fixed assets, payroll, occupancy and operating expenses. Tenants can rename / add accounts (glAccounts rows).
 *
 * Numbering: 1 assets · 2 liabilities · 3 equity · 4 revenue · 5 cost of sales · 6 expenses.
 */
import { ACCOUNTS } from "@finance/ledger";
import type { GlAccountType, GlGroup } from "@/data/accountingTypes";

export interface ChartAccount {
  code: string;
  type: GlAccountType;
  group: GlGroup;
  ar: string;
  en: string;
  parent?: string;
}

/** Account codes every module may post to. Import these instead of hard-coding strings. */
export const ACC = {
  // assets
  cash: ACCOUNTS.cash.code, // 1101 drawers (dims.drawer)
  cardClearing: ACCOUNTS.cardClearing.code, // 1102 card machines + online gateway, until settled
  walletClearing: ACCOUNTS.walletClearing.code, // 1103 Vodafone Cash / InstaPay / wallets
  aggregatorReceivable: ACCOUNTS.aggregatorReceivable.code, // 1104 Talabat, elmenus …
  bank: ACCOUNTS.bank.code, // 1105 main bank account
  safe: "1106",
  pettyCash: "1107",
  cashInTransit: "1108",
  bank2: "1109",
  receivables: ACCOUNTS.receivables.code, // 1201 house accounts (+ gift-card tender bridge)
  staffAdvances: "1202",
  prepaid: "1203",
  depositsPaid: "1204",
  inventoryFood: ACCOUNTS.inventoryFood.code, // 1301
  inventoryBeverage: ACCOUNTS.inventoryBeverage.code, // 1302
  inventoryPackaging: ACCOUNTS.inventoryPackaging.code, // 1303
  inputVat: ACCOUNTS.inputVat.code, // 1401
  withholdingReceivable: "1402",
  equipment: "1501",
  furniture: "1502",
  fitOut: "1503",
  accumulatedDepreciation: "1509",
  // liabilities
  payables: ACCOUNTS.payables.code, // 2101 suppliers
  accrued: "2102",
  outputVat: ACCOUNTS.outputVat.code, // 2201
  servicePayable: ACCOUNTS.servicePayable.code, // 2202
  tipsPayable: ACCOUNTS.tipsPayable.code, // 2203
  customerDeposits: ACCOUNTS.customerDeposits.code, // 2204 deposits + gift cards
  vatSettlement: ACCOUNTS.vatSettlement.code, // 2301 VAT payable to ETA
  withholdingPayable: "2302",
  payrollTaxPayable: "2303",
  socialInsurancePayable: "2304",
  salariesPayable: "2401",
  ownerLoan: "2501",
  // equity
  capital: ACCOUNTS.capital.code, // 3101
  retained: ACCOUNTS.retained.code, // 3201
  ownerDrawings: "3301",
  // revenue
  salesFood: ACCOUNTS.salesFood.code, // 4101
  salesBeverage: ACCOUNTS.salesBeverage.code, // 4102
  deliveryRevenue: ACCOUNTS.deliveryRevenue.code, // 4103
  serviceRevenue: ACCOUNTS.serviceRevenue.code, // 4104
  otherIncome: "4201",
  // cost of sales
  cogsFood: ACCOUNTS.cogsFood.code, // 5101
  cogsBeverage: ACCOUNTS.cogsBeverage.code, // 5102
  cogsPackaging: "5103",
  waste: ACCOUNTS.waste.code, // 5201
  staffMeals: "5301",
  inventoryVariance: "5401",
  // expenses
  cardFees: ACCOUNTS.cardFees.code, // 6101
  aggregatorFees: ACCOUNTS.aggregatorFees.code, // 6102
  bankCharges: "6103",
  pettyExpenses: ACCOUNTS.pettyExpenses.code, // 6201
  salaries: "6301",
  socialInsurance: "6302",
  bonuses: "6303",
  staffBenefits: "6304",
  rent: "6401",
  electricity: "6402",
  water: "6403",
  gas: "6404",
  internet: "6405",
  maintenance: "6501",
  cleaning: "6502",
  marketing: "6601",
  licenses: "6701",
  professional: "6702",
  software: "6703",
  transport: "6704",
  depreciation: "6801",
  cashOverShort: ACCOUNTS.cashOverShort.code, // 6901
  rounding: ACCOUNTS.rounding.code, // 6902
  misc: "6903",
} as const;
export type AccKey = keyof typeof ACC;

const F = ACCOUNTS;
const fin = (a: (typeof ACCOUNTS)[keyof typeof ACCOUNTS], group: GlGroup, parent?: string): ChartAccount => ({ code: a.code, type: a.type, group, ar: a.ar, en: a.en, ...(parent ? { parent } : {}) });
const acc = (code: string, type: GlAccountType, group: GlGroup, ar: string, en: string, parent?: string): ChartAccount => ({ code, type, group, ar, en, ...(parent ? { parent } : {}) });

/** Header rows (no postings) group the chart for the tree view. */
export const CHART_HEADERS: ChartAccount[] = [
  acc("1", "asset", "cash", "الأصول", "Assets"),
  acc("11", "asset", "cash", "النقدية وما في حكمها", "Cash & equivalents", "1"),
  acc("12", "asset", "receivable", "المدينون", "Receivables", "1"),
  acc("13", "asset", "inventory", "المخزون", "Inventory", "1"),
  acc("14", "asset", "tax_asset", "ضرائب مدينة", "Tax assets", "1"),
  acc("15", "asset", "fixed_asset", "الأصول الثابتة", "Fixed assets", "1"),
  acc("2", "liability", "payable", "الالتزامات", "Liabilities"),
  acc("21", "liability", "payable", "الموردين والمستحقات", "Payables & accruals", "2"),
  acc("22", "liability", "tax", "ضرائب ومستحقات العاملين من المبيعات", "Sales taxes & staff dues", "2"),
  acc("23", "liability", "tax", "ضرائب مستحقة", "Taxes payable", "2"),
  acc("24", "liability", "staff_liability", "الرواتب المستحقة", "Payroll liabilities", "2"),
  acc("25", "liability", "payable", "قروض", "Loans", "2"),
  acc("3", "equity", "equity", "حقوق الملكية", "Equity"),
  acc("4", "revenue", "revenue", "الإيرادات", "Revenue"),
  acc("5", "expense", "cogs", "تكلفة المبيعات", "Cost of sales"),
  acc("6", "expense", "opex", "المصروفات", "Expenses"),
  acc("61", "expense", "fees", "عمولات ومصاريف بنكية", "Fees & commissions", "6"),
  acc("63", "expense", "labour", "تكلفة العمالة", "Labour", "6"),
  acc("64", "expense", "occupancy", "الإيجار والمرافق", "Rent & utilities", "6"),
  acc("65", "expense", "opex", "مصروفات تشغيل", "Operating expenses", "6"),
  acc("69", "expense", "other_expense", "مصروفات أخرى", "Other expenses", "6"),
];

export const DEFAULT_CHART: ChartAccount[] = [
  fin(F.cash, "cash", "11"),
  fin(F.cardClearing, "clearing", "11"),
  fin(F.walletClearing, "clearing", "11"),
  fin(F.aggregatorReceivable, "clearing", "11"),
  acc(ACC.bank, "asset", "bank", "البنك - الحساب الجاري", "Bank — current account", "11"),
  acc(ACC.safe, "asset", "cash", "الخزنة الرئيسية", "Main safe", "11"),
  acc(ACC.pettyCash, "asset", "cash", "العهدة النثرية", "Petty cash", "11"),
  acc(ACC.cashInTransit, "asset", "cash", "نقدية في الطريق للبنك", "Cash in transit", "11"),
  acc(ACC.bank2, "asset", "bank", "البنك - حساب ثاني", "Bank — second account", "11"),
  fin(F.receivables, "receivable", "12"),
  acc(ACC.staffAdvances, "asset", "receivable", "سلف العاملين", "Staff advances", "12"),
  acc(ACC.prepaid, "asset", "prepaid", "مصروفات مدفوعة مقدماً", "Prepaid expenses", "12"),
  acc(ACC.depositsPaid, "asset", "prepaid", "تأمينات لدى الغير", "Deposits paid", "12"),
  fin(F.inventoryFood, "inventory", "13"),
  fin(F.inventoryBeverage, "inventory", "13"),
  fin(F.inventoryPackaging, "inventory", "13"),
  fin(F.inputVat, "tax_asset", "14"),
  acc(ACC.withholdingReceivable, "asset", "tax_asset", "ضريبة خصم من المنبع لنا", "Withholding tax receivable", "14"),
  acc(ACC.equipment, "asset", "fixed_asset", "معدات المطبخ", "Kitchen equipment", "15"),
  acc(ACC.furniture, "asset", "fixed_asset", "أثاث وتجهيزات الصالة", "Furniture & fixtures", "15"),
  acc(ACC.fitOut, "asset", "fixed_asset", "تشطيبات وديكورات", "Fit-out", "15"),
  acc(ACC.accumulatedDepreciation, "asset", "fixed_asset", "مجمع الإهلاك", "Accumulated depreciation", "15"),
  fin(F.payables, "payable", "21"),
  acc(ACC.accrued, "liability", "accrued", "مصروفات مستحقة", "Accrued expenses", "21"),
  fin(F.outputVat, "tax", "22"),
  fin(F.servicePayable, "staff_liability", "22"),
  fin(F.tipsPayable, "staff_liability", "22"),
  fin(F.customerDeposits, "deposit", "22"),
  fin(F.vatSettlement, "tax", "23"),
  acc(ACC.withholdingPayable, "liability", "tax", "ضريبة الخصم والإضافة المستحقة", "Withholding tax payable", "23"),
  acc(ACC.payrollTaxPayable, "liability", "tax", "ضريبة كسب العمل المستحقة", "Payroll tax payable", "23"),
  acc(ACC.socialInsurancePayable, "liability", "tax", "التأمينات الاجتماعية المستحقة", "Social insurance payable", "23"),
  acc(ACC.salariesPayable, "liability", "staff_liability", "رواتب وأجور مستحقة", "Salaries payable", "24"),
  acc(ACC.ownerLoan, "liability", "payable", "جاري الشركاء - قروض", "Owner loans", "25"),
  fin(F.capital, "equity", "3"),
  fin(F.retained, "equity", "3"),
  acc(ACC.ownerDrawings, "equity", "equity", "مسحوبات المالك", "Owner drawings", "3"),
  fin(F.salesFood, "revenue", "4"),
  fin(F.salesBeverage, "revenue", "4"),
  fin(F.deliveryRevenue, "revenue", "4"),
  fin(F.serviceRevenue, "revenue", "4"),
  acc(ACC.otherIncome, "revenue", "other_income", "إيرادات أخرى", "Other income", "4"),
  fin(F.cogsFood, "cogs", "5"),
  fin(F.cogsBeverage, "cogs", "5"),
  acc(ACC.cogsPackaging, "expense", "cogs", "تكلفة مواد التغليف", "Packaging cost", "5"),
  fin(F.waste, "cogs", "5"),
  acc(ACC.staffMeals, "expense", "cogs", "وجبات العاملين", "Staff meals", "5"),
  acc(ACC.inventoryVariance, "expense", "cogs", "فروق جرد المخزون", "Inventory count variance", "5"),
  fin(F.cardFees, "fees", "61"),
  fin(F.aggregatorFees, "fees", "61"),
  acc(ACC.bankCharges, "expense", "fees", "مصروفات وعمولات بنكية", "Bank charges", "61"),
  fin(F.pettyExpenses, "opex", "65"),
  acc(ACC.salaries, "expense", "labour", "رواتب وأجور", "Salaries & wages", "63"),
  acc(ACC.socialInsurance, "expense", "labour", "حصة المنشأة في التأمينات", "Employer social insurance", "63"),
  acc(ACC.bonuses, "expense", "labour", "مكافآت وحوافز", "Bonuses & incentives", "63"),
  acc(ACC.staffBenefits, "expense", "labour", "مزايا العاملين (مواصلات وزي)", "Staff benefits (transport, uniforms)", "63"),
  acc(ACC.rent, "expense", "occupancy", "الإيجار", "Rent", "64"),
  acc(ACC.electricity, "expense", "occupancy", "الكهرباء", "Electricity", "64"),
  acc(ACC.water, "expense", "occupancy", "المياه", "Water", "64"),
  acc(ACC.gas, "expense", "occupancy", "الغاز", "Gas", "64"),
  acc(ACC.internet, "expense", "occupancy", "الإنترنت والتليفونات", "Internet & phone", "64"),
  acc(ACC.maintenance, "expense", "opex", "صيانة وإصلاحات", "Repairs & maintenance", "65"),
  acc(ACC.cleaning, "expense", "opex", "نظافة ومستلزمات تشغيل", "Cleaning & supplies", "65"),
  acc(ACC.marketing, "expense", "opex", "دعاية وإعلان", "Marketing", "65"),
  acc(ACC.licenses, "expense", "opex", "رخص ورسوم حكومية", "Licences & government fees", "65"),
  acc(ACC.professional, "expense", "opex", "أتعاب مهنية ومحاسبية", "Professional fees", "65"),
  acc(ACC.software, "expense", "opex", "اشتراكات برامج", "Software subscriptions", "65"),
  acc(ACC.transport, "expense", "opex", "انتقالات ونقل", "Transport", "65"),
  acc(ACC.depreciation, "expense", "other_expense", "الإهلاك", "Depreciation", "69"),
  fin(F.cashOverShort, "other_expense", "69"),
  fin(F.rounding, "other_expense", "69"),
  acc(ACC.misc, "expense", "other_expense", "مصروفات متنوعة", "Miscellaneous", "69"),
];

export const DEFAULT_CHART_BY_CODE = new Map(DEFAULT_CHART.map((a) => [a.code, a]));

/** Account codes the posting rules rely on — renamable, never deactivated. */
export const SYSTEM_CODES = new Set<string>(Object.values(ACC));

/** Normal side: assets & expenses are debit-normal. */
export const debitNormal = (t: GlAccountType) => t === "asset" || t === "expense";

/** Prime cost buckets. */
export const isCogs = (g: GlGroup) => g === "cogs";
export const isLabour = (g: GlGroup) => g === "labour";
