import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Gift, Star } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import type { Localized } from "@/data/types";
import type { Units } from "@/lib/money";
import { Button, Input, Money, useReduced, useToast } from "@/ui";
import { Mark } from "@/shell/Logo";
import { normalizePhone, type GuestService } from "../api/service";

export interface ReceiptData {
  restaurant: Localized;
  branch: Localized | null;
  table: string | null;
  orderNo?: number | null;
  at: string;
  reference: string | null;
  method: string;
  splitLabel: string | null;
  lines?: { name: Localized; qty: number; total: Units }[];
  amount: Units;
  tip: Units;
}

/** Digital receipt (the legal ETA e-receipt is issued by the cashier when the check closes). */
export function ReceiptCard({ r }: { r: ReceiptData }) {
  const { L, loc, lang } = useT();
  const reduced = useReduced();
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-line bg-surface shadow-sf">
      <div className="flex flex-col items-center gap-2 bg-[linear-gradient(160deg,var(--sf-primary),color-mix(in_srgb,var(--sf-primary)_55%,black))] px-5 pt-6 pb-7 text-center text-white">
        <motion.span initial={reduced ? false : { scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }}>
          <CheckCircle2 className="size-14" strokeWidth={1.8} />
        </motion.span>
        <p className="text-[20px] font-bold">{L("الدفع تم بنجاح", "Payment successful")}</p>
        <Money value={r.amount + r.tip} className="text-[30px] font-bold" />
      </div>
      <div className="relative -mt-3 rounded-t-[22px] bg-surface px-5 pt-5 pb-5">
        <div className="mb-4 flex items-center gap-3">
          <Mark className="size-10" />
          <div className="min-w-0">
            <p className="font-display text-[17px] font-semibold">{loc(r.restaurant)}</p>
            <p className="text-[12.5px] text-muted">
              {r.branch ? loc(r.branch) : null}
              {r.table ? ` · ${L("ترابيزة", "Table")} ${r.table}` : null}
              {r.orderNo ? ` · #${r.orderNo}` : null}
            </p>
          </div>
        </div>
        {r.lines?.length ? (
          <ul className="mb-3 grid gap-1 border-b border-dashed border-line-strong pb-3 text-[13.5px]">
            {r.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>
                  <span className="num text-muted">{l.qty}× </span>
                  {loc(l.name)}
                </span>
                <Money value={l.total} />
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="grid gap-1.5 text-[13.5px]">
          <Row k={r.splitLabel ? L(`نصيبك (${r.splitLabel})`, `Your share (${r.splitLabel})`) : L("المبلغ", "Amount")} v={<Money value={r.amount} />} />
          {r.tip ? <Row k={L("بقشيش", "Tip")} v={<Money value={r.tip} />} /> : null}
          <Row k={L("طريقة الدفع", "Method")} v={r.method} />
          {r.reference ? <Row k={L("رقم العملية", "Reference")} v={<span className="num">{r.reference}</span>} /> : null}
          <Row k={L("الوقت", "Time")} v={<span className="num">{new Date(r.at).toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>} />
        </dl>
        <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-[12px] text-muted">{L("الفاتورة الإلكترونية الرسمية (مصلحة الضرائب) بتطلع من الكاشير مع قفل الحساب.", "The official e-receipt (Egyptian Tax Authority) is issued by the cashier when the check closes.")}</p>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}

const FEEDBACK_TAGS = [
  { k: "food", ar: "الأكل", en: "Food" },
  { k: "service", ar: "الخدمة", en: "Service" },
  { k: "speed", ar: "السرعة", en: "Speed" },
  { k: "clean", ar: "النضافة", en: "Cleanliness" },
  { k: "value", ar: "السعر", en: "Value" },
];

export function FeedbackCard({ svc, slug, checkId, orderId, tableCode }: { svc: GuestService; slug: string; checkId?: string | null; orderId?: string | null; tableCode?: string | null }) {
  const { L } = useT();
  const { toast } = useToast();
  const reduced = useReduced();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await svc.feedback(slug, { checkId, orderId, tableCode, stars, comment, tags });
      setDone(true);
    } catch {
      toast({ title: L("ماوصلش، جرّب تاني", "Didn't go through, try again"), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div id="rate" className="rounded-[24px] border border-line bg-surface p-5 shadow-sf-sm">
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div key="thanks" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
            <p className="text-[18px] font-bold">{L("شكرًا على رأيك 💚", "Thanks for your feedback 💚")}</p>
            <p className="mt-1 text-[13.5px] text-muted">{stars <= 2 ? L("آسفين جدًا — المدير وصله رأيك وهيتواصل معاك.", "We're sorry — the manager has your note and will reach out.") : L("مستنيينك تاني!", "See you again soon!")}</p>
          </motion.div>
        ) : (
          <motion.div key="form" exit={{ opacity: 0 }}>
            <p className="text-center text-[17px] font-bold">{L("إيه رأيك في الزيارة؟", "How was your visit?")}</p>
            <div className="mt-3 flex justify-center gap-1.5" role="radiogroup" aria-label={L("التقييم", "Rating")}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n}`} onClick={() => setStars(n)} className="grid size-12 place-items-center rounded-full transition active:scale-90">
                  <Star className={cn("size-9 transition-colors", n <= stars ? "fill-brass text-brass" : "text-line-strong")} strokeWidth={1.6} />
                </button>
              ))}
            </div>
            {stars ? (
              <motion.div initial={reduced ? false : { opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="grid gap-3 overflow-hidden pt-4">
                <p className="text-center text-[13px] text-muted">{stars >= 4 ? L("إيه أكتر حاجة عجبتك؟", "What did you like most?") : L("إيه اللي محتاج يتحسن؟", "What should we improve?")}</p>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {FEEDBACK_TAGS.map((t) => {
                    const on = tags.includes(t.k);
                    return (
                      <button key={t.k} type="button" aria-pressed={on} onClick={() => setTags((x) => (on ? x.filter((y) => y !== t.k) : [...x, t.k]))} className={cn("h-9 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors", on ? "border-primary bg-primary-soft text-primary" : "border-line")}>
                        {L(t.ar, t.en)}
                      </button>
                    );
                  })}
                </div>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={2} placeholder={L("كلمة للمطعم (اختياري)", "A note for the restaurant (optional)")} className="w-full resize-none rounded-2xl border border-line bg-surface px-3.5 py-3 text-[14.5px] outline-none focus:border-primary" />
                <Button size="lg" block onClick={submit} loading={busy}>
                  {L("ابعت التقييم", "Send rating")}
                </Button>
              </motion.div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function LoyaltyCard({ svc, slug, checkId, defaultName = "", defaultPhone = "" }: { svc: GuestService; slug: string; checkId?: string | null; defaultName?: string; defaultPhone?: string }) {
  const { L } = useT();
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [points, setPoints] = useState<number | null>(null);

  const join = async () => {
    if (!normalizePhone(phone)) return setErr(L("رقم موبايل مصري صحيح (01xxxxxxxxx)", "A valid Egyptian mobile (01xxxxxxxxx)"));
    setErr(null);
    setBusy(true);
    try {
      const r = await svc.joinLoyalty(slug, { name, phone, checkId });
      setPoints(r.points);
    } catch {
      setErr(L("حصلت مشكلة، جرّب تاني", "Something went wrong, try again"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-[24px] border border-brass/30 bg-[linear-gradient(150deg,var(--sf-brass-soft),var(--sf-surface))] p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brass text-brass-ink">
          <Gift className="size-5.5" />
        </span>
        <div>
          <p className="text-[17px] font-bold">{points !== null ? L("أهلاً بيك في نادي سُفرة!", "Welcome to the Sufra club!") : L("انضم لنادي سُفرة", "Join the Sufra club")}</p>
          <p className="text-[13px] text-muted">{points !== null ? L(`رصيدك دلوقتي ${points} نقطة`, `You now have ${points} points`) : L("نقطة على كل ١٠ ج.م، وهدية في عيد ميلادك", "1 point per 10 EGP, and a birthday treat")}</p>
        </div>
      </div>
      {points === null ? (
        <div className="mt-4 grid gap-2.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={L("اسمك", "Your name")} autoComplete="name" aria-label={L("اسمك", "Your name")} />
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" inputMode="tel" autoComplete="tel" dir="ltr" aria-label={L("الموبايل", "Mobile")} error={err ?? undefined} />
          <Button variant="brass" size="lg" block onClick={join} loading={busy}>
            {L("انضم", "Join")}
          </Button>
          <p className="text-center text-[11.5px] text-muted">{L("هنستخدم رقمك للنقط والعروض بس — تقدر تلغي في أي وقت", "We only use your number for points and offers — opt out any time")}</p>
        </div>
      ) : null}
    </div>
  );
}
