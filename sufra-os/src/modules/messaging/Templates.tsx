/**
 * Templates manager: the catalogue with AR/EN preview (sample data), category, Meta review status
 * (draft → submitted → approved / rejected, stored in settings.messaging.templates) and the JSON to submit.
 */
import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, FileJson, Search } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb } from "@/data/hooks";
import { useT, type Lang } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { matches } from "@/lib/arabic";
import { estimateCostMicros } from "@/lib/notify/core";
import type { TemplateReviewStatus } from "@/lib/notify/settings";
import { CATALOG, metaSubmission, priceCategoryOf, renderSample, type CatalogTemplate, type TemplateCategory } from "@/lib/notify/templates";
import { Badge, Button, Card, Input, Segmented, Select, useToast, type Tone } from "@/ui";
import { Bubble, usd } from "./bits";
import { useMessagingSettings } from "./useMessaging";

const CAT_TONE: Record<TemplateCategory, Tone> = { UTILITY: "primary", MARKETING: "brass", AUTHENTICATION: "info" };
const CAT_LABEL: Record<TemplateCategory, { ar: string; en: string }> = {
  UTILITY: { ar: "خدمة (Utility)", en: "Utility" },
  MARKETING: { ar: "تسويق (Marketing)", en: "Marketing" },
  AUTHENTICATION: { ar: "تحقق (Authentication)", en: "Authentication" },
};
const REVIEW_TONE: Record<TemplateReviewStatus, Tone> = { draft: "neutral", submitted: "info", approved: "ok", rejected: "danger" };
const REVIEW_LABEL: Record<TemplateReviewStatus, { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" },
  submitted: { ar: "اتبعت للمراجعة", en: "Submitted" },
  approved: { ar: "معتمد", en: "Approved" },
  rejected: { ar: "مرفوض", en: "Rejected" },
};

export default function Templates() {
  const { L } = useT();
  const [cat, setCat] = useState<"all" | TemplateCategory>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => CATALOG.filter((t) => (cat === "all" || t.category === cat) && (!q || matches(`${t.id} ${t.title.ar} ${t.title.en} ${t.body.ar} ${t.body.en}`, q))), [cat, q]);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={L("الفئة", "Category")}
          value={cat}
          onChange={setCat}
          options={[
            { value: "all", label: L("الكل", "All") },
            { value: "UTILITY", label: "Utility" },
            { value: "MARKETING", label: "Marketing" },
            { value: "AUTHENTICATION", label: L("تحقق", "Auth") },
          ]}
        />
        <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر في القوالب…", "Search templates…")} aria-label={L("بحث", "Search")} wrapClassName="min-w-56 flex-1" />
        <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noreferrer">
          <Button variant="outline" icon={<ExternalLink />}>{L("مدير القوالب في Meta", "Meta template manager")}</Button>
        </a>
      </div>
      <p className="text-[13px] text-muted">
        {L(
          "القوالب لازم تتعتمد من Meta قبل ما تتبعت برّه نافذة الـ ٢٤ ساعة. انسخ الـ JSON وابعته من مدير القوالب أو الـ API، وبعدين حدّث الحالة هنا. قوالب الخدمة ممنوع فيها كلام ترويجي وإلا هتتحول لتسويق.",
          "Templates must be approved by Meta before they can be sent outside the 24h window. Copy the JSON, submit it in the template manager or via the API, then update the status here. Keep Utility wording free of promotion or Meta reclassifies it as Marketing.",
        )}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {shown.map((t) => (
          <TemplateCard key={t.id} t={t} />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({ t }: { t: CatalogTemplate }) {
  const { L, lang: uiLang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const { can } = useSession();
  const { row, ms } = useMessagingSettings();
  const [lang, setLang] = useState<Lang>(uiLang);
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  const review = ms.templates[t.id]?.status ?? "draft";
  const json = useMemo(() => JSON.stringify(metaSubmission(t.id, lang), null, 2), [t.id, lang]);
  const cost = (c: "+20" | "+966") => usd(estimateCostMicros(priceCategoryOf(t.category), c === "+20" ? "+201000000000" : "+966500000000", ms.rates));

  const setReview = async (status: TemplateReviewStatus) => {
    if (!row) return;
    await db.update("settings", row.id, { messaging: { ...ms, templates: { ...ms.templates, [t.id]: { status, updatedAt: new Date().toISOString() } } } });
    toast({ title: L("حالة القالب اتحدثت", "Template status updated"), tone: "success" });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setShowJson(true);
    }
  };

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-start gap-2 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-sans text-[15.5px] font-bold">{L(t.title.ar, t.title.en)}</h3>
          <p className="font-mono text-[12px] text-muted" dir="ltr">{t.id}</p>
        </div>
        <Badge tone={CAT_TONE[t.category]} size="sm">{L(CAT_LABEL[t.category].ar, CAT_LABEL[t.category].en)}</Badge>
        <Badge tone={REVIEW_TONE[review]} size="sm" dot>{L(REVIEW_LABEL[review].ar, REVIEW_LABEL[review].en)}</Badge>
      </div>
      <div className="mx-4 mt-3 flex-1 rounded-2xl bg-[radial-gradient(var(--sf-line)_1px,transparent_1px)] [background-size:16px_16px] p-3" dir={lang === "ar" ? "rtl" : "ltr"}>
        <Bubble m={{ direction: "out", body: renderSample(t.id, lang), status: "read", createdAt: "2026-11-03T18:30:00.000Z", kind: "text", template: null, category: null }}>
          {t.button || t.quickReplies ? (
            <div className="mt-2 grid gap-1 border-t border-line/60 pt-1.5">
              {t.button ? <span className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-info"><ExternalLink className="size-3.5" aria-hidden />{t.button.label[lang]}</span> : null}
              {t.quickReplies?.map((qr, i) => <span key={i} className="text-center text-[13px] font-semibold text-info">{qr[lang]}</span>)}
            </div>
          ) : null}
        </Bubble>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 text-[12.5px] text-muted">
        <Segmented size="sm" label={L("لغة المعاينة", "Preview language")} value={lang} onChange={setLang} options={[{ value: "ar", label: "AR" }, { value: "en", label: "EN" }]} />
        <span className="ms-auto">{L("تكلفة تقريبية", "Est. cost")}: 🇪🇬 <span className="num">{cost("+20")}</span> · 🇸🇦 <span className="num">{cost("+966")}</span></span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Button size="sm" variant="soft" icon={copied ? <Check /> : <Copy />} onClick={() => void copy()}>{copied ? L("اتنسخ", "Copied") : L("انسخ JSON لـ Meta", "Copy Meta JSON")}</Button>
        <Button size="sm" variant="ghost" icon={<FileJson />} onClick={() => setShowJson((v) => !v)} aria-expanded={showJson}>{showJson ? L("اخفي", "Hide") : L("اعرض", "Show")}</Button>
        <div className="ms-auto w-44">
          <Select
            aria-label={L("حالة المراجعة", "Review status")}
            value={review}
            disabled={!can("settings.edit")}
            onChange={(e) => void setReview(e.target.value as TemplateReviewStatus)}
            options={(Object.keys(REVIEW_LABEL) as TemplateReviewStatus[]).map((k) => ({ value: k, label: L(REVIEW_LABEL[k].ar, REVIEW_LABEL[k].en) }))}
          />
        </div>
      </div>
      {showJson ? <pre className={cn("max-h-72 overflow-auto border-t border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed")} dir="ltr">{json}</pre> : null}
    </Card>
  );
}
