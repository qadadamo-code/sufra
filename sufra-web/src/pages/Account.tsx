import { useMemo, useState } from "react";
import { Blobatar } from "@blobatar/react";
import { CalendarDays, Copy, Gift, Heart, History, LogOut, MapPin, Phone, Plus, RotateCcw, Share2, Ticket, User, Users } from "lucide-react";
import { OtpInput, type OtpStatus } from "@/components/ui/otp-input";
import { PasswordStrength, type PasswordRule } from "@/components/ui/password-strength";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ActivityHeatmap } from "@/components/ui/activity-heatmap";
import { VoxelVideoStreakCard } from "@/components/ui/voxel-video-streak-card";
import { HoldToConfirm } from "@/components/ui/hold-to-confirm";
import { ShinyButton } from "@/components/ui/shiny-button";
import { CairoMap } from "@/components/sufra/CairoMap";
import { RestaurantCard } from "@/components/sufra/bits";
import { Photo } from "@/components/sufra/Photo";
import { areaById, areaName, areas, byId, DAYS_AR, DAYS_EN, MOODS, type Mood } from "@/lib/data";
import { haversineKm, type LatLng } from "@/lib/geo";
import { fmtTime } from "@/lib/hours";
import { useNow } from "@/lib/hooks";
import { useLang } from "@/lib/i18n";
import { allVideos, imgUrl, videoUrl } from "@/lib/media";
import { copyText } from "@/lib/copy";
import { notify } from "@/lib/notify";
import { formatMoney } from "@/lib/pricing";
import { navigate, shareUrl, type Route } from "@/lib/router";
import { addDays, createAccount, DEMO_OTP, DEMO_PHONE, getState, resetDemo, signIn, signOut, streakOf, todayYmd, updateAccount, useAccount, ymdOf, type Account as Acc } from "@/lib/store";
import { cn } from "@/lib/utils";
import { validEgMobile } from "@/lib/phone";

type Tab = "profile" | "favourites" | "history" | "wallet" | "invite";

export default function Account({ route, invite }: { route: Route; invite?: string }) {
  const acc = useAccount();
  if (!acc) return <Auth invite={invite} />;
  return <Profile acc={acc} tab={(route.query.get("tab") as Tab) || (invite ? "invite" : "profile")} />;
}

/* ───────────────────────── sign up / log in ───────────────────────── */

function Auth({ invite }: { invite?: string }) {
  const { L, lang } = useLang();
  const [step, setStep] = useState<"phone" | "otp" | "profile">("phone");
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);
  const [otp, setOtp] = useState<OtpStatus>("idle");
  const [otpKey, setOtpKey] = useState(0);
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [area, setArea] = useState("dokki");
  const valid = validEgMobile(phone);
  const exists = !!getState().accounts[phone];
  const rules: PasswordRule[] = [
    { id: "length", label: L("8 حروف أو أكتر", "8 characters or more"), test: (v) => v.length >= 8 },
    { id: "case", label: L("حروف كبيرة وصغيرة", "Upper and lower case"), test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
    { id: "digit", label: L("رقم", "A number"), test: (v) => /\d/.test(v) },
    { id: "symbol", label: L("رمز زي ! أو @", "A symbol like ! or @"), test: (v) => /[!-/:-@[-`{-~]/.test(v) },
  ];
  return (
    <div className="wrap gutter grid min-h-[70vh] place-items-center py-10">
      <div className="w-full max-w-md">
        {invite ? (
          <div className="mb-4 rounded-2xl border border-brass/40 bg-brass-soft/70 p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold"><Gift className="size-4 text-brass" aria-hidden />{L("صاحبك عازمك على سُفرة!", "A friend invited you to Sufra!")}</p>
            <p className="mt-1 text-muted-foreground">{L(`كود الدعوة ${invite} — هتاخد 100 ج.م خصم على أول طلب.`, `Invite code ${invite} — you get EGP 100 off your first order.`)}</p>
          </div>
        ) : null}
        <div className="sf-card p-6 sm:p-8">
          <p className="sf-kicker">{L("أهلًا بيك", "Welcome")}</p>
          <h1 className="text-[30px] font-bold">{step === "profile" ? L("كمّل بياناتك", "Finish your profile") : L("ادخل برقم موبايلك", "Continue with your mobile")}</h1>
          {step === "phone" ? (
            <form
              className="mt-5 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (valid) {
                  setStep("otp");
                  notify({ title: L("بعتنالك كود", "We sent you a code"), detail: L(`الكود التجريبي: ${DEMO_OTP}`, `Demo code: ${DEMO_OTP}`), icon: "bell" });
                }
              }}
            >
              <label>
                <span className="sf-label">{L("رقم الموبايل", "Mobile number")}</span>
                <div className="flex items-center gap-2 rounded-xl border bg-card ps-3 focus-within:border-primary" dir="ltr">
                  <Phone className="size-4 text-muted-foreground" aria-hidden />
                  <span className="num text-muted-foreground">+20</span>
                  <input
                    className="num h-12 flex-1 bg-transparent text-[17px] tracking-wider outline-none"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="01xxxxxxxxx"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    onBlur={() => setTouched(true)}
                    aria-invalid={touched && !valid}
                    aria-describedby="phone-help"
                  />
                </div>
              </label>
              <p id="phone-help" className={cn("-mt-2 text-sm", touched && !valid ? "text-danger" : "text-muted-foreground")}>
                {touched && !valid ? L("الرقم لازم يكون 11 رقم ويبدأ بـ 010 أو 011 أو 012 أو 015.", "Must be 11 digits starting 010, 011, 012 or 015.") : L(`جرّب الحساب التجريبي: ${DEMO_PHONE}`, `Try the demo account: ${DEMO_PHONE}`)}
              </p>
              <ShinyButton type="submit" label={L("ابعتلي كود", "Send me a code")} size="md" />
              <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setPhone(DEMO_PHONE)}>
                {L("املا الرقم التجريبي", "Fill the demo number")}
              </button>
            </form>
          ) : step === "otp" ? (
            <div className="mt-5 grid gap-4">
              <p className="text-muted-foreground">
                {L("اكتب الكود اللي وصلك على", "Enter the code we sent to")} <span className="num font-semibold text-foreground" dir="ltr">{phone}</span>
              </p>
              <div className="rounded-xl border border-dashed border-brass/60 bg-brass-soft/50 px-4 py-2 text-sm">
                {L("نسخة تجريبية — الكود:", "Demo — your code is:")} <span className="num font-bold tracking-widest text-brass">{DEMO_OTP}</span>
              </div>
              <OtpInput
                key={otpKey}
                status={otp}
                autoFocus
                label={L("كود التأكيد", "Verification code")}
                hint={L("6 أرقام", "6 digits")}
                successMessage={L("تمام! الكود صح.", "Code accepted.")}
                errorMessage={L("الكود مش صح، جرّب تاني.", "That code is not right.")}
                onChange={() => otp !== "idle" && setOtp("idle")}
                onComplete={(v) => {
                  if (v === DEMO_OTP) {
                    setOtp("success");
                    window.setTimeout(() => {
                      if (exists) {
                        signIn(phone);
                        notify({ title: L("أهلًا بيك تاني", "Welcome back"), icon: "check" });
                      } else setStep("profile");
                    }, 600);
                  } else setOtp("error");
                }}
              />
              <div className="flex justify-between text-sm">
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { setStep("phone"); setOtp("idle"); }}>{L("غيّر الرقم", "Change number")}</button>
                <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { setOtpKey((k) => k + 1); setOtp("idle"); notify({ title: L("بعتنا كود جديد", "New code sent"), detail: DEMO_OTP }); }}>{L("ابعت تاني", "Resend")}</button>
              </div>
            </div>
          ) : (
            <form
              className="mt-5 grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                createAccount({ phone, name: name.trim(), hasPassword: pw.length > 0, homeArea: area });
                notify({ title: L("حسابك جاهز!", "Your account is ready!"), detail: L("+100 نقطة ترحيب", "+100 welcome points"), tone: "brass" });
              }}
            >
              <label>
                <span className="sf-label">{L("اسمك", "Your name")}</span>
                <input className="sf-input" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="given-name" />
              </label>
              <label>
                <span className="sf-label">{L("ساكن فين؟ (عشان المسافات)", "Where's home? (for distances)")}</span>
                <select className="sf-input" value={area} onChange={(e) => setArea(e.target.value)}>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a[lang]}</option>)}
                </select>
              </label>
              <label>
                <span className="sf-label">{L("باسوورد (اختياري)", "Password (optional)")}</span>
                <input className="sf-input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
              </label>
              {pw ? (
                <PasswordStrength
                  value={pw}
                  rules={rules}
                  labels={[L("فاضي", "Empty"), L("ضعيف", "Weak"), L("مقبول", "Fair"), L("كويس", "Good"), L("قوي", "Strong")]}
                  meterLabel={L("قوة الباسوورد", "Password strength")}
                  guessedLabel={L("سهل يتخمّن", "Commonly guessed")}
                />
              ) : (
                <p className="-mt-2 text-xs text-muted-foreground">{L("تقدر تدخل بالكود كل مرة من غير باسوورد.", "You can always sign in with a code instead.")}</p>
              )}
              <ShinyButton type="submit" label={L("يلا بينا", "Let's go")} size="md" disabled={!name.trim()} />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── profile ───────────────────────── */
function Profile({ acc, tab }: { acc: Acc; tab: Tab }) {
  const { L } = useLang();
  const tabs: { id: Tab; label: string; Icon: typeof User }[] = [
    { id: "profile", label: L("ملفي", "Profile"), Icon: User },
    { id: "favourites", label: L("المفضلة", "Favourites"), Icon: Heart },
    { id: "history", label: L("حجوزات وطلبات", "Bookings & orders"), Icon: History },
    { id: "wallet", label: L("محفظة العروض", "Offers wallet"), Icon: Ticket },
    { id: "invite", label: L("صحابك", "Friends"), Icon: Users },
  ];
  return (
    <div className="wrap gutter pb-16 pt-6">
      <div className="flex flex-wrap items-center gap-4">
        <Blobatar name={acc.profile.phone} animate="hover" background="circle" className="size-16 sm:size-20" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="sf-kicker">{L("حسابي", "My account")}</p>
          <h1 className="truncate text-[28px] font-bold sm:text-[40px]">{acc.profile.name}</h1>
          <p className="text-sm text-muted-foreground">
            <span className="num whitespace-nowrap" dir="ltr">{acc.profile.phone}</span> · <span className="whitespace-nowrap">{L("في سُفرة من", "On Sufra since")} <span className="num">{acc.profile.joined}</span></span>
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          {acc.profile.demo ? (
            <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm bg-card" onClick={() => { resetDemo(); notify({ title: L("رجّعنا الحساب التجريبي لأوله", "Demo account reset") }); }}>
              <RotateCcw className="size-4" aria-hidden />
              {L("رجّع الديمو", "Reset demo")}
            </button>
          ) : null}
          <button type="button" className="sf-btn sf-btn-ghost sf-btn-sm bg-card" onClick={() => signOut()}>
            <LogOut className="size-4" aria-hidden />
            {L("خروج", "Sign out")}
          </button>
        </div>
      </div>
      {acc.profile.demo ? <p className="mt-3 inline-block rounded-full bg-brass-soft px-3 py-1 text-xs font-semibold text-accent-foreground">{L("حساب تجريبي — البيانات وهمية", "Demo account — data is fake")}</p> : null}
      <nav className="no-scrollbar -mx-4 mt-6 flex gap-2 overflow-x-auto border-b px-4 pb-3 md:mx-0 md:px-0" aria-label={L("أقسام الحساب", "Account sections")}>
        {tabs.map((t) => (
          <a key={t.id} href={`#/account?tab=${t.id}`} aria-current={tab === t.id ? "page" : undefined} className={cn("sf-chip h-10 shrink-0", tab === t.id && "!border-primary !bg-primary !text-primary-foreground")}>
            <t.Icon className="size-4" aria-hidden />
            {t.label}
          </a>
        ))}
      </nav>
      <div className="mt-6">
        {tab === "profile" ? <ProfileTab acc={acc} /> : tab === "favourites" ? <Favourites acc={acc} /> : tab === "history" ? <HistoryTab acc={acc} /> : tab === "wallet" ? <Wallet acc={acc} /> : <Invite acc={acc} />}
      </div>
    </div>
  );
}

const DIETS = [
  { id: "veg", ar: "نباتي", en: "Vegetarian" },
  { id: "vegan", ar: "فيجن", en: "Vegan" },
  { id: "gluten-free", ar: "من غير جلوتين", en: "Gluten-free" },
  { id: "lactose-free", ar: "من غير لاكتوز", en: "Lactose-free" },
  { id: "nut-allergy", ar: "حساسية مكسرات", en: "Nut allergy" },
  { id: "no-pork", ar: "حلال", en: "Halal only" },
  { id: "low-carb", ar: "لو كارب", en: "Low-carb" },
];

function ProfileTab({ acc }: { acc: Acc }) {
  const { L, lang } = useLang();
  const p = acc.profile;
  const [name, setName] = useState(p.name);
  const [home, setHome] = useState<LatLng>(p.home);
  const [areaId, setAreaId] = useState(p.homeArea);
  const [diet, setDiet] = useState(p.diet);
  const [moods, setMoods] = useState<Mood[]>(p.moods);
  const [range, setRange] = useState<"12m" | "6m" | "3m">("12m");
  const [selDate, setSelDate] = useState<string | null>(null);
  const streak = streakOf(acc.visits);
  const level = Math.floor(acc.points / 500) + 1;
  const toNext = 500 - (acc.points % 500);
  const completeness = [p.name, p.homeArea, p.diet.length, p.moods.length, acc.favourites.length, p.hasPassword].filter(Boolean).length / 6;

  const days = useMemo(() => {
    const n = range === "12m" ? 365 : range === "6m" ? 182 : 91;
    const now = new Date();
    return Array.from({ length: n }, (_, i) => {
      const d = ymdOf(addDays(now, -(n - 1 - i)));
      return { date: d, count: acc.visits[d] ?? 0 };
    });
  }, [acc.visits, range]);
  const periodLabel = { "12m": L("آخر 12 شهر", "the last 12 months"), "6m": L("آخر 6 شهور", "the last 6 months"), "3m": L("آخر 3 شهور", "the last 3 months") }[range];
  const selInfo = selDate
    ? {
        count: acc.visits[selDate] ?? 0,
        orders: acc.orders.filter((o) => ymdOf(new Date(o.createdAt)) === selDate),
        bookings: acc.bookings.filter((b) => b.date === selDate),
      }
    : null;
  const posterKey = imgUrl("venue-rooftop-1") ?? imgUrl(byId[acc.favourites[0]]?.cover ?? "");

  const save = () => {
    updateAccount((a) => ({ ...a, profile: { ...a.profile, name: name.trim() || a.profile.name, home, homeArea: areaId, diet, moods } }));
    notify({ title: L("اتحفظ", "Saved"), detail: L("المسافات والترشيحات اتحدّثت.", "Distances and picks are updated."), icon: "check" });
  };
  const nearestArea = (pt: LatLng) => areas.reduce((best, a) => (haversineKm(pt, a) < haversineKm(pt, best) ? a : best), areas[0]).id;

  return (
    <div className="grid grid-cols-1 gap-8">
      <VoxelVideoStreakCard
        headingTop={L("نقاط سُفرة", "Sufra points")}
        headingAccent={L(`${acc.points.toLocaleString("en-US")} نقطة`, `${acc.points.toLocaleString("en-US")} points`)}
        subtitle={L(`باقيلك ${toNext} نقطة وتوصل للمستوى ${level + 1}. كل حجز بـ 50 نقطة، وكل 10 ج.م في الطلبات بنقطة.`, `${toNext} points to level ${level + 1}. Every booking earns 50, every EGP 10 ordered earns 1.`)}
        streakDays={streak}
        daysWord={L("يوم", "days")}
        streakLabel={L("ورا بعض فيهم خروجة أو طلب", "in a row with an outing or order")}
        levelNumber={level}
        levelWord={L("مستوى", "Level")}
        levelLabel={level >= 3 ? L("ذوّاق القاهرة", "Cairo connoisseur") : L("بتستكشف", "Explorer")}
        videoSrc={videoUrl(allVideos[0])}
        posterSrc={posterKey}
        videoBadgeText={L("خروجاتك", "Your outings")}
        muteLabels={{ off: L("الصوت", "Audio"), on: L("شغّال", "Playing") }}
      />

      <section className="sf-card p-5 sm:p-6" aria-label={L("سنة أكلك", "Your year in food")}>
        <p className="sf-kicker">{L("سنة أكلك", "Your year in food")}</p>
        <ActivityHeatmap
          days={days}
          label={L("زياراتك وطلباتك بالأيام", "Your visits and orders by day")}
          period={periodLabel}
          unit={{ one: L("خروجة", "outing"), other: L("خروجة", "outings") }}
          inWord={L("في", "in")}
          locale={lang === "ar" ? "ar-EG-u-nu-latn" : "en-US"}
          lessLabel={L("أقل", "Less")}
          moreLabel={L("أكتر", "More")}
          selectedDate={selDate}
          onSelectDate={setSelDate}
          caption={(n, a, b) => (b === 0 ? L(`${n} يوم من غير خروجات`, `${n} days with none`) : L(`${n} يوم فيهم ${a}${b === Infinity ? "+" : b > a ? `–${b}` : ""} خروجة`, `${n} days with ${a}${b === Infinity ? "+" : b > a ? `–${b}` : ""} outings`))}
          actions={
            <div className="flex rounded-full border bg-background p-1 text-sm" role="group" aria-label={L("الفترة", "Period")}>
              {(["3m", "6m", "12m"] as const).map((k) => (
                <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)} className={cn("rounded-full px-3 py-1", range === k ? "bg-brass text-brass-ink" : "text-muted-foreground")}>
                  {{ "3m": L("3 شهور", "3 mo"), "6m": L("6 شهور", "6 mo"), "12m": L("سنة", "Year") }[k]}
                </button>
              ))}
            </div>
          }
        />
        {selInfo ? (
          <div className="mt-3 rounded-xl bg-muted px-4 py-3 text-sm">
            <span className="num font-semibold">{selDate}</span> — {L(`${selInfo.count} خروجة`, `${selInfo.count} outings`)}
            {selInfo.orders.map((o) => <span key={o.id}> · {L("طلب من", "order from")} {byId[o.rid]?.[lang]}</span>)}
            {selInfo.bookings.map((b) => <span key={b.id}> · {L("حجز في", "booking at")} {byId[b.rid]?.[lang]}</span>)}
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="sf-card grid content-start gap-4 p-5 sm:p-6">
          <h2 className="text-xl font-bold">{L("بياناتك", "Your details")}</h2>
          <ProgressBar value={Math.round(completeness * 100)} label={L("اكتمال الملف", "Profile completeness")} completeLabel={L("مكتمل", "Complete")} />
          <label>
            <span className="sf-label">{L("الاسم", "Name")}</span>
            <input className="sf-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span className="sf-label">{L("البيت (المسافات بتتحسب منه)", "Home (distances are measured from here)")}</span>
            <select
              className="sf-input"
              value={areaId}
              onChange={(e) => {
                const a = areaById[e.target.value];
                setAreaId(a.id);
                setHome({ lat: a.lat, lng: a.lng });
              }}
            >
              {areas.map((a) => <option key={a.id} value={a.id}>{a[lang]}</option>)}
            </select>
          </label>
          <fieldset>
            <legend className="sf-label">{L("أكلك", "Dietary preferences")}</legend>
            <div className="flex flex-wrap gap-2">
              {DIETS.map((d) => (
                <button key={d.id} type="button" aria-pressed={diet.includes(d.id)} onClick={() => setDiet((x) => (x.includes(d.id) ? x.filter((y) => y !== d.id) : [...x, d.id]))} className="sf-chip h-9 text-[13px]">
                  {d[lang]}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="sf-label">{L("المزاج اللي بتحبه", "Favourite moods")}</legend>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button key={m.id} type="button" aria-pressed={moods.includes(m.id)} onClick={() => setMoods((x) => (x.includes(m.id) ? x.filter((y) => y !== m.id) : [...x, m.id]))} className="sf-chip h-9 text-[13px]">
                  {m[lang]}
                </button>
              ))}
            </div>
          </fieldset>
          <button type="button" className="sf-btn sf-btn-primary" onClick={save}>{L("احفظ", "Save")}</button>
        </div>
        <div className="grid content-start gap-2">
          <h2 className="flex items-center gap-2 text-xl font-bold"><MapPin className="size-5 text-brass" aria-hidden />{L("أو دوس على الخريطة", "Or tap the map")}</h2>
          <p className="text-sm text-muted-foreground">{L("دوس على مكان بيتك بالظبط. هنحفظ أقرب منطقة كمان.", "Tap exactly where home is; we'll also save the nearest area.")}</p>
          <CairoMap
            home={home}
            center={home}
            className="h-[380px]"
            ariaLabel={L("اختار مكان بيتك على الخريطة", "Pick your home on the map")}
            onPick={(pt) => {
              setHome(pt);
              setAreaId(nearestArea(pt));
            }}
          />
          <p className="text-sm">
            {L("أقرب منطقة:", "Nearest area:")} <span className="font-semibold">{areaName(areaId, lang)}</span> · <span className="num text-muted-foreground" dir="ltr">{home.lat.toFixed(4)}, {home.lng.toFixed(4)}</span>
          </p>
        </div>
      </section>
    </div>
  );
}

function Favourites({ acc }: { acc: Acc }) {
  const { L } = useLang();
  const now = useNow();
  const list = acc.favourites.map((id) => byId[id]).filter(Boolean);
  if (!list.length) return <Empty text={L("لسه مفيش مفضلة — دوس على القلب في أي مطعم.", "No favourites yet — tap the heart on any restaurant.")} />;
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((r) => <RestaurantCard key={r.id} r={r} now={now} />)}
    </div>
  );
}

function HistoryTab({ acc }: { acc: Acc }) {
  const { L, lang } = useLang();
  const today = todayYmd();
  const upcoming = acc.bookings.filter((b) => b.status === "confirmed" && b.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const past = acc.bookings.filter((b) => !(b.status === "confirmed" && b.date >= today));
  const cancel = (id: string) => {
    updateAccount((a) => ({ ...a, bookings: a.bookings.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b)) }));
    notify({ title: L("الحجز اتلغى", "Booking cancelled"), detail: L("بلغنا المطعم.", "We let the restaurant know."), tone: "danger", icon: "bell" });
  };
  return (
    <div className="grid gap-10">
      <section>
        <h2 className="flex items-center gap-2 text-2xl font-bold"><CalendarDays className="size-5 text-brass" aria-hidden />{L("الحجوزات الجاية", "Upcoming bookings")}</h2>
        {upcoming.length ? <ul className="mt-4 grid gap-3 lg:grid-cols-2">{upcoming.map((b) => <BookingRow key={b.id} b={b} onCancel={cancel} />)}</ul> : <Empty text={L("مفيش حجوزات جاية.", "No upcoming bookings.")} />}
      </section>
      <section>
        <h2 className="text-2xl font-bold">{L("الطلبات", "Orders")}</h2>
        {acc.orders.length ? (
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">
            {acc.orders.map((o) => {
              const r = byId[o.rid];
              return (
                <li key={o.id}>
                  <a href={`#/order/${o.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-3 hover:shadow-sf">
                    <Photo k={r?.cover} label={r?.[lang] ?? ""} className="size-16 shrink-0 rounded-xl" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{r?.[lang]}</p>
                      <p className="text-sm text-muted-foreground">
                        {o.mode === "delivery" ? L("توصيل", "Delivery") : o.mode === "pickup" ? L("استلام", "Pickup") : L("في المطعم", "Dine-in")} · <span className="num">{o.lines.reduce((a, l) => a + l.qty, 0)}</span> {L("أصناف", "items")} · {new Date(o.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB")}
                      </p>
                    </div>
                    <span className="num font-semibold">{formatMoney(o.breakdown.total, lang)}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty text={L("لسه ماطلبتش حاجة.", "No orders yet.")} />
        )}
      </section>
      {past.length ? (
        <section>
          <h2 className="text-2xl font-bold">{L("حجوزات قديمة", "Past bookings")}</h2>
          <ul className="mt-4 grid gap-3 lg:grid-cols-2">{past.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function BookingRow({ b, onCancel }: { b: Acc["bookings"][number]; onCancel?: (id: string) => void }) {
    const { L, lang } = useLang();
    const days = lang === "ar" ? DAYS_AR : DAYS_EN;
    const r = byId[b.rid];
    const d = new Date(b.date + "T00:00:00");
    return (
      <li className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card p-3">
        <Photo k={r?.cover} label={r?.[lang] ?? ""} className="size-16 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <a href={`#/r/${r?.slug}`} className="font-semibold hover:underline">{r?.[lang]}</a>
          <p className="text-sm text-muted-foreground">
            {days[d.getDay()]} <span className="num">{d.getDate()}/{d.getMonth() + 1}</span> · <span className="num">{fmtTime(b.time, lang)}</span> · {L(`${b.party} أفراد`, `${b.party} guests`)}
          </p>
          <p className="text-xs text-muted-foreground">
            {L("كود", "Code")} <span className="num">{b.code}</span>
            {b.tags.includes("birthday") ? <span className="ms-2 rounded-full bg-brass-soft px-2 py-0.5 text-accent-foreground">{L("عيد ميلاد", "Birthday")}</span> : null}
            {b.status === "cancelled" ? <span className="ms-2 rounded-full bg-danger-soft px-2 py-0.5 text-danger">{L("ملغي", "Cancelled")}</span> : null}
          </p>
        </div>
        {onCancel ? (
          <HoldToConfirm
            label={L("اضغط مطوّل للإلغاء", "Hold to cancel")}
            confirmLabel={L("اتلغى", "Cancelled")}
            hint={L("اضغط مطوّل ثانيتين عشان تلغي الحجز", "Press and hold for 2 seconds to cancel the booking")}
            onConfirm={() => window.setTimeout(() => onCancel(b.id), 700)}
          />
        ) : null}
      </li>
    );
  }

function Wallet({ acc }: { acc: Acc }) {
  const { L, lang } = useLang();
  if (!acc.wallet.length) return <Empty text={L("المحفظة فاضية — انسخ كود من صفحة أي مطعم وهيتحفظ هنا.", "Empty — copy a code on any restaurant page and it lands here.")} />;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {acc.wallet.map((w) => {
        const r = byId[w.rid];
        const o = r?.offers.find((x) => x.id === w.offerId);
        if (!r || !o) return null;
        return (
          <li key={w.offerId} className="relative overflow-hidden rounded-2xl border border-brass/40 bg-card p-4">
            <span aria-hidden className="absolute -start-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background" />
            <span aria-hidden className="absolute -end-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-background" />
            <a href={`#/r/${r.slug}`} className="font-display text-lg font-semibold hover:underline">{r[lang]}</a>
            <p className="text-sm text-muted-foreground">{o[lang]}</p>
            <div className="mt-3 flex items-center justify-between">
              <button type="button" className="num inline-flex items-center gap-2 rounded-full border border-dashed border-brass px-3 py-1 text-sm font-semibold text-brass" onClick={async () => { await copyText(w.code); notify({ title: L("اتنسخ", "Copied"), detail: w.code, ttl: 2500 }); }}>
                {w.code}
                <Copy className="size-3.5" aria-hidden />
              </button>
              <span className="text-xs text-muted-foreground">{L(`باقي ${o.endsInDays} يوم`, `${o.endsInDays} days left`)}</span>
            </div>
            <button type="button" className="mt-3 text-xs font-semibold text-muted-foreground hover:text-danger" onClick={() => updateAccount((a) => ({ ...a, wallet: a.wallet.filter((x) => x.offerId !== w.offerId) }))}>
              {L("شيل من المحفظة", "Remove")}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Invite({ acc }: { acc: Acc }) {
  const { L, lang } = useLang();
  const link = shareUrl(`/invite/${acc.profile.inviteCode}`);
  const copy = async (t: string) => {
    const ok = await copyText(t);
    notify({ title: ok ? L("اتنسخ", "Copied") : L("مقدرناش ننسخ", "Couldn't copy"), detail: t, ttl: 3000 });
  };
  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="relative overflow-hidden rounded-[28px] bg-primary p-6 text-primary-foreground sm:p-8">
        <div aria-hidden className="absolute -end-10 -top-10 size-48 rounded-full border-[14px] border-brass/40" />
        <Gift className="size-8 text-brass" aria-hidden />
        <h2 className="mt-3 text-3xl font-bold">{L("ادعي صحابك، وكلكم تكسبوا", "Invite friends, everyone wins")}</h2>
        <p className="mt-2 text-primary-foreground/80">{L("صاحبك ياخد 100 ج.م خصم على أول طلب، وانت تاخد 150 نقطة لما يطلب.", "Your friend gets EGP 100 off their first order; you get 150 points when they order.")}</p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="num rounded-full border border-dashed border-white/50 px-4 py-2 text-lg font-bold tracking-widest">{acc.profile.inviteCode}</span>
          <button type="button" className="sf-btn sf-btn-sm bg-white/15 text-primary-foreground hover:bg-white/25" onClick={() => copy(acc.profile.inviteCode)}>
            <Copy className="size-4" aria-hidden />
            {L("انسخ الكود", "Copy code")}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-2xl bg-black/15 p-2">
          <span className="num min-w-0 flex-1 truncate px-2 text-sm" dir="ltr">{link}</span>
          <button type="button" className="sf-btn sf-btn-sm sf-btn-brass shrink-0" onClick={() => copy(link)}>
            <Share2 className="size-4" aria-hidden />
            {L("انسخ اللينك", "Copy link")}
          </button>
        </div>
        <p className="mt-4 text-sm text-primary-foreground/70">{L("3 صحاب انضموا بالكود بتاعك (تجريبي).", "3 friends joined with your code (demo).")}</p>
      </section>
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold">{L("خروجة مع الأصحاب", "Plan with friends")}</h2>
          <button type="button" className="sf-btn sf-btn-primary sf-btn-sm" onClick={() => navigate("/plan/new")}>
            <Plus className="size-4" aria-hidden />
            {L("أوضة جديدة", "New room")}
          </button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{L("رشّح 3 أماكن، ابعت اللينك، وصحابك يصوتوا.", "Shortlist 3 places, share the link, friends vote.")}</p>
        {acc.plans.length ? (
          <ul className="mt-4 grid gap-3">
            {acc.plans.map((p) => (
              <li key={p.id}>
                <a href={`#/plan/${p.id}`} className="flex items-center gap-3 rounded-2xl border bg-card p-4 hover:shadow-sf">
                  <div className="flex">
                    {p.members.slice(0, 4).map((m) => <Blobatar key={m} name={m} animate="hover" background="circle" className="-ms-2 size-8 rounded-full ring-2 ring-card first:ms-0" aria-hidden />)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.candidates.map((c) => byId[c]?.[lang]).join(" · ")}</p>
                  </div>
                  <span className="num text-sm text-muted-foreground">{Object.keys(p.votes).length}/{p.members.length}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <Empty text={L("مفيش أوض تخطيط لسه.", "No planning rooms yet.")} />
        )}
      </section>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="mt-4 rounded-2xl border border-dashed p-8 text-center text-muted-foreground">{text}</p>;
}
