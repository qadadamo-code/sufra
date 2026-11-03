/** /support — guest complaints inbox (the restaurant hotline). /support/t/:id — one ticket. */
import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Inbox, LifeBuoy, Plus, Search, Settings2 } from "lucide-react";
import { useDb, useLive, useRepo } from "@/data/hooks";
import { useSession } from "@/auth/session";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { ago } from "@/lib/time";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Button, Card, Dialog, EmptyState, Input, LinkButton, Select, Tabs, Textarea, useToast } from "@/ui";
import type { SupportTicket } from "../types";
import { GUEST_CATEGORIES, toEscalate } from "./tickets";
import { escalate, submitGuestComplaint } from "./ops";
import { CATEGORY_LABEL, PRIORITY_LABEL, SlaChip, STATUS_LABEL, TicketDetail } from "./TicketDetail";
import { useOpsSettings } from "../settings";

/** Runs the SLA escalation ladder while a manager screen is open (idempotent: escalatedAt gates repeats). */
export function useEscalator(tickets: SupportTicket[]) {
  const db = useDb();
  const { cfg } = useOpsSettings();
  useEffect(() => {
    const run = () => {
      for (const { ticket, priority } of toEscalate(tickets, cfg.sla)) void escalate(db, ticket, priority);
    };
    run();
    const id = setInterval(run, 60_000);
    return () => clearInterval(id);
  }, [tickets, cfg.sla, db]);
}

export default function TicketsPage() {
  return (
    <Routes>
      <Route index element={<Inbox_ />} />
      <Route path="t/:id" element={<TicketRoute />} />
    </Routes>
  );
}

function TicketRoute() {
  const { id } = useParams();
  const { L, dir } = useT();
  const t = useLive("supportTickets", { where: { id: id ?? "-" } }).data[0];
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <div className="grid gap-3">
      <Link to="/support" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink"><Back className="size-4" /> {L("كل الشكاوى", "All complaints")}</Link>
      {t ? <TicketDetail t={t} mode="restaurant" /> : <EmptyState compact icon={<Inbox />} title={L("التذكرة مش موجودة", "Ticket not found")} />}
    </div>
  );
}

type View = "active" | "mine" | "done" | "all";

function Inbox_() {
  const { L, lang } = useT();
  const { staff, can } = useSession();
  const nav = useNavigate();
  const all = useLive("supportTickets", { where: { kind: "guest" }, orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const members = useLive("memberships").data;
  const [view, setView] = useState<View>("active");
  const [q, setQ] = useState("");
  const [prio, setPrio] = useState("");
  const [add, setAdd] = useState(false);
  const active = useMemo(() => all.filter((t) => t.status === "new" || t.status === "open" || t.status === "pending"), [all]);
  useEscalator(active);
  const list = all.filter(
    (t) =>
      (view === "all" || (view === "active" ? active.includes(t) : view === "mine" ? t.assigneeId === staff?.id && active.includes(t) : t.status === "resolved" || t.status === "closed")) &&
      (!prio || t.priority === prio) &&
      (!q || matches(`${t.number} ${t.subject} ${t.body} ${t.contactName} ${t.contactPhone}`, q)),
  );
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const sorted = view === "active" || view === "mine" ? [...list].sort((a, b) => rank[a.priority] - rank[b.priority] || Date.parse(a.createdAt) - Date.parse(b.createdAt)) : list;
  return (
    <div className="grid gap-4">
      <PageHeader
        icon={<LifeBuoy />}
        title={L("الشكاوى والخط الساخن", "Guest hotline")}
        subtitle={L("كل شكوى بتبقى تذكرة: أولوية، وقت رد، مسؤول، وحل", "Every complaint becomes a ticket: priority, SLA, owner and resolution")}
        actions={
          <>
            {can("settings.edit") ? <LinkButton to="/settings/ops" variant="secondary" size="sm" icon={<Settings2 className="size-4" />}>{L("الإعدادات", "Settings")}</LinkButton> : null}
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdd(true)}>{L("شكوى بالتليفون", "Phone complaint")}</Button>
          </>
        }
      />
      <Tabs
        label={L("العرض", "View")}
        value={view}
        onChange={setView}
        items={[
          { value: "active", label: L("مفتوحة", "Open"), count: active.length },
          { value: "mine", label: L("بتاعتي", "Mine"), count: active.filter((t) => t.assigneeId === staff?.id).length },
          { value: "done", label: L("اتحلّت", "Resolved") },
          { value: "all", label: L("الكل", "All") },
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Input aria-label={L("بحث", "Search")} icon={<Search className="size-4" />} placeholder={L("رقم، اسم، تليفون، كلمة…", "Number, name, phone, word…")} value={q} onChange={(e) => setQ(e.target.value)} wrapClassName="min-w-56 flex-1" />
        <Select aria-label={L("الأولوية", "Priority")} value={prio} onChange={(e) => setPrio(e.target.value)} options={[{ value: "", label: L("كل الأولويات", "All priorities") }, ...(["urgent", "high", "normal", "low"] as const).map((p) => ({ value: p, label: PRIORITY_LABEL[p][lang] }))]} />
      </div>
      {!sorted.length ? <EmptyState icon={<Inbox />} title={L("مفيش شكاوى هنا", "No complaints here")} body={L("الضيوف يقدروا يشتكوا من صفحة المطعم أو منيو الـ QR.", "Guests can complain from the restaurant page or the QR menu.")} /> : null}
      <div className="grid gap-2">
        {sorted.map((t) => (
          <Card key={t.id} interactive data-ticket={t.number} className="flex cursor-pointer flex-wrap items-center gap-3 p-3" onClick={() => nav(`/support/t/${t.id}`)}>
            <div className="min-w-0 flex-1 basis-60">
              <p className="flex flex-wrap items-center gap-2 text-[14.5px] font-bold">
                <span className="font-mono text-[12.5px] text-muted">{t.number}</span>
                {t.subject}
              </p>
              <p className="truncate text-[12.5px] text-muted">
                {t.contactName || "—"} · {(CATEGORY_LABEL[t.category] ?? CATEGORY_LABEL.other)[lang]} · {ago(t.createdAt, lang)}
                {t.assigneeId ? <> · {members.find((m) => m.id === t.assigneeId)?.name}</> : null}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm" tone={PRIORITY_LABEL[t.priority].tone}>{PRIORITY_LABEL[t.priority][lang]}</Badge>
              <Badge size="sm" tone={STATUS_LABEL[t.status].tone}>{STATUS_LABEL[t.status][lang]}</Badge>
              <SlaChip t={t} compact />
            </div>
          </Card>
        ))}
      </div>
      <PhoneComplaint open={add} onClose={() => setAdd(false)} />
    </div>
  );
}

function PhoneComplaint({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L, lang } = useT();
  const repo = useRepo();
  const { restaurant } = useSession();
  const { toast } = useToast();
  const [d, setD] = useState({ name: "", phone: "", category: "food", body: "", channel: "phone" as SupportTicket["channel"] });
  const save = async () => {
    try {
      const r = await submitGuestComplaint(repo, restaurant!.slug, { ...d });
      toast({ title: L(`اتسجلت ${r.number}`, `Logged ${r.number}`), tone: "success" });
      setD({ name: "", phone: "", category: "food", body: "", channel: "phone" });
      onClose();
    } catch (e) {
      toast({ title: (e as Error).message === "bad_phone" ? L("رقم التليفون مش صح", "Invalid phone number") : L("اكتب تفاصيل الشكوى", "Describe the complaint"), tone: "error" });
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={L("تسجيل شكوى", "Log a complaint")} footer={<Button onClick={() => void save()}>{L("سجّل", "Log it")}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={L("الاسم", "Name")} value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
        <Input label={L("التليفون", "Phone")} inputMode="tel" dir="ltr" value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} />
        <Select label={L("النوع", "Category")} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} options={GUEST_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c][lang] }))} />
        <Select label={L("جت منين", "Channel")} value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value as SupportTicket["channel"] })} options={[{ value: "phone", label: L("تليفون", "Phone") }, { value: "whatsapp", label: "WhatsApp" }, { value: "walk_in", label: L("في المطعم", "In person") }]} />
        <div className="sm:col-span-2">
          <Textarea label={L("التفاصيل", "Details")} rows={4} value={d.body} onChange={(e) => setD({ ...d, body: e.target.value })} />
        </div>
      </div>
    </Dialog>
  );
}
