import { startTransition, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CreditCard, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, EmptyState, Input, Money, Segmented, Spinner } from "@/ui";
import { GuestToggles } from "./ui/bits";
import { demoProvider, type DemoOutcome, type PaymentIntent } from "./pay";

const BASE = import.meta.env.BASE_URL;

/**
 * The DemoProvider's "hosted checkout" (/r/:slug/pay/:intentId). Stands in for Paymob/Kashier's page:
 * no real card data is collected or stored — the fields are pre-filled and never leave the page.
 */
export default function CheckoutPage() {
  const { intentId = "" } = useParams();
  const { L } = useT();
  const navigate = useNavigate();
  const [pi, setPi] = useState<PaymentIntent | null | undefined>(undefined);
  const [method, setMethod] = useState<"card" | "wallet">("card");
  const [busy, setBusy] = useState<DemoOutcome | null>(null);

  useEffect(() => {
    demoProvider.retrieve(intentId).then(setPi, () => setPi(null));
  }, [intentId]);

  const finish = async (outcome: DemoOutcome) => {
    if (!pi) return;
    setBusy(outcome);
    await new Promise((r) => setTimeout(r, outcome === "succeeded" ? 1100 : 400));
    await demoProvider.complete(pi.id, outcome);
    const back = new URL(pi.request.returnUrl, window.location.origin);
    back.searchParams.set("pi", pi.id);
    if (back.origin === window.location.origin && back.pathname.startsWith(BASE)) startTransition(() => navigate(back.pathname.slice(BASE.length - 1) + back.search, { replace: true }));
    else window.location.replace(back.toString());
  };

  if (pi === undefined)
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <Spinner />
      </div>
    );
  if (!pi || pi.status !== "requires_action")
    return (
      <div className="grid min-h-dvh place-items-center bg-bg p-4">
        <EmptyState icon={<CreditCard />} title={L("لينك الدفع ده خلص", "This payment link has expired")} body={L("ارجع للصفحة وجرّب تاني", "Go back and try again")} />
      </div>
    );

  return (
    <div className="min-h-dvh bg-[#eef1f4] px-4 py-6 text-[#14181f] dark:bg-[#0b0e12] dark:text-[#e8edf3]">
      <div className="mx-auto flex max-w-md items-center justify-between pb-4">
        <span className="inline-flex items-center gap-2 text-[14px] font-bold">
          <Lock className="size-4 text-[#1d7f4a]" />
          {L("صفحة دفع آمنة", "Secure checkout")}
          <span className="rounded-md bg-[#ffd76a] px-1.5 py-0.5 text-[10.5px] font-black tracking-wide text-[#3a2a00]">DEMO</span>
        </span>
        <GuestToggles />
      </div>
      <main className="mx-auto max-w-md overflow-hidden rounded-[22px] bg-white shadow-[0_20px_60px_-20px_rgb(0_0_0/0.35)] dark:bg-[#151a21]">
        <div className="border-b border-black/5 p-5 dark:border-white/10">
          <p className="text-[13px] text-[#5b6472] dark:text-[#9aa4b2]">{L("الدفع لـ", "Paying")} · {pi.request.restaurantSlug}</p>
          <Money value={pi.charge} className="mt-1 text-[34px] font-bold" />
          <p className="mt-1 text-[12.5px] text-[#5b6472] dark:text-[#9aa4b2]">
            {pi.request.splitLabel ? `${pi.request.splitLabel} · ` : ""}
            {pi.tip ? (
              <>
                {L("شامل بقشيش", "incl. tip")} <Money value={pi.tip} />
              </>
            ) : null}
          </p>
        </div>
        <div className="grid gap-4 p-5">
          <Segmented
            block
            label={L("طريقة الدفع", "Method")}
            value={method}
            onChange={setMethod}
            options={[
              { value: "card", label: L("كارت / ميزة", "Card / Meeza"), icon: <CreditCard /> },
              { value: "wallet", label: L("محفظة موبايل", "Mobile wallet"), icon: <Smartphone /> },
            ]}
          />
          {method === "card" ? (
            <div className="grid gap-3">
              <Input label={L("رقم الكارت", "Card number")} defaultValue="4242 4242 4242 4242" dir="ltr" readOnly className="num" />
              <div className="grid grid-cols-2 gap-3">
                <Input label={L("تاريخ الانتهاء", "Expiry")} defaultValue="12 / 29" dir="ltr" readOnly className="num" />
                <Input label="CVV" defaultValue="•••" dir="ltr" readOnly className="num" />
              </div>
            </div>
          ) : (
            <Input label={L("رقم المحفظة", "Wallet number")} defaultValue="010 0000 0000" dir="ltr" readOnly className="num" hint={L("هيوصلك طلب تأكيد على الموبايل", "You'd confirm on your phone")} />
          )}
          <Button size="lg" block onClick={() => finish("succeeded")} loading={busy === "succeeded"} disabled={!!busy} className="bg-[#14181f] text-white hover:bg-black dark:bg-white dark:text-[#14181f]">
            {L("ادفع", "Pay")} <Money value={pi.charge} />
          </Button>
          <div className={cn("flex items-center justify-between text-[13px]", busy && "pointer-events-none opacity-50")}>
            <button type="button" className="font-semibold text-[#c2412d]" onClick={() => finish("failed")}>
              {L("جرّب رفض الكارت", "Simulate decline")}
            </button>
            <button type="button" className="font-semibold text-[#5b6472]" onClick={() => finish("cancelled")}>
              {L("إلغاء والرجوع", "Cancel and go back")}
            </button>
          </div>
        </div>
        <p className="flex items-center justify-center gap-1.5 border-t border-black/5 px-5 py-3 text-[11.5px] text-[#5b6472] dark:border-white/10 dark:text-[#9aa4b2]">
          <ShieldCheck className="size-3.5" />
          {L("صفحة تجريبية — مفيش فلوس حقيقية بتتخصم", "Demo page — no real money moves")}
        </p>
      </main>
    </div>
  );
}
