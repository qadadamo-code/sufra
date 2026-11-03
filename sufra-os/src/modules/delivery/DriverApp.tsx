/** /driver — the rider's phone app: shift, my orders, navigate, call/WhatsApp, picked up → arrived → delivered, live GPS. */
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Banknote, Bike, Camera, Check, CheckCircle2, ChevronDown, CreditCard, KeyRound, LocateFixed, LocateOff, MapPin, Navigation, PackageCheck, Power, ShieldAlert, Store, XCircle } from "lucide-react";
import { useDb } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { clock } from "@/lib/time";
import { Badge, Button, Dialog, EmptyState, Money, Segmented, Textarea, useReduced, useToast } from "@/ui";
import { latinDigits } from "@/lib/arabic";
import { arrive, deliver, failDelivery, pickUp, StageError, type DeliverInput } from "./stages";
import { dispatchOf } from "./settings";
import { endShift, startShift } from "./driverOps";
import { googleDirections, haversineKm, travelMinutes } from "./geo";
import { shiftCash } from "./settle";
import { useDeliveryData, useNow, type OrderView } from "./useDelivery";
import { useRiderGps } from "./useRiderGps";
import { ContactButtons, ItemLines } from "./ui";
import { DriverRadio } from "@/modules/ops/radio/DriverRadio";

export default function DriverApp() {
  const { L, lang } = useT();
  const db = useDb();
  const { staff } = useSession();
  const { toast } = useToast();
  const data = useDeliveryData();
  useNow(30_000); // keeps "due" times and distances fresh
  const me = staff?.id ?? null;
  const shift = data.shifts.find((s) => s.driverId === me && s.status === "on") ?? null;
  const mine = data.views.filter((v) => v.order.driverId === me);
  const queue = mine.filter((v) => ["assigned", "picked_up", "arrived"].includes(dispatchOf(v.order).stage)).sort((a, b) => rank(a) - rank(b) || (dispatchOf(a.order).assignedAt ?? "").localeCompare(dispatchOf(b.order).assignedAt ?? ""));
  const onRoad = queue.some((v) => ["picked_up", "arrived"].includes(dispatchOf(v.order).stage));
  const gps = useRiderGps(db, me, !!shift, onRoad);
  const done = shift ? mine.filter((v) => dispatchOf(v.order).driverShiftId === shift.id && dispatchOf(v.order).stage === "delivered") : [];
  const cash = shiftCash(done.map((v) => v.order));
  const [busy, setBusy] = useState(false);
  const toggleShift = async () => {
    if (!me) return;
    setBusy(true);
    try {
      if (shift) {
        if (queue.length) {
          toast({ title: L("سلّم طلباتك الأول", "Finish your orders first"), tone: "warn" });
          return;
        }
        await endShift(db, shift);
        toast({ title: L("الشيفت خلص — سلّم الكاش للكاشير", "Shift ended — hand the cash to the cashier"), tone: "success" });
      } else {
        await startShift(db, me);
        toast({ title: L("الشيفت بدأ — موقعك بيتشارك مع المطعم", "Shift started — sharing your location with the restaurant"), tone: "success" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-md gap-4">
      {/* shift header */}
      <section className={cn("relative overflow-hidden rounded-[26px] p-4 text-white shadow-sf-lg", shift ? "bg-[linear-gradient(150deg,#0d5a53,#062b27)]" : "bg-[linear-gradient(150deg,#3b4542,#1d2321)]")}>
        <div className="pointer-events-none absolute -end-10 -top-12 size-44 rounded-full bg-white/8" />
        <div className="flex items-center gap-3">
          <span className="grid size-12 place-items-center rounded-2xl bg-white/12 [&_svg]:size-6">
            <Bike />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] text-white/70">{shift ? L(`في الشيفت من ${clock(shift.startedAt, lang)}`, `On shift since ${clock(shift.startedAt, lang)}`) : L("خارج الشيفت", "Off shift")}</p>
            <h1 className="truncate text-[22px] leading-tight">{staff?.name ?? ""}</h1>
          </div>
          <Button variant={shift ? "secondary" : "brass"} icon={<Power />} loading={busy} onClick={toggleShift} className={shift ? "border-white/20 bg-white/10 text-white hover:bg-white/15" : ""}>
            {shift ? L("إنهاء", "End") : L("ابدأ الشيفت", "Start shift")}
          </Button>
        </div>
        {shift ? (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label={L("معايا كاش", "Cash on me")} value={<Money value={cash.cash} compact whole />} />
            <Stat label={L("اتسلّم", "Delivered")} value={<span className="num">{cash.orders}</span>} />
            <Stat label={L("الموقع", "Location")} value={<GpsChip state={gps.state} />} />
          </div>
        ) : null}
      </section>
      {/* rider ↔ dispatch push-to-talk (src/modules/ops/radio) */}
      <DriverRadio />

      {gps.state === "denied" ? (
        <p className="flex items-start gap-2 rounded-2xl border border-warn/40 bg-warn-soft px-3 py-2.5 text-[13.5px] text-warn">
          <ShieldAlert className="mt-0.5 size-4.5 shrink-0" />
          {L("فعّل إذن الموقع للمتصفح عشان المطعم والعميل يشوفوك على الخريطة", "Allow location for this site so the restaurant and the customer can see you on the map")}
        </p>
      ) : null}

      {!shift ? (
        <EmptyState icon={<Power />} title={L("ابدأ الشيفت عشان تستلم طلبات", "Start your shift to get orders")} body={L("بنشارك موقعك بس وإنت في الشيفت", "Your location is shared only while on shift")} className="rounded-[22px] border border-dashed border-line" />
      ) : queue.length === 0 ? (
        <EmptyState icon={<Store />} title={L("مفيش طلبات معاك دلوقتي", "No orders for you right now")} body={L("خليك قريب من المطبخ — هيوصلك أول ما يتوزّع طلب", "Stay near the kitchen — you'll see orders as soon as they're assigned")} className="rounded-[22px] border border-dashed border-line" />
      ) : (
        <ul className="grid gap-3">
          <AnimatePresence initial={false}>
            {queue.map((v, i) => (
              <RiderCard key={v.order.id} v={v} first={i === 0} shiftId={shift.id} data={data} gps={gps.last} />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {done.length ? (
        <section className="rounded-[22px] border border-line bg-surface p-4">
          <p className="mb-2 flex items-center gap-2 text-[14.5px] font-bold">
            <CheckCircle2 className="size-4.5 text-ok" /> {L("اتسلّم في الشيفت ده", "Delivered this shift")}
          </p>
          <ul className="grid gap-1.5 text-[13.5px]">
            {done.map((v) => {
              const c = dispatchOf(v.order).collected;
              return (
                <li key={v.order.id} className="flex items-center gap-2">
                  <span className="num font-bold">#{v.order.number}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{v.customer?.name ?? ""}</span>
                  {c && c.method !== "prepaid" ? <Money value={c.amount} compact className="font-semibold" /> : <Badge size="sm" tone="ok">{L("مدفوع", "Paid")}</Badge>}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 rounded-xl bg-brass-soft px-3 py-2 text-[13px] text-brass-text">{L("سلّم الكاش للكاشير آخر الشيفت — هيتسجل عليك بالظبط", "Hand the cash to the cashier at the end of the shift — it is settled against you")}</p>
        </section>
      ) : null}
    </div>
  );
}

const rank = (v: OrderView) => ({ arrived: 0, picked_up: 1, assigned: 2 })[dispatchOf(v.order).stage as "assigned"] ?? 3;

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white/10 px-2 py-2">
      <div className="text-[17px] font-bold leading-tight">{value}</div>
      <div className="text-[11.5px] text-white/70">{label}</div>
    </div>
  );
}

function GpsChip({ state }: { state: ReturnType<typeof useRiderGps>["state"] }) {
  const { L } = useT();
  const on = state === "sharing";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[13.5px]", on ? "text-white" : "text-white/70")}>
      {on ? <LocateFixed className="size-4" /> : <LocateOff className="size-4" />}
      {{ off: L("مقفول", "Off"), waiting: L("بيدوّر…", "Finding…"), sharing: L("شغال", "Live"), denied: L("ممنوع", "Blocked"), unavailable: L("مش متاح", "N/A") }[state]}
    </span>
  );
}

function RiderCard({ v, first, shiftId, data, gps }: { v: OrderView; first: boolean; shiftId: string; data: ReturnType<typeof useDeliveryData>; gps: { lat: number; lng: number } | null }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const reduced = useReduced();
  const d = dispatchOf(v.order);
  const [open, setOpen] = useState(first);
  const [busy, setBusy] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [failOpen, setFailOpen] = useState(false);
  const here = gps ?? (data.locations.get(v.order.driverId ?? "") ?? null);
  const etaMin = v.to ? travelMinutes(here ?? data.cfg.origin, v.to, data.cfg.speedKmh) : null;
  const km = v.to ? haversineKm(here ?? data.cfg.origin, v.to) : null;
  const ready = v.column !== "preparing" && (d.readyAt || v.items.every((i) => i.status === "ready" || i.status === "served" || i.status === "void"));
  const step = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast({ title: ok, tone: "success", duration: 2000 });
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const address = v.order.delivery;
  return (
    <motion.li layout={!reduced} initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -30 }}>
      <article className={cn("overflow-hidden rounded-[24px] border-2 bg-surface shadow-sf", d.stage === "assigned" ? "border-info/50" : "border-primary/60")}>
        <header className="flex items-center gap-3 p-4 pb-2">
          <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl font-mono text-[18px] font-bold text-white", d.stage === "assigned" ? "bg-info" : "bg-primary")}>{v.order.number}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[17px] font-bold">{v.customer?.name ?? L("عميل", "Customer")}</p>
            <p className="text-[12.5px] text-muted">
              {d.stage === "assigned" ? (ready ? L("جاهز — استلمه من المطبخ", "Ready — collect from the kitchen") : L("لسه بيتجهز", "Still being prepared")) : d.stage === "arrived" ? L("إنت عند العنوان", "You're at the door") : L("في الطريق", "On the way")}
              {d.promisedAt ? ` · ${L("الموعد", "due")} ${clock(d.promisedAt, lang)}` : ""}
            </p>
          </div>
          <ContactButtons phone={v.customer?.phone} name={v.customer?.name} size="lg" />
        </header>

        {address ? (
          <div className="mx-4 flex items-start gap-3 rounded-2xl bg-surface-2 p-3">
            <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-snug">{address.address}</p>
              <p className="text-[12.5px] text-muted">{[address.area, address.notes].filter(Boolean).join(" · ")}</p>
              {km !== null ? (
                <p className="num mt-1 text-[12.5px] font-semibold text-ink-2" dir="ltr">
                  {km.toFixed(1)} km · ~{etaMin}′
                </p>
              ) : null}
            </div>
            <a href={googleDirections(v.to, `${address.address}, ${address.area}, Cairo`, here)} target="_blank" rel="noreferrer" className="flex h-12 shrink-0 items-center gap-1.5 rounded-2xl bg-primary px-3.5 text-[14px] font-bold text-primary-ink shadow-sf-sm">
              <Navigation className="size-4.5" /> {L("روح", "Navigate")}
            </a>
          </div>
        ) : null}

        <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-line px-3 py-2.5">
          {v.due > 0 ? (
            <>
              <Banknote className="size-6 text-brass" />
              <div className="flex-1">
                <p className="text-[12px] text-muted">{L("حصّل من العميل", "Collect from customer")}</p>
                <Money value={v.due} className="text-[22px] font-bold" />
              </div>
              <Badge tone="brass">{/card/.test(v.order.note) ? L("كارت", "Card") : L("كاش", "Cash")}</Badge>
            </>
          ) : (
            <>
              <CreditCard className="size-6 text-ok" />
              <p className="flex-1 text-[15px] font-bold text-ok">{L("مدفوع أونلاين — ماتحصّلش حاجة", "Paid online — collect nothing")}</p>
            </>
          )}
        </div>

        <button type="button" onClick={() => setOpen((x) => !x)} className="mx-4 mt-2 flex w-[calc(100%-2rem)] items-center gap-2 py-2 text-[13.5px] font-semibold text-ink-2" aria-expanded={open}>
          {L(`الأصناف (${v.items.filter((i) => i.status !== "void").reduce((a, i) => a + i.qty, 0)})`, `Items (${v.items.filter((i) => i.status !== "void").reduce((a, i) => a + i.qty, 0)})`)}
          <ChevronDown className={cn("ms-auto size-4 transition-transform", open && "rotate-180")} />
        </button>
        {open ? (
          <div className="mx-4 mb-2">
            <ItemLines items={v.items} compact />
          </div>
        ) : null}

        <footer className="grid gap-2 border-t border-line bg-surface-2/50 p-3">
          {d.stage === "assigned" ? (
            <Button size="xl" block icon={<PackageCheck />} loading={busy} disabled={!ready} onClick={() => step(() => pickUp(db, v.order.id, shiftId), L("العميل اتبلغ إنك في الطريق", "Customer told you're on the way"))}>
              {ready ? L("استلمت الطلب — يلا", "Picked up — go") : L("مستني المطبخ…", "Waiting for the kitchen…")}
            </Button>
          ) : null}
          {d.stage === "picked_up" ? (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" variant="secondary" icon={<MapPin />} loading={busy} onClick={() => step(() => arrive(db, v.order.id), L("بلّغنا العميل إنك وصلت", "Customer told you've arrived"))}>
                {L("وصلت", "Arrived")}
              </Button>
              <Button size="lg" icon={<Check />} onClick={() => setDeliverOpen(true)}>
                {L("سلّمت", "Delivered")}
              </Button>
            </div>
          ) : null}
          {d.stage === "arrived" ? (
            <Button size="xl" block icon={<Check />} onClick={() => setDeliverOpen(true)}>
              {L("سلّمت الطلب", "Delivered")}
            </Button>
          ) : null}
          {d.stage === "picked_up" || d.stage === "arrived" ? (
            <Button variant="ghost" size="sm" icon={<XCircle />} className="text-danger" onClick={() => setFailOpen(true)}>
              {L("ماقدرتش أسلّم", "Couldn't deliver")}
            </Button>
          ) : null}
        </footer>
      </article>
      <DeliverDialog open={deliverOpen} onClose={() => setDeliverOpen(false)} v={v} rule={data.cfg.proof} />
      <FailDialog open={failOpen} onClose={() => setFailOpen(false)} v={v} />
    </motion.li>
  );
}

async function downscale(file: File, max = 640): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function DeliverDialog({ open, onClose, v, rule }: { open: boolean; onClose: () => void; v: OrderView; rule: "none" | "photo" | "otp" | "either" }) {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [kind, setKind] = useState<"otp" | "photo">(rule === "photo" ? "photo" : "otp");
  const [otp, setOtp] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [method, setMethod] = useState<"cash" | "card">(/card/.test(v.order.note) ? "card" : "cash");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const choose = rule === "either";
  const needs = rule !== "none";
  const ready = !needs || (kind === "otp" ? otp.length === 4 : !!photo);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const input: DeliverInput = {
        proof: needs ? (kind === "otp" ? { kind: "otp", otp } : { kind: "photo", photo }) : { kind: "none" },
        collected: v.due > 0 ? { method, amount: v.due } : { method: "prepaid", amount: 0 },
      };
      await deliver(db, v.order.id, input);
      toast({ title: L("اتسلّم ✓ — العميل وصله رابط التقييم", "Delivered ✓ — the customer got the rating link"), tone: "success" });
      onClose();
    } catch (e) {
      setErr(e instanceof StageError && e.code === "bad_otp" ? L("الكود غلط — اسأل العميل تاني", "Wrong code — ask the customer again") : e instanceof StageError && e.code === "needs_proof" ? L("محتاج إثبات تسليم", "Proof of delivery needed") : String((e as Error).message));
      setOtp("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={L(`تسليم #${v.order.number}`, `Deliver #${v.order.number}`)}
      footer={
        <Button size="lg" block icon={<Check />} disabled={!ready} loading={busy} onClick={go}>
          {v.due > 0 ? L("استلمت الفلوس وسلّمت", "Collected & delivered") : L("سلّمت", "Delivered")}
        </Button>
      }
    >
      <div className="grid gap-4">
        {v.due > 0 ? (
          <div className="rounded-2xl bg-brass-soft p-3">
            <p className="text-[12.5px] text-brass-text">{L("المبلغ المطلوب", "Amount due")}</p>
            <Money value={v.due} className="text-[26px] font-bold" />
            <Segmented
              className="mt-2"
              block
              label={L("طريقة الدفع", "Payment method")}
              value={method}
              onChange={setMethod}
              options={[
                { value: "cash", label: L("كاش", "Cash"), icon: <Banknote /> },
                { value: "card", label: L("كارت (ماكينة)", "Card (terminal)"), icon: <CreditCard /> },
              ]}
            />
          </div>
        ) : null}
        {needs ? (
          <>
            {choose ? (
              <Segmented
                block
                label={L("إثبات التسليم", "Proof of delivery")}
                value={kind}
                onChange={setKind}
                options={[
                  { value: "otp", label: L("كود العميل", "Customer code"), icon: <KeyRound /> },
                  { value: "photo", label: L("صورة", "Photo"), icon: <Camera /> },
                ]}
              />
            ) : null}
            {kind === "otp" ? (
              <div className="grid justify-items-center gap-2">
                <p className="text-center text-[13.5px] text-muted">{L("اطلب من العميل الكود اللي ظاهر في صفحة التتبع", "Ask the customer for the code on their tracking page")}</p>
                <input
                  value={otp}
                  onChange={(e) => setOtp(latinDigits(e.target.value).replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={L("كود التسليم", "Delivery code")}
                  placeholder="••••"
                  dir="ltr"
                  data-autofocus
                  className="num h-16 w-48 rounded-2xl border-2 border-line-strong bg-surface text-center text-[34px] font-bold tracking-[0.4em] outline-none focus:border-primary"
                />
              </div>
            ) : (
              <div className="grid gap-2">
                <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => e.target.files?.[0] && setPhoto(await downscale(e.target.files[0]))} />
                {photo ? <img src={photo} alt={L("صورة التسليم", "Delivery photo")} className="max-h-56 w-full rounded-2xl object-cover" /> : null}
                <Button variant="secondary" icon={<Camera />} onClick={() => file.current?.click()}>
                  {photo ? L("صورة تانية", "Retake") : L("صوّر الطلب عند الباب", "Photo at the door")}
                </Button>
              </div>
            )}
          </>
        ) : null}
        {err ? <p className="rounded-xl bg-danger-soft px-3 py-2 text-[13.5px] font-semibold text-danger">{err}</p> : null}
      </div>
    </Dialog>
  );
}

const FAILS = [
  { ar: "العميل مش بيرد", en: "Customer not answering" },
  { ar: "العنوان غلط", en: "Wrong address" },
  { ar: "العميل رفض الاستلام", en: "Customer refused" },
  { ar: "مشكلة في الموتوسيكل", en: "Bike problem" },
];

function FailDialog({ open, onClose, v }: { open: boolean; onClose: () => void; v: OrderView }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => FAILS.map((f) => (lang === "ar" ? f.ar : f.en)), [lang]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={L(`مشكلة في تسليم #${v.order.number}`, `Problem delivering #${v.order.number}`)}
      description={L("المطعم هيتبلغ ويقرر: محاولة تانية ولا رجوع", "The restaurant is alerted and decides: retry or return")}
      footer={
        <Button
          variant="danger"
          block
          disabled={!reason.trim()}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await failDelivery(db, v.order.id, reason);
              toast({ title: L("اتبلّغ المطعم", "Restaurant alerted"), tone: "warn" });
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {L("بلّغ المطعم", "Alert the restaurant")}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {opts.map((o) => (
            <button key={o} type="button" onClick={() => setReason(o)} className={cn("rounded-full border px-3.5 py-2 text-[13.5px] font-semibold", reason === o ? "border-danger bg-danger-soft text-danger" : "border-line")}>
              {o}
            </button>
          ))}
        </div>
        <Textarea label={L("تفاصيل", "Details")} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
      </div>
    </Dialog>
  );
}
