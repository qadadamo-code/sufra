import { useMemo, useState } from "react";
import { CalendarCheck, Minus, Plus } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import { MatteAlertFeedback } from "@/components/ui/matte-stack-feedback";
import { DAYS_AR, DAYS_EN, type Restaurant } from "@/lib/data";
import { fmtTime, timeSlots } from "@/lib/hours";
import { useLang } from "@/lib/i18n";
import { notify } from "@/lib/notify";
import { navigate } from "@/lib/router";
import { addDays, addVisit, updateAccount, useAccount, ymdOf, type Booking } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Modal } from "./Modal";

export function BookingDialog({ r, open, onClose }: { r: Restaurant; open: boolean; onClose: () => void }) {
  const { L, lang } = useLang();
  const acc = useAccount();
  const now = useMemo(() => new Date(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(now, i)), [now]);
  const [dayIdx, setDayIdx] = useState(0);
  const date = days[dayIdx];
  const slots = useMemo(() => timeSlots(r.hours, date, now), [r.hours, date, now]);
  const [time, setTime] = useState<number | null>(null);
  const [party, setParty] = useState(2);
  const [seating, setSeating] = useState("any");
  const [tags, setTags] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<Booking | null>(null);
  const slot = time != null && slots.includes(time) ? time : null;

  const seatOpts = [
    { id: "any", ar: "أي مكان", en: "No preference" },
    { id: "indoor", ar: "جوه", en: "Indoors" },
    ...(r.amenities.includes("outdoor") ? [{ id: "outdoor", ar: "برا", en: "Outdoors" }] : []),
    ...(r.amenities.includes("rooftop") ? [{ id: "rooftop", ar: "الروف", en: "Rooftop" }] : []),
    ...(r.amenities.includes("nile-view") ? [{ id: "nile", ar: "على النيل", en: "Nile view" }] : []),
    ...(r.amenities.includes("quiet") ? [{ id: "quiet", ar: "ركن هادي", en: "Quiet corner" }] : []),
  ];
  const tagOpts = [
    { id: "birthday", ar: "عيد ميلاد", en: "Birthday" },
    { id: "anniversary", ar: "ذكرى", en: "Anniversary" },
    { id: "business", ar: "اجتماع شغل", en: "Business" },
    { id: "first", ar: "أول مرة", en: "First visit" },
    { id: "kids", ar: "معانا أطفال", en: "With kids" },
    { id: "accessible", ar: "محتاجين مكان مناسب للكرسي", en: "Wheelchair access" },
  ];

  const confirm = async () => {
    if (!acc) throw new Error("auth");
    if (slot == null) throw new Error("slot");
    await new Promise((res) => setTimeout(res, 1100));
    const b: Booking = {
      id: `b-${Date.now().toString(36)}`,
      rid: r.id,
      date: ymdOf(date),
      time: slot,
      party,
      seating,
      notes: notes.trim(),
      tags,
      status: "confirmed",
      code: "SF-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
      createdAt: Date.now(),
    };
    updateAccount((a) => ({ ...a, bookings: [b, ...a.bookings] }));
    addVisit(50);
    notify({ title: L("الحجز اتأكد", "Booking confirmed"), detail: `${r[lang]} · ${fmtTime(slot, lang)} · ${L(`${party} أفراد`, `${party} guests`)}`, icon: "check" });
    window.setTimeout(() => setDone(b), 700);
  };

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setDone(null);
      setTime(null);
    }, 300);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={done ? L("اتحجزلك!", "You're booked!") : L(`احجز في ${r.ar}`, `Book at ${r.en}`)}
      footer={
        done ? (
          <div className="flex gap-2">
            <button type="button" className="sf-btn sf-btn-ghost flex-1" onClick={close}>{L("تمام", "Done")}</button>
            <button type="button" className="sf-btn sf-btn-primary flex-1" onClick={() => { close(); navigate("/account?tab=history"); }}>{L("حجوزاتي", "My bookings")}</button>
          </div>
        ) : !acc ? (
          <button type="button" className="sf-btn sf-btn-primary w-full" onClick={() => { close(); navigate("/account"); }}>{L("سجّل دخول عشان تحجز", "Sign in to book")}</button>
        ) : (
          <LoadingButton
            onAction={confirm}
            disabled={slot == null}
            pendingLabel={L("بنأكد مع المطعم…", "Confirming with the restaurant…")}
            successLabel={L("اتأكد!", "Confirmed!")}
            errorLabel={L("اختار ميعاد الأول", "Pick a time first")}
            className="w-full"
          >
            <CalendarCheck className="size-4" aria-hidden />
            {slot != null ? L(`أكّد الحجز · ${fmtTime(slot, lang)} · ${party} أفراد`, `Confirm · ${fmtTime(slot, lang)} · ${party} guests`) : L("اختار ميعاد", "Choose a time")}
          </LoadingButton>
        )
      }
    >
      {done ? (
        <div className="py-4 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-ok-soft text-ok">
            <CalendarCheck className="size-8" aria-hidden />
          </span>
          <p className="mt-4 font-display text-2xl font-bold">{r[lang]}</p>
          <p className="mt-1 text-muted-foreground">
            {(lang === "ar" ? DAYS_AR : DAYS_EN)[date.getDay()]} <span className="num">{date.getDate()}/{date.getMonth() + 1}</span> · <span className="num">{fmtTime(done.time, lang)}</span> · {L(`${done.party} أفراد`, `${done.party} guests`)}
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-dashed border-brass px-4 py-2">
            {L("كود الحجز", "Booking code")} <span className="num font-bold text-brass">{done.code}</span>
          </p>
          <p className="mt-3 text-sm text-muted-foreground">{L("+50 نقطة سُفرة. هنفكرك قبلها بساعة.", "+50 Sufra points. We'll remind you an hour before.")}</p>
        </div>
      ) : (
        <div className="grid gap-5">
          <fieldset>
            <legend className="sf-label">{L("اليوم", "Day")}</legend>
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
              {days.map((d, i) => (
                <button key={i} type="button" aria-pressed={dayIdx === i} onClick={() => { setDayIdx(i); setTime(null); }} className={cn("flex w-16 shrink-0 flex-col items-center rounded-2xl border bg-card py-2 text-sm", dayIdx === i && "border-primary bg-primary text-primary-foreground")}>
                  <span className="text-[12px] opacity-80">{i === 0 ? L("النهارده", "Today") : i === 1 ? L("بكرة", "Tmrw") : (lang === "ar" ? DAYS_AR : DAYS_EN)[d.getDay()].slice(0, lang === "ar" ? 6 : 3)}</span>
                  <span className="num text-lg font-semibold">{d.getDate()}</span>
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="sf-label">{L("الميعاد", "Time")}</legend>
            {slots.length ? (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                {slots.map((t) => (
                  <button key={t} type="button" aria-pressed={slot === t} onClick={() => setTime(t)} className={cn("num h-10 rounded-xl border bg-card text-[13px]", slot === t && "border-primary bg-primary text-primary-foreground")}>
                    {fmtTime(t, lang)}
                  </button>
                ))}
              </div>
            ) : (
              <MatteAlertFeedback heading={L("مفيش مواعيد", "No times left")} pill={L("اليوم ده", "This day")} alertTitle={L("المطعم مقفول أو المواعيد خلصت", "Closed or fully booked")} alertDetail={L("جرّب يوم تاني من فوق.", "Try another day above.")} showLabel={L("وريني التنبيه", "Show alert")} closeLabel={L("اقفل التنبيه", "Dismiss alert")} />
            )}
          </fieldset>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <span className="sf-label" id="party-l">{L("عدد الأفراد", "Party size")}</span>
              <div className="flex items-center gap-3 rounded-full border bg-card p-1" role="group" aria-labelledby="party-l">
                <button type="button" className="grid size-9 place-items-center rounded-full hover:bg-muted" onClick={() => setParty((p) => Math.max(1, p - 1))} aria-label={L("أقل", "Fewer")}>
                  <Minus className="size-4" aria-hidden />
                </button>
                <span className="num flex-1 text-center text-lg font-semibold" aria-live="polite">{party}</span>
                <button type="button" className="grid size-9 place-items-center rounded-full hover:bg-muted" onClick={() => setParty((p) => Math.min(20, p + 1))} aria-label={L("أكتر", "More")}>
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>
            </div>
            <label>
              <span className="sf-label">{L("تفضّل تقعد فين؟", "Seating preference")}</span>
              <select className="sf-input" value={seating} onChange={(e) => setSeating(e.target.value)}>
                {seatOpts.map((o) => (
                  <option key={o.id} value={o.id}>{o[lang]}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="sf-label">{L("المناسبة", "Occasion")}</legend>
            <div className="flex flex-wrap gap-2">
              {tagOpts.map((t) => (
                <button key={t.id} type="button" aria-pressed={tags.includes(t.id)} onClick={() => setTags((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))} className="sf-chip h-9 text-[13px]">
                  {t[lang]}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span className="sf-label">{L("ملاحظات للمطعم", "Notes for the restaurant")}</span>
            <textarea className="sf-input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={240} placeholder={L("مثلًا: ترابيزة جنب الشباك، حساسية من المكسرات…", "e.g. window table, nut allergy…")} />
          </label>
        </div>
      )}
    </Modal>
  );
}
