import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, BellRing, Check, Coffee, CreditCard, Droplets, Eye, Layers, Leaf, MessageSquare, Receipt, Smartphone, Sparkles, TriangleAlert, Utensils, Wallet } from "lucide-react";
import type { ServiceCallType } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, Dialog, useReduced, useToast } from "@/ui";
import type { CallState } from "../api/service";
import type { useTableCalls } from "./useTableCalls";

type Chip = { type: ServiceCallType; icon: React.ReactNode; ar: string; en: string; step?: "bill" | "text" | "optional-text" };

const CHIPS: Chip[] = [
  { type: "waiter", icon: <BellRing />, ar: "نادي الجرسون", en: "Call the waiter" },
  { type: "water", icon: <Droplets />, ar: "مياه", en: "Water" },
  { type: "napkins", icon: <Layers />, ar: "مناديل", en: "Napkins" },
  { type: "coffee", icon: <Coffee />, ar: "قهوة", en: "Coffee" },
  { type: "tea", icon: <Leaf />, ar: "شاي", en: "Tea" },
  { type: "clean_table", icon: <Sparkles />, ar: "تنضيف الترابيزة", en: "Clean the table" },
  { type: "item", icon: <Utensils />, ar: "عايز أطلب حاجة", en: "I'd like to order", step: "optional-text" },
  { type: "bill", icon: <Receipt />, ar: "الحساب", en: "The bill", step: "bill" },
  { type: "complaint", icon: <TriangleAlert />, ar: "في مشكلة", en: "There's a problem", step: "optional-text" },
  { type: "other", icon: <MessageSquare />, ar: "حاجة تانية", en: "Something else", step: "text" },
];

export const chipFor = (t: ServiceCallType) => CHIPS.find((c) => c.type === t);

type View = { v: "grid" } | { v: "bill" } | { v: "text"; chip: Chip } | { v: "sent"; id: string; repeat: boolean; type: ServiceCallType };

/** "Call the waiter" — quick chips, bill choices, free text; then a live "on the way" status. */
export function CallWaiterSheet({ open, onClose, calls, onPayOnline, payOnline }: { open: boolean; onClose: () => void; calls: ReturnType<typeof useTableCalls>; onPayOnline: () => void; payOnline: boolean }) {
  const { L } = useT();
  const { toast } = useToast();
  const [view, setView] = useState<View>({ v: "grid" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<ServiceCallType | null>(null);
  const reduced = useReduced();

  useEffect(() => {
    if (open) {
      setView({ v: "grid" });
      setText("");
    }
  }, [open]);

  const send = async (type: ServiceCallType, t = "") => {
    setBusy(type);
    const r = await calls.send(type, t);
    setBusy(null);
    if (r.ok) setView({ v: "sent", id: r.id, repeat: r.repeat, type });
    else toast({ title: r.reason === "rate_limited" ? L("استنى شوية — طلبات كتير ورا بعض", "Please wait a moment — too many requests") : L("ماوصلش، جرّب تاني", "Didn't go through, try again"), tone: "error" });
  };

  const fade = reduced ? {} : { initial: { opacity: 0, x: 12 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -12 } };
  const title = view.v === "bill" ? L("الحساب", "The bill") : view.v === "text" ? L(view.chip.ar, view.chip.en) : view.v === "sent" ? undefined : L("محتاج إيه؟", "What do you need?");

  return (
    <Dialog open={open} onClose={onClose} title={title} variant="bottom" size="md">
      <AnimatePresence mode="wait" initial={false}>
        {view.v === "grid" ? (
          <motion.div key="grid" {...fade} className="grid grid-cols-3 gap-2 pt-1 pb-2 sm:grid-cols-5">
            {CHIPS.map((c) => {
              const live = calls.active.find((a) => a.type === c.type);
              return (
                <button
                  key={c.type}
                  type="button"
                  disabled={!!busy}
                  onClick={() => (c.step === "bill" ? setView({ v: "bill" }) : c.step ? setView({ v: "text", chip: c }) : void send(c.type))}
                  className={cn(
                    "relative flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-[20px] border p-2 text-center text-[13.5px] font-semibold leading-tight transition active:scale-[0.96] [&_svg]:size-6",
                    c.type === "waiter" ? "col-span-3 min-h-16 flex-row bg-brass text-brass-ink border-transparent text-[16px] sm:col-span-5 [&_svg]:size-6" : c.type === "complaint" ? "border-danger/30 bg-danger-soft/50 text-danger" : "border-line bg-surface-2 hover:border-primary/40 hover:bg-primary-soft [&_svg]:text-primary",
                  )}
                >
                  {busy === c.type ? <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" /> : c.icon}
                  {L(c.ar, c.en)}
                  {live ? <span className="absolute top-2 end-2 size-2.5 rounded-full bg-ok ring-2 ring-surface" aria-label={L("متبعت", "Sent")} /> : null}
                </button>
              );
            })}
          </motion.div>
        ) : view.v === "bill" ? (
          <motion.div key="bill" {...fade} className="grid gap-2.5 pt-1 pb-2">
            <BillChoice icon={<Wallet />} title={L("هدفع كاش", "I'll pay cash")} sub={L("الجرسون هيجيب الحساب", "The waiter brings the bill")} onClick={() => void send("bill", L("كاش", "cash"))} busy={busy === "bill"} />
            <BillChoice icon={<CreditCard />} title={L("هدفع بالكارت", "I'll pay by card")} sub={L("الجرسون هيجيب الماكينة", "The waiter brings the card machine")} onClick={() => void send("bill", L("كارت", "card"))} busy={busy === "bill"} />
            {payOnline ? <BillChoice icon={<Smartphone />} title={L("ادفع أونلاين دلوقتي", "Pay online now")} sub={L("قسّم الحساب وزوّد بقشيش من موبايلك", "Split and tip from your phone")} onClick={onPayOnline} accent /> : null}
            <BillChoice icon={<Eye />} title={L("شوف الحساب الأول", "See the bill first")} sub={L("كل الأصناف والضريبة والخدمة", "All items, service and VAT")} onClick={onPayOnline} />
            <BackLink onClick={() => setView({ v: "grid" })} />
          </motion.div>
        ) : view.v === "text" ? (
          <motion.form key="text" {...fade} className="grid gap-3 pt-1 pb-2" onSubmit={(e) => (e.preventDefault(), void send(view.chip.type, text))}>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={200}
              rows={3}
              placeholder={view.chip.type === "item" ? L("عايز إيه؟ (اختياري)", "What would you like? (optional)") : view.chip.type === "complaint" ? L("قولنا حصل إيه (اختياري) — المدير هيعرف فورًا", "Tell us what happened (optional) — the manager is alerted") : L("اكتب طلبك…", "Write your request…")}
              className="w-full resize-none rounded-2xl border border-line bg-surface px-3.5 py-3 text-[15px] outline-none placeholder:text-faint focus:border-primary focus:shadow-[var(--sf-glow)]"
            />
            <Button type="submit" size="lg" block loading={busy === view.chip.type} disabled={view.chip.step === "text" && !text.trim()} variant={view.chip.type === "complaint" ? "danger" : "primary"}>
              {L("ابعت", "Send")}
            </Button>
            <BackLink onClick={() => setView({ v: "grid" })} />
          </motion.form>
        ) : (
          <motion.div key="sent" initial={reduced ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} className="pt-2 pb-3">
            <SentStatus state={calls.states[view.id]} type={view.type} repeat={view.repeat} />
            <div className="mt-6 grid grid-cols-2 gap-2">
              <Button variant="secondary" size="lg" onClick={() => setView({ v: "grid" })}>
                {L("طلب تاني", "Another request")}
              </Button>
              <Button size="lg" onClick={onClose}>
                {L("تمام", "Done")}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
}

function BillChoice({ icon, title, sub, onClick, accent, busy }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; accent?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn("flex min-h-[68px] items-center gap-3.5 rounded-[20px] border px-4 text-start transition active:scale-[0.98] [&>span:first-child_svg]:size-6", accent ? "border-transparent bg-primary text-primary-ink" : "border-line bg-surface-2 hover:border-primary/40")}
    >
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", accent ? "bg-white/15" : "bg-primary-soft text-primary")}>{icon}</span>
      <span className="flex-1">
        <span className="block text-[15.5px] font-bold">{title}</span>
        <span className={cn("block text-[13px]", accent ? "opacity-85" : "text-muted")}>{sub}</span>
      </span>
    </button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  const { L } = useT();
  return (
    <button type="button" onClick={onClick} className="mt-1 inline-flex items-center gap-1.5 justify-self-center text-[13.5px] font-semibold text-muted hover:text-ink">
      <ArrowLeft className="size-4 flip-rtl" />
      {L("رجوع", "Back")}
    </button>
  );
}

/** Live status of one call: sent → the waiter saw it (on the way) → done. */
export function SentStatus({ state, type, repeat, compact }: { state: CallState | undefined; type: ServiceCallType; repeat?: boolean; compact?: boolean }) {
  const { L } = useT();
  const reduced = useReduced();
  const status = state?.status ?? "open";
  const chip = chipFor(type);
  const steps = [
    { k: "open", ar: "اتبعت", en: "Sent" },
    { k: "ack", ar: "الجرسون شاف طلبك", en: "Waiter saw it" },
    { k: "done", ar: "اتعمل", en: "Done" },
  ];
  const idx = status === "done" ? 2 : status === "ack" ? 1 : 0;
  const head =
    status === "done" ? L("اتعمل ✓", "Done ✓") : status === "ack" ? L("الجرسون جاي لك 🏃", "Your waiter is coming 🏃") : repeat ? L("طلبك اتبعت من شوية — الجرسون جاي", "Already sent — the waiter is coming") : L("تم الإرسال — الجرسون جاي", "Sent — the waiter is coming");
  return (
    <div className={cn("flex flex-col items-center text-center", compact && "items-start text-start")}>
      {!compact ? (
        <span className="relative grid size-20 place-items-center">
          {!reduced && status !== "done" ? <span className="absolute inset-0 animate-ping rounded-full bg-ok/25" /> : null}
          <span className="relative grid size-16 place-items-center rounded-full bg-ok text-white shadow-sf">
            <Check className="size-8" strokeWidth={3} />
          </span>
        </span>
      ) : null}
      <p className={cn("font-bold", compact ? "text-[15px]" : "mt-4 text-[20px]")}>{head}</p>
      {chip ? <p className="mt-1 text-[13.5px] text-muted">{L(chip.ar, chip.en)}</p> : null}
      <ol className={cn("mt-4 flex w-full max-w-xs items-center gap-1.5", compact && "mt-2")} aria-label={L("الحالة", "Status")}>
        {steps.map((s, i) => (
          <li key={s.k} className="flex flex-1 flex-col items-center gap-1.5">
            <span className={cn("h-1.5 w-full rounded-full transition-colors duration-500", i <= idx ? "bg-ok" : "bg-line")} />
            <span className={cn("text-[11.5px] font-semibold", i <= idx ? "text-ok" : "text-faint")}>{L(s.ar, s.en)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
