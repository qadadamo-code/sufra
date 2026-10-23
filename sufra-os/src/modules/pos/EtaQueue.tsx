/**
 * ETA e-receipt queue: every issued receipt, its chain link and submission status, with the 24-hour deadline triage
 * from sufra-finance (`triage`). Submitting needs the POS client id/secret, which live only in a server function —
 * the button stays disabled (and says why) until that is set up. See README → "ETA submission".
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, FileJson, Link2, ReceiptText, Send, ShieldCheck, ShieldQuestion } from "lucide-react";
import { triage, type QueuedReceipt } from "@finance/eta-client";
import { useLive } from "@/data/hooks";
import type { EtaStatus, Receipt } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney, toAmount } from "@/lib/money";
import { ago, clock } from "@/lib/time";
import { etaReadiness, etaSettingsOf, submissionDeadline, verifyEtaUuid } from "@/lib/receipt/eta";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Segmented, StatTile, Table, useToast, type Tone } from "@/ui";

const TONE: Record<EtaStatus, Tone> = { not_required: "neutral", pending: "warn", submitted: "info", valid: "ok", invalid: "danger", late: "danger" };
export const ETA_LABEL: Record<EtaStatus, { ar: string; en: string }> = {
  not_required: { ar: "مش مطلوب", en: "Not required" },
  pending: { ar: "مستني الإرسال", en: "Pending" },
  submitted: { ar: "اتبعت", en: "Submitted" },
  valid: { ar: "مقبول", en: "Valid" },
  invalid: { ar: "مرفوض", en: "Rejected" },
  late: { ar: "متأخر", en: "Late" },
};

export default function EtaQueue() {
  const { L, lang } = useT();
  const { toast } = useToast();
  const settings = useLive("settings").data[0] ?? null;
  const receipts = useLive("receipts", { orderBy: [{ field: "issuedAt", dir: "desc" }], limit: 300 }).data;
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [json, setJson] = useState<Receipt | null>(null);
  const eta = etaSettingsOf(settings);
  const ready = etaReadiness(settings);
  const now = Date.now();

  const queue: QueuedReceipt[] = useMemo(
    () =>
      receipts
        .filter((r) => r.etaUuid)
        .map((r) => ({
          receipt: { uuid: r.etaUuid!, json: r.etaJson ?? "", totalAmount: toAmount(r.bill.payable), qr: r.etaQr ?? "", receiptNumber: r.receiptNo, issuedAt: r.issuedAt },
          status: r.etaStatus === "valid" ? "valid" : r.etaStatus === "invalid" ? "invalid" : r.etaStatus === "submitted" ? "submitted" : "pending",
        })),
    [receipts],
  );
  const t = useMemo(() => triage(queue, now), [queue, now]);
  const overdue = new Set(t.overdue);
  const dueSoon = new Set(t.dueSoon);
  const shown = filter === "open" ? receipts.filter((r) => r.etaStatus === "pending" || r.etaStatus === "invalid" || r.etaStatus === "late") : receipts;
  const count = (s: EtaStatus) => receipts.filter((r) => r.etaStatus === s).length;

  const verify = async (r: Receipt) => {
    if (!r.etaJson) return;
    const v = await verifyEtaUuid(r.etaJson);
    toast({ title: v.matches ? L("الـ UUID سليم", "UUID verified") : L("الـ UUID مش مطابق!", "UUID mismatch!"), description: v.uuid, tone: v.matches ? "success" : "error" });
  };

  const MISSING: Record<string, string> = {
    rin: L("رقم التسجيل الضريبي (RIN)", "Tax registration number (RIN)"),
    activity: L("كود النشاط", "Activity code"),
    serial: L("سيريال جهاز الـ POS المسجل", "Registered POS serial"),
    tradeName: L("الاسم التجاري", "Trade name"),
    address: L("عنوان الفرع", "Branch address"),
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        icon={<ReceiptText />}
        kicker={
          <Link to="/pos" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3.5 flip-rtl" /> {L("الكاشير", "POS")}
          </Link>
        }
        title={L("الإيصالات الإلكترونية", "ETA e-receipts")}
        subtitle={L(`مصلحة الضرائب · ${eta.environment === "prod" ? "إنتاج" : "تجريبي (preprod)"}`, `Egyptian Tax Authority · ${eta.environment === "prod" ? "production" : "pre-production"}`)}
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button icon={<Send className="size-4 flip-rtl" />} disabled title={L("الإرسال من السيرفر بس", "Submission runs server-side")}>
              {L("ابعت لمصلحة الضرائب", "Submit to ETA")} ({count("pending")})
            </Button>
            <span className="max-w-72 text-end text-[12px] text-muted">
              {eta.credentialsConfigured
                ? L("الإرسال بيتم من دالة السيرفر (api/eta-submit) كل دقيقة.", "Submission runs in the server function (api/eta-submit) every minute.")
                : L("محتاج client id/secret للجهاز في دالة على السيرفر — مش بيتحطوا في المتصفح أبدًا.", "Needs the POS client id/secret in a server function — never in the browser.")}
            </span>
          </div>
        }
      />

      {!ready.ok ? (
        <Card className="border-warn/40 bg-warn-soft/50 p-4">
          <p className="flex items-center gap-2 font-semibold text-warn">
            <AlertTriangle className="size-5" /> {L("قبل التشغيل الفعلي، كمّل في إعدادات الضرايب:", "Before going live, complete in Tax settings:")}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {ready.missing.map((m) => (
              <li key={m}>
                <Badge tone="warn">{MISSING[m]}</Badge>
              </li>
            ))}
          </ul>
          <Link to="/settings/tax" className="mt-3 inline-block text-[14px] font-semibold text-primary hover:underline">
            {L("افتح إعدادات الضرايب ←", "Open Tax settings →")}
          </Link>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} tone="warn" icon={<Clock />} label={L("مستني الإرسال", "Pending")} value={count("pending")} sub={t.dueSoon.length ? L(`${t.dueSoon.length} قرب الميعاد`, `${t.dueSoon.length} due within 3h`) : L("خلال ٢٤ ساعة", "within 24h")} />
        <StatTile index={1} tone="danger" icon={<AlertTriangle />} label={L("فات الميعاد", "Overdue (24h)")} value={t.overdue.length} sub={t.tooOldForLateRequest.length ? L(`${t.tooOldForLateRequest.length} أقدم من ٣٠ يوم`, `${t.tooOldForLateRequest.length} older than 30 days`) : L("محتاج طلب إرسال متأخر", "needs a late-submission request")} />
        <StatTile index={2} tone="ok" icon={<CheckCircle2 />} label={L("مقبول", "Valid")} value={count("valid")} />
        <StatTile index={3} tone="danger" icon={<ShieldQuestion />} label={L("مرفوض / ماتعملش", "Rejected / not issued")} value={count("invalid")} />
      </div>

      <Card>
        <CardHeader
          title={L("الطابور", "Queue")}
          subtitle={L("كل إيصال مربوط باللي قبله على نفس الجهاز (previousUUID)", "Each receipt is chained to the previous one on its device (previousUUID)")}
          action={<Segmented size="sm" label={L("فلتر", "Filter")} value={filter} onChange={setFilter} options={[{ value: "open", label: L("محتاج متابعة", "Needs action") }, { value: "all", label: L("الكل", "All") }]} />}
        />
        {shown.length ? (
          <Table
            rows={shown}
            rowKey={(r) => r.id}
            columns={[
              { key: "no", header: L("الإيصال", "Receipt"), cell: (r) => <span className="num font-semibold">{r.receiptNo}</span> },
              { key: "kind", header: L("النوع", "Type"), cell: (r) => <Badge tone={r.kind === "RC" ? "brass" : "neutral"} size="sm">{r.kind === "RC" ? L("مرتجع", "Return") : L("بيع", "Sale")}</Badge> },
              { key: "at", header: L("الوقت", "Issued"), cell: (r) => <span className="num text-[13px]">{clock(r.issuedAt, lang)}</span>, hideOnMobile: true },
              { key: "total", header: L("القيمة", "Total"), align: "end", cell: (r) => <span className="num">{formatMoney(r.kind === "RC" ? -r.bill.payable : r.bill.payable, { lang })}</span> },
              {
                key: "status",
                header: L("الحالة", "Status"),
                cell: (r) => {
                  const late = overdue.has(r.receiptNo);
                  return (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={late ? "danger" : TONE[r.etaStatus]} size="sm" dot pulse={dueSoon.has(r.receiptNo)}>
                        {late ? ETA_LABEL.late[lang] : ETA_LABEL[r.etaStatus][lang]}
                      </Badge>
                      {r.etaStatus === "pending" && !late ? <span className="text-[12px] text-muted">{L("لحد", "by")} {clock(submissionDeadline(r.issuedAt).toISOString(), lang)}</span> : null}
                      {r.etaErrors.length ? <span className="max-w-64 truncate text-[12px] text-danger" title={r.etaErrors.join("\n")}>{r.etaErrors[0]}</span> : null}
                    </span>
                  );
                },
              },
              {
                key: "uuid",
                header: "UUID",
                hideOnMobile: true,
                cell: (r) =>
                  r.etaUuid ? (
                    <span className="flex items-center gap-1 text-[12px] text-muted">
                      <Link2 className={cn("size-3.5", r.etaPreviousUuid ? "text-primary" : "text-faint")} aria-label={r.etaPreviousUuid ? L("مربوط", "chained") : L("أول إيصال", "first in chain")} />
                      <span className="num">{r.etaUuid.slice(0, 10)}…</span>
                    </span>
                  ) : (
                    "—"
                  ),
              },
              {
                key: "act",
                header: "",
                align: "end",
                cell: (r) =>
                  r.etaJson ? (
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" icon={<ShieldCheck className="size-4" />} onClick={() => void verify(r)}>
                        {L("تحقق", "Verify")}
                      </Button>
                      <Button size="sm" variant="ghost" icon={<FileJson className="size-4" />} onClick={() => setJson(r)}>
                        JSON
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        ) : (
          <EmptyState compact icon={<CheckCircle2 />} title={filter === "open" ? L("مفيش حاجة مستنية", "Nothing waiting") : L("مفيش إيصالات لسه", "No receipts yet")} body={L("كل شيك بيتقفل بيطلع إيصال إلكتروني هنا.", "Every closed check issues an e-receipt here.")} />
        )}
      </Card>
      <p className="text-[12.5px] text-muted">
        {L("آخر تحديث", "Updated")} {ago(new Date(now).toISOString(), lang)} · {L("الإيصالات بتتطبع فورًا وتتبعت أول ما يبقى في إنترنت (أوفلاين أولًا).", "Receipts print immediately and upload when online (offline-first).")}
      </p>

      <Dialog open={!!json} onClose={() => setJson(null)} size="xl" title={json?.receiptNo} description={json?.etaUuid ?? undefined}>
        <pre className="num max-h-[60dvh] overflow-auto rounded-2xl bg-surface-3 p-4 text-[12px] leading-relaxed thin-scrollbar" dir="ltr">
          {json?.etaJson ? JSON.stringify(JSON.parse(json.etaJson), null, 2) : ""}
        </pre>
      </Dialog>
    </div>
  );
}
