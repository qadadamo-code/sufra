import { lazy, Suspense, type ReactNode } from "react";
import { ArrowUpRight, BadgeCheck, BookOpen, Boxes, Building2, ChefHat, CloudOff, Gift, Languages, LayoutGrid, Megaphone, QrCode, Receipt, ShieldCheck, Sparkles, Store, Truck, Users, Wallet } from "lucide-react";
import { Reveal } from "@/components/sufra/Reveal";
import { useLang } from "@/lib/i18n";
import type { Route } from "@/lib/router";
import { cn } from "@/lib/utils";
import { BizPage, SectionTitle, useArrow } from "@/components/business/kit";
import { AiMockup, BranchesMockup, FloorMockup, InventoryMockup, KdsMockup, LedgerMockup, OfflineMockup, PosMockup, PurchasingMockup, QrMenuMockup, ReceiptMockup, ReservationsMockup, VatReturnMockup, ZReportMockup } from "@/components/business/Mockups";
import { FLOOR_DEMO_URL } from "@/data/business/demo";
import { TRIAL_DAYS } from "@/data/business/plans";

const SufraMachine = lazy(() => import("@/components/business/machine/SufraMachine"));

function Feature({ kicker, title, body, points, mock, flip, Icon }: { kicker: string; title: string; body: string; points: string[]; mock: ReactNode; flip?: boolean; Icon: typeof Store }) {
  return (
    <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
      <Reveal className={cn(flip && "lg:order-2")}>
        <span className="grid size-12 place-items-center rounded-2xl bg-brass-soft text-brass">
          <Icon className="size-6" aria-hidden />
        </span>
        <p className="sf-kicker mt-5">{kicker}</p>
        <h3 className="mt-1 text-[28px] font-bold leading-tight sm:text-[34px]">{title}</h3>
        <p className="mt-3 max-w-xl text-[16.5px] text-muted-foreground">{body}</p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-2 text-[15px]">
              <BadgeCheck className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      </Reveal>
      <Reveal delay={0.1} className={cn("min-w-0", flip && "lg:order-1")}>
        {mock}
      </Reveal>
    </div>
  );
}

export default function BusinessLanding({ route }: { route: Route }) {
  const { L } = useLang();
  const Arrow = useArrow();
  const quick = [
    { Icon: Wallet, t: L("كاشير POS", "POS") },
    { Icon: LayoutGrid, t: L("محرر الصالة", "Floor editor") },
    { Icon: BookOpen, t: L("حجوزات وانتظار", "Reservations") },
    { Icon: ChefHat, t: L("شاشة المطبخ", "Kitchen display") },
    { Icon: QrCode, t: L("منيو QR", "QR menus") },
    { Icon: Boxes, t: L("مخزن ووصفات", "Inventory") },
    { Icon: Truck, t: L("شراء من الموردين", "Purchasing") },
    { Icon: Gift, t: L("ولاء وحملات", "Loyalty") },
    { Icon: Sparkles, t: L("مساعد ذكي", "AI assistant") },
    { Icon: Building2, t: L("فروع متعددة", "Multi-branch") },
    { Icon: ShieldCheck, t: L("أدوار وصلاحيات", "Roles") },
    { Icon: CloudOff, t: L("بدون نت", "Offline") },
    { Icon: Languages, t: L("عربي / English", "Arabic / English") },
    { Icon: Receipt, t: L("إيصال ETA", "ETA e-receipt") },
  ];
  return (
    <BizPage kind="business" path={route.path}>
      {/* Hero: the 3D machine with the headline on the start side */}
      <section className="relative overflow-hidden border-b bg-[radial-gradient(120%_80%_at_20%_60%,color-mix(in_srgb,var(--sf-primary)_14%,transparent),transparent_60%)] paper-grain">
        <div className="relative wrap lg:min-h-[min(86svh,800px)]">
          <div className="gutter relative z-10 pt-10 pb-4 lg:absolute lg:inset-y-0 lg:start-0 lg:flex lg:w-[44%] lg:flex-col lg:justify-center lg:pb-10">
            <p className="sf-kicker">{L("سُفرة للمطاعم · القاهرة", "Sufra for restaurants · Cairo")}</p>
            <h1 className="mt-3 text-[40px] font-bold leading-[1.08] sm:text-[56px] xl:text-[64px]">
              {L("ماكينة واحدة", "One machine")}
              <br />
              <span className="text-primary">{L("بتشغّل مطعمك كله", "that runs your whole restaurant")}</span>
            </h1>
            <p className="mt-4 max-w-md text-[17px] text-muted-foreground">
              {L("من طلب الضيف بالـ QR، للمطبخ، للكاشير، للتوصيل، لحد الإيصال الإلكتروني لمصلحة الضرايب — كله في سستم واحد بالعربي، وشغال حتى لو النت فصل.", "From the guest's QR order to the kitchen, the cashier, delivery and the ETA e-receipt — one Arabic-first system that keeps running when the internet doesn't.")}
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <a href="#/business/signup" className="sf-btn sf-btn-primary">
                {L(`ابدأ تجربة مجانية ${TRIAL_DAYS} يوم`, `Start a ${TRIAL_DAYS}-day free trial`)}
                <Arrow className="size-4" aria-hidden />
              </a>
              <a href="#/business/pricing" className="sf-btn sf-btn-ghost">
                {L("الأسعار", "Pricing")}
              </a>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
              <a href={FLOOR_DEMO_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
                {L("ديمو حي: الصالة والحجوزات", "Live demo: floor & reservations")}
                <ArrowUpRight className="size-4" aria-hidden />
              </a>
              <a href="#/business/dashboard" className="inline-flex items-center gap-1 text-primary hover:underline">
                {L("ديمو حي: لوحة تحكم المالك", "Live demo: owner dashboard")}
                <Arrow className="size-4" aria-hidden />
              </a>
            </div>
          </div>
          <div className="relative h-[440px] sm:h-[520px] lg:absolute lg:inset-0 lg:h-auto">
            <Suspense fallback={<div className="h-full" />}>
              <SufraMachine className="h-full" />
            </Suspense>
          </div>
        </div>
      </section>

      {/* Everything in one strip */}
      <section className="wrap gutter py-12">
        <p className="sf-kicker mb-4 text-center">{L("كل ده في سستم واحد", "All of this in one system")}</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {quick.map((q) => (
            <li key={q.t} className="inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-[14px] font-medium">
              <q.Icon className="size-4 text-primary" aria-hidden />
              {q.t}
            </li>
          ))}
        </ul>
      </section>

      <section className="wrap gutter grid gap-24 py-10 sm:gap-28">
        <Feature
          Icon={Wallet}
          kicker={L("الصالة · الكاشير", "Front of house · POS")}
          title={L("كاشير سريع بيفهم المطعم المصري", "A fast POS that gets Egyptian restaurants")}
          body={L("فواتير مفتوحة لكل ترابيزة، تقسيم ودمج، خصومات بصلاحيات، خدمة 12% للصالة بس، وضريبة 14% محسوبة بالقرش.", "Open bills per table, split & merge, permissioned discounts, 12% service on dine-in only, and 14% VAT to the piastre.")}
          points={[L("تقسيم الفاتورة بالصنف أو بالتساوي", "Split by item or evenly"), L("كاش، فيزا، محافظ، إنستاباي", "Cash, card, wallets, InstaPay"), L("أسعار قبل أو شاملة الضريبة", "Prices exclusive or inclusive of VAT"), L("طابعة مطبخ وطابعة إيصالات", "Kitchen & receipt printers")]}
          mock={<PosMockup />}
        />
        <Feature
          flip
          Icon={LayoutGrid}
          kicker={L("محرر الصالة", "Floor plan editor")}
          title={L("ارسم صالتك زي ما هي", "Draw your floor exactly as it is")}
          body={L("اسحب الترابيزات وكبّرها، الكراسي بتتوزع لوحدها، وزق ترابيزتين في بعض يدمجهم — والفواتير بتتدمج معاهم.", "Drag and resize tables, chairs place themselves, and push two tables together to merge them — bills merge too.")}
          points={[L("سحب وتكبير وتدوير", "Drag, resize, rotate"), L("كراسي تلقائية حسب المقاس", "Auto chairs by size"), L("دمج بالزق + دمج الفواتير", "Merge by pushing + bill merge"), L("حالة كل ترابيزة لايف", "Live status per table")]}
          mock={<FloorMockup />}
        />
        <Feature
          Icon={BookOpen}
          kicker={L("حجوزات · قائمة انتظار", "Reservations · waitlist")}
          title={L("جدول حجوزات بيقترح الترابيزة الصح", "A timeline that suggests the right table")}
          body={L("حجوزات من سُفرة والتليفون في جدول واحد، اقتراح ذكي للترابيزة بأقل هدر في الكراسي، وقائمة انتظار بتبعت رسالة لما الترابيزة تفضى.", "Sufra and phone bookings on one timeline, smart table suggestions that waste the fewest seats, and a waitlist that texts guests when a table frees up.")}
          points={[L("اقتراح ترابيزة ذكي", "Smart table suggestions"), L("تأكيد SMS وواتساب", "SMS & WhatsApp confirmations"), L("عربون للمجموعات الكبيرة", "Deposits for large groups"), L("سجل الضيف وملاحظاته", "Guest history & notes")]}
          mock={<ReservationsMockup />}
        />
        <Feature
          flip
          Icon={QrCode}
          kicker={L("منيو QR · طلب الضيف", "QR menus · guest ordering")}
          title={L("الضيف يطلب من الترابيزة", "Guests order from the table")}
          body={L("كل ترابيزة ليها QR: منيو بالصور، طلب على طول للمطبخ، وطلب الحساب. ومحرر منيو بترتيب الأقسام بالسحب.", "Each table has a QR: photo menu, orders straight to the kitchen, and ask for the bill. Plus a menu editor with drag-to-reorder sections.")}
          points={[L("منيو عربي وإنجليزي", "Arabic & English menu"), L("إضافات واختيارات", "Modifiers & options"), L("إخفاء الصنف لما يخلص", "Hide items when 86'd"), L("نفس المنيو على تطبيق سُفرة", "Same menu on the Sufra app")]}
          mock={
            <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto]">
              <KdsMockup />
              <QrMenuMockup />
            </div>
          }
        />
        <Feature
          Icon={Boxes}
          kicker={L("المخزن · الوصفات · الشراء", "Inventory · recipes · purchasing")}
          title={L("اعرف تكلفة كل طبق بالقرش", "Know every dish's cost to the piastre")}
          body={L("وصفات بالجرام، خصم تلقائي من المخزن مع كل بيع، ومتوسط تكلفة مرجّح بيتحدث مع كل استلام. واطلب من الموردين وقارن الأسعار من جوه السستم.", "Recipes by the gram, automatic stock deduction with every sale, and a weighted-average cost updated with every delivery. Order from suppliers and compare prices in-app.")}
          points={[L("تنبيهات نقص المخزون", "Low-stock alerts"), L("جرد وهالك", "Counts & waste"), L("أوامر شراء واستلام", "Purchase orders & receiving"), L("تكلفة الأكل % لكل صنف", "Food cost % per dish")]}
          mock={
            <div className="grid gap-4 sm:grid-cols-2">
              <InventoryMockup />
              <PurchasingMockup />
            </div>
          }
        />
        <Feature
          flip
          Icon={Megaphone}
          kicker={L("العملاء · الولاء · الحملات · الذكاء", "Guests · loyalty · campaigns · AI")}
          title={L("رجّع الضيف تاني", "Bring guests back")}
          body={L("ملف لكل ضيف، نقاط ولاء، كوبونات وحملات SMS وواتساب، ومساعد ذكي بيرد على أسئلتك عن المبيعات والتكلفة.", "A profile per guest, loyalty points, coupons and SMS/WhatsApp campaigns, and an AI assistant that answers questions about sales and costs.")}
          points={[L("شرائح عملاء تلقائية", "Automatic guest segments"), L("عروض ساعة الهدوء", "Quiet-hour offers"), L("تقييمات وردود", "Reviews & replies"), L("اسأل بالعامية", "Ask in plain Arabic")]}
          mock={<AiMockup />}
        />
        <Feature
          Icon={Building2}
          kicker={L("فروع · صلاحيات · بدون نت", "Branches · roles · offline")}
          title={L("من فرع واحد لسلسلة", "From one branch to a chain")}
          body={L("لوحة واحدة لكل الفروع، أدوار وصلاحيات لكل موظف، ووضع بدون نت حقيقي: البيع والمطبخ والإيصالات بيكملوا وبيتزامنوا بعدين.", "One dashboard for every branch, roles and permissions per employee, and a real offline mode: sales, kitchen and receipts carry on and sync later.")}
          points={[L("منيو مركزي وأسعار لكل فرع", "Central menu, per-branch prices"), L("تحويلات مخزن بين الفروع", "Stock transfers between branches"), L("سجل لكل عملية حساسة", "Audit log of sensitive actions"), L("عربي RTL وإنجليزي", "Arabic RTL & English")]}
          mock={
            <div className="grid gap-4 sm:grid-cols-2">
              <BranchesMockup />
              <OfflineMockup />
            </div>
          }
        />
      </section>

      {/* Finance & tax core */}
      <section className="mt-24 border-y bg-card/50 py-20">
        <div className="wrap gutter">
          <SectionTitle kicker={L("المالية والضرايب", "Finance & tax core")} title={L("محاسبة حقيقية تحت كل فاتورة", "Real accounting under every bill")} sub={L("كل بيع بيعمل قيد مزدوج متوازن، والضرايب محسوبة بقواعد مصلحة الضرايب المصرية — من غير ما تفتح إكسيل.", "Every sale posts a balanced double-entry journal, with taxes computed to Egyptian Tax Authority rules — no spreadsheets.")} />
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr_1fr]">
            <div className="grid content-start gap-4">
              <LedgerMockup />
              <ZReportMockup />
            </div>
            <div className="grid content-start gap-4">
              <ReceiptMockup />
            </div>
            <div className="grid content-start gap-4">
              <VatReturnMockup />
              <ul className="grid gap-2">
                {[
                  L("دفتر قيد مزدوج: مبيعات، خدمة، ضريبة، خزينة، مخزن", "Double-entry ledger: sales, service, VAT, cash, stock"),
                  L("ضريبة 14% + خدمة 12% للصالة بس، والخدمة داخل أو خارج وعاء الضريبة (T9 / T17)", "VAT 14% + service 12% dine-in only; service inside or outside the VAT base (T9 / T17)"),
                  L("تقرير Z وعدّ الدرج والعجز والزيادة", "Z-report, drawer count, over/short"),
                  L("إقرار القيمة المضافة الشهري جاهز", "Monthly VAT return, ready to file"),
                  L("إيصال إلكتروني ETA (SC/RC v1.2) بسلسلة UUID و QR، بطابور قبل مهلة 24 ساعة", "ETA e-receipt (SC/RC v1.2) with UUID chain & QR, queued within the 24-hour window"),
                  L("جاهزين للفاتورة الإلكترونية B2B", "B2B e-invoice ready"),
                ].map((p) => (
                  <li key={p} className="flex items-start gap-2 text-[14.5px]">
                    <BadgeCheck className="mt-0.5 size-[18px] shrink-0 text-primary" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="wrap gutter pt-20">
        <div className="relative overflow-hidden rounded-[32px] bg-primary p-8 text-primary-foreground sm:p-12">
          <div className="absolute -end-20 -top-20 size-72 rounded-full bg-brass/30 blur-3xl" aria-hidden />
          <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
            <div>
              <h2 className="text-[32px] font-bold leading-tight sm:text-[44px]">{L(`جرّب سُفرة ${TRIAL_DAYS} يوم ببلاش`, `Try Sufra free for ${TRIAL_DAYS} days`)}</h2>
              <p className="mt-3 max-w-xl text-primary-foreground/80">{L("من غير كارت. بنساعدك تدخل المنيو وترسم الصالة في أول يوم.", "No card. We'll help you load your menu and draw your floor on day one.")}</p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <a href="#/business/signup" className="sf-btn sf-btn-brass">{L("ابدأ دلوقتي", "Start now")}</a>
              <a href="#/business/pricing" className="sf-btn border-white/30 text-primary-foreground hover:bg-white/10">{L("قارن الباقات", "Compare plans")}</a>
            </div>
          </div>
        </div>
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <Users className="size-4" aria-hidden />
          {L("بتبيع خامات للمطاعم؟", "Sell supplies to restaurants?")}{" "}
          <a href="#/suppliers" className="font-semibold text-primary hover:underline">{L("سُفرة للموردين", "Sufra for suppliers")}</a>
        </p>
      </section>
    </BizPage>
  );
}
