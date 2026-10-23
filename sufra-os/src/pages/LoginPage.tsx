import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Grid3x3, Mail, Lock as LockIcon, Percent, ShieldCheck, WifiOff } from "lucide-react";
import { useSession } from "@/auth/session";
import { ROLE_LABEL } from "@/auth/roles";
import { useRepo } from "@/data/hooks";
import { DEMO_PASSWORD, DEMO_STAFF } from "@/data/seed";
import { useT } from "@/i18n/i18n";
import { homeFor } from "@/modules/registry";
import { cn } from "@/lib/cn";
import { Avatar, Button, IconButton, Input, useReduced } from "@/ui";
import { Logo, Mark } from "@/shell/Logo";
import { AuthToggles, GlowOrbs, StarPattern } from "./AuthChrome";

export function LoginPage() {
  const s = useSession();
  const repo = useRepo();
  const { t, loc, dir } = useT();
  const nav = useNavigate();
  const location = useLocation();
  const reduced = useReduced();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Arrow = dir === "rtl" ? ArrowLeft : ArrowRight;

  useEffect(() => {
    if (s.status === "ready" && s.staff) {
      const from = (location.state as { from?: string } | null)?.from;
      nav(from && from !== "/" ? from : homeFor(s.role), { replace: true });
    }
  }, [s.status, s.staff, s.role, nav, location.state]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await s.signIn(email, password);
    } catch (err) {
      setError((err as { code?: string }).code === "no_membership" ? t("login.noMembership") : t("login.error"));
    } finally {
      setBusy(false);
    }
  };

  const demo = repo.kind === "local" ? DEMO_STAFF.filter((x) => x.email) : [];
  const enter = (i: number) => (reduced ? {} : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.05 + i * 0.06, type: "spring" as const, stiffness: 280, damping: 30 } });

  return (
    <div className="grid min-h-dvh bg-bg lg:grid-cols-[1.05fr_1fr]">
      {/* brand panel */}
      <aside className="relative hidden overflow-hidden bg-[#0b3f3a] text-[#eef6f3] lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#0d5a53_0%,#0a3833_55%,#08231f_100%)]" aria-hidden />
        <div className="absolute inset-0 overflow-hidden text-[#9fe0d4]">
          <StarPattern className="absolute -top-0 -start-0" opacity={0.2} />
        </div>
        <GlowOrbs />
        <div className="relative flex flex-1 flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <Mark className="size-11" />
            <span className="font-display text-[26px] font-semibold">{t("app.name")}</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[12px] font-semibold">{t("app.os")}</span>
          </div>
          <div className="max-w-lg">
            <motion.h2 {...enter(0)} className="text-[44px] leading-[1.15] xl:text-[52px]">
              {t("login.brandTitle")}
            </motion.h2>
            <motion.p {...enter(1)} className="mt-4 text-[17px] leading-relaxed text-[#cfe6e0]">
              {t("login.brandBody")}
            </motion.p>
            <ul className="mt-8 grid gap-3">
              {[
                { icon: <Percent />, text: t("login.feature.tax") },
                { icon: <WifiOff />, text: t("login.feature.offline") },
                { icon: <ShieldCheck />, text: t("login.feature.roles") },
              ].map((f, i) => (
                <motion.li key={i} {...enter(2 + i)} className="flex items-center gap-3 text-[15px]">
                  <span className="grid size-9 place-items-center rounded-xl border border-white/15 bg-white/10 text-[#f1c977] [&_svg]:size-[18px]">{f.icon}</span>
                  {f.text}
                </motion.li>
              ))}
            </ul>
          </div>
          <TicketPreview />
        </div>
      </aside>

      {/* form */}
      <main className="relative flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <Logo className="lg:invisible" />
          <AuthToggles />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-10 sm:px-6">
          <div className="w-full max-w-[420px]">
            <motion.h1 {...enter(0)} className="text-[32px] leading-tight">
              {t("login.title")}
            </motion.h1>
            <motion.p {...enter(1)} className="mt-1.5 text-[15px] text-muted">
              {t("login.subtitle")}
            </motion.p>
            <motion.form {...enter(2)} onSubmit={submit} className="mt-8 grid gap-4" noValidate>
              <Input label={t("login.email")} type="email" autoComplete="username" inputMode="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} icon={<Mail />} size="lg" />
              <Input
                label={t("login.password")}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                dir="ltr"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={<LockIcon />}
                size="lg"
                error={error}
                end={
                  <IconButton label={show ? t("login.hidePassword") : t("login.showPassword")} size="sm" onClick={() => setShow((v) => !v)}>
                    {show ? <EyeOff /> : <Eye />}
                  </IconButton>
                }
              />
              <Button type="submit" size="lg" block loading={busy} iconEnd={busy ? null : <Arrow className="size-5" />} className="mt-2">
                {busy ? t("login.submitting") : t("login.submit")}
              </Button>
            </motion.form>

            <motion.div {...enter(3)} className="mt-4">
              <Link to="/login/pin" className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-dashed border-line-strong text-[14.5px] font-semibold text-ink-2 transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary">
                <Grid3x3 className="size-[18px]" aria-hidden />
                {t("login.pinInstead")}
              </Link>
            </motion.div>

            {demo.length ? (
              <motion.div {...enter(4)} className="mt-8 rounded-2xl border border-line bg-surface p-4 shadow-sf-sm">
                <p className="text-[13px] font-bold">{t("login.demo")}</p>
                <p className="mb-3 text-[12.5px] text-muted">{t("login.demoHint", { pw: DEMO_PASSWORD })}</p>
                <div className="grid grid-cols-2 gap-2">
                  {demo.map((d) => (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => {
                        setEmail(d.email!);
                        setPassword(DEMO_PASSWORD);
                        setError(null);
                      }}
                      className={cn("flex min-h-12 items-center gap-2.5 rounded-xl border border-line px-2.5 text-start transition-colors hover:border-primary/40 hover:bg-primary-soft/50", email === d.email && "border-primary bg-primary-soft/60")}
                    >
                      <Avatar name={d.name} color={d.color} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">{d.name}</span>
                        <span className="block truncate text-[11.5px] text-muted">{loc(ROLE_LABEL[d.role])}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

/** A small, live-looking kitchen ticket on the brand panel (decorative). */
function TicketPreview() {
  const { L } = useT();
  const reduced = useReduced();
  const lines = [
    [L("٢× كفتة مشوية", "2× Grilled kofta"), L("جاهز", "Ready"), "ok"],
    [L("١× ملوخية بالفراخ", "1× Molokhia"), L("بيتعمل", "Preparing"), "warn"],
    [L("٣× ليمون نعناع", "3× Lemon mint"), L("اتقدّم", "Served"), "muted"],
  ] as const;
  return (
    <motion.div
      aria-hidden
      initial={reduced ? false : { opacity: 0, y: 20, rotate: -2 }}
      animate={{ opacity: 1, y: 0, rotate: -2 }}
      transition={{ delay: 0.4, type: "spring", stiffness: 160, damping: 20 }}
      className="w-72 self-end rounded-2xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md"
    >
      <div className="mb-3 flex items-center justify-between text-[12px] font-semibold text-[#cfe6e0]">
        <span>{L("ترابيزة ٥ · طلب #١٤", "Table 5 · Order #14")}</span>
        <span className="num" dir="ltr">
          12:48
        </span>
      </div>
      <ul className="grid gap-2 text-[13.5px]">
        {lines.map(([n, st, tone]) => (
          <li key={n} className="flex items-center justify-between gap-3">
            <span>{n}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold", tone === "ok" ? "bg-[#4cc683]/25 text-[#9ff0c3]" : tone === "warn" ? "bg-[#f0a04e]/25 text-[#ffd29e]" : "bg-white/10 text-white/70")}>{st}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
