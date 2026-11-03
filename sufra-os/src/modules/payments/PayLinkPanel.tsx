/**
 * Pay-by-link for a check — used by the POS "online link" tender (and reusable from messaging / waiter).
 * Creates a payment intent (kind "link"), shows QR + copy + WhatsApp click-to-chat, then waits live for the verified
 * payment (webhook in the cloud, DemoProvider locally) and calls `onPaid` once so the POS can close the check.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Copy, ExternalLink, Link2, MessageCircle, RefreshCw, Share2, Timer, X } from "lucide-react";
import { useSession } from "@/auth/session";
import { useLive, useRepo } from "@/data/hooks";
import type { Check, PaymentIntentRow } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, type Currency, type Units } from "@/lib/money";
import { Badge, Button, Input, Segmented, useToast } from "@/ui";
import { QrSvg } from "@/modules/guest/qr/QrSvg";
import { cancelIntent, createPayLink, PayApiError, paymentLinkUrl } from "./api";
import { linkState, timeLeft, whatsappUrl } from "./reconcile";
import { paySettingsOf } from "./config";

const EXPIRY = [15, 60, 24 * 60, 3 * 24 * 60];

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export function PayLinkPanel({ check, amount, onPaid, className }: { check: Check; amount: Units; onPaid: (pi: PaymentIntentRow) => void; className?: string }) {
  const { L, lang } = useT();
  const repo = useRepo();
  const session = useSession();
  const { toast } = useToast();
  const now = useNow();
  const settings = useLive("settings").data[0] ?? null;
  const ps = paySettingsOf(settings);
  const currency = (settings?.locale.currency ?? "EGP") as Currency;
  const slug = session.restaurant?.slug ?? "";
  const { data: links } = useLive("paymentIntents", { where: { checkId: check.id, kind: "link" }, orderBy: [{ field: "createdAt", dir: "desc" }] });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState(String(ps.linkExpiryMin && EXPIRY.includes(ps.linkExpiryMin) ? ps.linkExpiryMin : 60));
  const [busy, setBusy] = useState(false);
  const paidOnce = useRef(new Set<string>());

  // the link being shown: the one just created, else the newest still waiting on this check
  const active = useMemo(() => links.find((l) => l.id === activeId) ?? links.find((l) => linkState(l, now) === "waiting" || linkState(l, now) === "processing") ?? null, [links, activeId, now]);
  const state = active ? linkState(active, now) : null;
  const url = active ? paymentLinkUrl(slug, active.id) : "";

  useEffect(() => {
    if (active && state === "paid" && !paidOnce.current.has(active.id)) {
      paidOnce.current.add(active.id);
      toast({ title: L("العميل دفع باللينك ✓", "Paid by link ✓"), description: formatMoney(active.amount, { lang }), tone: "success" });
      onPaid(active);
    }
  }, [active, state]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setBusy(true);
    try {
      const pi = await createPayLink(repo, check, { restaurantSlug: slug, amount, currency, note: note.trim(), expiresInMin: Number(expiry), customer: phone.trim() ? { name: "", phone: phone.trim() } : null, createdBy: session.staff?.id ?? null, lang });
      setActiveId(pi.id);
    } catch (e) {
      const msg = e instanceof PayApiError && e.text ? e.text[lang] : (e as Error).message === "bad_amount" ? L("المبلغ لازم يكون بالقرش", "Amount must be whole piastres") : L("ماقدرناش نعمل اللينك", "Couldn't create the link");
      toast({ title: L("لينك الدفع", "Pay link"), description: msg, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const text = `${L("لينك دفع", "Payment link")} ${session.restaurant ? (lang === "ar" ? session.restaurant.name.ar : session.restaurant.name.en) : ""} — ${formatMoney(active?.amount ?? amount, { lang })}${active?.note ? ` · ${active.note}` : ""}\n${url}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: L("اللينك اتنسخ", "Link copied"), tone: "success" });
    } catch {
      toast({ title: url });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: L("لينك دفع", "Payment link"), text, url });
    } catch {
      /* cancelled */
    }
  };

  if (!active || state === "expired" || state === "failed" || state === "cancelled") {
    return (
      <div className={cn("grid gap-3 rounded-2xl border border-line bg-surface-2 p-4", className)}>
        <div className="flex items-center gap-2 text-[14px] font-semibold">
          <Link2 className="size-[18px] text-primary" />
          {L("ابعت لينك دفع للعميل", "Send the guest a payment link")}
        </div>
        {active && state ? (
          <Badge tone={state === "expired" ? "warn" : "danger"}>{state === "expired" ? L("اللينك اللي فات انتهى", "The last link expired") : state === "cancelled" ? L("اللينك اللي فات اتلغى", "The last link was cancelled") : L("الدفع باللينك اللي فات فشل", "The last link payment failed")}</Badge>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={L("موبايل العميل (واتساب)", "Guest mobile (WhatsApp)")} inputMode="tel" dir="ltr" placeholder="01xxxxxxxxx" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label={L("ملاحظة تظهر للعميل", "Note shown to the guest")} placeholder={L("مثلاً: طلب كاترينج الخميس", "e.g. Thursday catering")} value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-semibold text-muted">{L("صالح لمدة", "Valid for")}</span>
          <Segmented
            size="sm"
            label={L("مدة اللينك", "Link expiry")}
            value={expiry}
            onChange={setExpiry}
            options={EXPIRY.map((m) => ({ value: String(m), label: m < 60 ? L(`${m} دقيقة`, `${m} min`) : m < 1440 ? L("ساعة", "1 hour") : m === 1440 ? L("يوم", "1 day") : L("٣ أيام", "3 days") }))}
          />
        </div>
        <Button size="lg" block icon={<Link2 className="size-5" />} loading={busy} disabled={amount <= 0} onClick={create}>
          {L("اعمل لينك بـ", "Create link for")} {formatMoney(amount, { lang })}
        </Button>
      </div>
    );
  }

  const left = timeLeft(active.expiresAt, now);
  return (
    <div className={cn("grid gap-3 rounded-2xl border p-4", state === "paid" ? "border-ok/40 bg-ok-soft" : "border-primary/30 bg-primary-soft/40", className)} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {state === "paid" ? (
          <Badge tone="ok" icon={<CheckCircle2 />}>{L("اتدفع", "Paid")} · {active.providerRef ?? ""}</Badge>
        ) : (
          <Badge tone="info" dot pulse>{state === "processing" ? L("بنأكد الدفع…", "Confirming…") : L("مستنيين العميل يدفع…", "Waiting for the guest to pay…")}</Badge>
        )}
        {left && state !== "paid" ? (
          <span className="num inline-flex items-center gap-1 text-[13px] font-semibold text-muted">
            <Timer className="size-4" />
            {left}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-4">
        <div className="shrink-0 rounded-xl bg-white p-1.5 shadow-sf-sm">
          <QrSvg value={url} className="size-[124px]" fg="#111" bg="#fff" title={L("QR لينك الدفع", "Pay link QR")} />
        </div>
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="num text-[24px] font-semibold leading-tight">{formatMoney(active.amount, { lang })}</div>
          {active.note ? <div className="truncate text-[13px] text-muted">{active.note}</div> : null}
          <code dir="ltr" className="block truncate rounded-lg bg-surface px-2 py-1 text-[12px] text-muted">{url}</code>
        </div>
      </div>
      {state !== "paid" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button variant="secondary" icon={<Copy className="size-4" />} onClick={copy}>
            {L("انسخ", "Copy")}
          </Button>
          <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1fa855] px-3 text-[14px] font-semibold text-white hover:bg-[#178a45]" href={whatsappUrl(active.customer?.phone ?? phone, text)} target="_blank" rel="noreferrer">
            <MessageCircle className="size-4" />
            {L("واتساب", "WhatsApp")}
          </a>
          {typeof navigator !== "undefined" && "share" in navigator ? (
            <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={share}>
              {L("شارك", "Share")}
            </Button>
          ) : (
            <a className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-3 text-[14px] font-semibold hover:bg-surface-2" href={url} target="_blank" rel="noreferrer">
              <ExternalLink className="size-4" />
              {L("افتح", "Open")}
            </a>
          )}
          <Button variant="ghost" icon={<X className="size-4" />} onClick={() => void cancelIntent(repo, active.id).then(() => setActiveId(null))}>
            {L("الغي", "Cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => setActiveId("none")}>
          {L("لينك تاني", "Another link")}
        </Button>
      )}
    </div>
  );
}
