import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Mail, Search } from "lucide-react";
import { useSession } from "@/auth/session";
import { ROLE_LABEL, ROLE_RANK } from "@/auth/roles";
import { useRepo } from "@/data/hooks";
import type { Membership, Restaurant } from "@/data/types";
import { DEMO_STAFF, staffId } from "@/data/seed";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { cn } from "@/lib/cn";
import { homeFor } from "@/modules/registry";
import { Avatar, Badge, Button, EmptyState, Input, PinPad, Skeleton, spring, useReduced } from "@/ui";
import { Mark } from "@/shell/Logo";
import { AuthToggles, StarPattern } from "./AuthChrome";

const MAX_TRIES = 5;
const COOLDOWN_S = 30;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function PinLoginPage() {
  const s = useSession();
  const repo = useRepo();
  const { t, loc, lang, dir } = useT();
  const nav = useNavigate();
  const reduced = useReduced();
  const now = useClock();
  const [roster, setRoster] = useState<Membership[] | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [picked, setPicked] = useState<Membership | null>(null);
  const [q, setQ] = useState("");
  const [tries, setTries] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  useEffect(() => {
    if (s.status === "ready" && s.staff) nav(homeFor(s.role), { replace: true });
  }, [s.status, s.staff, s.role, nav]);

  useEffect(() => {
    const rid = s.deviceRestaurantId;
    if (!rid) return;
    repo.auth.pinRoster(rid).then(setRoster, () => setRoster([]));
    repo.list("restaurants", { where: { id: rid } }).then((r) => setRestaurant(r[0] ?? null), () => {});
  }, [repo, s.deviceRestaurantId]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const list = useMemo(
    () => (roster ?? []).filter((m) => matches(`${m.name} ${ROLE_LABEL[m.role].ar} ${ROLE_LABEL[m.role].en}`, q)).sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.name.localeCompare(b.name, "ar")),
    [roster, q],
  );

  const demoPin = picked && repo.kind === "local" ? DEMO_STAFF.find((d) => staffId(d.key) === picked.id)?.pin : undefined;

  const tryPin = async (pin: string) => {
    if (!picked || cooldown) return false;
    const m = await s.pinSignIn(picked.id, pin);
    if (m) return true;
    const n = tries + 1;
    setTries(n);
    if (n >= MAX_TRIES) {
      setTries(0);
      setCooldown(COOLDOWN_S);
    }
    return false;
  };

  const time = now.toLocaleTimeString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-bg">
      <div className="pointer-events-none absolute inset-0 overflow-hidden text-primary" aria-hidden>
        <StarPattern className="absolute" opacity={0.09} />
      </div>
      <div className="pointer-events-none absolute -top-56 start-1/2 size-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--sf-primary)_14%,transparent),transparent_62%)] rtl:translate-x-1/2" aria-hidden />

      <header className="relative flex items-center gap-3 p-4 sm:p-6">
        <Mark className="size-10" />
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-[18px] font-semibold">{restaurant ? loc(restaurant.name) : t("app.name")}</p>
          <p className="truncate text-[12.5px] text-muted">{date}</p>
        </div>
        <p className="num ms-auto hidden text-[26px] font-medium text-ink-2 sm:block" dir="ltr">
          {time}
        </p>
        <AuthToggles />
      </header>

      <main className="relative flex flex-1 flex-col items-center px-4 pb-10 sm:px-6">
        {!s.deviceRestaurantId ? (
          <EmptyState
            className="mt-16"
            icon={<Mail />}
            title={t("pin.needsDevice")}
            action={
              <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
                {t("pin.emailInstead")}
              </Link>
            }
          />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {!picked ? (
              <motion.section
                key="pick"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.15 } }}
                transition={reduced ? { duration: 0 } : spring.soft}
                className="w-full max-w-5xl"
              >
                <div className="mx-auto mb-8 max-w-xl text-center">
                  <h1 className="text-[34px] leading-tight sm:text-[42px]">{t("pin.title")}</h1>
                  <p className="mt-2 text-[15.5px] text-muted">{t("pin.subtitle")}</p>
                  {(roster?.length ?? 0) > 8 ? (
                    <div className="mx-auto mt-5 max-w-sm">
                      <Input placeholder={t("pin.findName")} aria-label={t("pin.findName")} icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                  ) : null}
                </div>
                {!roster ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {Array.from({ length: 8 }, (_, i) => (
                      <Skeleton key={i} className="h-40" rounded="rounded-[24px]" />
                    ))}
                  </div>
                ) : !list.length ? (
                  <EmptyState title={t("pin.noStaff")} />
                ) : (
                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {list.map((m, i) => (
                      <motion.li key={m.id} initial={reduced ? false : { opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ delay: reduced ? 0 : 0.03 * i, ...spring.soft }}>
                        <motion.button
                          type="button"
                          layoutId={reduced ? undefined : `staff-${m.id}`}
                          onClick={() => setPicked(m)}
                          whileHover={reduced ? undefined : { y: -3 }}
                          whileTap={reduced ? undefined : { scale: 0.97 }}
                          className="group flex w-full flex-col items-center gap-3 rounded-[24px] border border-line bg-surface px-3 py-5 text-center shadow-sf-sm transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-sf focus-visible:border-primary"
                        >
                          <Avatar name={m.name} color={m.color} size="xl" />
                          <span className="min-w-0">
                            <span className="block truncate text-[16px] font-bold">{m.name}</span>
                            <span className="mt-1 inline-block rounded-full bg-surface-3 px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">{loc(ROLE_LABEL[m.role])}</span>
                          </span>
                        </motion.button>
                      </motion.li>
                    ))}
                  </ul>
                )}
                <div className="mt-10 text-center">
                  <Link to="/login" className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-semibold text-muted transition-colors hover:bg-surface-3 hover:text-ink">
                    <Mail className="size-4" aria-hidden />
                    {t("pin.emailInstead")}
                  </Link>
                </div>
              </motion.section>
            ) : (
              <motion.section
                key="pin"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, transition: { duration: 0.15 } }}
                transition={reduced ? { duration: 0 } : spring.soft}
                className="flex w-full max-w-sm flex-col items-center"
              >
                <Button variant="ghost" size="sm" icon={<Back className="size-4" />} onClick={() => setPicked(null)} className="mb-4 self-start">
                  {t("pin.back")}
                </Button>
                <motion.div layoutId={reduced ? undefined : `staff-${picked.id}`} className="mb-3 flex flex-col items-center gap-3 rounded-[28px] px-6 py-2">
                  <Avatar name={picked.name} color={picked.color} size="xl" className="shadow-[0_18px_40px_-16px_rgb(0_0_0/0.45)]" />
                </motion.div>
                <h1 className="text-center text-[26px]">{t("pin.hello", { name: picked.name.split(" ")[0] === "الشيف" ? picked.name : picked.name.split(" ")[0] })}</h1>
                <p className="mt-1 mb-6 text-[14px] text-muted">
                  {loc(ROLE_LABEL[picked.role])} · {t("pin.enter")}
                </p>
                <PinPad key={picked.id} onComplete={tryPin} disabled={cooldown > 0} error={cooldown ? t("pin.cooldown", { s: cooldown }) : null} />
                {demoPin ? (
                  <Badge tone="brass" className={cn("mt-6")}>
                    {t("pin.demoHint", { pin: demoPin })}
                  </Badge>
                ) : null}
              </motion.section>
            )}
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
