/** One ticket: header, SLA, assignment, priority, conversation + internal notes, resolution, follow-up, history, diagnostics. */
import { useMemo, useState } from "react";
import { CheckCircle2, Clock, History, Lock, MessageCircle, Phone, Send, Smartphone, UserRound } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { formatMoney } from "@/lib/money";
import { ago, clock, dayLabel } from "@/lib/time";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Segmented, Select, Textarea, useToast } from "@/ui";
import type { SupportTicket, TicketPriority, TicketStatus } from "../types";
import { PRIORITIES, slaView, type SlaState } from "./tickets";
import { addNote, assign, recordFollowUp, setPriority, setStatus, waLink } from "./ops";
import { useOpsSettings } from "../settings";
import { KV } from "../ui";

export const PRIORITY_LABEL: Record<TicketPriority, { ar: string; en: string; tone: "neutral" | "info" | "warn" | "danger" }> = {
  low: { ar: "منخفضة", en: "Low", tone: "neutral" },
  normal: { ar: "عادية", en: "Normal", tone: "info" },
  high: { ar: "عالية", en: "High", tone: "warn" },
  urgent: { ar: "عاجلة", en: "Urgent", tone: "danger" },
};
export const STATUS_LABEL: Record<TicketStatus, { ar: string; en: string; tone: "neutral" | "info" | "warn" | "ok" | "primary" }> = {
  new: { ar: "جديدة", en: "New", tone: "primary" },
  open: { ar: "مفتوحة", en: "Open", tone: "info" },
  pending: { ar: "مستنية رد", en: "Pending", tone: "warn" },
  resolved: { ar: "اتحلّت", en: "Resolved", tone: "ok" },
  closed: { ar: "مقفولة", en: "Closed", tone: "neutral" },
};
export const CATEGORY_LABEL: Record<string, { ar: string; en: string }> = {
  food: { ar: "الأكل", en: "Food" }, service: { ar: "الخدمة", en: "Service" }, billing: { ar: "الحساب", en: "Billing" }, delivery: { ar: "الدليفري", en: "Delivery" },
  cleanliness: { ar: "النظافة", en: "Cleanliness" }, suggestion: { ar: "اقتراح", en: "Suggestion" }, praise: { ar: "شكر", en: "Praise" }, other: { ar: "أخرى", en: "Other" },
  bug: { ar: "عطل في البرنامج", en: "Bug" }, pos: { ar: "الكاشير", en: "POS" }, printer: { ar: "الطابعة", en: "Printer" }, payments: { ar: "الدفع", en: "Payments" },
  eta: { ar: "الضرايب (ETA)", en: "ETA" }, account: { ar: "الحساب والاشتراك", en: "Account" }, feature: { ar: "طلب ميزة", en: "Feature request" },
};

export function SlaChip({ t, compact }: { t: SupportTicket; compact?: boolean }) {
  const { L } = useT();
  const { cfg } = useOpsSettings();
  const v = slaView(t, cfg.sla);
  const clockOf = !t.firstResponseAt && t.status !== "resolved" && t.status !== "closed" ? v.response : v.resolve;
  const tone: Record<SlaState, "ok" | "warn" | "danger" | "neutral"> = { ok: "ok", due_soon: "warn", breached: "danger", met: "ok", closed: "neutral" };
  const txt =
    v.worst === "met" ? L("في الوقت", "SLA met") : v.worst === "closed" ? L("مقفولة", "closed") : v.worst === "breached" ? L(`متأخرة ${Math.abs(clockOf.leftMin)} د`, `${Math.abs(clockOf.leftMin)}m late`) : L(`باقي ${clockOf.leftMin} د`, `${clockOf.leftMin}m left`);
  return (
    <Badge size="sm" tone={tone[v.worst]} icon={<Clock className="size-3" />} pulse={v.worst === "breached"}>
      {compact ? txt : `${!t.firstResponseAt ? L("أول رد", "first reply") : L("الحل", "resolve")}: ${txt}`}
    </Badge>
  );
}

export function TicketDetail({ t, mode }: { t: SupportTicket; mode: "restaurant" | "platform" | "requester" }) {
  const { L, lang } = useT();
  const db = useDb();
  const { staff } = useSession();
  const { toast } = useToast();
  const members = useLive("memberships", { where: { active: true } }, { enabled: mode === "restaurant" }).data;
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"reply" | "internal">(mode === "requester" ? "reply" : "reply");
  const [resolution, setResolution] = useState(t.resolution);
  const [follow, setFollow] = useState(t.followUp ?? (t.kind === "guest" ? L(`أهلاً ${t.contactName || ""} — إحنا آسفين على اللي حصل. `, `Hi ${t.contactName || ""} — we're sorry about what happened. `) : ""));
  const me = staff?.name ?? (mode === "platform" ? "Sufra" : "");
  const done = t.status === "resolved" || t.status === "closed";
  const byName = mode === "platform" ? L("دعم سُفرة", "Sufra support") : me;
  const notes = t.notes.filter((n) => mode !== "requester" || n.kind !== "internal");

  const send = async () => {
    if (!text.trim()) return;
    await addNote(db, t, byName, kind, text);
    setText("");
  };
  const move = async (to: TicketStatus) => {
    await setStatus(db, t, byName, to, resolution);
    toast({ title: L("اتحدّثت", "Updated"), tone: "success", duration: 1200 });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="grid content-start gap-3">
        <Card className="grid gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] text-muted">{t.number}</span>
            <Badge size="sm" tone={STATUS_LABEL[t.status].tone}>{lang === "ar" ? STATUS_LABEL[t.status].ar : STATUS_LABEL[t.status].en}</Badge>
            <Badge size="sm" tone={PRIORITY_LABEL[t.priority].tone}>{lang === "ar" ? PRIORITY_LABEL[t.priority].ar : PRIORITY_LABEL[t.priority].en}</Badge>
            <Badge size="sm">{(CATEGORY_LABEL[t.category] ?? CATEGORY_LABEL.other)[lang]}</Badge>
            <SlaChip t={t} />
            {t.escalatedAt ? <Badge size="sm" tone="danger">{L("متصعّدة", "escalated")}</Badge> : null}
          </div>
          <h2 className="text-[20px] font-bold">{t.subject}</h2>
          <p className="whitespace-pre-wrap text-[15px] text-ink-2">{t.body}</p>
          <p className="text-[12.5px] text-muted">
            <span className="num">{dayLabel(t.createdAt, lang)} {clock(t.createdAt, lang)}</span> · {t.contactName || "—"} {t.contactPhone ? <span className="num" dir="ltr">· {t.contactPhone}</span> : null} · {t.channel}
          </p>
          {t.contactPhone && mode !== "requester" ? (
            <div className="flex flex-wrap gap-2">
              <a className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13.5px] font-semibold" href={`tel:${t.contactPhone}`}><Phone className="size-4" /> {L("اتصل", "Call")}</a>
              <a className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line px-3 text-[13.5px] font-semibold" href={waLink(t.contactPhone, follow)} target="_blank" rel="noreferrer"><MessageCircle className="size-4" /> WhatsApp</a>
            </div>
          ) : null}
        </Card>

        <Card className="grid gap-2 p-4">
          <p className="text-[14px] font-bold">{L("المحادثة والملاحظات", "Conversation & notes")}</p>
          {!notes.length ? <p className="text-[13px] text-muted">{L("لسه مفيش رد.", "No replies yet.")}</p> : null}
          {notes.map((n) => (
            <div key={n.id} className={cn("rounded-xl px-3 py-2 text-[14px]", n.kind === "internal" ? "border border-dashed border-warn/50 bg-warn-soft/40" : n.kind === "system" ? "text-[12.5px] text-muted" : "bg-surface-2")}>
              <p className="text-[12px] font-semibold text-muted">
                {n.kind === "internal" ? <Lock className="me-1 inline size-3" /> : null}
                {n.byName} · {ago(n.at, lang)}
              </p>
              <p className="whitespace-pre-wrap">{n.text}</p>
            </div>
          ))}
          {!done || mode === "requester" ? (
            <div className="grid gap-2">
              {mode !== "requester" ? (
                <Segmented size="sm" label={L("نوع", "Type")} value={kind} onChange={setKind} options={[{ value: "reply", label: t.kind === "guest" ? L("رد للضيف", "Reply to guest") : L("رد", "Reply") }, { value: "internal", label: L("ملاحظة داخلية", "Internal note"), icon: <Lock className="size-3.5" /> }]} />
              ) : null}
              <Textarea aria-label={L("اكتب", "Write")} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "internal" ? L("للفريق بس — الضيف مش هيشوفها", "Team only — the guest won't see it") : L("اكتب ردك…", "Write a reply…")} />
              <div className="flex justify-end">
                <Button size="sm" icon={<Send className="size-4" />} disabled={!text.trim()} onClick={() => void send()}>{L("ابعت", "Send")}</Button>
              </div>
            </div>
          ) : null}
        </Card>

        {mode !== "requester" ? (
          <Card className="grid gap-2 p-4">
            <p className="text-[14px] font-bold">{L("الحل والمتابعة", "Resolution & follow-up")}</p>
            <Textarea aria-label={L("الحل", "Resolution")} rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={L("إيه اللي اتعمل؟ (مرتجع، اعتذار، كوبون…)", "What was done? (refund, apology, coupon…)")} />
            <div className="flex flex-wrap gap-2">
              {!done ? <Button size="sm" icon={<CheckCircle2 className="size-4" />} onClick={() => void move("resolved")}>{L("اتحلّت", "Resolve")}</Button> : null}
              {!done && t.status !== "pending" ? <Button size="sm" variant="secondary" onClick={() => void move("pending")}>{L("مستنية رد", "Pending")}</Button> : null}
              {t.status === "resolved" ? <Button size="sm" variant="secondary" onClick={() => void move("closed")}>{L("اقفل", "Close")}</Button> : null}
              {done ? <Button size="sm" variant="secondary" onClick={() => void move("open")}>{L("افتحها تاني", "Reopen")}</Button> : null}
            </div>
            {t.kind === "guest" ? (
              <div className="grid gap-2 border-t border-line pt-2">
                <p className="text-[13px] font-semibold">{L("رسالة متابعة للضيف", "Follow-up message to the guest")}</p>
                <Textarea aria-label={L("رسالة المتابعة", "Follow-up")} rows={2} value={follow} onChange={(e) => setFollow(e.target.value)} />
                <div className="flex flex-wrap items-center gap-2">
                  {t.contactPhone ? (
                    <a
                      href={waLink(t.contactPhone, follow)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => void recordFollowUp(db, t, me, follow)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-primary px-3.5 text-[13.5px] font-semibold text-primary-ink"
                    >
                      <MessageCircle className="size-4" /> {L("ابعت على واتساب", "Send on WhatsApp")}
                    </a>
                  ) : <span className="text-[12.5px] text-muted">{L("مفيش رقم للضيف", "No guest phone")}</span>}
                  {t.followUpAt ? <Badge size="sm" tone="ok">{L("اتبعتت", "sent")} {ago(t.followUpAt, lang)}</Badge> : null}
                </div>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>

      <div className="grid content-start gap-3">
        {mode === "restaurant" ? (
          <Card className="grid gap-2 p-4">
            <Select label={L("المسؤول", "Assignee")} value={t.assigneeId ?? ""} onChange={(e) => void assign(db, t, e.target.value || null)} options={[{ value: "", label: L("محدش", "Unassigned") }, ...members.filter((m) => ["owner", "admin", "manager", "cashier"].includes(m.role)).map((m) => ({ value: m.id, label: m.name }))]} />
            <Select label={L("الأولوية", "Priority")} value={t.priority} onChange={(e) => void setPriority(db, t, e.target.value as TicketPriority)} options={PRIORITIES.map((p) => ({ value: p, label: lang === "ar" ? PRIORITY_LABEL[p].ar : PRIORITY_LABEL[p].en }))} />
          </Card>
        ) : null}
        {t.kind === "guest" ? <GuestHistory t={t} /> : <StaffHistory t={t} showDiag={mode !== "requester"} />}
      </div>
    </div>
  );
}

function GuestHistory({ t }: { t: SupportTicket }) {
  const { L, lang } = useT();
  const cid = t.customerId;
  const customer = useLive("customers", { where: { id: cid ?? "-" } }, { enabled: !!cid }).data[0];
  const orders = useLive("orders", { where: { customerId: cid ?? "-" }, orderBy: [{ field: "createdAt", dir: "desc" }], limit: 10 }, { enabled: !!cid }).data;
  const checkIds = useMemo(() => [...new Set([...orders.map((o) => o.checkId), t.checkId].filter(Boolean) as string[])], [orders, t.checkId]);
  const payments = useLive("payments", { where: { checkId: checkIds.length ? checkIds : ["-"] } }, { enabled: checkIds.length > 0 }).data;
  const feedback = useLive("guestFeedback", { where: { customerId: cid ?? "-" } }, { enabled: !!cid }).data;
  const others = useLive("supportTickets", { where: { customerId: cid ?? "-" } }, { enabled: !!cid }).data.filter((x) => x.id !== t.id);
  const calls = useLive("serviceCalls", { where: { tableId: t.tableId ?? "-" }, gte: { createdAt: new Date(Date.parse(t.createdAt) - 3 * 3600_000).toISOString() } }, { enabled: !!t.tableId }).data;
  return (
    <Card className="grid gap-2 p-4">
      <CardHeader icon={<History />} title={L("تاريخ الضيف", "Guest history")} />
      {customer ? (
        <>
          <KV k={L("العميل", "Customer")} v={customer.name} />
          <KV k={L("الزيارات", "Visits")} v={<span className="num">{customer.visits}</span>} />
          <KV k={L("إجمالي الصرف", "Total spent")} v={formatMoney(customer.totalSpent, { lang })} />
        </>
      ) : <p className="text-[13px] text-muted">{L("مش مربوط بعميل في الـ CRM (مفيش رقم معروف).", "Not linked to a CRM customer (unknown phone).")}</p>}
      {orders.length ? <p className="mt-1 text-[12.5px] font-bold text-muted">{L("الطلبات", "Orders")}</p> : null}
      {orders.slice(0, 6).map((o) => (
        <KV key={o.id} k={<span className="num">#{o.number} · {dayLabel(o.createdAt, lang)}</span>} v={`${o.mode} · ${o.status}`} />
      ))}
      {payments.length ? <p className="mt-1 text-[12.5px] font-bold text-muted">{L("المدفوعات", "Payments")}</p> : null}
      {payments.slice(0, 6).map((p) => (
        <KV key={p.id} k={`${p.method} · ${ago(p.createdAt, lang)}`} v={formatMoney(p.amount, { lang })} />
      ))}
      {calls.length ? <KV k={L("نداءات الطاولة", "Table calls")} v={<span className="num">{calls.length}</span>} /> : null}
      {feedback.length ? <p className="mt-1 text-[12.5px] font-bold text-muted">{L("التقييمات", "Feedback")}</p> : null}
      {feedback.slice(0, 4).map((f) => (
        <KV key={f.id} k={"★".repeat(f.stars)} v={f.comment || "—"} />
      ))}
      {others.length ? <KV k={L("تذاكر قبل كده", "Previous tickets")} v={others.map((o) => o.number).join("، ")} /> : null}
    </Card>
  );
}

function StaffHistory({ t, showDiag }: { t: SupportTicket; showDiag: boolean }) {
  const { L, lang } = useT();
  const d = t.diagnostics;
  const member = useLive("memberships", { where: { id: t.raisedBy ?? "-" } }, { enabled: !!t.raisedBy, unscoped: true }).data[0];
  const audit = useLive("auditLog", { where: { actorId: t.raisedBy ?? "-" }, orderBy: [{ field: "createdAt", dir: "desc" }], limit: 8 }, { enabled: !!t.raisedBy && showDiag, unscoped: true }).data;
  return (
    <>
      <Card className="grid gap-1 p-4">
        <CardHeader icon={<UserRound />} title={L("الموظف", "Staff member")} />
        <KV k={L("الاسم", "Name")} v={member?.name ?? t.contactName} />
        <KV k={L("الدور", "Role")} v={member?.role ?? d?.role ?? "—"} />
        {audit.length ? <p className="mt-1 text-[12.5px] font-bold text-muted">{L("آخر عمليات", "Recent actions")}</p> : null}
        {audit.map((a) => <KV key={a.id} k={ago(a.createdAt, lang)} v={a.action} mono />)}
      </Card>
      {d && showDiag ? (
        <Card className="grid gap-1 p-4" data-diagnostics>
          <CardHeader icon={<Smartphone />} title={L("بيانات الجهاز", "Diagnostics")} />
          <KV k={L("النسخة", "Version")} v={`${d.appVersion} (${d.build})`} mono />
          <KV k={L("الجهاز", "Device")} v={d.platform || "—"} />
          <KV k={L("الشاشة", "Screen")} v={d.screen} mono />
          <KV k={L("المزامنة", "Sync")} v={`${d.sync.mode} · ${d.sync.online ? "online" : "offline"} · pending ${d.sync.pending}`} mono />
          <KV k={L("مثبّت كتطبيق", "Installed PWA")} v={d.standalone ? "✓" : "—"} />
          <KV k={L("الصفحة", "Page")} v={d.url} mono />
          <p className="mt-1 break-all text-[11.5px] text-muted" dir="ltr">{d.userAgent}</p>
          <p className="mt-1 text-[12.5px] font-bold text-muted">{L(`آخر الأخطاء (${d.errors.length})`, `Last errors (${d.errors.length})`)}</p>
          {d.errors.slice(0, 5).map((e, i) => (
            <p key={i} className="break-all rounded-lg bg-danger-soft/50 px-2 py-1 font-mono text-[11.5px]" dir="ltr">{e.at.slice(11, 19)} {e.message}</p>
          ))}
        </Card>
      ) : null}
    </>
  );
}
