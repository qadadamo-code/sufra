import { useMemo, useState } from "react";
import { MessageCircle, Reply, Star, ThumbsDown, ThumbsUp } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { GuestFeedback } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { dayLabel } from "@/lib/time";
import { clickToChatUrl } from "@/lib/notify/core";
import { Avatar, Badge, BarChart, Button, Dialog, EmptyState, Segmented, StatTile, Textarea } from "@/ui";
import { BarList, Section, Stars } from "./ui";

type Row = GuestFeedback & { source: "feedback" | "audit" };

export default function ReviewsPage() {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { can, staff } = useSession();
  const fb = useLive("guestFeedback", { orderBy: [{ field: "createdAt", dir: "desc" }] }).data;
  const audit = useLive("auditLog", { where: { action: "guest.feedback" } }).data;
  const staffRows = useLive("memberships").data;
  const tables = useLive("tables").data;
  const customers = useLive("customers").data;
  const orders = useLive("orders", { where: { checkId: fb.map((f) => f.checkId).filter(Boolean) as string[] } }, { enabled: fb.some((f) => f.checkId) }).data;
  const items = useLive("orderItems", { where: { orderId: orders.map((o) => o.id) } }, { enabled: orders.length > 0 }).data;
  const [filter, setFilter] = useState<"all" | "low" | "unreplied">("all");
  const [reply, setReply] = useState<Row | null>(null);
  const [text, setText] = useState("");

  const rows: Row[] = useMemo(() => {
    const fromAudit: Row[] = audit
      .filter((a) => !fb.some((f) => (f.orderId && f.orderId === a.entityId) || (f.checkId && f.checkId === a.entityId)))
      .map((a) => {
        const d = a.data as { stars?: number; comment?: string; tags?: string[] };
        return { id: a.id, restaurantId: a.restaurantId, createdAt: a.createdAt, updatedAt: a.updatedAt, branchId: a.branchId, checkId: a.entity === "checks" ? a.entityId : null, orderId: a.entity === "orders" ? a.entityId : null, tableId: null, stars: d.stars ?? 0, tags: d.tags ?? [], comment: d.comment ?? "", source: "audit" };
      });
    return [...fb.map((f) => ({ ...f, source: "feedback" as const })), ...fromAudit].filter((r) => r.stars > 0).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [fb, audit]);
  const avg = rows.length ? rows.reduce((a, r) => a + r.stars, 0) / rows.length : 0;
  const nps = rows.length ? ((rows.filter((r) => r.stars === 5).length - rows.filter((r) => r.stars <= 3).length) / rows.length) * 100 : 0;

  const weeks = useMemo(() => {
    const out: { key: string; label: string; value: number; tip: string }[] = [];
    for (let w = 7; w >= 0; w--) {
      const end = Date.now() - w * 7 * 86_400_000;
      const start = end - 7 * 86_400_000;
      const xs = rows.filter((r) => Date.parse(r.createdAt) >= start && Date.parse(r.createdAt) < end);
      const v = xs.length ? xs.reduce((a, r) => a + r.stars, 0) / xs.length : 0;
      out.push({ key: String(w), label: dayLabel(new Date(start).toISOString(), lang).split(" ").slice(1).join(" "), value: Math.round(v * 100), tip: `${v.toFixed(2)} ★ · ${xs.length}` });
    }
    return out;
  }, [rows, lang]);

  const group = (keyOf: (r: Row) => string | null | undefined, label: (k: string) => string) => {
    const m = new Map<string, { n: number; s: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!k) continue;
      const x = m.get(k) ?? { n: 0, s: 0 };
      x.n++;
      x.s += r.stars;
      m.set(k, x);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, label: `${label(k)} (${v.n})`, value: Math.round((v.s / v.n) * 100) / 100 })).sort((a, b) => b.value - a.value);
  };
  const byWaiter = group((r) => r.waiterId ?? orders.find((o) => o.id === r.orderId || o.checkId === r.checkId)?.waiterId, (k) => staffRows.find((s) => s.id === k)?.name ?? "—");
  const byTable = group((r) => r.tableId ?? orders.find((o) => o.checkId === r.checkId)?.tableIds[0], (k) => `${L("ترابيزة", "Table")} ${tables.find((t) => t.id === k)?.label ?? "?"}`).slice(0, 8);
  const byItem = useMemo(() => {
    const m = new Map<string, { n: number; s: number; name: string }>();
    for (const r of rows) {
      const os = orders.filter((o) => o.checkId === r.checkId || o.id === r.orderId);
      for (const i of items.filter((x) => os.some((o) => o.id === x.orderId))) {
        const x = m.get(i.itemId) ?? { n: 0, s: 0, name: loc(i.name) };
        x.n++;
        x.s += r.stars;
        m.set(i.itemId, x);
      }
    }
    return [...m.entries()].filter(([, v]) => v.n >= 1).map(([k, v]) => ({ key: k, label: `${v.name} (${v.n})`, value: Math.round((v.s / v.n) * 100) / 100 })).sort((a, b) => b.value - a.value);
  }, [rows, orders, items, loc]);

  const shown = rows.filter((r) => (filter === "low" ? r.stars <= 3 : filter === "unreplied" ? !r.reply : true));
  const dist = [5, 4, 3, 2, 1].map((s) => ({ key: String(s), label: "★".repeat(s), value: rows.filter((r) => r.stars === s).length, tone: s >= 4 ? "var(--sf-ok)" : s === 3 ? "var(--sf-brass)" : "var(--sf-danger)" }));

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} tone="brass" icon={<Star />} label={L("متوسط التقييم", "Average rating")} value={avg.toFixed(2)} sub={<Stars value={avg} />} />
        <StatTile index={1} label={L("عدد التقييمات", "Reviews")} value={rows.length} />
        <StatTile index={2} tone="ok" icon={<ThumbsUp />} label={L("صافي الرضا", "Net satisfaction")} value={`${nps > 0 ? "+" : ""}${nps.toFixed(0)}`} sub={L("٥ نجوم ناقص ٣ أو أقل", "5★ minus ≤3★")} />
        <StatTile index={3} tone="danger" icon={<ThumbsDown />} label={L("محتاجين رد", "Need a reply")} value={rows.filter((r) => r.stars <= 3 && !r.reply).length} />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Section title={L("التقييم على مدار ٨ أسابيع", "Rating over 8 weeks")}>
          <BarChart data={weeks} height={170} ariaLabel={L("متوسط التقييم بالأسبوع", "Average rating by week")} />
        </Section>
        <Section title={L("توزيع النجوم", "Star distribution")}>
          <BarList rows={dist} />
        </Section>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title={L("حسب الجرسون", "By waiter")}><BarList rows={byWaiter} format={(v) => `${v.toFixed(2)}★`} /></Section>
        <Section title={L("حسب الترابيزة", "By table")}><BarList rows={byTable} format={(v) => `${v.toFixed(2)}★`} /></Section>
        <Section title={L("حسب الصنف", "By item")}>{byItem.length ? <BarList rows={byItem.slice(0, 8)} format={(v) => `${v.toFixed(2)}★`} /> : <p className="text-[13px] text-muted">—</p>}</Section>
      </div>
      <Section title={L("التعليقات", "Comments")} action={<Segmented size="sm" label={L("فلتر", "Filter")} value={filter} onChange={setFilter} options={[{ value: "all", label: L("الكل", "All") }, { value: "low", label: L("٣ نجوم وأقل", "≤ 3★") }, { value: "unreplied", label: L("من غير رد", "Unreplied") }]} />}>
        {shown.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {shown.slice(0, 40).map((r) => {
              const c = customers.find((x) => x.id === r.customerId);
              const w = staffRows.find((s) => s.id === r.waiterId);
              return (
                <li key={r.id} className={`grid gap-2 rounded-2xl border p-3 ${r.stars <= 2 ? "border-danger/30" : "border-line"}`}>
                  <div className="flex items-center gap-2">
                    <Avatar name={c?.name ?? "?"} size="xs" />
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{c?.name ?? L("ضيف", "Guest")}</span>
                    <Stars value={r.stars} />
                  </div>
                  {r.comment ? <p className="text-[14px]">“{r.comment}”</p> : <p className="text-[13px] text-faint">{L("من غير تعليق", "No comment")}</p>}
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                    {r.tags.map((t) => <Badge key={t} size="sm">{t}</Badge>)}
                    {w ? <span>· {w.name}</span> : null}
                    <span className="flex-1" />
                    <span>{dayLabel(r.createdAt, lang)}</span>
                  </div>
                  {r.reply ? <p className="rounded-xl bg-primary-soft px-3 py-2 text-[13px] text-primary">↩ {r.reply}</p> : can("marketing.manage") && r.source === "feedback" ? (
                    <Button size="sm" variant="secondary" icon={<Reply className="size-4 flip-rtl" />} onClick={() => (setReply(r), setText(r.stars <= 2 ? L("متأسفين جدًا على اللي حصل 🙏 عايزين نعوضك — المرة الجاية علينا. ", "We're truly sorry 🙏 we'd like to make it right — your next visit is on us. ") : L("شكرًا جدًا على كلامك الحلو ❤️ مستنيينك تاني!", "Thank you so much ❤️ see you again soon!")))}>
                      {L("رد", "Reply")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact icon={<Star />} title={L("مفيش تقييمات هنا", "No reviews here")} />
        )}
      </Section>
      <Dialog open={!!reply} onClose={() => setReply(null)} title={L("رد على التقييم", "Reply to review")} description={reply?.comment}>
        {reply ? (
          <div className="grid gap-3 pb-1">
            <Textarea label={L("الرد", "Reply")} value={text} onChange={(e) => setText(e.target.value)} />
            {(() => {
              const c = customers.find((x) => x.id === reply.customerId);
              return (
                <div className="flex flex-wrap gap-2">
                  {c ? (
                    <a href={clickToChatUrl(c.phone, text)} target="_blank" rel="noreferrer" onClick={async () => {
                      await db.update("guestFeedback", reply.id, { reply: text, repliedAt: new Date().toISOString(), repliedBy: staff?.id ?? null });
                      setReply(null);
                    }} className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#1fa855] px-4 font-semibold text-white">
                      <MessageCircle className="size-5" /> {L("ابعت على واتساب", "Send on WhatsApp")}
                    </a>
                  ) : null}
                  <Button variant="secondary" onClick={async () => {
                    await db.update("guestFeedback", reply.id, { reply: text, repliedAt: new Date().toISOString(), repliedBy: staff?.id ?? null });
                    setReply(null);
                  }}>
                    {L("احفظ الرد بس", "Save reply only")}
                  </Button>
                </div>
              );
            })()}
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
