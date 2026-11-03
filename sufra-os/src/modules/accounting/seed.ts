/**
 * Demo accounting history for "مطعم سُفرة – الزمالك": ~3 months of books derived from the restaurant's patterns —
 * one Z-summary sales journal per business day (tender mix, food/beverage split, 12% service, 14% VAT), nightly
 * drawer → safe cash-ups, safe → bank deposits, card / wallet / aggregator payouts, supplier invoices and payments,
 * weekly stock counts (cost of sales), payroll, rent, utilities, petty cash, depreciation, monthly VAT returns and
 * a bank statement for the reconciliation demo. Deterministic (seedId + hashed noise). All names are fictional.
 */
import type {
  AccountingSettings, BankStatementLine, CashAccount, CashTransfer, Collections, CostCentre, Expense, ExpenseCategory, GlAccount, JournalDraft, JournalLineRow, LedgerEntry,
  RecurringExpense, StaffCompensation,
} from "@/data/types";
import { ACC, DEFAULT_CHART, SYSTEM_CODES } from "./chart";
import { addDays, balanceOf, businessDay, monthEnd, monthStart, signedLines, vatReturn, vatSettlementLines, weekday } from "./core";

type Rows = { [C in "glAccounts" | "costCentres" | "journalDrafts" | "accountingSettings" | "cashAccounts" | "cashTransfers" | "expenses" | "recurringExpenses" | "bankLines" | "ledgerEntries"]: Collections[C][] };

export interface AccountingSeedCtx {
  restaurantId: string;
  branchId: string;
  now: Date;
  id: (k: string) => string;
  staffId: (k: string) => string;
  staffCompensation: StaffCompensation[];
}

export const HISTORY_DAYS = 91;
/** EGP → units, rounded to piastres */
const u = (egp: number) => Math.round(egp * 100) * 1000;
const r2 = (units: number) => Math.round(units / 1000) * 1000;

function noise(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 10_000) / 10_000;
}

/** a tiny drawn receipt (SVG) standing in for a phone photo */
export const DEMO_RECEIPT_PHOTO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="320" viewBox="0 0 240 320"><rect width="240" height="320" fill="#f4f1ea"/><rect x="30" y="20" width="180" height="280" fill="#fff" stroke="#d8d2c4"/><g fill="#8a8578"><rect x="50" y="45" width="140" height="10"/><rect x="70" y="62" width="100" height="6"/></g><g fill="#c9c3b5">${Array.from({ length: 9 }, (_, i) => `<rect x="50" y="${95 + i * 18}" width="${80 + ((i * 37) % 50)}" height="6"/><rect x="160" y="${95 + i * 18}" width="30" height="6"/>`).join("")}</g><rect x="50" y="265" width="140" height="2" fill="#8a8578"/><rect x="130" y="275" width="60" height="9" fill="#0d5a53"/></svg>`,
  );

const SUPPLIERS = {
  meat: "جزارة الأمانة",
  veg: "خضار وفاكهة الحاج سيد",
  dry: "مخازن النيل للمواد الغذائية",
  bev: "الشركة المتحدة للمشروبات",
  pack: "مصنع العبوات الحديثة",
};

export function demoAccountingRows(c: AccountingSeedCtx): Rows {
  const R = c.restaurantId;
  const B = c.branchId;
  const today = businessDay(c.now);
  const yesterday = addDays(today, -1);
  const start = addDays(today, -HISTORY_DAYS);
  const at = (day: string, hh = 23, mm = 0) => {
    const [y, m, d] = day.split("-").map(Number);
    return new Date(y, m - 1, d, hh, mm).toISOString();
  };
  const base = (k: string, day = addDays(start, -1), hh = 9) => ({ id: c.id(k), restaurantId: R, createdAt: at(day, hh), updatedAt: at(day, hh) });
  const S = c.staffId;
  const dimB = { branch: B };
  const drawerDims = { branch: B, drawer: "POS1" };

  /* ── chart, cost centres, settings, cash accounts ── */
  const glAccounts: GlAccount[] = DEFAULT_CHART.map((a) => ({
    ...base(`gl:${a.code}`), code: a.code, name: { ar: a.ar, en: a.en }, type: a.type, group: a.group, parentCode: a.parent ?? null, system: SYSTEM_CODES.has(a.code), active: true, note: "",
  }));
  const costCentres: CostCentre[] = [
    { ...base("cc:zm"), code: "ZM", name: { ar: "فرع الزمالك", en: "Zamalek branch" }, branchId: B, active: true },
    { ...base("cc:hq"), code: "HQ", name: { ar: "الإدارة العامة", en: "Head office" }, branchId: null, active: true },
  ];
  const payroll = c.staffCompensation.reduce((a, s) => a + s.monthlySalary, 0);
  const ca = (k: string, kind: CashAccount["kind"], ar: string, en: string, glCode: string, institution: string, extra: Partial<CashAccount> = {}, sort = 0): CashAccount => ({
    ...base(`cash:${k}`), kind, name: { ar, en }, glCode, branchId: B, institution, last4: null, limit: null, active: true, sort, ...extra,
  });
  const cashAccounts: CashAccount[] = [
    ca("pos1", "drawer", "درج الكاشير ١", "Till POS1", ACC.cash, "POS1", {}, 1),
    ca("safe", "safe", "الخزنة الرئيسية", "Main safe", ACC.safe, "", { limit: u(80_000) }, 2),
    ca("petty", "petty", "العهدة النثرية", "Petty cash", ACC.pettyCash, "", { limit: u(5_000) }, 3),
    ca("cib", "bank", "البنك التجاري الدولي - جاري", "CIB current account", ACC.bank, "CIB", { last4: "4821", branchId: null }, 4),
    ca("wallet", "wallet", "فودافون كاش وإنستاباي", "Vodafone Cash & InstaPay", ACC.walletClearing, "Vodafone Cash", { last4: "0418" }, 5),
    ca("cards", "provider", "ماكينات الفيزا وPaymob", "Card machines & Paymob", ACC.cardClearing, "Paymob · CIB POS", {}, 6),
    ca("apps", "provider", "تطبيقات التوصيل", "Delivery apps", ACC.aggregatorReceivable, "Talabat · elmenus", {}, 7),
  ];
  const caId = (k: string) => c.id(`cash:${k}`);

  /* ── journal builder ── */
  const entries: LedgerEntry[] = [];
  const je = (key: string, day: string, sourceType: string, sourceId: string, memo: string, lines: JournalLineRow[], branchId: string | null = B, hh = 23): LedgerEntry => {
    const e: LedgerEntry = { ...base(`je:${key}`, day, hh), branchId, date: day, sourceType, sourceId, memo, lines };
    entries.push(e);
    return e;
  };
  const sl = signedLines;

  // opening balances (the day before history starts)
  const open = addDays(start, -1);
  const openLines = sl([
    [ACC.cash, u(2_000), drawerDims], [ACC.safe, u(35_000), dimB], [ACC.pettyCash, u(5_000), dimB], [ACC.bank, u(640_000)], [ACC.inventoryFood, u(62_000), dimB], [ACC.inventoryBeverage, u(18_000), dimB],
    [ACC.inventoryPackaging, u(9_000), dimB], [ACC.depositsPaid, u(240_000)], [ACC.equipment, u(900_000)], [ACC.furniture, u(350_000)], [ACC.fitOut, u(600_000)], [ACC.accumulatedDepreciation, -u(410_000)],
    [ACC.capital, -u(2_000_000)],
  ]);
  const openDr = openLines.reduce((a, l) => a + l.debit - l.credit, 0);
  openLines.push({ account: ACC.retained, debit: 0, credit: openDr });
  je("opening", open, "opening-balance", "opening", "أرصدة افتتاحية / Opening balances", openLines, null, 8);

  const transfers: CashTransfer[] = [];
  const expenses: Expense[] = [];
  const bankDesc = new Map<string, { text: string; ref: string; lag: number }>();
  const tr = (k: string, day: string, from: string, to: string, amount: number, counted: number | null, e: LedgerEntry | null, note: string, by = "manager", status: CashTransfer["status"] = "posted", reference = "") =>
    transfers.push({
      ...base(`tr:${k}`, day, 23), branchId: B, date: day, fromId: caId(from), toId: caId(to), amount, counted, denominations: null, status, requestedBy: S(by), approvedBy: status === "posted" ? S("owner") : null,
      reference, note, ledgerEntryId: e?.id ?? null,
    });
  const exp = (k: string, day: string, category: ExpenseCategory, glCode: string, vendor: string, description: string, net: number, vat: number, paidFrom: string | null, opts: Partial<Expense> = {}) => {
    const total = net + vat;
    const credit = paidFrom ? cashAccounts.find((a) => a.id === caId(paidFrom))!.glCode : ACC.accrued;
    const branchId = opts.branchId === undefined ? B : opts.branchId;
    const status = opts.status ?? "posted";
    const e = status === "posted"
      ? je(`exp:${k}`, day, "expense", c.id(`exp:${k}`), `${description} · ${vendor}`, sl([[glCode, net, branchId ? dimB : undefined], [ACC.inputVat, vat, branchId ? dimB : undefined], [credit, -total, paidFrom === "pos1" ? drawerDims : undefined]]), branchId, 14)
      : null;
    expenses.push({
      ...base(`exp:${k}`, day, 14), branchId, date: day, category, glCode, vendor, description, invoiceNo: opts.invoiceNo ?? "", net, vat, total, paidFromId: paidFrom ? caId(paidFrom) : null,
      dueDate: opts.dueDate ?? null, status, receiptPhoto: opts.receiptPhoto ?? null, recurringId: opts.recurringId ?? null, createdBy: opts.createdBy ?? S("manager"), approvedBy: status === "posted" ? S("accountant") : null,
      ledgerEntryId: e?.id ?? null,
    });
    return e;
  };

  // recurring templates
  const rec = (k: string, category: ExpenseCategory, glCode: string, vendor: string, description: string, net: number, vat: number, day: number, paidFrom: string | null, branchId: string | null = B): RecurringExpense => ({
    ...base(`rec:${k}`), branchId, category, glCode, vendor, description, net, vat, dayOfMonth: day, paidFromId: paidFrom ? caId(paidFrom) : null, active: true, lastRaisedFor: null,
  });
  const recurringExpenses: RecurringExpense[] = [
    rec("rent", "rent", ACC.rent, "شركة الجزيرة للاستثمار العقاري", "إيجار المحل - الزمالك", u(120_000), 0, 1, "cib"),
    rec("software", "software", ACC.software, "سُفرة", "اشتراك سُفرة الشهري", u(1_999), u(279.86), 3, "cib", null),
    rec("internet", "internet", ACC.internet, "WE تي إي داتا", "إنترنت وخطوط", u(1_450), u(203), 5, "cib"),
    rec("marketing", "marketing", ACC.marketing, "Meta Platforms", "إعلانات فيسبوك وإنستجرام", u(9_000), u(1_260), 10, "cib"),
    rec("accounting", "professional", ACC.professional, "مكتب الشافعي للمحاسبة", "أتعاب مراجعة شهرية", u(6_000), u(840), 12, "cib", null),
    rec("water", "water", ACC.water, "الشركة القابضة لمياه الشرب", "فاتورة المياه", u(1_650), 0, 18, "safe"),
    rec("electricity", "electricity", ACC.electricity, "شمال القاهرة لتوزيع الكهرباء", "فاتورة الكهرباء", u(17_500), 0, 20, "safe"),
    rec("gas", "gas", ACC.gas, "تاون جاس", "فاتورة الغاز الطبيعي", u(4_300), 0, 22, "safe"),
  ];

  /* ── simulate day by day ── */
  const salesByDay = new Map<string, { cash: number; card: number; wallet: number; agg: number; net: number; total: number }>();
  const openInvoices: { k: string; supplier: string; day: string; total: number; paid: boolean }[] = [];
  const weekPurch = { food: 0, bev: 0, pack: 0 };
  const months = new Set<string>();
  const factor = [0.88, 0.85, 0.9, 0.95, 1.22, 1.35, 1.12]; // Sun … Sat
  let seq = 0;

  for (let i = HISTORY_DAYS; i >= 1; i--) {
    const day = addDays(today, -i);
    const wd = weekday(day);
    const dom = Number(day.slice(8));
    months.add(day.slice(0, 7));

    // 1. Z summary: one sales journal per business day
    const trend = 1 + (HISTORY_DAYS - i) * 0.0012;
    const N = r2(u(31_500) * factor[wd] * trend * (0.9 + noise(`sales:${day}`) * 0.2));
    const food = r2(N * 0.78);
    const bev = N - food;
    const service = r2(N * 0.66 * 0.12);
    const fee = r2(N * 0.012);
    const vat = r2((N + service + fee) * 0.14);
    const total = N + service + fee + vat;
    const agg = r2(total * 0.11);
    const card = r2(total * 0.36);
    const wallet = r2(total * 0.07);
    const cash = total - agg - card - wallet;
    const tips = r2(card * 0.018);
    salesByDay.set(day, { cash, card: card + tips, wallet, agg, net: N, total });
    je(`z:${day}`, day, "z-summary", `Z-${day}`, `ملخص مبيعات اليوم (Z) ${day} / Daily sales summary`, sl([
      [ACC.cash, cash, drawerDims], [ACC.cardClearing, card + tips, dimB], [ACC.walletClearing, wallet, dimB], [ACC.aggregatorReceivable, agg, dimB],
      [ACC.salesFood, -food, dimB], [ACC.salesBeverage, -bev, dimB], [ACC.servicePayable, -service, dimB], [ACC.deliveryRevenue, -fee, dimB], [ACC.outputVat, -vat, dimB], [ACC.tipsPayable, -tips, dimB],
    ]), B, 23);

    // 2. nightly cash-up: drawer → safe (float stays in the drawer), occasional over/short
    const vary = noise(`os:${day}`) < 0.14 ? (noise(`osv:${day}`) < 0.6 ? -1 : 1) * u(20 + Math.round(noise(`osa:${day}`) * 330)) : 0;
    const counted = cash + vary;
    const cu = je(`cu:${day}`, day, "cash-transfer", c.id(`tr:cu:${day}`), `تقفيل الدرج → الخزنة ${day} / Drawer cash-up`, sl([
      [ACC.safe, counted, dimB], [ACC.cash, -cash, drawerDims], [ACC.cashOverShort, -vary, dimB],
    ]), B, 23);
    tr(`cu:${day}`, day, "pos1", "safe", cash, counted, cu, vary ? (vary > 0 ? "زيادة في العد" : "عجز في العد") : "", "cashier1");

    // 3. card machines settle T+1, net of 1.8% fees
    const prev = salesByDay.get(addDays(day, -1));
    if (prev) {
      const gross = prev.card;
      const fees = r2(gross * 0.018);
      const e = je(`po:card:${day}`, day, "payout", `CARD-${addDays(day, -1)}`, `تسوية الفيزا ${addDays(day, -1)} / Card settlement`, sl([[ACC.bank, gross - fees], [ACC.cardFees, fees, dimB], [ACC.cardClearing, -gross, dimB]]), B, 10);
      bankDesc.set(e.id, { text: `POS SETTLEMENT MID 44102 ${addDays(day, -1)}`, ref: `STL${addDays(day, -1).replace(/-/g, "")}`, lag: 0 });
    }

    // 4. weekly sweeps: wallets on Monday, delivery apps on Tuesday (balance to Sunday, 22% commission + VAT on it)
    if (wd === 1) {
      const bal = balanceOf(entries, ACC.walletClearing, { to: addDays(day, -1) });
      if (bal > 0) {
        const fees = r2(bal * 0.0075);
        const e = je(`po:wallet:${day}`, day, "payout", `WALLET-${day}`, "تحويل رصيد المحافظ للبنك / Wallet sweep", sl([[ACC.bank, bal - fees], [ACC.cardFees, fees, dimB], [ACC.walletClearing, -bal, dimB]]), B, 11);
        bankDesc.set(e.id, { text: "VODAFONE CASH BUSINESS SWEEP", ref: `VFC${day.replace(/-/g, "")}`, lag: 1 });
      }
    }
    if (wd === 2) {
      const bal = balanceOf(entries, ACC.aggregatorReceivable, { to: addDays(day, -2) });
      if (bal > 0) {
        const comm = r2(bal * 0.22);
        const cvat = r2(comm * 0.14);
        const e = je(`po:apps:${day}`, day, "payout", `APPS-${day}`, "تحويل طلبات + عمولة / Delivery apps payout", sl([[ACC.bank, bal - comm - cvat], [ACC.aggregatorFees, comm, dimB], [ACC.inputVat, cvat, dimB], [ACC.aggregatorReceivable, -bal, dimB]]), B, 12);
        bankDesc.set(e.id, { text: "INWARD TRF TALABAT EGYPT LLC", ref: `TLB${day.replace(/-/g, "")}`, lag: 0 });
      }
    }

    // 5. supplier invoices: Sat / Mon / Wed (meat & vegetables are VAT-exempt)
    const purchase = (k: string, supplier: string, account: string, net: number, vatBp: number) => {
      const v = r2((net * vatBp) / 10_000);
      const inv = `INV-${++seq}`;
      const e = je(`pi:${k}:${day}`, day, "purchase-invoice", c.id(`pi:${k}:${day}`), `فاتورة ${inv} · ${supplier}`, sl([[account, net, dimB], [ACC.inputVat, v, dimB], [ACC.payables, -(net + v), { supplier }]]), B, 9);
      openInvoices.push({ k: e.id, supplier, day, total: net + v, paid: false });
      if (account === ACC.inventoryFood) weekPurch.food += net;
      else if (account === ACC.inventoryBeverage) weekPurch.bev += net;
      else weekPurch.pack += net;
    };
    if (wd === 6 || wd === 1 || wd === 3) {
      purchase("meat", SUPPLIERS.meat, ACC.inventoryFood, r2(u(11_200) * (0.9 + noise(`m:${day}`) * 0.2)), 0);
      purchase("veg", SUPPLIERS.veg, ACC.inventoryFood, r2(u(4_100) * (0.85 + noise(`v:${day}`) * 0.3)), 0);
      purchase("dry", SUPPLIERS.dry, ACC.inventoryFood, r2(u(6_100) * (0.9 + noise(`d:${day}`) * 0.2)), 1400);
    }
    if (wd === 1) purchase("bev", SUPPLIERS.bev, ACC.inventoryBeverage, r2(u(13_200) * (0.9 + noise(`b:${day}`) * 0.2)), 1400);
    if (wd === 3) purchase("pack", SUPPLIERS.pack, ACC.inventoryPackaging, r2(u(4_000) * (0.9 + noise(`p:${day}`) * 0.2)), 1400);

    // 6. Thursday: pay suppliers for invoices older than 14 days (one bank transfer per supplier)
    if (wd === 4) {
      const due = new Map<string, number>();
      for (const inv of openInvoices) if (!inv.paid && inv.day <= addDays(day, -14)) {
        inv.paid = true;
        due.set(inv.supplier, (due.get(inv.supplier) ?? 0) + inv.total);
      }
      for (const [supplier, amount] of due) {
        const k = Object.entries(SUPPLIERS).find(([, v]) => v === supplier)![0];
        const e = je(`sp:${k}:${day}`, day, "supplier.payment", c.id(`sp:${k}:${day}`), `سداد مورد · ${supplier}`, sl([[ACC.payables, amount, { supplier }], [ACC.bank, -amount]]), B, 13);
        bankDesc.set(e.id, { text: `OUTWARD TRF ${k.toUpperCase()} SUPPLIER`, ref: `OT${day.replace(/-/g, "")}${k.slice(0, 2).toUpperCase()}`, lag: 0 });
      }
    }

    // 7. Saturday stock count: last week's consumption to cost of sales
    if (wd === 6 && i < HISTORY_DAYS - 3) {
      const f = r2(weekPurch.food * (0.96 + noise(`cf:${day}`) * 0.07));
      const b = r2(weekPurch.bev * (0.95 + noise(`cb:${day}`) * 0.08));
      const p = r2(weekPurch.pack * (0.9 + noise(`cp:${day}`) * 0.15));
      je(`cogs:${day}`, day, "cogs", `COUNT-${day}`, `جرد أسبوعي - تكلفة المبيعات / Weekly count`, sl([
        [ACC.cogsFood, f, dimB], [ACC.cogsBeverage, b, dimB], [ACC.cogsPackaging, p, dimB], [ACC.inventoryFood, -f, dimB], [ACC.inventoryBeverage, -b, dimB], [ACC.inventoryPackaging, -p, dimB],
      ]), B, 8);
      weekPurch.food = weekPurch.bev = weekPurch.pack = 0;
      const waste = r2(u(450) * (0.5 + noise(`w:${day}`)));
      je(`waste:${day}`, day, "waste", `WASTE-${day}`, "هالك الأسبوع / Weekly waste", sl([[ACC.waste, waste, dimB], [ACC.inventoryFood, -waste, dimB]]), B, 8);
    }

    // 8. safe → bank deposits on Sunday and Wednesday (keep 25k in the safe)
    if (wd === 0 || wd === 3) {
      const safeBal = balanceOf(entries, ACC.safe, { to: day });
      const amount = Math.floor((safeBal - u(25_000)) / u(1_000)) * u(1_000);
      if (amount > 0) {
        const e = je(`dep:${day}`, day, "cash-transfer", c.id(`tr:dep:${day}`), `إيداع نقدي بالبنك / Cash deposit`, sl([[ACC.bank, amount], [ACC.safe, -amount, dimB]]), B, 12);
        tr(`dep:${day}`, day, "safe", "cib", amount, amount, e, "إيداع CIB فرع الزمالك", "manager", "posted", `DEP-${day.replace(/-/g, "")}`);
        bankDesc.set(e.id, { text: "CASH DEPOSIT ZAMALEK BR", ref: `DEP${day.replace(/-/g, "")}`, lag: noise(`lag:${day}`) < 0.5 ? 1 : 0 });
      }
    }

    // 9. petty cash: small daily spends, Sunday top-up back to the 5,000 imprest from the safe; tips paid out Friday
    if (wd === 0) {
      const bal = balanceOf(entries, ACC.pettyCash, { to: addDays(day, -1) });
      const top = u(5_000) - bal;
      if (top > 0) {
        const e = je(`pt:${day}`, day, "cash-transfer", c.id(`tr:pt:${day}`), "تعويض العهدة النثرية / Petty cash top-up", sl([[ACC.pettyCash, top, dimB], [ACC.safe, -top, dimB]]), B, 10);
        tr(`pt:${day}`, day, "safe", "petty", top, top, e, "تعويض العهدة", "manager");
      }
    }
    if (wd === 4) exp(`clean:${day}`, day, "cleaning", ACC.cleaning, "مكتبة ومنظفات النور", "منظفات ومناديل وأكياس زبالة", u(780 + Math.round(noise(`cl:${day}`) * 300)), 0, "petty");
    if (wd === 2 || wd === 6) exp(`ice:${day}`, day, "supplies", ACC.pettyExpenses, "مصنع ثلج الزمالك", "ثلج وفحم للشيشة والمشويات", u(260 + Math.round(noise(`ice:${day}`) * 220)), 0, "petty");
    if (noise(`tx:${day}`) < 0.3) exp(`tx:${day}`, day, "transport", ACC.transport, "مواصلات", "توصيل مشتريات عاجلة", u(120 + Math.round(noise(`txa:${day}`) * 230)), 0, "petty");
    if (noise(`mt:${day}`) < 0.07) exp(`mt:${day}`, day, "maintenance", ACC.maintenance, "ورشة التبريد المركزي", "صيانة تكييف / ثلاجات", u(1_800 + Math.round(noise(`mta:${day}`) * 2_400)), 0, "safe");
    if (wd === 5) {
      const tipsBal = -balanceOf(entries, ACC.tipsPayable, { to: day });
      if (tipsBal > 0) je(`tips:${day}`, day, "tips.payout", `TIPS-${day}`, "صرف التيبس للعاملين / Tips paid out", sl([[ACC.tipsPayable, tipsBal, dimB], [ACC.safe, -tipsBal, dimB]]), B, 23);
    }

    // 10. monthly: recurring bills, payroll + service charge on the 28th, insurance / payroll tax on the 15th, depreciation at month end
    for (const r of recurringExpenses) if (r.dayOfMonth === dom) {
      const vary2 = ["electricity", "gas", "water"].includes(r.category) ? 0.85 + noise(`${r.id}:${day}`) * 0.3 : 1;
      const net = r2(r.net * vary2);
      const vatAmt = r.vat ? r2((net * 1400) / 10_000) : 0;
      const paidFromKey = r.paidFromId === caId("cib") ? "cib" : r.paidFromId === caId("safe") ? "safe" : null;
      const e = exp(`${r.category}:${day}`, day, r.category, r.glCode, r.vendor, r.description, net, vatAmt, paidFromKey, { recurringId: r.id, branchId: r.branchId, invoiceNo: `${r.category.slice(0, 3).toUpperCase()}-${day.slice(0, 7)}`, createdBy: S("accountant") });
      if (e && paidFromKey === "cib") bankDesc.set(e.id, { text: r.category === "rent" ? "STANDING ORDER RENT" : `CARD/TRF ${r.vendor}`, ref: `${r.category.slice(0, 4).toUpperCase()}${day.replace(/-/g, "")}`, lag: 0 });
    }
    // last month's payroll (accrual, payment and the service-charge share) is seeded by HR (src/modules/hr/seed.ts) through the same accounts
    const hrMonth = addDays(monthStart(today), -1).slice(0, 7);
    if (dom === 28 && day.slice(0, 7) !== hrMonth) {
      const gross = payroll;
      const insurable = r2(gross * 0.62);
      const erSi = r2(insurable * 0.1875);
      const eeSi = r2(insurable * 0.11);
      const tax = r2(gross * 0.035);
      const net = gross - eeSi - tax;
      je(`pay:${day}`, day, "payroll", `PAYROLL-${day.slice(0, 7)}`, `مرتبات شهر ${day.slice(0, 7)} / Payroll`, sl([
        [ACC.salaries, gross, dimB], [ACC.socialInsurance, erSi, dimB], [ACC.salariesPayable, -net], [ACC.socialInsurancePayable, -(erSi + eeSi)], [ACC.payrollTaxPayable, -tax],
      ]), B, 15);
      const pe = je(`payout:${day}`, day, "payroll.payment", `PAYROLL-${day.slice(0, 7)}`, "صرف المرتبات / Salaries paid", sl([[ACC.salariesPayable, net], [ACC.bank, -net]]), B, 16);
      bankDesc.set(pe.id, { text: "PAYROLL BULK TRF", ref: `PAY${day.slice(0, 7).replace("-", "")}`, lag: 0 });
      const svc = -balanceOf(entries, ACC.servicePayable, { to: day });
      if (svc > 0) {
        const se = je(`svc:${day}`, day, "service.payout", `SERVICE-${day.slice(0, 7)}`, "توزيع الخدمة على العاملين / Service charge paid out", sl([[ACC.servicePayable, svc, dimB], [ACC.bank, -svc]]), B, 16);
        bankDesc.set(se.id, { text: "PAYROLL BULK TRF SERVICE", ref: `SVC${day.slice(0, 7).replace("-", "")}`, lag: 0 });
      }
    }
    if (dom === 15) {
      const si = -balanceOf(entries, ACC.socialInsurancePayable, { to: addDays(day, -1) });
      const pt = -balanceOf(entries, ACC.payrollTaxPayable, { to: addDays(day, -1) });
      if (si > 0) {
        const e = je(`si:${day}`, day, "tax.payment", `SI-${day.slice(0, 7)}`, "سداد التأمينات الاجتماعية / Social insurance", sl([[ACC.socialInsurancePayable, si], [ACC.bank, -si]]), B, 11);
        bankDesc.set(e.id, { text: "NOSI E-PAYMENT", ref: `NOSI${day.slice(0, 7).replace("-", "")}`, lag: 0 });
      }
      if (pt > 0) {
        const e = je(`pt-tax:${day}`, day, "tax.payment", `PTAX-${day.slice(0, 7)}`, "سداد ضريبة كسب العمل / Payroll tax", sl([[ACC.payrollTaxPayable, pt], [ACC.bank, -pt]]), B, 11);
        bankDesc.set(e.id, { text: "ETA E-PAYMENT SALARY TAX", ref: `PTX${day.slice(0, 7).replace("-", "")}`, lag: 0 });
      }
    }
    if (day === monthEnd(day)) je(`dep-fa:${day}`, day, "depreciation", `DEPR-${day.slice(0, 7)}`, "إهلاك الشهر / Monthly depreciation", sl([[ACC.depreciation, u(23_333.33), dimB], [ACC.accumulatedDepreciation, -u(23_333.33)]]), B, 23);

    // 11. VAT: return for month m filed on the 10th of m+1 (period locked), paid on the last day of m+1
    if (dom === 10) {
      const m = addDays(monthStart(day), -1);
      const from = monthStart(m) < start ? start : monthStart(m);
      const r = vatReturn(entries, from, m);
      if (r.outputVat || r.inputVat) je(`vat:${m}`, day, "vat-return", `${from}..${m}`, `إقرار ضريبة القيمة المضافة ${m.slice(0, 7)} / VAT return`, vatSettlementLines(r), null, 10);
    }
    if (day === monthEnd(day)) {
      const owed = -balanceOf(entries, ACC.vatSettlement, { to: day });
      if (owed > 0) {
        const e = je(`vatpay:${day}`, day, "tax.payment", `VATPAY-${day.slice(0, 7)}`, "سداد ضريبة القيمة المضافة / VAT paid to ETA", sl([[ACC.vatSettlement, owed], [ACC.bank, -owed]]), null, 12);
        bankDesc.set(e.id, { text: "ETA E-PAYMENT VAT", ref: `VAT${day.slice(0, 7).replace("-", "")}`, lag: 0 });
      }
    }
  }

  const lastVat = entries.filter((e) => e.sourceType === "vat-return").map((e) => e.sourceId.split("..")[1]).sort().pop() ?? null;
  const accountingSettings: AccountingSettings[] = [{
    ...base("acct:settings"), closedThrough: lastVat, closeHistory: entries.filter((e) => e.sourceType === "vat-return").map((e) => ({ through: e.sourceId.split("..")[1], by: S("accountant"), at: e.createdAt, note: "إقرار القيمة المضافة / VAT filed" })),
    payrollDay: 28, payrollEstimate: payroll, vatDueDay: 31, lowCashThreshold: u(150_000), overShortAlert: u(200), journalApprovalLimit: u(5_000), defaultFoodCostBp: 3200, supplierTermsDays: 14,
  }];

  /* ── open items for today (approvals waiting) ── */
  exp("pending:fridge", today, "maintenance", ACC.maintenance, "ورشة التبريد المركزي", "صيانة ثلاجة العرض - تغيير موتور المروحة", u(1_850), 0, "petty", { status: "pending", receiptPhoto: DEMO_RECEIPT_PHOTO, createdBy: S("manager") });
  exp("pending:print", today, "marketing", ACC.marketing, "مطبعة الأهرام الحديثة", "طباعة منيو جديد ١٠٠ نسخة", u(2_400), u(336), null, { status: "pending", dueDate: addDays(today, 14), invoiceNo: "PR-7781", createdBy: S("manager") });
  const safeNow = balanceOf(entries, ACC.safe, {});
  const dep = Math.floor((safeNow - u(25_000)) / u(1_000)) * u(1_000);
  if (dep > 0) tr("pending:deposit", today, "safe", "cib", dep, null, null, "إيداع اليوم - مستني موافقة", "manager", "pending", "");
  const journalDrafts: JournalDraft[] = [{
    ...base("jd:elec", today, 11), branchId: B, date: yesterday, memo: "إثبات كهرباء مستحقة عن الشهر (لم تصل الفاتورة) / Electricity accrual", lines: sl([[ACC.electricity, u(9_500), dimB], [ACC.accrued, -u(9_500)]]),
    status: "pending", requestedBy: S("accountant"), approvedBy: null, decidedAt: null, reason: "", ledgerEntryId: null, kind: "manual", reverses: null,
  }];

  /* ── bank statement (CIB) for the last 40 days ── */
  const winStart = addDays(today, -40);
  const bankEntries = entries.filter((e) => e.date >= winStart && e.lines.some((l) => l.account === ACC.bank)).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  let bal = balanceOf(entries, ACC.bank, { to: addDays(winStart, -1) });
  const raw: Omit<BankStatementLine, "balance">[] = [];
  const bank = caId("cib");
  const batch = `CIB-${today.slice(0, 7)}`;
  for (const e of bankEntries) {
    const amount = e.lines.filter((l) => l.account === ACC.bank).reduce((a, l) => a + l.debit - l.credit, 0);
    const d = bankDesc.get(e.id) ?? { text: e.memo.slice(0, 40), ref: "", lag: 0 };
    const date = addDays(e.date, d.lag);
    if (date >= today) continue; // not on the statement yet
    const matched = date < addDays(today, -12);
    raw.push({
      ...base(`bl:${e.id}`, date, 7), cashAccountId: bank, date, description: d.text, reference: d.ref, amount, batchId: batch, status: matched ? "matched" : "unmatched",
      matchKind: matched ? "auto" : null, matchedEntryId: matched ? e.id : null, matchedBy: matched ? S("accountant") : null, matchedAt: matched ? at(addDays(date, 2), 10) : null,
    });
  }
  // lines the books don't know yet
  const extra = (k: string, date: string, description: string, amount: number, reference = "") =>
    raw.push({ ...base(`bl:x:${k}`, date, 7), cashAccountId: bank, date, description, reference, amount, batchId: batch, status: "unmatched", matchKind: null, matchedEntryId: null, matchedBy: null, matchedAt: null });
  for (const m of [...months]) {
    const d = `${m}-25`;
    if (d >= winStart && d < today) extra(`fee:${m}`, d, "ACCOUNT MAINTENANCE FEE", -u(75), `FEE${m.replace("-", "")}`);
    const s = `${m}-26`;
    if (s >= winStart && s < today) extra(`sms:${m}`, s, "SMS ALERTS FEE", -u(15), `SMS${m.replace("-", "")}`);
  }
  extra("event", addDays(today, -6), "INWARD INSTAPAY M.ELSAYED", u(3_500), "IPN88213");
  raw.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const bankLines: BankStatementLine[] = raw.map((l) => {
    bal += l.amount;
    return { ...l, balance: bal };
  });

  return { glAccounts, costCentres, journalDrafts, accountingSettings, cashAccounts, cashTransfers: transfers, expenses, recurringExpenses, bankLines, ledgerEntries: entries };
}
