/**
 * Shared-device time clock (/timeclock, kiosk layout) — the POS tablet by the staff door: tap your name, enter your PIN,
 * optional/required selfie (settings.hr.kioskSelfie), done. Nobody stays signed in; the device session is untouched.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Camera, CheckCircle2, LogIn, LogOut, X } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { Membership } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, PinPad } from "@/ui";
import { useHr, useNow } from "./useHr";
import { punch } from "./ops";
import { presence } from "./lib/attendance";
import { snapshot } from "./image";
import { minutesText, hmRange } from "./labels";
import { PersonPhoto } from "./ui";

type Step = { k: "pick" } | { k: "pin"; m: Membership } | { k: "selfie"; m: Membership } | { k: "done"; m: Membership; kind: "in" | "out" | "break_start" | "break_end" };

export default function TimeclockPage() {
  const { L, lang } = useT();
  const db = useDb();
  const hr = useHr();
  const now = useNow(10_000);
  const [step, setStep] = useState<Step>({ k: "pick" });
  const [err, setErr] = useState<string | null>(null);
  const recent = useLive("attendancePunches", { gte: { at: new Date(now - 16 * 3_600_000).toISOString() } }).data;
  const here = useMemo(() => presence(recent, now), [recent, now]);
  const shifts = useLive("rotaShifts", { where: { date: hr.today, published: true } }).data;
  const people = hr.active.filter((m) => m.hasPin);
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (step.k !== "done") return;
    const t = setTimeout(() => {
      setStep({ k: "pick" });
      setPhoto(null);
    }, 3500);
    return () => clearTimeout(t);
  }, [step]);

  const record = async (m: Membership, kind: "in" | "out" | "break_start" | "break_end", selfie: string | null) => {
    await punch(db, { membershipId: m.id, kind, source: selfie ? "selfie" : "pin", branchId: hr.session.branchId, photoUrl: selfie });
    setStep({ k: "done", m, kind });
  };
  const nextKind = (m: Membership) => (here.get(m.id) ? "out" : "in");

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Link to="/" className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold text-muted hover:bg-surface-2">
          <ArrowRight className="size-4 ltr:rotate-180" />
          {L("رجوع", "Back")}
        </Link>
        <h1 className="flex-1 text-center text-[20px]">{L("ساعة الحضور", "Time clock")}</h1>
        <p className="num font-display text-[24px] font-semibold">{new Date(now).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", timeZone: hr.tz })}</p>
      </header>

      {step.k === "pick" ? (
        <main className="mx-auto w-full max-w-5xl flex-1 p-4">
          <p className="mb-4 text-center text-[16px] text-muted">{L("دوس على اسمك وادخل الـ PIN", "Tap your name and enter your PIN")}</p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {people.map((m) => {
              const h = here.get(m.id);
              const sh = shifts.find((s) => s.membershipId === m.id);
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => { setErr(null); setStep({ k: "pin", m }); }} className={cn("flex w-full flex-col items-center gap-2 rounded-[20px] border bg-surface p-4 shadow-sf-sm transition-transform active:scale-[0.98]", h ? "border-ok/50" : "border-line")}>
                    <PersonPhoto m={m} p={hr.profileOf(m.id)} size="lg" status={h ? (h.state === "in" ? "online" : "away") : null} />
                    <span className="max-w-full truncate text-[15px] font-bold">{m.name}</span>
                    <span className="num text-[12.5px] text-muted">{h ? L(`جوه من ${minutesText(Math.floor((now - Date.parse(h.since)) / 60000), lang)}`, `in for ${minutesText(Math.floor((now - Date.parse(h.since)) / 60000), lang)}`) : sh ? hmRange(sh.start, sh.end) : "—"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </main>
      ) : null}

      {step.k === "pin" ? (
        <main className="mx-auto grid w-full max-w-sm flex-1 content-center gap-5 p-4">
          <div className="flex flex-col items-center gap-2">
            <PersonPhoto m={step.m} p={hr.profileOf(step.m.id)} size="xl" />
            <p className="text-[20px] font-bold">{step.m.name}</p>
            <p className="text-muted">{here.get(step.m.id) ? L("هتسجّل انصراف", "You'll clock out") : L("هتسجّل حضور", "You'll clock in")}</p>
          </div>
          <PinPad
            error={err}
            onComplete={async (pin) => {
              const ok = await db.repo.auth.verifyPin(db.restaurantId, step.m.id, pin);
              if (!ok) {
                setErr(L("الـ PIN غلط", "Wrong PIN"));
                return false;
              }
              if (hr.rules.kioskSelfie !== "off") setStep({ k: "selfie", m: step.m });
              else await record(step.m, nextKind(step.m), null);
              return true;
            }}
          />
          <Button variant="ghost" icon={<X />} onClick={() => setStep({ k: "pick" })}>{L("مش أنا", "Not me")}</Button>
        </main>
      ) : null}

      {step.k === "selfie" ? <Selfie m={step.m} required={hr.rules.kioskSelfie === "required"} onShot={setPhoto} photo={photo} onDone={(p) => record(step.m, nextKind(step.m), p)} /> : null}

      {step.k === "done" ? (
        <main className="grid flex-1 place-items-center p-6 text-center">
          <div className="grid justify-items-center gap-3">
            <CheckCircle2 className={cn("size-20", step.kind === "in" ? "text-ok" : "text-primary")} />
            <p className="text-[26px] font-bold">{step.kind === "in" ? L(`أهلاً ${step.m.name.split(" ")[0]} — يوم موفق`, `Welcome ${step.m.name.split(" ")[0]} — have a good shift`) : L(`تسلم إيدك يا ${step.m.name.split(" ")[0]}`, `Thanks ${step.m.name.split(" ")[0]} — see you`)}</p>
            <p className="num text-[18px] text-muted">
              {step.kind === "in" ? <LogIn className="me-1 inline size-5" /> : <LogOut className="me-1 inline size-5" />}
              {new Date().toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", timeZone: hr.tz })}
            </p>
            {photo ? <img src={photo} alt="" className="size-24 rounded-2xl object-cover" /> : null}
          </div>
        </main>
      ) : null}
    </div>
  );
}

function Selfie({ m, required, onShot, photo, onDone }: { m: Membership; required: boolean; onShot: (p: string | null) => void; photo: string | null; onDone: (p: string | null) => void }) {
  const { L } = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user", width: 480, height: 480 }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play().catch(() => undefined);
        }
      })
      .catch(() => setFailed(true));
    if (!navigator.mediaDevices) setFailed(true);
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  return (
    <main className="mx-auto grid w-full max-w-sm flex-1 content-center gap-4 p-4 text-center">
      <p className="text-[18px] font-bold">{L(`صورة سريعة يا ${m.name.split(" ")[0]}`, `Quick photo, ${m.name.split(" ")[0]}`)}</p>
      <div className="relative mx-auto aspect-square w-64 overflow-hidden rounded-[28px] border border-line bg-surface-3">
        {photo ? <img src={photo} alt="" className="size-full object-cover" /> : <video ref={video} playsInline muted className="size-full -scale-x-100 object-cover" />}
        {failed ? <p className="absolute inset-0 grid place-items-center p-4 text-[14px] text-muted">{L("الكاميرا مش متاحة", "Camera not available")}</p> : null}
      </div>
      {!photo ? (
        <Button size="lg" icon={<Camera />} disabled={failed} onClick={() => video.current && onShot(snapshot(video.current))}>{L("صوّر", "Take photo")}</Button>
      ) : (
        <Button size="lg" icon={<CheckCircle2 />} onClick={() => onDone(photo)}>{L("تمام — سجّل", "Looks good — record")}</Button>
      )}
      {!required || failed ? <Button variant="ghost" onClick={() => onDone(null)}>{L("من غير صورة", "Skip photo")}</Button> : null}
    </main>
  );
}
