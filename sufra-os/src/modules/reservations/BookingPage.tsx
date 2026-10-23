/** Public booking page: /r/:restaurantSlug/book — party, day, time (from real availability), details → pending booking. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Baby, CalendarDays, Cake, Check, Clock, MapPin, Phone, Users } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { ReservationTag } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, EmptyState, Input, Skeleton, Textarea, useReduced } from "@/ui";
import { Mark } from "@/shell/Logo";
import { AuthToggles, StarPattern } from "@/pages/AuthChrome";
import { guestBooking, isoDate, validPhone, type BookingInfo, type PublicSlot } from "./booking";
import { resDict } from "./dict";
import { addDays, parseDate } from "./useRes";

export default function BookingPage() {
  const { restaurantSlug = "" } = useParams();
  const repo = useRepo();
  const api = useMemo(() => guestBooking(repo), [repo]);
  const r = useDict(resDict);
  const { loc, lang, L } = useT();
  const reduced = useReduced();
  const [info, setInfo] = useState<BookingInfo | null | undefined>(undefined);
  const [party, setParty] = useState(2);
  const [date, setDate] = useState(() => isoDate(new Date()));
  const [slots, setSlots] = useState<PublicSlot[] | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<ReservationTag[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ startsAt: string; party: number } | null>(null);
  const details = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.info(restaurantSlug).then(setInfo, () => setInfo(null));
  }, [api, restaurantSlug]);

  useEffect(() => {
    if (!info) return;
    let alive = true;
    setSlots(null);
    setSlot(null);
    api.slots(restaurantSlug, date, party).then(
      (s) => alive && setSlots(s),
      () => alive && setSlots([]),
    );
    return () => {
      alive = false;
    };
  }, [api, restaurantSlug, date, party, info]);

  useEffect(() => {
    if (info) document.title = `${r("book.title")} · ${loc(info.restaurant.name)}`;
  }, [info, loc, r]);

  const days = useMemo(() => Array.from({ length: info?.days ?? 30 }, (_, i) => addDays(isoDate(new Date()), i)), [info]);
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit", hour12: lang === "ar" });
  const groups = useMemo(() => {
    const g: Record<"lunch" | "evening" | "late", PublicSlot[]> = { lunch: [], evening: [], late: [] };
    for (const s of slots ?? []) {
      if (s.reason === "past") continue;
      const h = new Date(s.startsAt).getHours();
      const hh = h < 6 ? h + 24 : h;
      g[hh < 16 ? "lunch" : hh < 21 ? "evening" : "late"].push(s);
    }
    return g;
  }, [slots]);
  const anyOpen = (slots ?? []).some((s) => s.ok);
  const phoneOk = validPhone(phone);

  const submit = async () => {
    setTried(true);
    setError(null);
    if (!slot || !name.trim() || !phoneOk) return;
    setBusy(true);
    try {
      await api.book(restaurantSlug, { startsAt: slot, party, name, phone, note, tags });
      setDone({ startsAt: slot, party });
    } catch (e) {
      const m = (e as Error).message;
      setError(m === "taken" ? r("book.taken") : m === "bad_phone" ? r("book.phoneInvalid") : r("book.error"));
      if (m === "taken") api.slots(restaurantSlug, date, party).then(setSlots, () => {});
    } finally {
      setBusy(false);
    }
  };

  if (info === null)
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <EmptyState icon={<CalendarDays />} title={r("book.notFound")} />
      </div>
    );

  const brand = info?.restaurant.brandColor ?? "var(--sf-primary)";

  return (
    <div className="min-h-dvh bg-bg pb-32" style={{ ["--brand" as string]: brand }}>
      <header className="relative overflow-hidden bg-[var(--brand)] text-white">
        <div className="absolute inset-0 text-white">
          <StarPattern className="absolute -inset-12" opacity={0.18} />
        </div>
        <div className="relative mx-auto max-w-2xl px-4 pt-4 pb-10 sm:px-6">
          <div className="flex items-center justify-between">
            <span className="grid size-11 place-items-center rounded-2xl bg-white/15 backdrop-blur [&_svg]:size-7">
              <Mark />
            </span>
            <div className="rounded-2xl bg-white/90 text-ink dark:bg-surface/90">
              <AuthToggles />
            </div>
          </div>
          {info ? (
            <motion.div initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
              <p className="text-[14px] font-semibold text-white/75">{r("book.title")}</p>
              <h1 className="mt-1 text-[30px] leading-tight text-white sm:text-[36px]">{loc(info.restaurant.name)}</h1>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[13.5px] text-white/85">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="size-4" /> {loc(info.branch.address)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="size-4" />
                  <span className="num ltr">
                    {info.branch.hours.open} – {info.branch.hours.close}
                  </span>
                </span>
              </div>
            </motion.div>
          ) : (
            <Skeleton className="mt-6 h-16 w-64 opacity-40" />
          )}
        </div>
      </header>

      <AnimatePresence mode="wait">
        {done ? (
          <motion.main key="done" initial={reduced ? false : { opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="mx-auto -mt-6 max-w-2xl px-4 sm:px-6">
            <div className="rounded-[28px] border border-line bg-surface p-6 text-center shadow-sf-lg">
              <motion.span initial={reduced ? false : { scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 380, damping: 18 }} className="mx-auto grid size-20 place-items-center rounded-full bg-ok text-white shadow-[0_12px_30px_-10px_var(--sf-ok)]">
                <Check className="size-10" strokeWidth={3} />
              </motion.span>
              <h2 className="mt-4 text-[26px]">{r("book.doneTitle")}</h2>
              <p className="mt-1 text-muted">{r("book.doneBody")}</p>
              <div className="mx-auto mt-5 grid max-w-sm grid-cols-3 gap-2 rounded-2xl bg-surface-2 p-3 text-[14px]">
                <Summary icon={<CalendarDays />} text={parseDate(isoDate(new Date(done.startsAt))).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "short", day: "numeric", month: "short" })} />
                <Summary icon={<Clock />} text={fmtTime(done.startsAt)} />
                <Summary icon={<Users />} text={r("book.guests", { n: done.party })} />
              </div>
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brass-soft px-3 py-1 text-[13px] font-semibold text-brass-text">{r("book.pending")}</p>
              <p className="mt-3 text-[12.5px] text-faint">{r("book.policy")}</p>
              <Button
                className="mt-5"
                variant="secondary"
                onClick={() => {
                  setDone(null);
                  setSlot(null);
                  setTried(false);
                  api.slots(restaurantSlug, date, party).then(setSlots, () => {});
                }}
              >
                {r("book.another")}
              </Button>
            </div>
          </motion.main>
        ) : (
          <motion.main key="form" className="mx-auto -mt-6 max-w-2xl space-y-3 px-4 sm:px-6">
            <Step n={1} title={r("book.party")} icon={<Users />}>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: info?.maxParty ?? 8 }, (_, i) => i + 1).map((n) => (
                  <Pill key={n} on={party === n} onClick={() => setParty(n)} className="num size-12 text-[17px]">
                    {n}
                  </Pill>
                ))}
              </div>
              {info ? (
                <p className="mt-2.5 flex items-center gap-1.5 text-[12.5px] text-muted">
                  <Phone className="size-3.5" />
                  {r("book.bigParty", { n: info.maxParty, phone: info.restaurant.phone ?? "" })}
                </p>
              ) : null}
            </Step>

            <Step n={2} title={r("book.date")} icon={<CalendarDays />}>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:-mx-5 sm:px-5">
                {days.map((d, i) => {
                  const dt = parseDate(d);
                  return (
                    <Pill key={d} on={date === d} onClick={() => setDate(d)} className="h-[4.5rem] w-16 shrink-0 flex-col gap-0">
                      <span className="text-[11.5px] font-semibold opacity-75">{i === 0 ? L("النهارده", "Today") : i === 1 ? L("بكرة", "Tmrw") : dt.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { weekday: "short" })}</span>
                      <span className="num text-[20px] font-bold leading-tight">{dt.getDate()}</span>
                      <span className="text-[11px] opacity-70">{dt.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { month: "short" })}</span>
                    </Pill>
                  );
                })}
              </div>
            </Step>

            <Step n={3} title={r("book.time")} icon={<Clock />}>
              {!slots ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: 10 }, (_, i) => (
                    <Skeleton key={i} className="h-11 w-20 rounded-xl" />
                  ))}
                </div>
              ) : !anyOpen ? (
                <p className="rounded-2xl bg-surface-2 p-4 text-center text-[14px] text-muted">{r("book.noSlots")}</p>
              ) : (
                <div className="space-y-3">
                  {(["lunch", "evening", "late"] as const).map((g) =>
                    groups[g].length ? (
                      <div key={g}>
                        <p className="mb-1.5 text-[12.5px] font-bold text-muted">{r(`book.${g}`)}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {groups[g].map((s) => (
                            <Pill
                              key={s.startsAt}
                              on={slot === s.startsAt}
                              disabled={!s.ok}
                              title={s.ok ? undefined : r("book.full")}
                              onClick={() => {
                                setSlot(s.startsAt);
                                setTimeout(() => details.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }), 120);
                              }}
                              className="num h-11 min-w-[5.25rem] px-3 text-[14.5px]"
                            >
                              {fmtTime(s.startsAt)}
                            </Pill>
                          ))}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </Step>

            <div ref={details} className="scroll-mt-4">
              <Step n={4} title={r("book.details")} icon={<Phone />}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label={r("form.name")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={tried && !name.trim() ? r("form.required") : undefined} />
                  <Input label={r("form.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" dir="ltr" className="num" placeholder="01xxxxxxxxx" error={tried && !phoneOk ? r("book.phoneInvalid") : undefined} />
                  <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                    {(
                      [
                        ["birthday", <Cake key="c" />],
                        ["kids", <Baby key="b" />],
                      ] as const
                    ).map(([tg, icon]) => {
                      const on = tags.includes(tg);
                      return (
                        <button key={tg} type="button" aria-pressed={on} onClick={() => setTags((x) => (on ? x.filter((y) => y !== tg) : [...x, tg]))} className={cn("inline-flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors [&_svg]:size-4", on ? "border-[var(--brand)] bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-[var(--brand)]" : "border-line text-ink-2")}>
                          {icon}
                          {r(`tag.${tg}`)}
                        </button>
                      );
                    })}
                  </div>
                  <Textarea label={r("book.note")} value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="sm:col-span-2" maxLength={300} />
                </div>
              </Step>
            </div>
          </motion.main>
        )}
      </AnimatePresence>

      {!done ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-xl safe-bottom">
          <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1 text-[13.5px]">
              {slot ? (
                <p className="truncate font-bold">
                  {parseDate(date).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "short" })} · <span className="num">{fmtTime(slot)}</span> · {r("book.guests", { n: party })}
                </p>
              ) : (
                <p className="text-muted">{r("book.time")}</p>
              )}
              {error ? <p className="truncate font-semibold text-danger">{error}</p> : null}
            </div>
            <Button size="lg" onClick={submit} loading={busy} disabled={!slot} className="bg-[var(--brand)] shadow-[0_8px_20px_-10px_var(--brand)] hover:brightness-110 hover:bg-[var(--brand)]">
              {r("book.submit")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Step({ n, title, icon, children }: { n: number; title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[24px] border border-line bg-surface p-4 shadow-sf-sm sm:p-5">
      <h2 className="mb-3 flex items-center gap-2.5 text-[17px]">
        <span className="num grid size-7 place-items-center rounded-full bg-[var(--brand)] text-[13px] font-bold text-white">{n}</span>
        {title}
        <span className="ms-auto text-faint [&_svg]:size-4">{icon}</span>
      </h2>
      {children}
    </section>
  );
}

function Pill({ on, onClick, disabled, children, className, title }: { on: boolean; onClick: () => void; disabled?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded-xl border font-bold transition-[background-color,border-color,color,transform] duration-150 active:scale-[0.97]",
        on ? "border-[var(--brand)] bg-[var(--brand)] text-white shadow-[0_8px_18px_-10px_var(--brand)]" : "border-line bg-surface text-ink hover:border-line-strong",
        disabled && "border-dashed bg-surface-2 text-faint line-through opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Summary({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <span className="flex flex-col items-center gap-1 font-semibold [&_svg]:size-4 [&_svg]:text-muted">
      {icon}
      <span className="num">{text}</span>
    </span>
  );
}
