/** The current check: lines by course, live totals (@finance/tax), and the actions that move it along. */
import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeftRight, BadgePercent, ChefHat, Flame, Minus, MoreHorizontal, PauseCircle, Plus, Printer, ReceiptText, Scissors, Send, ShoppingBag, Trash2, Users, Wallet } from "lucide-react";
import type { Check, Order, OrderItem, OrderItemStatus } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { lineUnitPrice } from "@/data/pricing";
import { AnimatedMoney, Badge, Button, IconButton, Kbd, MenuItem, MenuSeparator, Popover, spring, useReduced, type Tone } from "@/ui";
import { courseStates, sendableItems } from "../math";

const STATUS_TONE: Record<OrderItemStatus, Tone> = { new: "neutral", sent: "info", preparing: "warn", ready: "ok", served: "primary", void: "danger" };
export const STATUS_LABEL: Record<OrderItemStatus, { ar: string; en: string }> = {
  new: { ar: "جديد", en: "New" },
  sent: { ar: "اتبعت", en: "Sent" },
  preparing: { ar: "بيتعمل", en: "Cooking" },
  ready: { ar: "جاهز", en: "Ready" },
  served: { ar: "اتقدّم", en: "Served" },
  void: { ar: "ملغي", en: "Void" },
};
const COURSE = (c: number, L: (a: string, e: string) => string) => (c === 1 ? L("كورس ١ · مقبلات", "Course 1 · Starters") : c === 2 ? L("كورس ٢ · رئيسي", "Course 2 · Mains") : c === 3 ? L("كورس ٣ · حلو", "Course 3 · Dessert") : L(`كورس ${c}`, `Course ${c}`));

export interface TicketActions {
  onLine: (it: OrderItem) => void;
  onQty: (it: OrderItem, qty: number) => void;
  onSend: () => void;
  onFire: (course: number) => void;
  onHold: () => void;
  onPay: () => void;
  onDiscount: () => void;
  onSplit: () => void;
  onTransfer: () => void;
  onMerge: () => void;
  onPrebill: () => void;
  onDiscard: () => void;
  onGuests: (n: number) => void;
}

export function TicketPanel({ check, orders, items, header, busy, className, ...a }: { check: Check | null; orders: Order[]; items: OrderItem[]; header: React.ReactNode; busy?: boolean; className?: string } & TicketActions) {
  const { L, loc, lang } = useT();
  const reduced = useReduced();
  const courses = useMemo(() => courseStates(items), [items]);
  const sendable = useMemo(() => sendableItems(items).length, [items]);
  const live = items.filter((i) => i.status !== "void");
  const due = check ? Math.max(0, check.total - check.paid) : 0;
  const order = orders[0];
  const anySent = items.some((i) => i.status !== "new" && i.status !== "void");

  return (
    <section className={cn("flex min-h-0 flex-col bg-surface", className)} aria-label={L("الشيك الحالي", "Current check")}>
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 thin-scrollbar">
        {!live.length && !items.length ? (
          <div className="grid h-full min-h-48 place-items-center px-6 text-center">
            <div>
              <span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-surface-2 text-faint">
                <ShoppingBag className="size-7" />
              </span>
              <p className="font-semibold text-ink-2">{L("الشيك فاضي", "Empty check")}</p>
              <p className="mt-1 text-[13.5px] text-muted">{L("اضغط على أي صنف عشان يتضاف هنا", "Tap any item to add it here")}</p>
            </div>
          </div>
        ) : (
          courses.map((c) => (
            <div key={c.course} className="mt-2.5 first:mt-1.5">
              {courses.length > 1 || c.course > 1 ? (
                <div className="sticky top-0 z-[1] -mx-1 flex items-center gap-2 bg-surface/95 px-1 py-1.5 backdrop-blur">
                  <span className="text-[12.5px] font-bold tracking-wide text-muted">{COURSE(c.course, L)}</span>
                  {c.course > 1 && !c.fired && c.waiting ? (
                    <>
                      <Badge tone="brass" size="sm" icon={<PauseCircle className="size-3" />}>
                        {L("مستني", "Held")}
                      </Badge>
                      <div className="flex-1" />
                      <Button size="sm" variant="brass" icon={<Flame className="size-4" />} onClick={() => a.onFire(c.course)} disabled={busy}>
                        {L("ابعت الكورس", "Fire")}
                      </Button>
                    </>
                  ) : c.fired ? (
                    <Badge tone="info" size="sm" icon={<ChefHat className="size-3" />}>
                      {L("في المطبخ", "Fired")}
                    </Badge>
                  ) : null}
                </div>
              ) : null}
              <ul className="grid gap-1">
                <AnimatePresence initial={false}>
                  {c.items.map((it) => {
                    const amount = lineUnitPrice(it) * it.qty;
                    const isNew = it.status === "new";
                    return (
                      <motion.li
                        key={it.id}
                        layout={!reduced}
                        initial={reduced ? false : { opacity: 0, x: lang === "ar" ? -16 : 16, scale: 0.98 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        transition={spring.snappy}
                      >
                        <div className={cn("group flex items-start gap-2.5 rounded-2xl border border-transparent px-2 py-2 hover:border-line hover:bg-surface-2", !isNew && "bg-surface-2/40")}>
                          <button type="button" onClick={() => a.onLine(it)} className="flex min-w-0 flex-1 items-start gap-2.5 text-start" aria-label={`${loc(it.name)} × ${it.qty}`}>
                            <span className={cn("num grid h-8 min-w-8 shrink-0 place-items-center rounded-xl px-1.5 text-[15px] font-bold", isNew ? "bg-primary-soft text-primary" : "bg-surface-3 text-ink-2")}>{it.qty}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[15px] font-semibold leading-tight">{loc(it.name)}</span>
                              </span>
                              {it.modifiers.length ? <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{it.modifiers.map((m) => loc(m.name)).join(" · ")}</span> : null}
                              {it.notes ? <span className="mt-0.5 block text-[12.5px] italic leading-snug text-brass-text">“{it.notes}”</span> : null}
                              <span className="mt-1 flex flex-wrap items-center gap-1">
                                {it.seat ? (
                                  <span className="num inline-flex items-center gap-1 rounded-full bg-surface-3 px-2 text-[11.5px] font-semibold text-ink-2">
                                    <Users className="size-3" /> {it.seat}
                                  </span>
                                ) : null}
                                {!isNew ? (
                                  <Badge tone={STATUS_TONE[it.status]} size="sm" dot pulse={it.status === "preparing"}>
                                    {STATUS_LABEL[it.status][lang]}
                                  </Badge>
                                ) : null}
                                {it.discount ? (
                                  <Badge tone="brass" size="sm">
                                    −{formatMoney(it.discount, { lang, bare: true })}
                                  </Badge>
                                ) : null}
                              </span>
                            </span>
                            <span className={cn("num shrink-0 pt-1 text-[14.5px] font-semibold", it.status === "void" && "text-faint line-through")} dir="ltr">
                              {formatMoney(amount, { lang, bare: true })}
                            </span>
                          </button>
                          {isNew ? (
                            <span className="flex shrink-0 flex-col gap-1 opacity-100 @md:opacity-0 @md:group-hover:opacity-100 @md:group-focus-within:opacity-100">
                              <button type="button" className="grid size-8 place-items-center rounded-lg border border-line bg-surface hover:bg-surface-3" onClick={() => a.onQty(it, it.qty + 1)} aria-label={L("زوّد", "Add one")}>
                                <Plus className="size-4" />
                              </button>
                              <button type="button" className="grid size-8 place-items-center rounded-lg border border-line bg-surface hover:bg-surface-3" onClick={() => a.onQty(it, it.qty - 1)} aria-label={L("قلّل", "Remove one")}>
                                {it.qty === 1 ? <Trash2 className="size-4 text-danger" /> : <Minus className="size-4" />}
                              </button>
                            </span>
                          ) : null}
                        </div>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-line bg-surface-2/60 px-4 pt-3 pb-3">
        {check ? (
          <dl className="grid gap-0.5 text-[14px]">
            <Row label={L("الإجمالي قبل الخصم", "Subtotal")} value={check.subtotal} lang={lang} />
            {check.discountTotal ? <Row label={`${L("خصم", "Discount")}${check.discountReason ? ` · ${check.discountReason}` : ""}`} value={-check.discountTotal} lang={lang} tone="text-brass-text" /> : null}
            {check.service ? <Row label={L("خدمة", "Service")} value={check.service} lang={lang} /> : null}
            {check.vat ? <Row label={L("ضريبة ق.م", "VAT")} value={check.vat} lang={lang} /> : null}
            {order?.deliveryFee ? <Row label={L("توصيل", "Delivery")} value={order.deliveryFee} lang={lang} /> : null}
            {check.paid ? <Row label={L("اتدفع", "Paid")} value={-check.paid} lang={lang} tone="text-ok" /> : null}
          </dl>
        ) : null}
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="text-[13px] font-semibold text-muted">{check?.paid ? L("الباقي", "Due") : L("الإجمالي", "Total")}</span>
          <AnimatedMoney value={check ? (check.paid ? due : check.total) : 0} className="text-[30px] font-semibold leading-none tracking-tight" />
        </div>
        <div className="mt-3 grid grid-cols-[auto_1fr_1.25fr] gap-2">
          <Popover
            side="top"
            align="start"
            width="w-64"
            trigger={({ props }) => (
              <IconButton label={L("أكتر", "More")} variant="secondary" size="lg" {...props} disabled={!check}>
                <MoreHorizontal />
              </IconButton>
            )}
          >
            {(close) => (
              <div className="grid gap-0.5 p-1.5">
                <MenuItem icon={<BadgePercent />} onClick={() => (close(), a.onDiscount())} end={<Kbd>D</Kbd>}>
                  {L("خصم", "Discount")}
                </MenuItem>
                <MenuItem icon={<Scissors />} onClick={() => (close(), a.onSplit())} end={<Kbd>X</Kbd>}>
                  {L("تقسيم الشيك", "Split check")}
                </MenuItem>
                <MenuItem icon={<ArrowLeftRight />} onClick={() => (close(), a.onTransfer())} end={<Kbd>T</Kbd>}>
                  {L("نقل أصناف / ترابيزة", "Transfer items / table")}
                </MenuItem>
                <MenuItem icon={<ReceiptText />} onClick={() => (close(), a.onMerge())}>
                  {L("دمج مع شيك تاني", "Merge with another check")}
                </MenuItem>
                <MenuItem icon={<Printer />} onClick={() => (close(), a.onPrebill())}>
                  {L("اطبع شيك مبدئي", "Print pre-bill")}
                </MenuItem>
                {order?.mode === "dine_in" ? (
                  <MenuItem icon={<Users />} onClick={() => (close(), a.onGuests(-1))}>
                    {L("عدد الأفراد", "Guests")} · <span className="num">{check?.guests}</span>
                  </MenuItem>
                ) : null}
                <MenuSeparator />
                <MenuItem icon={<Trash2 />} danger onClick={() => (close(), a.onDiscard())} disabled={anySent}>
                  {L("إلغاء الشيك", "Discard check")}
                </MenuItem>
              </div>
            )}
          </Popover>
          <Button size="lg" variant={sendable ? "primary" : "secondary"} icon={sendable ? <Send className="size-5 flip-rtl" /> : <PauseCircle className="size-5" />} onClick={sendable ? a.onSend : a.onHold} disabled={busy || !check} className="px-3">
            {sendable ? (
              <>
                {L("ابعت", "Send")} <span className="num rounded-full bg-white/20 px-1.5 text-[13px]">{sendable}</span>
              </>
            ) : (
              L("علّق", "Hold")
            )}
          </Button>
          <Button size="lg" variant="brass" icon={<Wallet className="size-5" />} onClick={a.onPay} disabled={busy || !check || !live.length} className="px-3">
            {L("ادفع", "Pay")}
          </Button>
        </div>
      </div>
    </section>
  );
}

function Row({ label, value, lang, tone }: { label: string; value: number; lang: "ar" | "en"; tone?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3", tone)}>
      <dt className="truncate text-muted">{label}</dt>
      <dd className="num" dir="ltr">
        {formatMoney(value, { lang, bare: true })}
      </dd>
    </div>
  );
}
