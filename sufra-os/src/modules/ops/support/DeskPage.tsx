/** /sufra-desk — Sufra platform admins: every restaurant's technical support tickets (RLS: is_platform_admin()). */
import { useMemo, useState } from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Headset, Search } from "lucide-react";
import { useLive } from "@/data/hooks";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { ago } from "@/lib/time";
import { PageHeader } from "@/shell/PageHeader";
import { Badge, Card, EmptyState, Input, StatTile, Tabs } from "@/ui";
import { CATEGORY_LABEL, PRIORITY_LABEL, SlaChip, STATUS_LABEL, TicketDetail } from "./TicketDetail";
import { slaView } from "./tickets";

export default function DeskPage() {
  return (
    <Routes>
      <Route index element={<Desk />} />
      <Route path="t/:id" element={<DeskTicket />} />
    </Routes>
  );
}

function Desk() {
  const { L, loc, lang } = useT();
  const nav = useNavigate();
  const tickets = useLive("supportTickets", { where: { kind: "sufra" }, orderBy: [{ field: "createdAt", dir: "desc" }] }, { unscoped: true }).data;
  const restaurants = useLive("restaurants", undefined, { unscoped: true }).data;
  const [view, setView] = useState<"open" | "all">("open");
  const [q, setQ] = useState("");
  const rName = useMemo(() => new Map(restaurants.map((r) => [r.id, loc(r.name)])), [restaurants, loc]);
  const open = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const breached = open.filter((t) => slaView(t).worst === "breached").length;
  const list = (view === "open" ? open : tickets).filter((t) => !q || matches(`${t.number} ${t.subject} ${t.body} ${rName.get(t.restaurantId) ?? ""}`, q));
  return (
    <div className="grid gap-4">
      <PageHeader icon={<Headset />} title={L("مكتب دعم سُفرة", "Sufra support desk")} subtitle={L("طلبات الدعم الفني من كل المطاعم", "Technical support requests from every restaurant")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={L("مفتوحة", "Open")} value={open.length} tone="primary" />
        <StatTile label={L("عدّت الـ SLA", "Past SLA")} value={breached} tone={breached ? "danger" : "ok"} index={1} />
        <StatTile label={L("عاجلة", "Urgent")} value={open.filter((t) => t.priority === "urgent").length} tone="warn" index={2} />
        <StatTile label={L("مطاعم", "Restaurants")} value={new Set(open.map((t) => t.restaurantId)).size} tone="info" index={3} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Tabs label={L("العرض", "View")} value={view} onChange={setView} items={[{ value: "open", label: L("مفتوحة", "Open"), count: open.length }, { value: "all", label: L("الكل", "All") }]} />
        <Input aria-label={L("بحث", "Search")} icon={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} wrapClassName="ms-auto min-w-56" placeholder={L("مطعم، رقم، كلمة…", "Restaurant, number, word…")} />
      </div>
      {!list.length ? <EmptyState icon={<Headset />} title={L("مفيش تذاكر", "No tickets")} /> : null}
      <div className="grid gap-2">
        {list.map((t) => (
          <Card key={t.id} interactive className="flex cursor-pointer flex-wrap items-center gap-3 p-3" onClick={() => nav(`/sufra-desk/t/${t.id}`)}>
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-[14.5px] font-bold"><span className="me-2 font-mono text-[12.5px] text-muted">{t.number}</span>{t.subject}</p>
              <p className="text-[12.5px] text-muted">{rName.get(t.restaurantId) ?? "?"} · {t.contactName} · {(CATEGORY_LABEL[t.category] ?? CATEGORY_LABEL.other)[lang]} · {ago(t.createdAt, lang)}</p>
            </div>
            <Badge size="sm" tone={PRIORITY_LABEL[t.priority].tone}>{PRIORITY_LABEL[t.priority][lang]}</Badge>
            <Badge size="sm" tone={STATUS_LABEL[t.status].tone}>{STATUS_LABEL[t.status][lang]}</Badge>
            <SlaChip t={t} compact />
          </Card>
        ))}
      </div>
    </div>
  );
}

function DeskTicket() {
  const { id } = useParams();
  const { L, dir } = useT();
  const t = useLive("supportTickets", { where: { id: id ?? "-" } }, { unscoped: true }).data[0];
  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <div className="grid gap-3">
      <Link to="/sufra-desk" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-muted hover:text-ink"><Back className="size-4" /> {L("كل التذاكر", "All tickets")}</Link>
      {t ? <TicketDetail t={t} mode="platform" /> : <EmptyState compact icon={<Headset />} title={L("مش موجودة", "Not found")} />}
    </div>
  );
}
