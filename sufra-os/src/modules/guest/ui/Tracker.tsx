import { motion } from "motion/react";
import { Bike, Check, ChefHat, CircleCheckBig, ClipboardCheck, Hand, PackageCheck, ReceiptText, UtensilsCrossed, XCircle } from "lucide-react";
import type { OrderMode } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { useReduced } from "@/ui";
import { pipeline, type Stage } from "../stages";

export const STAGE_COPY: Record<Stage, { ar: string; en: string; sub: { ar: string; en: string }; icon: React.ReactNode }> = {
  received: { ar: "الطلب وصل", en: "Order received", sub: { ar: "وصلنا طلبك", en: "We've got your order" }, icon: <ReceiptText /> },
  accepted: { ar: "المطعم قبل الطلب", en: "Accepted", sub: { ar: "المطبخ استلم الطلب", en: "The kitchen has it" }, icon: <ClipboardCheck /> },
  preparing: { ar: "بيتجهز", en: "Preparing", sub: { ar: "الشيف شغال على طلبك", en: "The chef is on it" }, icon: <ChefHat /> },
  ready: { ar: "جاهز", en: "Ready", sub: { ar: "طلبك جاهز", en: "Your order is ready" }, icon: <PackageCheck /> },
  served: { ar: "اتقدّم", en: "Served", sub: { ar: "بالهنا والشفا", en: "Enjoy your meal" }, icon: <UtensilsCrossed /> },
  picked_up: { ar: "اتستلم", en: "Picked up", sub: { ar: "بالهنا والشفا", en: "Enjoy your meal" }, icon: <Hand /> },
  out_for_delivery: { ar: "خرج للتوصيل", en: "Out for delivery", sub: { ar: "الطيار في الطريق", en: "The driver is on the way" }, icon: <Bike /> },
  delivered: { ar: "اتسلّم", en: "Delivered", sub: { ar: "بالهنا والشفا", en: "Enjoy your meal" }, icon: <CircleCheckBig /> },
  cancelled: { ar: "الطلب اتلغى", en: "Cancelled", sub: { ar: "كلمنا لو محتاج حاجة", en: "Call us if you need anything" }, icon: <XCircle /> },
};

/** Horizontal compact progress (table page pill / cards). */
export function StageBar({ mode, qr, stage, className }: { mode: OrderMode; qr: boolean; stage: Stage; className?: string }) {
  const steps = pipeline(mode, qr);
  const idx = steps.indexOf(stage);
  const { L } = useT();
  return (
    <ol className={cn("flex gap-1", className)} aria-label={L("حالة الطلب", "Order status")}>
      {steps.map((s, i) => (
        <li key={s} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-700", stage === "cancelled" ? "bg-danger/40" : i <= idx ? "bg-primary" : "bg-line")} title={L(STAGE_COPY[s].ar, STAGE_COPY[s].en)} />
      ))}
    </ol>
  );
}

/** Vertical timeline with the live step pulsing. */
export function Timeline({ mode, qr, stage, awaitingConfirm, extra }: { mode: OrderMode; qr: boolean; stage: Stage; awaitingConfirm?: boolean; extra?: Partial<Record<Stage, React.ReactNode>> }) {
  const { L } = useT();
  const reduced = useReduced();
  const steps: Stage[] = stage === "cancelled" ? ["received", "cancelled"] : pipeline(mode, qr);
  const idx = steps.indexOf(stage);
  return (
    <ol className="relative grid gap-0">
      {steps.map((s, i) => {
        const done = i < idx;
        const now = i === idx;
        const c = STAGE_COPY[s];
        const bad = s === "cancelled";
        return (
          <li key={s} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < steps.length - 1 ? (
              <span className="absolute top-10 bottom-0 start-[19px] w-0.5 overflow-hidden rounded-full bg-line" aria-hidden>
                <motion.span className="block w-full bg-primary" initial={false} animate={{ height: done ? "100%" : "0%" }} transition={reduced ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
              </span>
            ) : null}
            <span
              className={cn(
                "relative grid size-10 shrink-0 place-items-center rounded-full border-2 transition-colors duration-500 [&_svg]:size-[19px]",
                bad ? "border-danger bg-danger text-white" : done ? "border-primary bg-primary text-primary-ink" : now ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-faint",
              )}
            >
              {now && !reduced && !bad && s !== steps[steps.length - 1] ? <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" /> : null}
              {done ? <Check strokeWidth={3} /> : c.icon}
            </span>
            <div className="min-w-0 flex-1 pt-1.5">
              <p className={cn("text-[15.5px] font-bold", !done && !now && "text-faint")}>{L(c.ar, c.en)}</p>
              {now ? (
                <p className="mt-0.5 text-[13.5px] text-muted">
                  {s === "received" && awaitingConfirm ? L("الجرسون هيأكد طلبك ويبعته للمطبخ", "Your waiter will confirm and send it to the kitchen") : L(c.sub.ar, c.sub.en)}
                </p>
              ) : null}
              {extra?.[s] && (now || done) ? <div className="mt-2">{extra[s]}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
