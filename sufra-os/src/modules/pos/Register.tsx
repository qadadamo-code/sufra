/**
 * The register: menu on one side, the current check on the other (bottom sheet on phones).
 * Keyboard: S search · N new · K send · H hold · P pay · D discount · X split · T transfer · O open checks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { Bike, ChevronDown, ClipboardList, LayoutGrid, Plus, ReceiptText, ShoppingBag, Store, Timer, UserRound, Users, Utensils, Wallet } from "lucide-react";
import { useApproval } from "@/auth/approval";
import { useSession } from "@/auth/session";
import { useDb, useLive, useRow } from "@/data/hooks";
import { priceItems } from "@/data/pricing";
import { recomputeCheck } from "@/data/ops";
import type { Check, Discount, MenuItem, OrderItem, OrderMode, Payment } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, type Units } from "@/lib/money";
import { loadRaw, saveRaw } from "@/lib/storage";
import type { ReceiptModel } from "@/lib/receipt";
import { AnimatedMoney, Button, Dialog, useCommands, useHotkeys, useIsMobile, useReduced, useToast, spring } from "@/ui";
import { MenuPanel } from "./components/MenuPanel";
import { ModifierSheet, type ModifierChoice } from "./components/ModifierSheet";
import { TicketPanel } from "./components/TicketPanel";
import { LineSheet } from "./components/LineSheet";
import { DiscountDialog } from "./components/DiscountDialog";
import { SplitDialog } from "./components/SplitDialog";
import { TablePicker } from "./components/TablePicker";
import { CustomerDialog, type CustomerResult } from "./components/CustomerDialog";
import { PaymentDialog, type TenderInput } from "./components/PaymentDialog";
import { ReceiptDialog } from "./components/ReceiptDialog";
import { OpenChecksDialog, TransferDialog, useCheckRows } from "./components/Checks";
import { OpenShiftDialog } from "./components/OpenShiftDialog";
import { Stepper } from "./components/bits";
import { discountPct, lineDiscountUnits } from "./math";
import { addLine, discardTicket, loadTicket, mergeChecks, moveCheckToTable, moveItems, openTicket, sendToKitchen, setBillDiscount, setLineDiscount, setLineQty, setTicketMeta, splitIntoChecks, updateLine, voidLine, type TicketDraft } from "./ops";
import { closeCheck, takePayment, voidPayment } from "./sale";
import { useMenu, useReceiptSourceBuilder, useSettings, useShift } from "./usePos";

const ACTIVE_KEY = "sufra-os.pos.active";
type Kind = "dine_in" | "takeaway" | "pickup" | "delivery";
const NEW_DRAFT = (kind: Kind = "dine_in"): TicketDraft => ({ mode: kind === "pickup" ? "takeaway" : kind, pickup: kind === "pickup", tableIds: [], guests: kind === "dine_in" ? 2 : 1, customerId: null, deliveryFee: 0, delivery: null, pickupAt: null });

export default function Register() {
  const { L, loc, lang } = useT();
  const db = useDb();
  const approve = useApproval();
  const { toast } = useToast();
  const session = useSession();
  const reduced = useReduced();
  const isMobile = useIsMobile();
  const menu = useMenu();
  const settings = useSettings();
  const { device, shift } = useShift();
  const receiptSrc = useReceiptSourceBuilder();
  const searchRef = useRef<HTMLInputElement>(null);

  const [activeId, setActiveIdState] = useState<string | null>(() => loadRaw(ACTIVE_KEY));
  const setActiveId = useCallback((id: string | null) => {
    saveRaw(ACTIVE_KEY, id);
    setActiveIdState(id);
  }, []);
  const [draft, setDraft] = useState<TicketDraft>(NEW_DRAFT());
  const [busy, setBusy] = useState(false);

  /* ── live data ── */
  const check = useRow("checks", activeId).data;
  const ordersLive = useLive("orders", { where: { checkId: activeId ?? "-" }, orderBy: [{ field: "openedAt" }] }, { enabled: !!activeId }).data;
  const orders = activeId ? ordersLive.filter((o) => o.checkId === activeId) : [];
  const itemsLive = useLive("orderItems", { where: { orderId: orders.map((o) => o.id) }, orderBy: [{ field: "createdAt" }] }, { enabled: orders.length > 0 }).data;
  const items = orders.length ? itemsLive.filter((i) => orders.some((o) => o.id === i.orderId)) : [];
  const paymentsLive = useLive("payments", { where: { checkId: activeId ?? "-" }, orderBy: [{ field: "createdAt" }] }, { enabled: !!activeId }).data;
  const payments = activeId ? paymentsLive.filter((p) => p.checkId === activeId) : [];
  const openChecks = useLive("checks", { where: { status: ["open", "bill_requested"] }, orderBy: [{ field: "openedAt" }] }).data;
  const openOrders = useLive("orders", { where: { checkId: openChecks.map((c) => c.id) } }, { enabled: openChecks.length > 0 }).data;
  const openItems = useLive("orderItems", { where: { orderId: openOrders.map((o) => o.id) } }, { enabled: openOrders.length > 0 }).data;
  const tables = useLive("tables", { where: { active: true }, orderBy: [{ field: "label" }] }).data;
  const zones = useLive("zones", { orderBy: [{ field: "sort" }] }).data;
  const customers = useLive("customers").data;
  const rows = useCheckRows(openChecks, openOrders, openItems, tables, customers);

  const order = orders[0] ?? null;
  const live = check && (check.status === "open" || check.status === "bill_requested");
  const kind: Kind = check ? (order?.pickupAt ? "pickup" : (order?.mode ?? "dine_in")) : draft.pickup ? "pickup" : draft.mode;
  const tableIds = check ? check.tableIds : draft.tableIds;
  const tableLabel = tableIds.map((id) => tables.find((t) => t.id === id)?.label ?? "?").join(" + ");
  const customer = customers.find((c) => c.id === (check?.customerId ?? draft.customerId)) ?? null;
  const guests = check?.guests ?? draft.guests;
  const anySent = items.some((i) => i.status !== "new" && i.status !== "void");
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.status !== "void") m.set(i.itemId, (m.get(i.itemId) ?? 0) + i.qty);
    return m;
  }, [items]);

  /* ── dialogs ── */
  const [modItem, setModItem] = useState<MenuItem | null>(null);
  const [lineItem, setLineItem] = useState<OrderItem | null>(null);
  const [dlg, setDlg] = useState<null | "table" | "customer" | "discount" | "split" | "pay" | "checks" | "transfer" | "merge" | "moveTable" | "itemsToTable" | "guests" | "shift" | "ticket">(null);
  const [shares, setShares] = useState<{ amounts: Units[]; labels: string[] } | null>(null);
  const [receipt, setReceipt] = useState<{ model: ReceiptModel; etaError: string | null; title?: string } | null>(null);
  const pendingItem = useRef<{ item: MenuItem; choice: ModifierChoice | null } | null>(null);
  const pendingMoves = useRef<{ itemId: string; qty: number }[]>([]);
  const afterShift = useRef<(() => void) | null>(null);

  // a check closed or voided elsewhere (another tablet, the waiter app) leaves the register
  useEffect(() => {
    if (activeId && check && !live && !receipt && dlg !== "pay") setActiveId(null);
  }, [activeId, check, live, receipt, dlg, setActiveId]);
  useEffect(() => {
    if (activeId && !check) {
      const t = setTimeout(() => db.get("checks", activeId).then((c) => !c && setActiveId(null)), 800);
      return () => clearTimeout(t);
    }
  }, [activeId, check, db, setActiveId]);

  const fail = (e: unknown) => toast({ title: L("حصلت مشكلة", "Something went wrong"), description: String((e as Error)?.message ?? e), tone: "error" });
  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      fail(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  };

  const newTicket = (k: Kind = kind) => {
    setActiveId(null);
    setDraft(NEW_DRAFT(k));
    setShares(null);
    if (k === "dine_in") setDlg("table");
    else if (k === "delivery") setDlg("customer");
  };

  /** Ensures a check exists (dine-in needs a table first). */
  const ensure = async (): Promise<{ checkId: string; orderId: string } | null> => {
    if (check && live && order) return { checkId: check.id, orderId: order.id };
    if (draft.mode === "dine_in" && !draft.tableIds.length) {
      setDlg("table");
      return null;
    }
    const { check: c, order: o } = await openTicket(db, draft);
    setActiveId(c.id);
    return { checkId: c.id, orderId: o.id };
  };

  const add = async (item: MenuItem, choice: ModifierChoice | null) => {
    const t = await run(ensure);
    if (!t) {
      pendingItem.current = { item, choice };
      return;
    }
    const mods = choice?.modifiers ?? menu.mods.filter((m) => item.modifierGroupIds.includes(m.groupId) && m.isDefault && m.available);
    const current = activeId === t.checkId ? items : [];
    await run(() =>
      addLine(db, { orderId: t.orderId, checkId: t.checkId, items: current, tableId: draft.tableIds[0] ?? check?.tableIds[0] ?? null }, { item, modifiers: mods, qty: choice?.qty ?? 1, notes: choice?.notes ?? "", seat: choice?.seat ?? null, course: choice?.course ?? 1 }, menu.cats),
    );
  };

  const pick = (item: MenuItem, { forceSheet }: { forceSheet: boolean }) => {
    if (!item.available) return toast({ title: L("الصنف ده خلصان النهارده", "This item is 86'd today"), tone: "warn" });
    const required = item.modifierGroupIds.some((g) => (menu.groups.find((x) => x.id === g)?.min ?? 0) > 0);
    if (forceSheet || required) setModItem(item);
    else void add(item, null);
  };

  /* ── order type / table / customer ── */
  const setKind = async (k: Kind) => {
    if (!check) {
      setDraft((d) => ({ ...NEW_DRAFT(k), customerId: d.customerId }));
      if (k === "dine_in") setDlg("table");
      if (k === "delivery" || k === "pickup") setDlg("customer");
      return;
    }
    if (anySent) return toast({ title: L("الطلب في المطبخ — مينفعش تغيّر النوع", "Already in the kitchen — type can't change"), tone: "warn" });
    const mode: OrderMode = k === "pickup" ? "takeaway" : k;
    await run(async () => {
      for (const o of orders) await db.update("orders", o.id, { mode, pickupAt: k === "pickup" ? (o.pickupAt ?? new Date(Date.now() + 20 * 60_000).toISOString()) : null, tableIds: mode === "dine_in" ? check.tableIds : [], deliveryStatus: mode === "delivery" ? "pending" : null });
      if (mode !== "dine_in") await db.update("checks", check.id, { tableIds: [] });
      await recomputeCheck(db, check.id);
    });
    if (k === "dine_in" && !check.tableIds.length) setDlg("moveTable");
    if (k === "delivery" || k === "pickup") setDlg("customer");
  };

  const onTable = async (tableId: string, existing: Check | null) => {
    setDlg(null);
    if (dlg === "moveTable" && check) {
      if (existing && existing.id !== check.id) {
        await run(() => mergeChecks(db, existing, check));
        setActiveId(existing.id);
        return toast({ title: L("الشيكين اندمجوا", "Checks merged"), tone: "success" });
      }
      const t = await loadTicket(db, check.id);
      if (t) await run(() => moveCheckToTable(db, t, tableId));
      return toast({ title: L("الشيك اتنقل", "Check moved"), tone: "success" });
    }
    if (dlg === "itemsToTable" && check) {
      const from = await loadTicket(db, check.id);
      if (!from) return;
      await run(async () => {
        const target = existing ?? (await openTicket(db, { ...NEW_DRAFT("dine_in"), tableIds: [tableId] })).check;
        await moveItems(db, from, target, pendingMoves.current);
      });
      return toast({ title: L("الأصناف اتنقلت", "Lines moved"), tone: "success" });
    }
    if (existing) {
      setActiveId(existing.id);
      toast({ title: L(`ترابيزة ${tables.find((t) => t.id === tableId)?.label}: الشيك المفتوح`, `Table ${tables.find((t) => t.id === tableId)?.label}: open check`) });
      return;
    }
    setActiveId(null);
    const d = { ...NEW_DRAFT("dine_in"), tableIds: [tableId], guests: draft.guests || 2 };
    setDraft(d);
    const p = pendingItem.current;
    pendingItem.current = null;
    if (p) {
      const t = await run(() => openTicket(db, d));
      if (!t) return;
      setActiveId(t.check.id);
      const mods = p.choice?.modifiers ?? menu.mods.filter((m) => p.item.modifierGroupIds.includes(m.groupId) && m.isDefault && m.available);
      await run(() => addLine(db, { orderId: t.order.id, checkId: t.check.id, items: [], tableId }, { item: p.item, modifiers: mods, qty: p.choice?.qty ?? 1, notes: p.choice?.notes ?? "", seat: p.choice?.seat ?? null, course: p.choice?.course ?? 1 }, menu.cats));
    }
  };

  const onCustomer = async (r: CustomerResult) => {
    setDlg(null);
    if (check) {
      const t = await loadTicket(db, check.id);
      if (t) await run(() => setTicketMeta(db, t, { customerId: r.customer?.id ?? null, ...(order?.mode === "delivery" ? { delivery: r.delivery, deliveryFee: r.deliveryFee } : {}) }));
      if (r.pickupAt) for (const o of orders) await db.update("orders", o.id, { pickupAt: r.pickupAt });
    } else setDraft((d) => ({ ...d, customerId: r.customer?.id ?? null, delivery: r.delivery, deliveryFee: r.deliveryFee, pickupAt: r.pickupAt }));
  };

  /* ── ticket actions ── */
  const ticket = async () => (check ? loadTicket(db, check.id) : null);
  const send = async () => {
    const t = await ticket();
    if (!t) return;
    const n = await run(() => sendToKitchen(db, t));
    if (n) {
      toast({ title: L(`اتبعت ${n} صنف للمطبخ`, `Sent ${n} line${n > 1 ? "s" : ""} to the kitchen`), tone: "success" });
      if (order?.mode === "dine_in") newTicket("dine_in");
    }
  };
  const fire = async (course: number) => {
    const t = await ticket();
    if (!t) return;
    const n = await run(() => sendToKitchen(db, t, course));
    if (n) toast({ title: L(`الكورس ${course} اتبعت`, `Course ${course} fired`), tone: "success" });
  };
  const hold = async () => {
    if (check && !items.length) {
      const t = await ticket();
      if (t) await run(() => discardTicket(db, t));
    } else if (check) toast({ title: L("الشيك اتعلّق — تلاقيه في الشيكات المفتوحة", "Check held — find it under Open checks") });
    newTicket(kind === "dine_in" ? "dine_in" : kind);
  };
  const discard = async () => {
    const t = await ticket();
    if (!t) return;
    await run(() => discardTicket(db, t));
    newTicket(kind);
  };

  const policy = { discountApprovalPct: settings?.discountApprovalPct ?? 10 };
  const preview = (d: Discount | null) => (settings && order ? priceItems(items, { mode: order.mode, tax: settings.tax, discount: d, deliveryFee: order.deliveryFee }).totals.total : 0);
  const applyDiscount = async (d: Discount | null, reason: string) => {
    if (!check) return;
    if (d) {
      const pct = discountPct(d, check.subtotal - items.reduce((a, i) => a + i.discount, 0));
      const who = await approve({ kind: "discount", pct }, L(`خصم ${pct.toFixed(0)}% على الشيك`, `${pct.toFixed(0)}% bill discount`), policy);
      if (!who) return;
      await run(() => setBillDiscount(db, check.id, d, reason, who.id));
    } else await run(() => setBillDiscount(db, check.id, null, null, null));
    setDlg(null);
  };

  const onLineSave = async (it: OrderItem, patch: { qty?: number; notes?: string; seat?: number | null; course?: number }) => {
    if (!check) return;
    setLineItem(null);
    await run(async () => {
      if (patch.qty != null && patch.qty !== it.qty) await setLineQty(db, check.id, it, patch.qty);
      const { qty: _q, ...rest } = patch;
      await updateLine(db, check.id, it, rest);
    });
  };
  const onLineVoid = async (it: OrderItem, reason: string) => {
    if (!check) return;
    const afterSend = it.status !== "new";
    const who = await approve({ kind: "void", afterSend }, L(`إلغاء ${loc(it.name)}`, `Void ${loc(it.name)}`));
    if (!who) return;
    setLineItem(null);
    await run(() => voidLine(db, check.id, it, reason, afterSend ? who.id : null));
  };
  const onLineDiscount = async (it: OrderItem, d: Discount | null, reason: string) => {
    if (!check) return;
    if (d) {
      const units = lineDiscountUnits(it, d);
      const base = (it.unitPrice + it.modifiers.reduce((a, m) => a + m.price, 0)) * it.qty;
      const pct = base ? (units / base) * 100 : 0;
      const who = await approve({ kind: "discount", pct }, L(`خصم على ${loc(it.name)}`, `Discount on ${loc(it.name)}`), policy);
      if (!who) return;
      setLineItem(null);
      await run(() => setLineDiscount(db, check.id, it, units, reason, who.id));
    } else {
      setLineItem(null);
      await run(() => setLineDiscount(db, check.id, it, 0, "", null));
    }
  };

  const price = (list: OrderItem[]) => (settings && order ? priceItems(list, { mode: order.mode, tax: settings.tax, discount: check?.discount ?? null, deliveryFee: order.deliveryFee }).totals.total : 0);

  /* ── payment ── */
  const requireShift = (then: () => void) => {
    if (shift) return then();
    afterShift.current = then;
    setDlg("shift");
  };
  const pay = () => {
    if (!check || !items.some((i) => i.status !== "void")) return;
    requireShift(() => setDlg("pay"));
  };
  const finish = async () => {
    if (!check) return;
    const res = await run(() => closeCheck(db, check.id, { shift, device }));
    if (!res || !receiptSrc) return;
    const fresh = await loadTicket(db, check.id);
    const pays = await db.list("payments", { where: { checkId: check.id } });
    setDlg(null);
    setShares(null);
    if (fresh) setReceipt({ model: receiptSrc.fromReceipt(res.receipt, fresh.check, fresh.orders, pays), etaError: res.etaError, title: L(`إيصال ${res.receipt.receiptNo}`, `Receipt ${res.receipt.receiptNo}`) });
    if (res.ledgerError) toast({ title: L("القيد المحاسبي اتسجل كخطأ للمحاسب", "Ledger posting logged for the accountant"), description: res.ledgerError, tone: "warn" });
  };
  const tender = async (t: TenderInput) => {
    if (!check) return;
    await run(() => takePayment(db, check, t));
    const fresh = await db.get("checks", check.id);
    if (fresh && fresh.paid >= fresh.total) await finish();
  };
  const voidTender = async (p: Payment) => {
    const who = await approve({ kind: "refund" }, L("إلغاء دفعة", "Void a payment"));
    if (who) await run(() => voidPayment(db, p));
  };
  const prebill = async () => {
    if (!check || !receiptSrc) return;
    const m = receiptSrc.fromCheck(check, orders, items, payments, session.staff?.id ?? null);
    if (!m) return;
    if (check.status === "open") {
      await run(() => db.update("checks", check.id, { status: "bill_requested" }));
      for (const tid of check.tableIds) await db.update("tables", tid, { status: "bill" });
    }
    setReceipt({ model: m, etaError: null, title: L("شيك مبدئي", "Pre-bill") });
  };

  /* ── keyboard + palette ── */
  const k = (fn: () => void) => (e: KeyboardEvent) => {
    e.preventDefault();
    fn();
  };
  useHotkeys(
    {
      s: k(() => searchRef.current?.focus()),
      n: k(() => newTicket(kind)),
      k: k(() => void send()),
      h: k(() => void hold()),
      p: k(pay),
      d: k(() => check && setDlg("discount")),
      x: k(() => check && setDlg("split")),
      t: k(() => check && setDlg("transfer")),
      o: k(() => setDlg("checks")),
    },
    {
      descriptions: {
        s: { ar: "دوّر في المنيو", en: "Search menu" },
        n: { ar: "طلب جديد", en: "New order" },
        k: { ar: "ابعت للمطبخ", en: "Send to kitchen" },
        h: { ar: "علّق الشيك", en: "Hold check" },
        p: { ar: "ادفع", en: "Pay" },
        d: { ar: "خصم", en: "Discount" },
        x: { ar: "قسّم الشيك", en: "Split check" },
        t: { ar: "نقل", en: "Transfer" },
        o: { ar: "الشيكات المفتوحة", en: "Open checks" },
      },
    },
  );
  useCommands(
    [
      { id: "pos.new", group: "actions", title: { ar: "طلب جديد", en: "New order" }, icon: <Plus />, shortcut: "n", perform: () => newTicket(kind) },
      { id: "pos.checks", group: "actions", title: { ar: "الشيكات المفتوحة", en: "Open checks" }, icon: <ClipboardList />, shortcut: "o", perform: () => setDlg("checks") },
    ],
    [kind],
  );

  /* ── header ── */
  const KINDS: { k: Kind; label: string; icon: typeof Utensils }[] = [
    { k: "dine_in", label: L("صالة", "Dine-in"), icon: Utensils },
    { k: "takeaway", label: L("تيك أواي", "Takeaway"), icon: ShoppingBag },
    { k: "pickup", label: L("استلام", "Pickup"), icon: Store },
    { k: "delivery", label: L("دليفري", "Delivery"), icon: Bike },
  ];
  const header = (
    <div className="border-b border-line px-3 pt-3 pb-2.5">
      <div className="grid grid-cols-4 gap-1 rounded-[14px] bg-surface-2 p-1" role="radiogroup" aria-label={L("نوع الطلب", "Order type")}>
        {KINDS.map(({ k: kk, label, icon: Icon }) => (
          <button key={kk} type="button" role="radio" aria-checked={kind === kk} onClick={() => void setKind(kk)} className={cn("relative flex h-11 flex-col items-center justify-center rounded-[10px] text-[12px] font-semibold leading-none", kind === kk ? "text-ink" : "text-muted hover:text-ink")}>
            {kind === kk ? <motion.span layoutId="pos-kind" className="absolute inset-0 rounded-[10px] bg-surface shadow-sf-sm ring-1 ring-line" transition={reduced ? { duration: 0 } : spring.layout} /> : null}
            <Icon className="relative mb-1 size-4" />
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        {kind === "dine_in" ? (
          <button type="button" onClick={() => setDlg(check ? "moveTable" : "table")} className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-start hover:bg-surface-2">
            <LayoutGrid className="size-[18px] shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-semibold">{tableLabel ? `${L("ترابيزة", "Table")} ${tableLabel}` : L("اختار ترابيزة", "Pick a table")}</span>
            <ChevronDown className="size-4 text-muted" />
          </button>
        ) : (
          <button type="button" onClick={() => setDlg("customer")} className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-start hover:bg-surface-2">
            {kind === "delivery" ? <Bike className="size-[18px] shrink-0 text-primary" /> : kind === "pickup" ? <Timer className="size-[18px] shrink-0 text-primary" /> : <UserRound className="size-[18px] shrink-0 text-primary" />}
            <span className="min-w-0 flex-1 truncate font-semibold">
              {customer ? customer.name || customer.phone : kind === "delivery" ? L("العميل والعنوان", "Customer & address") : L("عميل (اختياري)", "Customer (optional)")}
              {kind === "pickup" && (order?.pickupAt ?? draft.pickupAt) ? <span className="num ms-1.5 text-[12.5px] font-medium text-muted">· {new Date((order?.pickupAt ?? draft.pickupAt)!).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" })}</span> : null}
            </span>
            <ChevronDown className="size-4 text-muted" />
          </button>
        )}
        {kind === "dine_in" ? (
          <button type="button" onClick={() => setDlg("guests")} className="flex h-11 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 font-semibold hover:bg-surface-2" aria-label={L("عدد الأفراد", "Guests")}>
            <Users className="size-[18px] text-muted" />
            <span className="num">{guests}</span>
          </button>
        ) : null}
        {order ? (
          <span className="num rounded-lg bg-surface-3 px-2 py-1 text-[12.5px] font-semibold text-ink-2" title={L("رقم الطلب", "Order number")}>
            #{order.number}
          </span>
        ) : null}
      </div>
    </div>
  );

  const ticketPanel = (
    <TicketPanel
      check={live ? check : null}
      orders={orders}
      items={live ? items : []}
      header={header}
      busy={busy}
      className="@container h-full"
      onLine={setLineItem}
      onQty={(it, q) => check && void run(() => setLineQty(db, check.id, it, q))}
      onSend={() => void send()}
      onFire={(c) => void fire(c)}
      onHold={() => void hold()}
      onPay={pay}
      onDiscount={() => setDlg("discount")}
      onSplit={() => setDlg("split")}
      onTransfer={() => setDlg("transfer")}
      onMerge={() => setDlg("merge")}
      onPrebill={() => void prebill()}
      onDiscard={() => void discard()}
      onGuests={() => setDlg("guests")}
    />
  );

  const itemCount = items.filter((i) => i.status !== "void").reduce((a, i) => a + i.qty, 0);

  return (
    <div className="-mx-4 -mt-5 -mb-28 flex h-[calc(100dvh-8rem-env(safe-area-inset-bottom))] min-h-0 flex-col md:-mx-6 md:-mt-6 md:-mb-10 md:h-[calc(100dvh-4rem)] xl:-mx-8">
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-3 py-2 backdrop-blur md:px-4">
        <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => newTicket(kind)}>
          {L("طلب جديد", "New")}
        </Button>
        <Button size="sm" variant="secondary" icon={<ClipboardList className="size-4" />} onClick={() => setDlg("checks")}>
          {L("المفتوح", "Open")} <span className="num rounded-full bg-primary-soft px-1.5 text-[12px] text-primary">{rows.length}</span>
        </Button>
        <div className="flex-1" />
        {shift ? (
          <Link to="/pos/shift" className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-surface-2 sm:flex">
            <span className="size-2 rounded-full bg-ok" /> {L("وردية", "Shift")} · <span className="num">{device}</span>
          </Link>
        ) : (
          <Button size="sm" variant="brass" icon={<Wallet className="size-4" />} onClick={() => setDlg("shift")}>
            {L("افتح وردية", "Open shift")}
          </Button>
        )}
        <Link to="/pos/eta" className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-surface-2 sm:flex">
          <ReceiptText className="size-4" /> ETA
        </Link>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="@container flex min-h-0 min-w-0 flex-1 flex-col">
          <MenuPanel ref={searchRef} cats={menu.cats} items={menu.items} counts={counts} onPick={pick} />
        </div>
        {!isMobile ? <aside className="w-[340px] shrink-0 border-s border-line lg:w-[380px] 2xl:w-[420px]">{ticketPanel}</aside> : null}
      </div>

      {isMobile ? (
        <motion.button
          type="button"
          onClick={() => setDlg("ticket")}
          initial={false}
          animate={{ y: 0 }}
          className="mx-3 mb-2 flex h-14 shrink-0 items-center gap-3 rounded-2xl bg-ink px-4 text-bg shadow-sf-lg"
        >
          <span className="num grid size-8 place-items-center rounded-xl bg-white/15 text-[15px] font-bold">{itemCount}</span>
          <span className="flex-1 text-start font-semibold">{check ? `${L("الشيك", "Check")}${tableLabel ? ` · ${tableLabel}` : ""}` : L("الشيك فاضي", "Empty check")}</span>
          <AnimatedMoney value={live && check ? check.total : 0} className="text-[18px] font-semibold" />
        </motion.button>
      ) : null}
      {isMobile ? (
        <Dialog open={dlg === "ticket"} onClose={() => setDlg(null)} variant="bottom" hideClose className="h-[88dvh]">
          <div className="-mx-5 -mb-5 h-[calc(88dvh-2.5rem)]">{ticketPanel}</div>
        </Dialog>
      ) : null}

      {/* dialogs */}
      <ModifierSheet
        item={modItem}
        groups={menu.groups}
        mods={menu.mods}
        guests={guests}
        seat={null}
        course={1}
        onClose={() => setModItem(null)}
        onAdd={(c) => {
          const it = modItem!;
          setModItem(null);
          void add(it, c);
        }}
      />
      <LineSheet item={lineItem} guests={guests} onClose={() => setLineItem(null)} onSave={onLineSave} onVoid={onLineVoid} onDiscount={onLineDiscount} />
      <TablePicker
        open={dlg === "table" || dlg === "moveTable" || dlg === "itemsToTable"}
        onClose={() => {
          setDlg(null);
          pendingItem.current = null;
        }}
        tables={tables}
        zones={zones}
        checks={openChecks}
        current={tableIds[0] ?? null}
        title={dlg === "moveTable" ? L("انقل الشيك لترابيزة", "Move check to table") : dlg === "itemsToTable" ? L("انقل الأصناف لترابيزة", "Move lines to table") : L("اختار الترابيزة", "Pick a table")}
        onPick={(t, c) => void onTable(t.id, c)}
      />
      <CustomerDialog
        open={dlg === "customer"}
        onClose={() => setDlg(null)}
        kind={kind === "delivery" ? "delivery" : kind === "pickup" ? "pickup" : "takeaway"}
        initial={{ customerId: check?.customerId ?? draft.customerId, delivery: order?.delivery ?? draft.delivery, deliveryFee: order?.deliveryFee ?? draft.deliveryFee, pickupAt: order?.pickupAt ?? draft.pickupAt }}
        onDone={(r) => void onCustomer(r)}
      />
      <Dialog open={dlg === "guests"} onClose={() => setDlg(null)} size="sm" title={L("عدد الأفراد", "Guests")}>
        <div className="grid place-items-center gap-4 py-2">
          <Stepper
            value={guests}
            min={1}
            max={40}
            label={L("عدد الأفراد", "Guests")}
            onChange={async (n) => {
              if (check) {
                const t = await loadTicket(db, check.id);
                if (t) await setTicketMeta(db, t, { guests: n });
              } else setDraft((d) => ({ ...d, guests: n }));
            }}
          />
          <Button onClick={() => setDlg(null)}>{L("تمام", "Done")}</Button>
        </div>
      </Dialog>
      <DiscountDialog
        open={dlg === "discount"}
        onClose={() => setDlg(null)}
        base={check ? check.subtotal - items.reduce((a, i) => a + i.discount, 0) : 0}
        current={check?.discount ?? null}
        currentReason={check?.discountReason ?? null}
        limitPct={policy.discountApprovalPct}
        preview={preview}
        onApply={(d, r) => void applyDiscount(d, r)}
      />
      <SplitDialog
        open={dlg === "split"}
        onClose={() => setDlg(null)}
        items={items}
        total={check?.total ?? 0}
        price={price}
        onSplitChecks={async (groups) => {
          const t = await ticket();
          if (!t) return;
          const made = await run(() => splitIntoChecks(db, t, groups));
          setDlg(null);
          if (made) toast({ title: L(`اتعمل ${made.length} شيك جديد`, `${made.length} new check${made.length > 1 ? "s" : ""}`), description: L("تلاقيهم في الشيكات المفتوحة", "Find them under Open checks"), tone: "success", action: { label: L("افتح", "Open"), onClick: () => setDlg("checks") } });
        }}
        onShares={(amounts, labels) => {
          setShares({ amounts, labels });
          requireShift(() => setDlg("pay"));
        }}
      />
      <PaymentDialog
        open={dlg === "pay"}
        onClose={() => setDlg(null)}
        check={check}
        payments={payments}
        shares={shares}
        tipsEnabled={settings?.tipsEnabled ?? true}
        busy={busy}
        onTender={tender}
        onVoid={(p) => void voidTender(p)}
        onComplete={() => void finish()}
      />
      <ReceiptDialog
        open={!!receipt}
        onClose={() => {
          setReceipt(null);
          if (check && check.status === "paid") newTicket(kind);
        }}
        model={receipt?.model ?? null}
        title={receipt?.title}
        etaError={receipt?.etaError}
        actions={
          check?.status === "paid" ? (
            <Button size="lg" variant="secondary" icon={<Plus className="size-5" />} onClick={() => (setReceipt(null), newTicket(kind))}>
              {L("طلب جديد", "New order")}
            </Button>
          ) : null
        }
      />
      <OpenChecksDialog open={dlg === "checks"} onClose={() => setDlg(null)} rows={rows} activeId={activeId} onPick={(c) => (setActiveId(c.id), setDlg(null))} />
      <OpenChecksDialog
        open={dlg === "merge"}
        onClose={() => setDlg(null)}
        rows={rows}
        activeId={null}
        exclude={check?.id ?? null}
        title={L("دمج مع شيك", "Merge with check")}
        onPick={async (c) => {
          if (!check) return;
          setDlg(null);
          await run(() => mergeChecks(db, check, c));
          toast({ title: L("الشيكين اندمجوا", "Checks merged"), tone: "success" });
        }}
      />
      <TransferDialog
        open={dlg === "transfer"}
        onClose={() => setDlg(null)}
        items={items}
        rows={rows}
        exclude={check?.id ?? null}
        onMoveTable={() => setDlg("moveTable")}
        onToTable={(moves) => {
          pendingMoves.current = moves;
          setDlg("itemsToTable");
        }}
        onToCheck={async (moves, target) => {
          const t = await ticket();
          if (!t) return;
          setDlg(null);
          await run(() => moveItems(db, t, target, moves));
          toast({ title: L("الأصناف اتنقلت", "Lines moved"), tone: "success" });
        }}
      />
      <OpenShiftDialog
        open={dlg === "shift"}
        onClose={() => setDlg(null)}
        device={device}
        onOpened={() => {
          setDlg(null);
          const next = afterShift.current;
          afterShift.current = null;
          if (next) setTimeout(next, 50);
        }}
      />
      <span className="sr-only" aria-live="polite">
        {check ? `${L("الإجمالي", "Total")} ${formatMoney(check.total, { lang })}` : ""}
      </span>
    </div>
  );
}
