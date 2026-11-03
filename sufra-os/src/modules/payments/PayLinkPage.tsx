/**
 * Public pay-by-link page: /r/:restaurantSlug/link/:intentId (no login). Shows who is asking, how much, the note and the
 * expiry, then hands over to the gateway's hosted checkout (or the DemoProvider page locally). Coming back (?pi=…) it
 * polls the server-side status — the redirect itself proves nothing.
 */
import { startTransition, useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CheckCircle2, Clock3, CreditCard, Lock, ShieldCheck, XCircle } from "lucide-react";
import { useRepo } from "@/data/hooks";
import type { Localized } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Button, EmptyState, Money, Spinner } from "@/ui";
import { Mark } from "@/shell/Logo";
import { GuestToggles } from "@/modules/guest/ui/bits";
import { attachDemoRepo, demoProvider, intentFromRow, type PaymentIntent } from "@/modules/guest/pay";
import { linkState, timeLeft } from "./reconcile";

const BASE = import.meta.env.BASE_URL;
type Rpc = { rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> };
type View = PaymentIntent & { restaurant?: { name: Localized; slug: string } };

export default function PayLinkPage() {
  const { restaurantSlug = "", intentId = "" } = useParams();
  const repo = useRepo();
  const navigate = useNavigate();
  const { L, loc, lang } = useT();
  const [pi, setPi] = useState<View | null | undefined>(undefined);
  const [name, setName] = useState<Localized | null>(null);
  const [now, setNow] = useState(Date.now());
  const [going, setGoing] = useState(false);

  const load = useCallback(async (): Promise<View | null> => {
    if (repo.kind === "local") {
      attachDemoRepo(repo);
      const row = await repo.get("paymentIntents", intentId);
      const p = row ? intentFromRow(row) : await demoProvider.retrieve(intentId);
      return p;
    }
    const client = (repo as unknown as { client?: Rpc }).client;
    const { data } = (await client?.rpc("guest_payment_status", { p_intent_id: intentId })) ?? { data: null };
    return (data as View | null) ?? null;
  }, [repo, intentId]);

  useEffect(() => {
    let alive = true;
    const tick = () => load().then((p) => alive && setPi(p), () => alive && setPi(null));
    tick();
    const unsub = repo.kind === "local" ? repo.subscribe(["paymentIntents"], null, () => tick()) : () => undefined;
    const poll = setInterval(tick, repo.kind === "local" ? 5000 : 2500);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      unsub();
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load, repo]);

  useEffect(() => {
    if (pi?.restaurant) setName(pi.restaurant.name);
    else if (repo.kind === "local") repo.list("restaurants", { where: { slug: restaurantSlug } }).then((r) => r[0] && setName(r[0].name));
  }, [pi, repo, restaurantSlug]);
  useEffect(() => {
    document.title = `${name ? loc(name) : "Sufra"} · ${L("لينك دفع", "Payment link")}`;
  }, [name, loc, L]);

  const pay = () => {
    if (!pi?.redirectUrl) return;
    setGoing(true);
    if (pi.redirectUrl.startsWith(BASE)) startTransition(() => navigate(pi.redirectUrl!.slice(BASE.length - 1)));
    else window.location.assign(pi.redirectUrl);
  };

  if (pi === undefined)
    return (
      <div className="grid min-h-dvh place-items-center bg-bg">
        <Spinner />
      </div>
    );
  if (!pi)
    return (
      <div className="grid min-h-dvh place-items-center bg-bg p-4">
        <EmptyState icon={<CreditCard />} title={L("اللينك ده مش موجود", "This payment link doesn't exist")} body={L("اتأكد من اللينك أو اطلب لينك جديد من المطعم", "Check the link or ask the restaurant for a new one")} />
      </div>
    );

  const st = linkState({ status: pi.status, expiresAt: pi.expiresAt }, now);
  const left = timeLeft(pi.expiresAt, now);
  return (
    <div className="min-h-dvh bg-bg px-4 py-6">
      <div className="mx-auto flex max-w-md items-center justify-between pb-5">
        <span className="inline-flex items-center gap-2.5">
          <Mark className="size-9" />
          <span className="text-[17px] font-bold">{name ? loc(name) : restaurantSlug}</span>
        </span>
        <GuestToggles />
      </div>
      <main className="mx-auto max-w-md overflow-hidden rounded-[24px] border border-line bg-surface shadow-sf-lg">
        <div className="grid gap-1 p-6 text-center">
          <p className="text-[13.5px] font-semibold text-muted">{L("مطلوب منك تدفع", "Amount to pay")}</p>
          <Money value={pi.charge} className="text-[40px] font-bold leading-tight" />
          {pi.note ? <p className="mx-auto max-w-xs text-[14px] text-ink-2">{pi.note}</p> : null}
        </div>
        <div className={cn("grid gap-3 border-t border-line p-5", st === "paid" && "bg-ok-soft", (st === "failed" || st === "expired" || st === "cancelled") && "bg-danger-soft/50")}>
          {st === "paid" ? (
            <div className="grid justify-items-center gap-2 py-2 text-center" role="status">
              <CheckCircle2 className="size-12 text-ok" />
              <p className="text-[18px] font-bold">{L("تم الدفع، شكرًا! 🌿", "Paid — thank you! 🌿")}</p>
              {pi.reference ? <p className="num text-[13px] text-muted">{L("رقم العملية", "Transaction")} {pi.reference}</p> : null}
            </div>
          ) : st === "processing" ? (
            <div className="grid justify-items-center gap-2 py-3 text-center" role="status">
              <Spinner />
              <p className="font-semibold">{L("بنأكد الدفع مع البنك…", "Confirming with the bank…")}</p>
            </div>
          ) : st === "waiting" ? (
            <>
              {left ? (
                <p className="flex items-center justify-center gap-1.5 text-[13px] text-muted">
                  <Clock3 className="size-4" />
                  {L("اللينك صالح لمدة", "Link valid for")} <span className="num font-semibold text-ink">{left}</span>
                </p>
              ) : null}
              <Button size="xl" block icon={<Lock className="size-5" />} onClick={pay} loading={going} disabled={!pi.redirectUrl}>
                {L("ادفع دلوقتي", "Pay now")}
              </Button>
              <p className="flex items-center justify-center gap-1.5 text-center text-[12px] text-muted">
                <ShieldCheck className="size-3.5" />
                {lang === "ar" ? "الدفع بيتم في صفحة آمنة لشركة الدفع — المطعم مش بيشوف بيانات الكارت" : "You pay on the payment provider's secure page — the restaurant never sees your card"}
              </p>
            </>
          ) : (
            <div className="grid justify-items-center gap-2 py-2 text-center" role="alert">
              <XCircle className="size-11 text-danger" />
              <p className="text-[16px] font-bold">
                {st === "expired" ? L("اللينك ده انتهى", "This link has expired") : st === "cancelled" ? L("اللينك ده اتلغى", "This link was cancelled") : L("الدفع ماتمّش", "The payment didn't go through")}
              </p>
              <p className="text-[13px] text-muted">{L("اطلب من المطعم يبعتلك لينك جديد", "Ask the restaurant to send you a new link")}</p>
            </div>
          )}
        </div>
      </main>
      <p className="mx-auto mt-4 max-w-md text-center text-[11.5px] text-faint">Sufra · {pi.id.slice(-8)}</p>
    </div>
  );
}
