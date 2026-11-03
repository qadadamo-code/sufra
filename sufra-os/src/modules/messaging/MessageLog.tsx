/** Message log: every message with channel, category, delivery status and estimated Meta cost; month totals per category. */
import { useMemo, useState } from "react";
import { Download, Eye, Search, Send, Wallet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLive } from "@/data/hooks";
import type { Message, MessageCategory, MessageChannel, MessageStatus } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { prettyPhone } from "@/lib/notify/core";
import { Badge, Button, Card, Input, Select, StatTile, Table } from "@/ui";
import { STATUS_LABEL, STATUS_TONE, StatusIcon, usd } from "./bits";
import { useMessagingSettings } from "./useMessaging";

const CHANNEL_LABEL: Record<MessageChannel, { ar: string; en: string }> = {
  whatsapp: { ar: "واتساب API", en: "WhatsApp API" },
  click_to_chat: { ar: "بالضغط (wa.me)", en: "Click-to-chat" },
  sms: { ar: "SMS", en: "SMS" },
  log: { ar: "معاينة", en: "Preview" },
};
const CAT_LABEL: Record<MessageCategory, { ar: string; en: string }> = {
  utility: { ar: "خدمة", en: "Utility" },
  marketing: { ar: "تسويق", en: "Marketing" },
  authentication: { ar: "تحقق", en: "Auth" },
  service: { ar: "رد (مجاني)", en: "Service" },
};

export default function MessageLog() {
  const { L, lang } = useT();
  const nav = useNavigate();
  const { ms } = useMessagingSettings();
  const messages = useLive("messages", { orderBy: [{ field: "createdAt", dir: "desc" }], limit: 500 }).data;
  const conversations = useLive("conversations").data;
  const conv = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | MessageStatus>("all");
  const [dir, setDir] = useState<"all" | "in" | "out">("out");
  const [cat, setCat] = useState<"all" | MessageCategory>("all");

  const shown = messages.filter(
    (m) =>
      (dir === "all" || m.direction === dir) &&
      (status === "all" || m.status === status) &&
      (cat === "all" || m.category === cat) &&
      (!q || matches(`${m.body} ${m.template ?? ""} ${conv.get(m.conversationId)?.name ?? ""}`, q) || (conv.get(m.conversationId)?.phone ?? "").includes(q.replace(/\D/g, ""))),
  );

  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const thisMonth = messages.filter((m) => m.direction === "out" && Date.parse(m.createdAt) >= month.getTime());
  const sent = thisMonth.filter((m) => ["sent", "delivered", "read", "opened"].includes(m.status));
  const delivered = thisMonth.filter((m) => m.status === "delivered" || m.status === "read");
  const read = thisMonth.filter((m) => m.status === "read");
  const cost = thisMonth.reduce((a, m) => a + (m.status === "failed" || m.status === "skipped" ? 0 : m.costMicros), 0);
  const byCat = (["utility", "marketing", "authentication", "service"] as MessageCategory[]).map((c) => ({ c, n: thisMonth.filter((m) => m.category === c).length, cost: thisMonth.filter((m) => m.category === c).reduce((a, m) => a + m.costMicros, 0) }));
  const api = thisMonth.filter((m) => m.channel === "whatsapp").length;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const dt = (iso: string) => new Date(iso).toLocaleString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

  const csv = () => {
    const rows = [["time", "direction", "phone", "name", "channel", "category", "template", "status", "cost_usd", "body"]];
    for (const m of shown) {
      const c = conv.get(m.conversationId);
      rows.push([m.createdAt, m.direction, c?.phone ?? "", c?.name ?? "", m.channel, m.category ?? "", m.template ?? "", m.status, (m.costMicros / 1e6).toFixed(4), m.body.replace(/\s+/g, " ")]);
    }
    const blob = new Blob(["﻿" + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sufra-messages-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile index={0} icon={<Send />} label={L("اتبعت الشهر ده", "Sent this month")} value={sent.length} sub={`${api} ${L("عن طريق الـ API", "via the API")}`} />
        <StatTile index={1} icon={<Eye />} tone="ok" label={L("وصلت", "Delivered")} value={pct(delivered.length, api)} sub={`${L("اتقرت", "Read")} ${pct(read.length, api)} · ${L("من رسايل الـ API", "of API messages")}`} />
        <StatTile index={2} icon={<Wallet />} tone="brass" label={L("تكلفة تقديرية", "Estimated cost")} value={usd(cost)} sub={L("أسعار Meta التقريبية — عدّلها من الإعدادات", "Approx. Meta rates — edit in settings")} />
        <Card className="grid gap-1.5 p-4 text-[13px]">
          {byCat.map((x) => (
            <div key={x.c} className="flex items-center gap-2">
              <span className="flex-1 text-muted">{L(CAT_LABEL[x.c].ar, CAT_LABEL[x.c].en)}</span>
              <span className="num font-semibold">{x.n}</span>
              <span className="num w-16 text-end text-muted">{usd(x.cost)}</span>
            </div>
          ))}
          <p className="text-[11.5px] text-muted">
            🇪🇬 {L("خدمة", "Utility")} {usd(ms.rates.EG.utility * 1e6)} · {L("تسويق", "Marketing")} {usd(ms.rates.EG.marketing * 1e6)}
          </p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر…", "Search…")} aria-label={L("بحث", "Search")} wrapClassName="min-w-48 flex-1" />
          <div className="w-32"><Select aria-label={L("الاتجاه", "Direction")} value={dir} onChange={(e) => setDir(e.target.value as typeof dir)} options={[{ value: "out", label: L("الصادر", "Outgoing") }, { value: "in", label: L("الوارد", "Incoming") }, { value: "all", label: L("الكل", "All") }]} /></div>
          <div className="w-40"><Select aria-label={L("الحالة", "Status")} value={status} onChange={(e) => setStatus(e.target.value as typeof status)} options={[{ value: "all", label: L("كل الحالات", "All statuses") }, ...(Object.keys(STATUS_LABEL) as MessageStatus[]).map((s) => ({ value: s, label: L(STATUS_LABEL[s].ar, STATUS_LABEL[s].en) }))]} /></div>
          <div className="w-36"><Select aria-label={L("الفئة", "Category")} value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} options={[{ value: "all", label: L("كل الفئات", "All categories") }, ...(Object.keys(CAT_LABEL) as MessageCategory[]).map((c) => ({ value: c, label: L(CAT_LABEL[c].ar, CAT_LABEL[c].en) }))]} /></div>
          <Button variant="outline" icon={<Download />} onClick={csv}>CSV</Button>
        </div>
        <Table<Message>
          rows={shown.slice(0, 300)}
          rowKey={(m) => m.id}
          onRowClick={(m) => nav(`/messages/c/${m.conversationId}`)}
          empty={L("مفيش رسايل", "No messages")}
          columns={[
            { key: "t", header: L("الوقت", "Time"), cell: (m) => <span className="num whitespace-nowrap text-[13px]">{dt(m.createdAt)}</span> },
            { key: "to", header: L("الزبون", "Customer"), cell: (m) => { const c = conv.get(m.conversationId); return <span className="flex flex-col"><span className="font-semibold">{c?.name ?? "—"}</span><span className="num whitespace-nowrap text-[12px] text-muted" dir="ltr">{c ? prettyPhone(c.phone) : ""}</span></span>; } },
            { key: "b", header: L("الرسالة", "Message"), cell: (m) => <span className="flex max-w-96 flex-col">{m.template ? <span className="font-mono text-[11.5px] text-muted" dir="ltr">{m.template}</span> : null}<span className="line-clamp-2 text-[13px]" dir="auto">{m.body}</span></span>, hideOnMobile: true },
            { key: "c", header: L("الفئة", "Category"), cell: (m) => (m.category ? <Badge size="sm" tone={m.category === "marketing" ? "brass" : "neutral"}>{L(CAT_LABEL[m.category].ar, CAT_LABEL[m.category].en)}</Badge> : null), hideOnMobile: true },
            { key: "ch", header: L("القناة", "Channel"), cell: (m) => <span className="text-[12.5px] text-muted">{L(CHANNEL_LABEL[m.channel].ar, CHANNEL_LABEL[m.channel].en)}</span>, hideOnMobile: true },
            { key: "s", header: L("الحالة", "Status"), cell: (m) => <Badge size="sm" tone={STATUS_TONE[m.status]} icon={<StatusIcon status={m.status} className="text-current" />}>{L(STATUS_LABEL[m.status].ar, STATUS_LABEL[m.status].en)}</Badge> },
            { key: "$", header: L("التكلفة", "Cost"), align: "end", cell: (m) => <span className="num text-[13px] text-muted">{m.costMicros ? usd(m.costMicros) : "—"}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

