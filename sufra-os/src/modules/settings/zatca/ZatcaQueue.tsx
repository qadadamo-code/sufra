/**
 * ZATCA queue (/pos/zatca): every KSA document with its EGS chain link, status (pending · awaiting stamp · reported ·
 * cleared · warnings · rejected · demo) and the 24-hour reporting deadline for simplified documents. Retry/submit goes
 * through the server functions (keys in Vault); XML view, QR decode and a local re-verification of hash/signature/QR.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, FileCode2, FlaskConical, Link2, QrCode, RefreshCw, ShieldCheck, ShieldQuestion, Stamp } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/money";
import { ago, clock } from "@/lib/time";
import { qrMatrix } from "@/lib/receipt/qr";
import { reportingTriage } from "@/lib/zatca/api";
import { brokenLink } from "@/lib/zatca/chain";
import { zatcaFetch, ZatcaApiError } from "@/lib/zatca/client";
import type { ZatcaInvoiceRow, ZatcaInvoiceStatus } from "@/lib/zatca/model";
import { zatcaReadiness, zatcaSettingsOf } from "@/lib/zatca/settings";
import { verifyInvoiceXml, type VerifyReport } from "@/lib/zatca/sign";
import { decodeQr } from "@/lib/zatca/tlv";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, CardHeader, Dialog, EmptyState, Segmented, StatTile, Table, useToast, type Tone } from "@/ui";

const TONE: Record<ZatcaInvoiceStatus | "overdue", Tone> = { pending: "warn", unsigned: "warn", reported: "ok", cleared: "ok", warning: "brass", rejected: "danger", demo: "info", overdue: "danger" };
export const ZATCA_LABEL: Record<ZatcaInvoiceStatus | "overdue", { ar: string; en: string }> = {
  pending: { ar: "مستني الإرسال", en: "Pending" },
  unsigned: { ar: "مستني الختم", en: "Awaiting stamp" },
  reported: { ar: "تم الإبلاغ", en: "Reported" },
  cleared: { ar: "تم الاعتماد", en: "Cleared" },
  warning: { ar: "مقبول بتحذيرات", en: "Accepted with warnings" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  demo: { ar: "تجريبي — مش متبعت", en: "Demo — not sent" },
  overdue: { ar: "فات ميعاد الـ ٢٤ ساعة", en: "Past 24 h" },
};
const DOC: Record<string, { ar: string; en: string }> = {
  "simplified:invoice": { ar: "مبسطة", en: "Simplified" },
  "standard:invoice": { ar: "ضريبية (B2B)", en: "Standard (B2B)" },
  "simplified:credit": { ar: "إشعار دائن مبسط", en: "Simplified credit" },
  "standard:credit": { ar: "إشعار دائن", en: "Credit note" },
  "simplified:debit": { ar: "إشعار مدين مبسط", en: "Simplified debit" },
  "standard:debit": { ar: "إشعار مدين", en: "Debit note" },
};
const OPEN: ZatcaInvoiceStatus[] = ["pending", "unsigned", "warning", "rejected"];

export default function ZatcaQueue() {
  const { L, lang } = useT();
  const { toast } = useToast();
  const db = useDb();
  const settings = useLive("settings").data[0] ?? null;
  const units = useLive("zatcaEgsUnits").data;
  const docs = useLive("zatcaInvoices", { orderBy: [{ field: "issuedAt", dir: "desc" }], limit: 500 }).data;
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [xml, setXml] = useState<ZatcaInvoiceRow | null>(null);
  const [qr, setQr] = useState<ZatcaInvoiceRow | null>(null);
  const [check, setCheck] = useState<{ doc: ZatcaInvoiceRow; report: VerifyReport | null; error?: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const z = zatcaSettingsOf(settings);
  const ready = zatcaReadiness(settings, units);
  const now = Date.now();

  const triage = (d: ZatcaInvoiceRow) => (d.kind === "simplified" && (d.status === "pending" || d.status === "unsigned") ? reportingTriage(d.issuedAt, now) : null);
  const overdue = docs.filter((d) => triage(d)?.level === "overdue");
  const soon = docs.filter((d) => ["urgent", "soon"].includes(triage(d)?.level ?? ""));
  const shown = filter === "open" ? docs.filter((d) => OPEN.includes(d.status)) : docs;
  const count = (...s: ZatcaInvoiceStatus[]) => docs.filter((d) => s.includes(d.status)).length;
  const broken = useMemo(() => {
    const out = new Map<string, number>();
    for (const u of units) {
      const b = brokenLink(docs.filter((d) => d.egsId === u.id));
      if (b !== null) out.set(u.id, b);
    }
    return out;
  }, [docs, units]);

  const submit = async (d: ZatcaInvoiceRow) => {
    if (d.status === "demo") {
      const r = verifyInvoiceXml(d.xml);
      setCheck({ doc: d, report: r });
      toast({ title: L("وضع تجريبي: اتراجع محليًا ومتبعتش لهيئة الزكاة", "Demo: verified locally, not sent to ZATCA"), tone: r.ok ? "success" : "error" });
      return;
    }
    setBusy(d.id);
    try {
      const fn = d.kind === "standard" ? "zatca-clear" : "zatca-report";
      const r = await zatcaFetch<{ outcome?: string; results?: { outcome: string }[] }>(fn, { restaurantId: d.restaurantId, invoiceId: d.id });
      const outcome = r.outcome ?? r.results?.[0]?.outcome ?? "?";
      toast({ title: L(`نتيجة الإرسال: ${outcome}`, `Result: ${outcome}`), tone: outcome === "rejected" ? "error" : "success" });
    } catch (e) {
      const err = e as ZatcaApiError;
      toast({
        title: err.status === 501 ? L("الإرسال لهيئة الزكاة مش متظبط على السيرفر", "ZATCA submission isn't configured on the server") : L("ماقدرناش نوصل لدالة السيرفر", "Couldn't reach the server function"),
        description: err.detail ?? err.code,
        tone: "warn",
      });
    } finally {
      setBusy(null);
    }
  };

  const verify = (d: ZatcaInvoiceRow) => {
    try {
      setCheck({ doc: d, report: verifyInvoiceXml(d.clearedXml ? new TextDecoder().decode(Uint8Array.from(atob(d.clearedXml), (c) => c.charCodeAt(0))) : d.xml) });
    } catch (e) {
      setCheck({ doc: d, report: null, error: String((e as Error).message ?? e) });
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        icon={<Stamp />}
        kicker={
          <Link to="/pos" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3.5 flip-rtl" /> {L("الكاشير", "POS")}
          </Link>
        }
        title={L("الفواتير الإلكترونية — هيئة الزكاة", "ZATCA e-invoices")}
        subtitle={L(`فاتورة (المرحلة الثانية) · ${z.environment === "production" ? "إنتاج" : z.environment === "simulation" ? "محاكاة" : "بيئة المطورين (sandbox)"}`, `FATOORA Phase 2 · ${z.environment}`)}
        actions={
          <div className="flex flex-col items-end gap-1">
            {z.keyCustody === "demo_browser" ? (
              <Badge tone="info" icon={<FlaskConical className="size-3.5" />}>
                {L("وضع تجريبي — المفتاح على الجهاز", "Demo mode — key on this device")}
              </Badge>
            ) : null}
            <span className="max-w-80 text-end text-[12px] text-muted">
              {L("الفواتير المبسطة لازم تتبلّغ خلال ٢٤ ساعة؛ الضريبية (B2B) لازم تتعتمد قبل ما تتسلم للمشتري.", "Simplified invoices must be reported within 24 h; standard (B2B) invoices must be cleared before they reach the buyer.")}
            </span>
          </div>
        }
      />

      {!ready.ok ? (
        <Card className="border-warn/40 bg-warn-soft/50 p-4">
          <p className="flex items-center gap-2 font-semibold text-warn">
            <AlertTriangle className="size-5" /> {L("لسه مش جاهز للتشغيل الفعلي:", "Not production-ready yet:")}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {ready.items.filter((i) => !i.ok).map((i) => (
              <li key={i.id}>
                <Badge tone="warn">{i.label[lang]}</Badge>
              </li>
            ))}
          </ul>
          <Link to="/settings/zatca" className="mt-3 inline-block text-[14px] font-semibold text-primary hover:underline">
            {L("افتح إعدادات هيئة الزكاة ←", "Open ZATCA settings →")}
          </Link>
        </Card>
      ) : null}
      {broken.size ? (
        <Card className="border-danger/40 bg-danger-soft/40 p-4 text-danger">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="size-5" /> {L("سلسلة الفواتير مقطوعة (ICV/PIH) على جهاز — راجع الدعم قبل إصدار فواتير تانية.", "Invoice chain (ICV/PIH) broken on a device — contact support before issuing more.")}
          </p>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} tone="warn" icon={<Clock />} label={L("مستني الإرسال / الختم", "Pending / awaiting stamp")} value={count("pending", "unsigned")} sub={soon.length ? L(`${soon.length} قرب الميعاد`, `${soon.length} due soon`) : count("demo") ? L(`+ ${count("demo")} تجريبي مش هيتبعت`, `+ ${count("demo")} demo, never sent`) : L("خلال ٢٤ ساعة", "within 24 h")} />
        <StatTile index={1} tone="danger" icon={<AlertTriangle />} label={L("فات الميعاد", "Overdue (24 h)")} value={overdue.length} sub={L("ابلّغ فورًا", "report now")} />
        <StatTile index={2} tone="ok" icon={<CheckCircle2 />} label={L("تم الإبلاغ / الاعتماد", "Reported / cleared")} value={count("reported", "cleared")} sub={count("warning") ? L(`${count("warning")} بتحذيرات`, `${count("warning")} with warnings`) : undefined} />
        <StatTile index={3} tone="danger" icon={<ShieldQuestion />} label={L("مرفوض", "Rejected")} value={count("rejected")} sub={L("صلّح وأصدر مستند جديد", "fix and issue a new document")} />
      </div>

      <Card>
        <CardHeader
          title={L("الطابور", "Queue")}
          subtitle={L("كل فاتورة بتاخد رقم عداد (ICV) وهاش الفاتورة اللي قبلها (PIH) على نفس الجهاز", "Every document carries a counter (ICV) and the previous document's hash (PIH) per device")}
          action={<Segmented size="sm" label={L("فلتر", "Filter")} value={filter} onChange={setFilter} options={[{ value: "open", label: L("محتاج متابعة", "Needs action") }, { value: "all", label: L("الكل", "All") }]} />}
        />
        {shown.length ? (
          <Table
            rows={shown}
            rowKey={(d) => d.id}
            columns={[
              { key: "no", header: L("الفاتورة", "Invoice"), cell: (d) => <span className="num font-semibold">{d.invoiceNo}</span> },
              { key: "type", header: L("النوع", "Type"), cell: (d) => <Badge tone={d.docType === "invoice" ? (d.kind === "standard" ? "primary" : "neutral") : "brass"} size="sm">{DOC[`${d.kind}:${d.docType}`][lang]}</Badge> },
              {
                key: "icv",
                header: "ICV",
                hideOnMobile: true,
                cell: (d) => (
                  <span className="flex items-center gap-1 text-[12.5px] text-muted">
                    <Link2 className={cn("size-3.5", d.icv > 1 ? "text-primary" : "text-faint")} />
                    <span className="num">
                      {d.device} · {d.icv}
                    </span>
                  </span>
                ),
              },
              { key: "at", header: L("الوقت", "Issued"), hideOnMobile: true, cell: (d) => <span className="num text-[13px]">{clock(d.issuedAt, lang)}</span> },
              { key: "total", header: L("الإجمالي", "Total"), align: "end", cell: (d) => <span className="num">{formatMoney(d.docType === "credit" ? -d.total : d.total, { lang, currency: "SAR" })}</span> },
              {
                key: "status",
                header: L("الحالة", "Status"),
                cell: (d) => {
                  const t = triage(d);
                  const late = t?.level === "overdue";
                  return (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={late ? "danger" : TONE[d.status]} size="sm" dot pulse={t?.level === "urgent"}>
                        {late ? ZATCA_LABEL.overdue[lang] : ZATCA_LABEL[d.status][lang]}
                      </Badge>
                      {t && !late ? <span className="text-[12px] text-muted">{L("لحد", "by")} {clock(t.deadline, lang)}</span> : null}
                      {d.errors.length ? <span className="max-w-64 truncate text-[12px] text-danger" title={d.errors.join("\n")}>{d.errors[0]}</span> : null}
                      {!d.errors.length && d.warnings.filter((w) => w !== "awaiting-stamp").length ? <span className="max-w-64 truncate text-[12px] text-brass-text" title={d.warnings.join("\n")}>{d.warnings[0]}</span> : null}
                    </span>
                  );
                },
              },
              {
                key: "act",
                header: "",
                align: "end",
                cell: (d) => (
                  <span className="flex justify-end gap-1">
                    {OPEN.includes(d.status) || d.status === "demo" ? (
                      <Button size="sm" variant={d.status === "rejected" ? "ghost" : "secondary"} loading={busy === d.id} icon={<RefreshCw className="size-4" />} onClick={() => void submit(d)}>
                        {d.status === "demo" ? L("تحقق", "Check") : d.status === "rejected" || d.status === "warning" ? L("أعد", "Retry") : d.kind === "standard" ? L("اعتمد", "Clear") : L("بلّغ", "Report")}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" icon={<ShieldCheck className="size-4" />} onClick={() => verify(d)} aria-label={L("تحقق من التوقيع", "Verify signature")} />
                    <Button size="sm" variant="ghost" icon={<QrCode className="size-4" />} onClick={() => setQr(d)} aria-label="QR" />
                    <Button size="sm" variant="ghost" icon={<FileCode2 className="size-4" />} onClick={() => setXml(d)}>
                      XML
                    </Button>
                  </span>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState compact icon={<CheckCircle2 />} title={filter === "open" ? L("مفيش حاجة مستنية", "Nothing waiting") : L("مفيش فواتير لسه", "No invoices yet")} body={L("كل شيك بيتقفل في فرع سعودي بيطلع فاتورة هنا.", "Every check closed at a Saudi outlet issues an invoice here.")} />
        )}
      </Card>
      <p className="text-[12.5px] text-muted">
        {L("آخر تحديث", "Updated")} {ago(new Date(now).toISOString(), lang)} · {L("الفاتورة بتتطبع فورًا وبتتربط بالسلسلة حتى من غير إنترنت؛ الإبلاغ بيتم من السيرفر.", "Invoices print and chain immediately, even offline; reporting runs on the server.")}{" "}
        {db.repo.kind === "local" ? L("(وضع العرض: مفيش سيرفر)", "(demo backend: no server)") : null}
      </p>

      <Dialog open={!!xml} onClose={() => setXml(null)} size="xl" title={xml?.invoiceNo} description={xml ? `UUID ${xml.uuid} · ICV ${xml.icv}` : undefined}>
        <pre className="num max-h-[60dvh] overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-surface-3 p-4 text-[11.5px] leading-relaxed thin-scrollbar" dir="ltr">
          {xml ? prettyXml(xml.xml) : ""}
        </pre>
      </Dialog>
      <QrDialog doc={qr} onClose={() => setQr(null)} />
      <Dialog open={!!check} onClose={() => setCheck(null)} size="md" title={L("تحقق محلي", "Local verification")} description={check?.doc.invoiceNo}>
        {check?.error ? <p className="text-danger">{check.error}</p> : null}
        {check?.report ? (
          <ul className="grid gap-1.5 text-[14px]">
            {check.report.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 text-ok" /> : <AlertTriangle className="mt-0.5 size-4 text-danger" />}
                <span>
                  <span className="font-semibold">{CHECK_LABEL[c.id]?.[lang] ?? c.id}</span>
                  {c.detail ? <span className="block text-[12.5px] text-muted">{c.detail}</span> : null}
                </span>
              </li>
            ))}
            <li className="num mt-2 break-all text-[12px] text-muted" dir="ltr">
              hash {check.report.hash}
            </li>
          </ul>
        ) : null}
        <p className="mt-3 text-[12.5px] text-muted">{L("ده تحقق من الهاش والتوقيع والـ QR بس — الاعتماد الرسمي من مدقق هيئة الزكاة.", "Checks hash, signature and QR only — ZATCA's validator is the authority.")}</p>
      </Dialog>
    </div>
  );
}

const CHECK_LABEL: Record<string, { ar: string; en: string }> = {
  digest: { ar: "هاش الفاتورة مطابق", en: "Invoice hash matches" },
  signature: { ar: "التوقيع (ECDSA) سليم", en: "ECDSA signature valid" },
  signedProperties: { ar: "الخصائص الموقعة سليمة", en: "Signed properties digest" },
  certDigest: { ar: "بصمة الشهادة", en: "Certificate digest" },
  qrHash: { ar: "الـ QR فيه نفس الهاش", en: "QR carries the hash" },
  qrSignature: { ar: "الـ QR فيه نفس التوقيع", en: "QR carries the signature" },
  qrPublicKey: { ar: "الـ QR فيه المفتاح العام", en: "QR carries the public key" },
  signed: { ar: "مختوم", en: "Stamped" },
  certificate: { ar: "الشهادة", en: "Certificate" },
  qr: { ar: "QR", en: "QR" },
};

const TAG: Record<number, { ar: string; en: string }> = {
  1: { ar: "اسم البائع", en: "Seller name" },
  2: { ar: "الرقم الضريبي", en: "VAT number" },
  3: { ar: "الوقت", en: "Timestamp" },
  4: { ar: "الإجمالي شامل الضريبة", en: "Total with VAT" },
  5: { ar: "الضريبة", en: "VAT total" },
  6: { ar: "هاش الفاتورة", en: "Invoice hash" },
  7: { ar: "التوقيع", en: "ECDSA signature" },
  8: { ar: "المفتاح العام", en: "Public key" },
  9: { ar: "توقيع الهيئة على الشهادة", en: "ZATCA stamp signature" },
};

function QrDialog({ doc, onClose }: { doc: ZatcaInvoiceRow | null; onClose: () => void }) {
  const { L, lang } = useT();
  const decoded = useMemo(() => {
    try {
      return doc ? decodeQr(doc.qr) : null;
    } catch {
      return null;
    }
  }, [doc]);
  const m = useMemo(() => (doc ? qrMatrix(doc.qr, "M") : null), [doc]);
  return (
    <Dialog open={!!doc} onClose={onClose} size="lg" title={L("فك الـ QR", "QR decode")} description={doc?.invoiceNo}>
      <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
        {m ? (
          <svg viewBox={`-2 -2 ${m.size + 4} ${m.size + 4}`} className="w-44 rounded-xl bg-white p-1" shapeRendering="crispEdges" role="img" aria-label="ZATCA QR">
            <rect x={-2} y={-2} width={m.size + 4} height={m.size + 4} fill="#fff" />
            <path d={m.path} fill="#000" />
          </svg>
        ) : null}
        <table className="w-full text-[13px]">
          <tbody>
            {decoded?.tags.map((t) => (
              <tr key={t.tag} className="border-b border-line align-top">
                <td className="py-1.5 pe-3 font-semibold whitespace-nowrap">
                  <span className="num text-muted">{t.tag}</span> {TAG[t.tag]?.[lang]}
                </td>
                <td className="num py-1.5 break-all text-[12px]" dir="ltr">
                  {t.text}
                  <span className="text-faint"> ({t.length} B)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {decoded && decoded.tags.length <= 5 ? <p className="mt-3 text-[12.5px] text-warn">{L("QR مؤقت (المرحلة الأولى، tags 1–5) لحد ما السيرفر يختم الفاتورة.", "Provisional Phase-1 QR (tags 1–5) until the server stamps the document.")}</p> : null}
    </Dialog>
  );
}

/** Indent the stored canonical XML for reading (display only — never re-saved). */
function prettyXml(xml: string): string {
  let depth = 0;
  return xml
    .replace(/>\s*</g, ">\n<")
    .split("\n")
    .map((line) => {
      if (/^<\/[^>]+>$/.test(line)) depth = Math.max(0, depth - 1);
      const out = "  ".repeat(depth) + line;
      if (/^<[^/?!][^>]*[^/]>$/.test(line) && !/<\/[^>]+>$/.test(line)) depth++;
      return out;
    })
    .join("\n");
}
