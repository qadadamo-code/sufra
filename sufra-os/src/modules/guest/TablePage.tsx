import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { BellRing, ChevronLeft, Clock3, ReceiptText } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Dialog, useReduced, useToast } from "@/ui";
import { Mark } from "@/shell/Logo";
import { TABLE_IMAGE } from "./data/images";
import { cartCount, type MenuItemView } from "./cart";
import { pipeline } from "./stages";
import { GuestProvider, useGuest } from "./ui/context";
import { GuestToggles, Photo } from "./ui/bits";
import { MenuBrowser } from "./ui/Menu";
import { ItemSheet } from "./ui/ItemSheet";
import { CartBar, CartSheet } from "./ui/Cart";
import { CallWaiterSheet, SentStatus, chipFor } from "./ui/CallWaiter";
import { StageBar, STAGE_COPY, Timeline } from "./ui/Tracker";
import { BillSheet, type PayChoice } from "./ui/Bill";
import { FeedbackCard, LoyaltyCard, ReceiptCard } from "./ui/AfterMeal";
import { useTableCalls } from "./ui/useTableCalls";
import { useLiveFetch } from "./ui/useLiveFetch";
import { usePayment } from "./ui/usePayment";

/** QR table page: /r/:slug/t/:code — menu, order, call the waiter, bill & pay. */
export default function TablePage() {
  const { restaurantSlug = "", tableCode = "" } = useParams();
  return (
    <GuestProvider slug={restaurantSlug} tableCode={tableCode.toUpperCase()}>
      <TableView />
    </GuestProvider>
  );
}

function TableView() {
  const { slug, tableCode, menu, venue, svc, cart, clearCart } = useGuest();
  const code = tableCode!;
  const { L, loc, lang } = useT();
  const { toast } = useToast();
  const reduced = useReduced();
  const [item, setItem] = useState<MenuItemView | null>(null);
  const [sheet, setSheet] = useState<null | "cart" | "call" | "bill" | "orders" | "receipt">(null);
  const [placing, setPlacing] = useState(false);
  const calls = useTableCalls(svc, slug, code, venue.restaurantId);
  const bill = useLiveFetch(svc, venue.restaurantId, () => svc.tableBill(slug, code), [svc, slug, code]);
  const pay = usePayment(svc, slug);
  const ordering = menu.qrOrdering.enabled;
  const canCall = menu.qrOrdering.allowServiceCalls;

  useEffect(() => {
    document.title = `${loc(menu.restaurant.name)} · ${L("ترابيزة", "Table")} ${menu.table?.label ?? ""}`;
  }, [menu, loc, L]);

  // payment outcome
  useEffect(() => {
    const s = pay.state.s;
    if (s === "done") {
      setSheet("receipt");
      bill.refresh();
    } else if (s === "failed" || s === "cancelled" || s === "expired") {
      toast({ title: s === "cancelled" ? L("الدفع اتلغى", "Payment cancelled") : s === "expired" ? L("ماقدرناش نتأكد من الدفع — اسأل الجرسون", "Couldn't confirm the payment — ask your waiter") : L("الدفع ماتمّش", "Payment failed"), tone: "error" });
      pay.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay.state.s]);

  const place = async () => {
    setPlacing(true);
    try {
      await svc.placeOrder(slug, { tableCode: code, mode: "dine_in", lines: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, modifierIds: l.modifierIds, notes: l.notes })) });
      clearCart();
      bill.refresh();
      setSheet("orders");
      toast({ title: venue.qr.requireWaiterConfirm ? L("طلبك وصل — الجرسون هيأكده", "Order sent — your waiter will confirm it") : L("طلبك راح للمطبخ 👨‍🍳", "Your order is in the kitchen 👨‍🍳"), tone: "success" });
    } catch (e) {
      const m = (e as Error).message;
      toast({ title: m === "item_unavailable" ? L("في صنف خلص — راجع طلبك", "An item just sold out — check your order") : L("الطلب ماوصلش، جرّب تاني", "Couldn't send the order, try again"), tone: "error" });
    } finally {
      setPlacing(false);
    }
  };

  const toWaiter = async (method: "cash" | "card", p: PayChoice) => {
    const text = [method === "cash" ? L("كاش", "cash") : L("كارت", "card"), p.splitLabel, formatMoney(p.amount + p.tip, { lang })].filter(Boolean).join(" · ");
    const r = await calls.send("bill", text);
    if (r.ok) {
      setSheet(null);
      toast({ title: L("تمام — الجرسون جاي بالحساب", "Done — your waiter is bringing the bill"), tone: "success" });
    } else toast({ title: L("ماوصلش، جرّب تاني", "Didn't go through, try again"), tone: "error" });
  };

  const payOnline = (p: PayChoice) => {
    if (!bill.data) return;
    void pay.start({ purpose: "check", checkId: bill.data.checkId, orderId: null, tableCode: code, amount: p.amount, tip: p.tip, currency: venue.currency, splitLabel: p.splitLabel, customer: null, lang });
  };

  const orders = bill.data?.orders ?? [];
  const latest = orders[orders.length - 1];
  const due = bill.data ? Math.max(0, bill.data.totals.total - bill.data.totals.paid) : 0;
  const n = cartCount(cart);
  const dockH = canCall || bill.data ? 76 : 0;
  const receiptIntent = pay.state.s === "done" ? pay.state.intent : null;

  return (
    <div className="min-h-dvh bg-bg pb-44">
      {/* hero */}
      <header className="relative">
        <Photo src={TABLE_IMAGE} alt="" eager className="h-[236px] w-full sm:h-[280px]">
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(0_0_0/0.45)_0%,rgb(0_0_0/0.05)_38%,rgb(0_0_0/0.72)_100%)]" />
        </Photo>
        <div className="absolute inset-x-0 top-0 mx-auto flex max-w-2xl items-center justify-between px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
          <span className="rounded-full bg-black/30 p-1 backdrop-blur-md">
            <Mark className="size-8" />
          </span>
          <GuestToggles glass />
        </div>
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-2xl px-4 pb-5 text-white">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/18 px-3 text-[13px] font-bold backdrop-blur-md">
              {L("ترابيزة", "Table")} <span className="num">{menu.table?.label}</span>
            </span>
            {menu.branch ? <span className="text-[13px] text-white/80">{loc(menu.branch.name)}</span> : null}
          </div>
          <h1 className="mt-2 text-[30px] leading-tight drop-shadow-sm">{loc(menu.restaurant.name)}</h1>
          <p className="mt-1 text-[12.5px] text-white/80">
            {menu.pricing.priceMode === "inclusive" ? L("الأسعار شاملة الخدمة والضريبة", "Prices include service and VAT") : L(`الأسعار من غير ${menu.pricing.serviceRate / 100}٪ خدمة و${menu.pricing.vatRegistered ? menu.pricing.vatRate / 100 : 0}٪ ضريبة`, `Prices exclude ${menu.pricing.serviceRate / 100}% service and ${menu.pricing.vatRegistered ? menu.pricing.vatRate / 100 : 0}% VAT`)}
          </p>
        </div>
      </header>

      <MenuBrowser
        onOpen={(i) => (ordering ? setItem(i) : undefined)}
        header={
          <div className="grid gap-3 empty:hidden [&:has(>*)]:mb-6">
            {!ordering ? (
              <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-[13.5px] text-muted">{L("المنيو للعرض بس — اطلب من الجرسون.", "Menu is view-only — order with your waiter.")}</div>
            ) : null}
            {latest ? (
              <button type="button" onClick={() => setSheet("orders")} className="flex items-center gap-3 rounded-[20px] border border-line bg-surface p-3.5 text-start shadow-sf-sm transition active:scale-[0.99]">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary [&_svg]:size-5">{STAGE_COPY[latest.stage].icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[15px] font-bold">
                    {L(STAGE_COPY[latest.stage].ar, STAGE_COPY[latest.stage].en)}
                    <span className="num text-[12.5px] font-semibold text-muted">#{latest.number}</span>
                    {orders.length > 1 ? <Badge size="sm">{L(`${orders.length} طلبات`, `${orders.length} orders`)}</Badge> : null}
                  </span>
                  <StageBar mode="dine_in" qr stage={latest.stage} className="mt-2" />
                </span>
                <ChevronLeft className="size-5 text-muted ltr:rotate-180" />
              </button>
            ) : null}
            {calls.active.length ? (
              <div className="flex gap-2 overflow-x-auto no-scrollbar">
                {calls.active.slice(0, 4).map((c) => {
                  const st = calls.states[c.id]?.status ?? "open";
                  const chip = chipFor(c.type);
                  return (
                    <span key={c.id} className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold", st === "ack" ? "bg-ok-soft text-ok" : "bg-brass-soft text-brass-text")}>
                      <span className={cn("size-2 rounded-full", st === "ack" ? "bg-ok" : "animate-pulse bg-brass")} />
                      {chip ? L(chip.ar, chip.en) : c.type} · {st === "ack" ? L("الجرسون جاي", "on the way") : L("اتبعت", "sent")}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        }
      />
      <p className="mt-10 pb-4 text-center text-[12px] text-faint">{L("بنظام سُفرة", "Powered by Sufra")}</p>

      {/* cart bar sits above the dock */}
      {ordering ? <CartBar onOpen={() => setSheet("cart")} mode="dine_in" offset={dockH} /> : null}

      {/* dock */}
      {dockH ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-bg/90 px-4 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+10px)] backdrop-blur-lg">
          <div className="mx-auto flex max-w-2xl gap-2">
            {bill.data ? (
              <Button variant="secondary" size="lg" className="h-14 shrink-0 rounded-[18px] px-4" icon={<ReceiptText className="size-5" />} onClick={() => setSheet("bill")}>
                <span className="flex flex-col items-start leading-tight">
                  <span className="text-[13px] text-muted">{L("الحساب", "Bill")}</span>
                  <span className="num text-[14.5px]">{formatMoney(due, { lang, bare: true })}</span>
                </span>
              </Button>
            ) : null}
            {canCall ? (
              <Button variant="brass" size="lg" className="h-14 flex-1 rounded-[18px] text-[17px]" icon={<BellRing className="size-6" />} onClick={() => setSheet("call")}>
                {L("نادي الجرسون", "Call the waiter")}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <ItemSheet item={item} onClose={() => setItem(null)} onAdded={(q) => !reduced && navigator.vibrate?.(q ? 12 : 0)} />

      <CartSheet
        open={sheet === "cart"}
        onClose={() => setSheet(null)}
        mode="dine_in"
        action={
          <Button size="lg" block loading={placing} onClick={place} disabled={!n}>
            {L("ابعت الطلب", "Send order")}
          </Button>
        }
        footerNote={venue.qr.requireWaiterConfirm ? <p className="text-center text-[12px] text-muted">{L("الجرسون هيأكد طلبك قبل ما يدخل المطبخ", "Your waiter confirms the order before it goes to the kitchen")}</p> : null}
      />

      <CallWaiterSheet open={sheet === "call"} onClose={() => setSheet(null)} calls={calls} payOnline={pay.available} onPayOnline={() => setSheet("bill")} />

      <BillSheet
        open={sheet === "bill"}
        onClose={() => setSheet(null)}
        bill={bill.data}
        loading={bill.loading}
        tipsEnabled={venue.tipsEnabled}
        serviceRate={venue.tax.serviceRate}
        vatRate={venue.tax.vatRate}
        canPayOnline={pay.available}
        paying={pay.state.s === "creating" || pay.state.s === "redirect"}
        onPayOnline={payOnline}
        onWaiter={toWaiter}
      />

      <Dialog open={sheet === "orders"} onClose={() => setSheet(null)} title={L("طلباتكم", "Your orders")} size="md">
        <div className="grid gap-4 pb-2">
          {[...orders].reverse().map((o, i) => {
            const lines = bill.data?.lines.filter((l) => l.orderId === o.id) ?? [];
            return (
              <section key={o.id} className="rounded-[20px] border border-line bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[16px] font-bold">
                    {L("طلب", "Order")} <span className="num">#{o.number}</span>
                  </p>
                  <span className="flex items-center gap-1 text-[12.5px] text-muted">
                    <Clock3 className="size-3.5" />
                    <span className="num">{new Date(o.at).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" })}</span>
                  </span>
                </div>
                {i === 0 ? <Timeline mode="dine_in" qr stage={o.stage} awaitingConfirm={venue.qr.requireWaiterConfirm} /> : <StageBar mode="dine_in" qr stage={o.stage} />}
                {lines.length ? (
                  <ul className="mt-4 grid gap-1.5 border-t border-line pt-3 text-[13.5px]">
                    {lines.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2">
                        <span>
                          <span className="num text-muted">{l.qty}× </span>
                          {loc(l.name)}
                        </span>
                        <ItemStatus status={l.status} />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            );
          })}
          {!orders.length ? <p className="py-8 text-center text-muted">{L("لسه مفيش طلبات", "No orders yet")}</p> : null}
          {calls.active[0] ? (
            <div className="rounded-[20px] border border-line bg-surface-2 p-4">
              <SentStatus compact state={calls.states[calls.active[0].id]} type={calls.active[0].type} />
            </div>
          ) : null}
        </div>
      </Dialog>

      <Dialog open={sheet === "receipt"} onClose={() => (setSheet(null), pay.reset())} title={L("الإيصال", "Receipt")} size="md">
        <AnimatePresence>
          {receiptIntent ? (
            <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 pb-2">
              <ReceiptCard
                r={{
                  restaurant: menu.restaurant.name,
                  branch: menu.branch?.name ?? null,
                  table: menu.table?.label ?? null,
                  at: new Date().toISOString(),
                  reference: receiptIntent.reference,
                  method: L("أونلاين", "Online"),
                  splitLabel: receiptIntent.request.splitLabel,
                  amount: receiptIntent.amount,
                  tip: receiptIntent.tip,
                }}
              />
              <FeedbackCard svc={svc} slug={slug} checkId={receiptIntent.request.checkId} tableCode={code} />
              <LoyaltyCard svc={svc} slug={slug} checkId={receiptIntent.request.checkId} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </Dialog>

      {/* stage list kept for screen readers */}
      <span className="sr-only">{pipeline("dine_in", true).join(" ")}</span>
    </div>
  );
}

function ItemStatus({ status }: { status: string }) {
  const { L } = useT();
  const map: Record<string, [string, string, "neutral" | "info" | "warn" | "ok" | "primary" | "danger"]> = {
    new: ["مستني تأكيد", "Awaiting confirm", "neutral"],
    sent: ["في المطبخ", "In kitchen", "info"],
    preparing: ["بيتجهز", "Preparing", "warn"],
    ready: ["جاهز", "Ready", "ok"],
    served: ["اتقدّم", "Served", "primary"],
    void: ["اتلغى", "Void", "danger"],
  };
  const [ar, en, tone] = map[status] ?? [status, status, "neutral"];
  return (
    <Badge size="sm" tone={tone}>
      {L(ar, en)}
    </Badge>
  );
}
