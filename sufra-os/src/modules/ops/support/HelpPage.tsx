/** /help — help center (search), request Sufra support (with diagnostics), my support tickets, system status. */
import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Activity, ArrowLeft, ArrowRight, BookOpen, CheckCircle2, ChevronDown, CircleHelp, Headset, MessageCircle, Phone, Search, Send, TriangleAlert, XCircle } from "lucide-react";
import { useDb, useLive, useSync } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { ago } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, CardHeader, EmptyState, Input, LinkButton, Select, Textarea, useToast } from "@/ui";
import type { TicketPriority } from "../types";
import { ARTICLES, searchArticles } from "./articles";
import { collectDiagnostics } from "./diagnostics";
import { requestSufraSupport, waLink } from "./ops";
import { SUFRA_CATEGORIES } from "./tickets";
import { CATEGORY_LABEL, PRIORITY_LABEL, SlaChip, STATUS_LABEL, TicketDetail } from "./TicketDetail";
import { useOpsSettings } from "../settings";
import { KV, SubNav } from "../ui";

export default function HelpPage() {
  const { L } = useT();
  const mine = useLive("supportTickets", { where: { kind: "sufra", status: ["new", "open", "pending"] } }).data.length;
  return (
    <div className="grid gap-4">
      <PageHeader icon={<CircleHelp />} title={L("المساعدة والدعم الفني", "Help & support")} subtitle={L("إزاي تعمل أي حاجة في سُفرة — ولو فيه مشكلة، فريقنا معاك", "How to do anything in Sufra — and our team when something's wrong")} />
      <SubNav
        label={L("المساعدة", "Help")}
        items={[
          { to: "/help", label: L("المقالات", "Articles"), end: true },
          { to: "/help/request", label: L("اطلب دعم", "Request support") },
          { to: "/help/tickets", label: L("طلباتي", "My requests"), badge: mine },
          { to: "/help/status", label: L("حالة النظام", "System status") },
        ]}
      />
      <Routes>
        <Route index element={<Articles />} />
        <Route path="request" element={<Request />} />
        <Route path="tickets" element={<MyTickets />} />
        <Route path="tickets/:id" element={<MyTicket />} />
        <Route path="status" element={<Status />} />
      </Routes>
    </div>
  );
}

function Articles() {
  const { L, loc } = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => searchArticles(q), [q]);
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
      <div className="grid content-start gap-2">
        <Input aria-label={L("ابحث في المساعدة", "Search help")} size="lg" icon={<Search className="size-5" />} placeholder={L("مثلاً: إلغاء صنف، الوردية، الكاميرات…", "e.g. void an item, shift, cameras…")} value={q} onChange={(e) => setQ(e.target.value)} />
        <p className="px-1 text-[12.5px] text-muted">{L(`${list.length} مقالة`, `${list.length} articles`)}</p>
        {!list.length ? <EmptyState compact icon={<BookOpen />} title={L("ملقيناش حاجة", "Nothing found")} body={L("جرّب كلمة تانية، أو اطلب دعم.", "Try another word, or request support.")} action={<LinkButton to="/help/request">{L("اطلب دعم", "Request support")}</LinkButton>} /> : null}
        {list.map((a) => (
          <Card key={a.id} data-article={a.id} className="overflow-hidden">
            <button type="button" aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full items-center gap-3 p-4 text-start">
              <BookOpen className="size-5 shrink-0 text-primary" />
              <span className="flex-1 text-[15px] font-bold">{loc(a.title)}</span>
              <ChevronDown className={cn("size-4 text-muted transition-transform", open === a.id && "rotate-180")} />
            </button>
            {open === a.id ? (
              <div className="grid gap-2 px-4 pb-4">
                <p className="text-[14.5px] leading-relaxed text-ink-2">{loc(a.body)}</p>
                {a.path ? <LinkButton to={a.path} size="sm" variant="soft" className="justify-self-start">{L("افتح الشاشة", "Open the screen")}</LinkButton> : null}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <SupportContacts />
    </div>
  );
}

function SupportContacts() {
  const { L } = useT();
  const { cfg } = useOpsSettings();
  return (
    <Card className="grid content-start gap-2 p-4">
      <CardHeader icon={<Headset />} title={L("كلّم دعم سُفرة", "Contact Sufra support")} />
      {cfg.sufraSupportPhone ? (
        <a href={`tel:${cfg.sufraSupportPhone}`} className="flex items-center gap-2 text-[15px] font-semibold"><Phone className="size-4" /> <span className="num" dir="ltr">{cfg.sufraSupportPhone}</span></a>
      ) : (
        <p className="text-[13px] text-muted">{L("رقم الخط الساخن لسه هيتعلن — لحد كده اطلب دعم من هنا وهنرد عليك.", "The hotline number will be published soon — until then request support here and we'll reply.")}</p>
      )}
      {cfg.sufraSupportWhatsapp ? <a href={waLink(cfg.sufraSupportWhatsapp, "أهلاً، محتاج مساعدة في سُفرة")} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-[15px] font-semibold"><MessageCircle className="size-4" /> WhatsApp</a> : null}
      <LinkButton to="/help/request" icon={<Send className="size-4" />}>{L("اطلب دعم", "Request support")}</LinkButton>
      <p className="text-[12px] text-muted">{L(`${ARTICLES.length} مقالة مساعدة بالعربي والإنجليزي`, `${ARTICLES.length} help articles in Arabic and English`)}</p>
    </Card>
  );
}

function Request() {
  const { L, lang } = useT();
  const db = useDb();
  const sync = useSync();
  const { staff, role, restaurant } = useSession();
  const { toast } = useToast();
  const nav = useNavigate();
  const [d, setD] = useState({ subject: "", body: "", category: "bug", priority: "normal" as TicketPriority, phone: staff?.phone ?? "" });
  const [busy, setBusy] = useState(false);
  const diag = useMemo(() => collectDiagnostics({ sync, role, lang }), [sync, role, lang]);
  const send = async () => {
    if (d.body.trim().length < 5) return toast({ title: L("اوصف المشكلة شوية", "Describe the problem a bit"), tone: "warn" });
    setBusy(true);
    try {
      const t = await requestSufraSupport(db, { ...d, name: staff?.name ?? "", diagnostics: collectDiagnostics({ sync, role, lang }), restaurantName: restaurant?.name.ar ?? "" });
      toast({ title: L(`اتبعت ${t.number} — هنرد عليك قريب`, `Sent ${t.number} — we'll get back to you`), tone: "success" });
      nav(`/help/tickets/${t.id}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
      <Card className="grid content-start gap-3 p-4">
        <CardHeader icon={<Send />} title={L("اطلب دعم من فريق سُفرة", "Request support from the Sufra team")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={L("الموضوع", "Topic")} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} options={SUFRA_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c][lang] }))} />
          <Select label={L("قد إيه مستعجل؟", "How urgent?")} value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as TicketPriority })} options={(["low", "normal", "high", "urgent"] as const).map((p) => ({ value: p, label: PRIORITY_LABEL[p][lang] }))} />
        </div>
        <Input label={L("العنوان", "Subject")} value={d.subject} onChange={(e) => setD({ ...d, subject: e.target.value })} placeholder={L("مثلاً: الطابعة مش بتطبع", "e.g. printer not printing")} />
        <Textarea label={L("إيه اللي حصل؟", "What happened?")} rows={5} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} placeholder={L("كنت بعمل إيه، وإيه اللي ظهر…", "What you were doing and what you saw…")} />
        <Input label={L("رقم نكلمك عليه", "Phone we can call")} dir="ltr" inputMode="tel" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
        <Button loading={busy} icon={<Send className="size-4" />} onClick={() => void send()}>{L("ابعت", "Send")}</Button>
      </Card>
      <Card className="grid content-start gap-1 p-4" data-diagnostics-preview>
        <CardHeader icon={<Activity />} title={L("هيتبعت معاه تلقائياً", "Attached automatically")} subtitle={L("علشان نحل أسرع — من غير باسوردات ولا بيانات العملاء", "So we can fix it faster — no passwords, no customer data")} />
        <KV k={L("نسخة التطبيق", "App version")} v={diag.appVersion} mono />
        <KV k={L("الجهاز", "Device")} v={diag.platform || "—"} />
        <KV k={L("الشاشة", "Screen")} v={diag.screen} mono />
        <KV k={L("الاتصال", "Connection")} v={diag.online ? L("متصل", "online") : L("أوفلاين", "offline")} />
        <KV k={L("المزامنة", "Sync")} v={`${diag.sync.mode} · ${L("مستني", "pending")} ${diag.sync.pending}`} />
        <KV k={L("آخر الأخطاء", "Recent errors")} v={<span className="num">{diag.errors.length}</span>} />
      </Card>
    </div>
  );
}

function MyTickets() {
  const { L, lang } = useT();
  const nav = useNavigate();
  const list = useLive("supportTickets", { where: { kind: "sufra" }, orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  if (!list.length) return <EmptyState icon={<Headset />} title={L("مفيش طلبات دعم", "No support requests")} action={<LinkButton to="/help/request">{L("اطلب دعم", "Request support")}</LinkButton>} />;
  return (
    <div className="grid gap-2">
      {list.map((t) => (
        <Card key={t.id} interactive className="flex cursor-pointer flex-wrap items-center gap-3 p-3" onClick={() => nav(`/help/tickets/${t.id}`)}>
          <div className="min-w-0 flex-1">
            <p className="text-[14.5px] font-bold"><span className="me-2 font-mono text-[12.5px] text-muted">{t.number}</span>{t.subject}</p>
            <p className="text-[12.5px] text-muted">{t.contactName} · {ago(t.createdAt, lang)} · {t.notes.filter((n) => n.kind === "reply").length} {L("رد", "replies")}</p>
          </div>
          <Badge size="sm" tone={STATUS_LABEL[t.status].tone}>{STATUS_LABEL[t.status][lang]}</Badge>
          <SlaChip t={t} compact />
        </Card>
      ))}
    </div>
  );
}

function MyTicket() {
  const { id } = useParams();
  const { L, dir } = useT();
  const t = useLive("supportTickets", { where: { id: id ?? "-" } }).data[0];
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <div className="grid gap-3">
      <Link to="/help/tickets" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink"><Back className="size-4" /> {L("طلباتي", "My requests")}</Link>
      {t ? <TicketDetail t={t} mode="requester" /> : <EmptyState compact icon={<Headset />} title={L("مش موجود", "Not found")} />}
    </div>
  );
}

type Health = "ok" | "degraded" | "down" | "unknown" | "not_configured";

function useProbe(url: string, enabled: boolean): Health {
  const [h, setH] = useState<Health>("unknown");
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } })
      .then((r) => alive && setH(!(r.headers.get("content-type") ?? "").includes("json") ? "not_configured" : r.ok ? "ok" : r.status === 501 ? "not_configured" : r.status >= 500 ? "down" : "degraded"))
      .catch(() => alive && setH("down"))
      .finally(() => clearTimeout(t));
    return () => {
      alive = false;
      ctl.abort();
    };
  }, [url, enabled]);
  return h;
}

function Status() {
  const { L, lang } = useT();
  const sync = useSync();
  const local = sync.mode === "local";
  const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
  const pay = useProbe(`${base}/api/pay-status`, true);
  const wa = useProbe(`${base}/api/whatsapp-send`, true);
  const sup = useProbe(`${base}/api/support-ticket`, true);
  const rows: { name: string; h: Health; note: string }[] = [
    { name: L("التطبيق", "App"), h: "ok", note: L("شغّال على الجهاز ده", "Running on this device") },
    { name: L("المزامنة والبيانات", "Data & sync"), h: sync.error ? "degraded" : sync.online ? "ok" : "down", note: local ? L(`وضع محلي — ${sync.peers} تابة/جهاز متصل`, `Local mode — ${sync.peers} tabs/devices connected`) : `${L("مستني", "pending")} ${sync.pending}${sync.lastSyncAt ? " · " + ago(sync.lastSyncAt, lang) : ""}` },
    { name: L("الدفع الأونلاين", "Online payments"), h: pay, note: "/api/pay-status" },
    { name: "WhatsApp", h: wa, note: "/api/whatsapp-send" },
    { name: L("دعم سُفرة (إرسال التذاكر)", "Sufra support forwarding"), h: sup, note: "/api/support-ticket" },
  ];
  const icon = (h: Health) => (h === "ok" ? <CheckCircle2 className="size-5 text-ok" /> : h === "down" ? <XCircle className="size-5 text-danger" /> : <TriangleAlert className={cn("size-5", h === "degraded" ? "text-warn" : "text-faint")} />);
  const label: Record<Health, string> = { ok: L("شغّال", "Operational"), degraded: L("بطيء / فيه مشكلة", "Degraded"), down: L("واقع / مش متاح", "Unavailable"), unknown: L("بيتأكد…", "Checking…"), not_configured: L("مش متفعّل", "Not configured") };
  const allOk = rows.every((r) => r.h === "ok" || r.h === "not_configured" || r.h === "unknown");
  return (
    <div className="grid gap-3">
      <Card className={cn("flex items-center gap-3 p-4", allOk ? "bg-ok-soft" : "bg-warn-soft")} data-status-summary={allOk ? "ok" : "issues"}>
        {allOk ? <CheckCircle2 className="size-7 text-ok" /> : <TriangleAlert className="size-7 text-warn" />}
        <div>
          <p className="text-[17px] font-bold">{allOk ? L("كل الأنظمة شغّالة", "All systems operational") : L("فيه خدمة مش متاحة دلوقتي", "Some services are unavailable")}</p>
          <p className="text-[12.5px] text-muted">{L("فحص مباشر من الجهاز ده", "Live check from this device")}</p>
        </div>
      </Card>
      <Card className="divide-y divide-line">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-3 p-3.5">
            {icon(r.h)}
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold">{r.name}</p>
              <p className="truncate font-mono text-[11.5px] text-muted" dir="ltr">{r.note}</p>
            </div>
            <span className="text-[13px] font-semibold text-muted">{label[r.h]}</span>
          </div>
        ))}
      </Card>
      <Card className="p-4 text-[13px] text-muted">
        <p className="mb-1 font-bold text-ink">{L("بلاغات الأعطال", "Incident notices")}</p>
        {L("مفيش أعطال معلنة. لو فيه عطل عام هيظهر هنا وفي التنبيهات.", "No incidents reported. A platform-wide incident will show here and in alerts.")}
      </Card>
    </div>
  );
}
