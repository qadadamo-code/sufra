/**
 * /payments — every online transaction (pay at table, pay-by-link, online orders, gift cards), settlements per provider,
 * reconciliation against POS checks, refunds (manager PIN → gateway refund through /api/pay-refund) and CSV export.
 * Owner / admin / manager / accountant (permission "reports.financial").
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, CircleDollarSign, Download, Landmark, Link2, Receipt, Search, Settings2, Undo2, Wallet } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useApproval } from "@/auth/approval";
import { useSession } from "@/auth/session";
import { useLive, useRepo } from "@/data/hooks";
import type { PaymentIntentKind, PaymentIntentRow, PaymentIntentStatus, PaymentPayout, PayProviderId } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, major, type Units } from "@/lib/money";
import { PageHeader } from "@/shell/PageHeader";
import { AnimatedMoney, Badge, Button, Card, Dialog, EmptyState, Input, Select, StatTile, Table, Tabs, useToast, type Column, type Tone } from "@/ui";
import { PayApiError, recordIntentLocal, refundIntent } from "./api";
import { METHOD_SHORT, PROVIDER_NAME, paySettingsOf } from "./config";
import { chargeOf, feeOf, reconcile, settlements, toCsv, unitsDecimal, type ReconIssue, type Settlement } from "./reconcile";

type Tab = "all" | "settle" | "recon";
type Filter = "all" | "succeeded" | "pending" | "failed" | "refunded";

export const STATUS_TONE: Record<PaymentIntentStatus, Tone> = { requires_action: "info", processing: "info", succeeded: "ok", failed: "danger", cancelled: "neutral", expired: "warn" };

export default function PaymentsPage() {
  const { L, lang, loc } = useT();
  const repo = useRepo();
  const navigate = useNavigate();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>("all");
  const [filter, setFilter] = useState<Filter>("all");
  const [provider, setProvider] = useState<string>("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<PaymentIntentRow | null>(null);
  const [payoutFor, setPayoutFor] = useState<Settlement | null>(null);
  const settings = useLive("settings").data[0] ?? null;
  const ps = paySettingsOf(settings);
  const { data: intents, loading } = useLive("paymentIntents", { orderBy: [{ field: "createdAt", dir: "desc" }], limit: 1000 });
  const { data: payments } = useLive("payments", { where: { method: "online" } });
  const { data: checks } = useLive("checks", { orderBy: [{ field: "openedAt", dir: "desc" }], limit: 1000 });
  const { data: refunds } = useLive("paymentRefunds", { orderBy: [{ field: "createdAt", dir: "desc" }] });
  const { data: payouts } = useLive("paymentPayouts", { orderBy: [{ field: "createdAt", dir: "desc" }] });

  const KIND: Record<PaymentIntentKind, string> = { guest: L("دفع على الترابيزة", "Pay at table"), link: L("لينك دفع", "Pay link"), online_order: L("طلب أونلاين", "Online order"), gift_card: L("كارت هدية", "Gift card"), wallet_topup: L("شحن محفظة", "Wallet top-up"), deposit: L("عربون", "Deposit") };
  const STATUS: Record<PaymentIntentStatus, string> = { requires_action: L("مستني الدفع", "Awaiting payment"), processing: L("بيتأكد", "Confirming"), succeeded: L("اتدفع", "Paid"), failed: L("فشل", "Failed"), cancelled: L("اتلغى", "Cancelled"), expired: L("انتهى", "Expired") };
  const money = (u: Units) => formatMoney(u, { lang });

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return intents.filter((pi) => {
      if (provider && pi.provider !== provider) return false;
      if (filter === "succeeded" && pi.status !== "succeeded") return false;
      if (filter === "pending" && pi.status !== "requires_action" && pi.status !== "processing") return false;
      if (filter === "failed" && !["failed", "expired", "cancelled"].includes(pi.status)) return false;
      if (filter === "refunded" && !pi.refunded) return false;
      if (s && ![pi.id, pi.providerRef, pi.note, pi.customer?.phone, pi.customer?.name, pi.splitLabel].some((v) => v?.toLowerCase().includes(s))) return false;
      return true;
    });
  }, [intents, filter, provider, q]);

  const paid = intents.filter((p) => p.status === "succeeded");
  const today = new Date().toISOString().slice(0, 10);
  const todays = paid.filter((p) => p.createdAt.slice(0, 10) === today);
  const gross = todays.reduce((a, p) => a + chargeOf(p), 0);
  const fees = todays.reduce((a, p) => a + feeOf(p, ps).fee, 0);
  const refundedToday = refunds.filter((r) => r.status === "succeeded" && r.createdAt.slice(0, 10) === today).reduce((a, r) => a + r.amount, 0);
  const waiting = intents.filter((p) => p.status === "requires_action" && Date.parse(p.expiresAt) > Date.now()).length;
  const recon = useMemo(() => reconcile(intents, payments, checks), [intents, payments, checks]);
  const batches = useMemo(() => settlements(intents, payouts, ps), [intents, payouts, ps]);

  const exportCsv = () => {
    const header = ["created_at", "intent_id", "kind", "provider", "mode", "method", "status", "currency", "amount", "tip", "charge", "fee", "fee_estimated", "refunded", "net", "provider_ref", "check_id", "split", "customer_phone", "note"];
    const data = rows.map((p) => {
      const f = feeOf(p, ps);
      const charge = chargeOf(p);
      return [p.createdAt, p.id, p.kind, p.provider, p.mode, p.method ?? "", p.status, p.currency, unitsDecimal(p.amount), unitsDecimal(p.tip), unitsDecimal(charge), unitsDecimal(f.fee), f.estimated ? "yes" : "no", unitsDecimal(p.refunded), p.status === "succeeded" ? unitsDecimal(charge - f.fee - p.refunded) : "0.00", p.providerRef ?? "", p.checkId ?? "", p.splitLabel ?? "", p.customer?.phone ?? "", p.note];
    });
    const blob = new Blob([toCsv(header, data)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sufra-online-payments-${today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const columns: Column<PaymentIntentRow>[] = [
    {
      key: "when", header: L("الوقت", "Time"), width: "8.5rem",
      cell: (p) => (
        <span className="grid leading-tight">
          <span className="num font-semibold">{new Date(p.createdAt).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
          <span className="num text-[12px] text-muted">{new Date(p.createdAt).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short" })}</span>
        </span>
      ),
    },
    {
      key: "what", header: L("العملية", "Payment"),
      cell: (p) => (
        <span className="grid min-w-0 leading-tight">
          <span className="truncate font-semibold">{KIND[p.kind]}{p.splitLabel ? <span className="num text-[12px] font-medium text-muted"> · {p.splitLabel}</span> : null}</span>
          <span className="truncate text-[12px] text-muted">{p.note || p.customer?.name || p.customer?.phone || p.id}</span>
        </span>
      ),
    },
    { key: "method", header: L("الطريقة", "Method"), hideOnMobile: true, cell: (p) => <span className="whitespace-nowrap text-[13px]">{PROVIDER_NAME[p.provider]}{p.method ? ` · ${loc(METHOD_SHORT[p.method])}` : ""}{p.mode === "test" ? <Badge size="sm" tone="warn" className="ms-1.5">TEST</Badge> : null}</span> },
    { key: "ref", header: L("مرجع البوابة", "Provider ref"), hideOnMobile: true, cell: (p) => <code dir="ltr" className="whitespace-nowrap text-[12px] text-muted">{p.providerRef ?? "—"}</code> },
    { key: "amount", header: L("المبلغ", "Amount"), align: "end", cell: (p) => <span className="num whitespace-nowrap font-semibold">{money(chargeOf(p))}</span> },
    {
      key: "fee", header: L("الرسوم", "Fee"), align: "end", hideOnMobile: true,
      cell: (p) => {
        const f = feeOf(p, ps);
        return p.status === "succeeded" ? <span className={cn("num whitespace-nowrap text-[13px]", f.estimated && "text-muted")} title={f.estimated ? L("تقدير من الإعدادات", "Estimated from settings") : undefined}>{f.estimated ? "≈ " : ""}{money(f.fee)}</span> : <span className="text-faint">—</span>;
      },
    },
    { key: "refund", header: L("مسترد", "Refunded"), align: "end", hideOnMobile: true, cell: (p) => (p.refunded ? <span className="num whitespace-nowrap text-[13px] text-danger">−{money(p.refunded)}</span> : <span className="text-faint">—</span>) },
    { key: "status", header: L("الحالة", "Status"), align: "end", cell: (p) => <Badge tone={STATUS_TONE[p.status]} dot pulse={p.status === "requires_action" || p.status === "processing"}>{STATUS[p.status]}</Badge> },
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        icon={<CircleDollarSign />}
        title={L("المدفوعات الأونلاين", "Online payments")}
        subtitle={L("الدفع على الترابيزة، لينكات الدفع، الطلبات الأونلاين والتسويات", "Pay at table, pay links, online orders and settlements")}
        actions={<div className="hidden gap-2 sm:flex">
            {can("settings.edit") ? (
              <Button variant="ghost" icon={<Settings2 className="size-4" />} onClick={() => navigate("/settings/payments")}>
                {L("إعدادات الدفع", "Payment settings")}
              </Button>
            ) : null}
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv} disabled={!rows.length}>
              CSV
            </Button>
          </div>}
      />

      <div className="-mt-3 flex gap-2 sm:hidden">
            {can("settings.edit") ? (
              <Button variant="secondary" className="flex-1" icon={<Settings2 className="size-4" />} onClick={() => navigate("/settings/payments")}>
                {L("إعدادات الدفع", "Payment settings")}
              </Button>
            ) : null}
            <Button variant="secondary" icon={<Download className="size-4" />} onClick={exportCsv} disabled={!rows.length}>
              CSV
            </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={<CircleDollarSign />} label={L("أونلاين النهارده", "Online today")} value={<AnimatedMoney value={gross} whole />} sub={L(`${todays.length} عملية`, `${todays.length} payments`)} />
        <StatTile index={1} icon={<Receipt />} tone="brass" label={L("رسوم البوابة", "Gateway fees")} value={<AnimatedMoney value={fees} whole />} sub={L("الصافي ", "Net ") + money(gross - fees - refundedToday)} />
        <StatTile index={2} icon={<Link2 />} tone="info" label={L("لينكات مستنية", "Links waiting")} value={waiting} sub={L("لسه ماتدفعتش", "not paid yet")} />
        <StatTile index={3} icon={<AlertTriangle />} tone={recon.issues.length ? "warn" : "ok"} label={L("محتاج مراجعة", "Needs review")} value={recon.issues.length} sub={L(`${recon.matched} متطابقة`, `${recon.matched} matched`)} />
      </div>

      <Tabs
        label={L("المدفوعات", "Payments")}
        value={tab}
        onChange={setTab}
        items={[
          { value: "all", label: L("كل العمليات", "Transactions"), icon: <Wallet />, count: intents.length },
          { value: "settle", label: L("التسويات", "Settlements"), icon: <Landmark /> },
          { value: "recon", label: L("المطابقة", "Reconciliation"), icon: <ArrowLeftRight />, count: recon.issues.length || undefined },
        ]}
      />

      {tab === "all" ? (
        <Card className="overflow-hidden p-0">
          <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
            <Input wrapClassName="min-w-[220px] flex-1" icon={<Search className="size-4" />} placeholder={L("دوّر برقم، موبايل، ملاحظة…", "Search ref, phone, note…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={L("بحث", "Search")} />
            <Select
              aria-label={L("الحالة", "Status")}
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              options={[
                { value: "all", label: L("كل الحالات", "All statuses") },
                { value: "succeeded", label: STATUS.succeeded },
                { value: "pending", label: STATUS.requires_action },
                { value: "failed", label: L("فشل / انتهى", "Failed / expired") },
                { value: "refunded", label: L("فيها استرداد", "Refunded") },
              ]}
            />
            <Select aria-label={L("البوابة", "Provider")} value={provider} onChange={(e) => setProvider(e.target.value)} options={[{ value: "", label: L("كل البوابات", "All providers") }, ...[...new Set(intents.map((p) => p.provider))].map((p) => ({ value: p, label: PROVIDER_NAME[p] }))]} />
          </div>
          <Table
            caption={L("المدفوعات الأونلاين", "Online payments")}
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            loading={loading}
            onRowClick={setOpen}
            empty={<EmptyState compact icon={<Wallet />} title={L("مفيش عمليات", "No payments")} body={L("أول ما ضيف يدفع أونلاين أو تبعت لينك دفع هتظهر هنا", "Payments show up here as soon as a guest pays online or you send a pay link")} />}
          />
        </Card>
      ) : tab === "settle" ? (
        <SettlementsView batches={batches} onRecord={setPayoutFor} canRecord={can("accounting.post") || can("settings.edit")} />
      ) : (
        <ReconView
          recon={recon}
          kinds={KIND}
          onOpen={setOpen}
          onRecord={async (pi) => {
            if (repo.kind === "local") await recordIntentLocal(repo, pi.id, "succeeded", null, { repair: true }).catch(() => undefined);
          }}
          local={repo.kind === "local"}
        />
      )}

      <IntentSheet intent={open ? intents.find((p) => p.id === open.id) ?? open : null} onClose={() => setOpen(null)} kinds={KIND} statuses={STATUS} refunds={refunds.filter((r) => r.intentId === open?.id)} />
      <PayoutDialog batch={payoutFor} onClose={() => setPayoutFor(null)} />
      <p className="text-[12px] text-faint">
        {L("الرسوم اللي جنبها ≈ تقدير من ", "Fees marked ≈ are estimated from ")}
        <Link to="/settings/payments" className="underline">{L("إعدادات الدفع", "payment settings")}</Link>
        {L(" لحد ما البوابة تبعت الرسوم الفعلية.", " until the gateway reports the actual fee.")}
      </p>
    </div>
  );
}

/* ───────── detail + refund ───────── */

function IntentSheet({ intent, onClose, kinds, statuses, refunds }: { intent: PaymentIntentRow | null; onClose: () => void; kinds: Record<PaymentIntentKind, string>; statuses: Record<PaymentIntentStatus, string>; refunds: { id: string; amount: Units; reason: string; status: string; createdAt: string; providerRef: string | null }[] }) {
  const { L, lang, loc } = useT();
  const repo = useRepo();
  const session = useSession();
  const approve = useApproval();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const refundable = intent ? intent.amount + intent.tip - intent.refunded : 0;
  useEffect(() => {
    setAmount(intent ? unitsDecimal(intent.amount + intent.tip - intent.refunded) : "");
    setReason("");
  }, [intent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!intent) return <Dialog open={false} onClose={onClose} />;
  let units = 0;
  try {
    units = amount.trim() ? major(amount.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", ".")) : 0;
  } catch {
    units = 0;
  }
  const valid = units > 0 && units <= refundable && units % 1000 === 0 && reason.trim().length >= 3;

  const doRefund = async () => {
    const who = await approve({ kind: "refund" }, L(`استرداد ${formatMoney(units, { lang })} أونلاين`, `Online refund of ${formatMoney(units, { lang })}`));
    if (!who) return;
    setBusy(true);
    try {
      await refundIntent(repo, intent, units, reason.trim(), { requestedBy: session.staff?.id ?? null, approvedBy: who.id });
      toast({ title: L("الاسترداد اتعمل", "Refund sent"), description: L("الفلوس بترجع لكارت العميل خلال أيام حسب البنك. لو الشيك اتقفل، اعمل مرتجع من الطلبات عشان الإيصال.", "The bank returns it to the card within days. If the check was closed, also issue a return from Orders for the receipt."), tone: "success" });
    } catch (e) {
      toast({ title: L("الاسترداد ماتمّش", "Refund failed"), description: e instanceof PayApiError && e.text ? e.text[lang] : (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const f = (k: string, v: React.ReactNode) => (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-[14px] last:border-0">
      <span className="text-muted">{k}</span>
      <span className="min-w-0 text-end font-medium">{v}</span>
    </div>
  );
  return (
    <Dialog open={!!intent} onClose={onClose} variant="sheet-end" size="md" title={kinds[intent.kind]} description={<code dir="ltr" className="text-[12px]">{intent.id}</code>}>
      <div className="grid gap-5">
        <div className="flex items-end justify-between">
          <AnimatedMoney value={chargeOf(intent)} className="text-[34px] font-semibold" />
          <Badge tone={STATUS_TONE[intent.status]}>{statuses[intent.status]}</Badge>
        </div>
        <div>
          {f(L("البوابة", "Provider"), `${PROVIDER_NAME[intent.provider]} · ${intent.mode}`)}
          {f(L("الطريقة", "Method"), intent.method ? loc(METHOD_SHORT[intent.method]) : "—")}
          {f(L("الحساب / البقشيش", "Bill / tip"), `${formatMoney(intent.amount, { lang })} + ${formatMoney(intent.tip, { lang })}`)}
          {f(L("مرجع البوابة", "Provider ref"), <code dir="ltr">{intent.providerRef ?? "—"}</code>)}
          {intent.failureReason ? f(L("السبب", "Reason"), intent.failureReason) : null}
          {intent.customer ? f(L("العميل", "Customer"), `${intent.customer.name} ${intent.customer.phone}`) : null}
          {intent.note ? f(L("ملاحظة", "Note"), intent.note) : null}
          {f(L("اتعمل", "Created"), new Date(intent.createdAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB"))}
          {f(L("ينتهي", "Expires"), new Date(intent.expiresAt).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB"))}
          {intent.refunded ? f(L("مسترد", "Refunded"), <span className="text-danger">−{formatMoney(intent.refunded, { lang })}</span>) : null}
        </div>
        {refunds.length ? (
          <ul className="grid gap-1.5">
            {refunds.map((r) => (
              <li key={r.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-[13px]">
                <span>
                  <Undo2 className="me-1.5 inline size-4" />
                  {r.reason}
                </span>
                <span className="num font-semibold">−{formatMoney(r.amount, { lang })}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {intent.status === "succeeded" && refundable > 0 && session.can("payments.take") ? (
          <Card className="grid gap-3 p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Undo2 className="size-[18px] text-danger" />
              {L("استرداد للعميل", "Refund the guest")}
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Input label={L("المبلغ", "Amount")} inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} hint={L("أقصى ", "Max ") + formatMoney(refundable, { lang })} />
              <Input label={L("السبب", "Reason")} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={L("مثلاً: صنف ناقص", "e.g. missing item")} />
            </div>
            <Button variant="danger-soft" icon={<Undo2 className="size-4" />} disabled={!valid} loading={busy} onClick={doRefund}>
              {L("استرد (محتاج PIN مدير)", "Refund (manager PIN)")}
            </Button>
          </Card>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ───────── settlements ───────── */

function SettlementsView({ batches, onRecord, canRecord }: { batches: Settlement[]; onRecord: (b: Settlement) => void; canRecord: boolean }) {
  const { L, lang } = useT();
  const money = (u: Units) => formatMoney(u, { lang });
  const columns: Column<Settlement>[] = [
    { key: "day", header: L("يوم الدفع", "Payment day"), cell: (b) => <span className="num font-semibold">{b.day}</span> },
    { key: "provider", header: L("البوابة", "Provider"), cell: (b) => PROVIDER_NAME[b.provider as PayProviderId] },
    { key: "count", header: L("عمليات", "Payments"), align: "end", hideOnMobile: true, cell: (b) => <span className="num">{b.count}</span> },
    { key: "gross", header: L("الإجمالي", "Gross"), align: "end", cell: (b) => <span className="num">{money(b.gross)}</span> },
    { key: "fees", header: L("الرسوم", "Fees"), align: "end", hideOnMobile: true, cell: (b) => <span className={cn("num", b.feesEstimated && "text-muted")}>{b.feesEstimated ? "≈ " : ""}−{money(b.fees)}</span> },
    { key: "refunds", header: L("استرداد", "Refunds"), align: "end", hideOnMobile: true, cell: (b) => (b.refunds ? <span className="num text-danger">−{money(b.refunds)}</span> : "—") },
    { key: "net", header: L("الصافي", "Net"), align: "end", cell: (b) => <span className="num font-semibold">{money(b.net)}</span> },
    {
      key: "payout", header: L("التحويل", "Payout"), align: "end",
      cell: (b) => b.payout ? (
        <Badge tone="ok" icon={<CheckCircle2 />}>{b.payout.reference}</Badge>
      ) : canRecord ? (
        <Button size="sm" variant="secondary" onClick={(e) => (e.stopPropagation(), onRecord(b))}>{L(`متوقع ${b.expected}`, `Expected ${b.expected}`)}</Button>
      ) : (
        <Badge tone="info">{L(`متوقع ${b.expected}`, `Expected ${b.expected}`)}</Badge>
      ),
    },
  ];
  return (
    <Card className="overflow-hidden p-0">
      <p className="border-b border-line px-4 py-3 text-[13px] text-muted">{L("البوابة بتحوّل الصافي للبنك بعد كام يوم (T+n من الإعدادات). سجّل التحويل لما يوصل عشان نطابقه.", "Gateways pay the net to your bank after a few days (T+n in settings). Record each payout when it lands so it is matched.")}</p>
      <Table caption={L("التسويات", "Settlements")} columns={columns} rows={batches} rowKey={(b) => `${b.provider}|${b.day}|${b.payout?.id ?? ""}`} empty={<EmptyState compact icon={<Landmark />} title={L("مفيش تسويات لسه", "No settlements yet")} />} />
    </Card>
  );
}

function PayoutDialog({ batch, onClose }: { batch: Settlement | null; onClose: () => void }) {
  const { L, lang } = useT();
  const repo = useRepo();
  const { toast } = useToast();
  const session = useSession();
  const [ref, setRef] = useState("");
  const [net, setNet] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRef("");
    setNet(batch ? unitsDecimal(batch.net) : "");
  }, [batch]);
  if (!batch) return <Dialog open={false} onClose={onClose} />;
  let received = 0;
  try {
    received = net.trim() ? major(net.trim()) : 0;
  } catch {
    received = 0;
  }
  const diff = received - batch.net;
  const save = async () => {
    const rid = session.restaurant?.id;
    if (!rid) return;
    setBusy(true);
    try {
      const row: Omit<PaymentPayout, "id" | "createdAt" | "updatedAt"> = { restaurantId: rid, provider: batch.provider, periodStart: batch.day, periodEnd: batch.day, gross: batch.gross, fees: batch.gross - batch.refunds - received, net: received, reference: ref.trim(), paidAt: new Date().toISOString(), note: diff ? `diff ${unitsDecimal(diff)}` : "" };
      const p = await repo.insert("paymentPayouts", row);
      if (repo.kind === "local") for (const id of batch.intentIds) await repo.update("paymentIntents", id, { payoutId: p.id });
      else {
        const client = (repo as unknown as { client?: { rpc(fn: string, a: Record<string, unknown>): Promise<unknown> } }).client;
        await client?.rpc("pay_assign_payout", { p_payout_id: p.id, p_intent_ids: batch.intentIds });
      }
      toast({ title: L("التحويل اتسجل", "Payout recorded"), tone: "success" });
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!batch} onClose={onClose} size="sm" title={L("تسجيل تحويل من البوابة", "Record a gateway payout")} description={`${PROVIDER_NAME[batch.provider as PayProviderId]} · ${batch.day}`}>
      <div className="grid gap-3">
        <Input label={L("رقم التحويل / المرجع", "Transfer reference")} value={ref} onChange={(e) => setRef(e.target.value)} dir="ltr" />
        <Input label={L("المبلغ اللي وصل البنك", "Amount received")} value={net} onChange={(e) => setNet(e.target.value)} inputMode="decimal" dir="ltr" hint={L("المتوقع ", "Expected ") + formatMoney(batch.net, { lang })} />
        {received && diff ? <Badge tone="warn">{L("فرق ", "Difference ")}{formatMoney(diff, { lang })}</Badge> : null}
        <Button block loading={busy} disabled={!ref.trim() || received <= 0} onClick={save}>
          {L("سجّل", "Record")}
        </Button>
      </div>
    </Dialog>
  );
}

/* ───────── reconciliation ───────── */

function ReconView({ recon, kinds, onOpen, onRecord, local }: { recon: ReturnType<typeof reconcile>; kinds: Record<PaymentIntentKind, string>; onOpen: (p: PaymentIntentRow) => void; onRecord: (p: PaymentIntentRow) => Promise<void>; local: boolean }) {
  const { L, lang } = useT();
  const navigate = useNavigate();
  const TITLE: Record<ReconIssue, { t: string; b: string; tone: Tone }> = {
    paid_not_recorded: { t: L("اتدفع عند البوابة ومش متسجل في الكاشير", "Paid at the gateway, missing in the POS"), b: L("غالبًا الشيك اتقفل كاش قبل ما الدفع الأونلاين يوصل — راجع مع الكاشير واعمل استرداد لو اتدفع مرتين.", "Usually the check was closed in cash before the online payment landed — check with the cashier and refund if paid twice."), tone: "danger" },
    tender_without_gateway: { t: L("دفع \"أونلاين\" في الكاشير من غير عملية بوابة", "\"Online\" tender with no gateway payment"), b: L("حد سجّل دفع أونلاين يدوي — اتأكد من رقم العملية في لوحة البوابة.", "Someone typed an online tender by hand — confirm the transaction in the gateway dashboard."), tone: "warn" },
    amount_mismatch: { t: L("المبلغ مختلف", "Amounts differ"), b: L("المبلغ عند البوابة غير المسجل في الكاشير.", "The gateway amount differs from the POS tender."), tone: "warn" },
    check_left_open: { t: L("اتدفع بالكامل والشيك لسه مفتوح", "Fully paid online, check still open"), b: L("اقفل الشيك من الكاشير عشان الإيصال والضريبة.", "Close the check in the POS to issue the receipt and e-receipt."), tone: "info" },
  };
  if (!recon.issues.length)
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 />} title={L("كله متطابق 👌", "Everything matches 👌")} body={L(`${recon.matched} عملية أونلاين متطابقة مع الكاشير`, `${recon.matched} online payments match the POS`)} />
      </Card>
    );
  return (
    <div className="grid gap-3">
      {recon.issues.map((r, i) => {
        const c = TITLE[r.issue];
        return (
          <Card key={i} className="flex flex-wrap items-center gap-4 p-4">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", c.tone === "danger" ? "bg-danger-soft text-danger" : c.tone === "warn" ? "bg-warn-soft text-warn" : "bg-info-soft text-info")}>
              <AlertTriangle className="size-5" />
            </span>
            <div className="min-w-[220px] flex-1">
              <p className="font-semibold">{c.t}</p>
              <p className="text-[13px] text-muted">{c.b}</p>
              <p className="num mt-1 text-[12.5px] text-muted">
                {r.intent ? `${kinds[r.intent.kind]} · ${r.intent.providerRef ?? r.intent.id}` : `POS · ${r.payment?.reference ?? r.payment?.id.slice(0, 8)}`}
                {r.check?.receiptNo ? ` · ${r.check.receiptNo}` : ""}
              </p>
            </div>
            <span className="num text-[16px] font-semibold">{formatMoney(r.intent?.amount ?? r.payment?.amount ?? 0, { lang })}</span>
            <div className="flex gap-2">
              {r.intent ? (
                <Button size="sm" variant="secondary" onClick={() => onOpen(r.intent!)}>
                  {L("التفاصيل", "Details")}
                </Button>
              ) : null}
              {r.issue === "paid_not_recorded" && local && r.check && r.check.status !== "paid" ? (
                <Button size="sm" onClick={() => void onRecord(r.intent!)}>
                  {L("سجّله على الشيك", "Record on check")}
                </Button>
              ) : null}
              {r.issue === "check_left_open" ? (
                <Button size="sm" onClick={() => navigate("/pos")}>
                  {L("افتح الكاشير", "Open POS")}
                </Button>
              ) : null}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
