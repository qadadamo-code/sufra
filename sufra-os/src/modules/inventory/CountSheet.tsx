/** One stock count: the phone count sheet (blind), then the variance report and approval. */
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowRight, Check, ClipboardCheck, Search } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useRow } from "@/data/hooks";
import type { CountLine } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { formatMoney } from "@/lib/money";
import { Badge, Button, Card, EmptyState, Input, Money, Skeleton, Table, useToast, type Column } from "@/ui";
import { Qty, QtyInput } from "./bits";
import { approveCount, countVarianceValue, lineVariance, lineVarianceValue, saveCountLine, submitCount } from "./stock";
import { useInventory } from "./useInventory";
import { COUNT_STATUS } from "./CountsPage";

export default function CountSheet() {
  const { countId = "" } = useParams();
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const { data: count, loading } = useRow("stockCounts", countId);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const lines = useMemo(() => (count?.lines ?? []).filter((l) => !q.trim() || matches(`${inv.itemById.get(l.itemId)?.name.ar} ${inv.itemById.get(l.itemId)?.name.en}`, q)), [count, q, inv]);
  if (loading && !count) return <Skeleton className="h-96" rounded="rounded-[20px]" />;
  if (!count) return <EmptyState icon={<ClipboardCheck />} title={L("الجرد مش موجود", "Count not found")} action={<Link to="/inventory/counts" className="font-semibold text-primary">{L("رجوع", "Back")}</Link>} />;
  const open = count.status === "open";
  const done = count.lines.filter((l) => l.counted != null).length;
  const showExpected = !count.blind || !open;
  const byLoc = new Map<string, CountLine[]>();
  for (const l of lines) byLoc.set(l.locationId, [...(byLoc.get(l.locationId) ?? []), l]);
  const variance = countVarianceValue(count.lines);
  const big = Math.abs(variance) >= inv.settings.approvalVarianceValue;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/inventory/counts" className="inline-flex items-center gap-1 text-[14px] font-semibold text-primary"><ArrowRight className="size-4 ltr:rotate-180" />{L("الجرد", "Counts")}</Link>
        <Badge tone={COUNT_STATUS[count.status].tone} dot>{COUNT_STATUS[count.status][lang]}</Badge>
        <span className="text-[13.5px] text-muted">{count.locationId ? loc(inv.locationById.get(count.locationId)?.name) : L("كل الأماكن", "All locations")} · {count.blind ? L("أعمى", "blind") : L("مكشوف", "open")} · <span className="num">{done}/{count.lines.length}</span></span>
      </div>

      {open ? (
        <>
          <Input icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر على خامة", "Find an item")} aria-label={L("بحث", "Search")} />
          {[...byLoc.entries()].map(([locId, ls]) => (
            <section key={locId} className="grid gap-2">
              <h2 className="text-[15px] font-semibold text-ink-2">{loc(inv.locationById.get(locId)?.name)}</h2>
              <ul className="grid gap-2 md:grid-cols-2">
                {ls.map((l) => {
                  const it = inv.itemById.get(l.itemId);
                  if (!it) return null;
                  return (
                    <li key={`${l.itemId}:${l.locationId}`} className={`grid gap-2 rounded-2xl border p-3 ${l.counted != null ? "border-ok/40 bg-ok-soft/40" : "border-line bg-surface"}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{loc(it.name)}</span>
                        {l.counted != null ? <Check className="size-4 text-ok" aria-label={L("اتعد", "counted")} /> : null}
                        {showExpected ? <span className="text-[12.5px] text-muted">{L("المتوقع", "expected")} <Qty qty={l.expected} item={it} /></span> : null}
                      </div>
                      <QtyInput item={it} value={l.counted ?? 0} defaultUnit={it.countUnit} onChange={(v) => void saveCountLine(db, count.id, l.itemId, l.locationId, v)} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <div className="sticky bottom-3 z-10">
            <Button
              block
              size="lg"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await submitCount(db, count.id);
                  toast({ title: L("الجرد اتسلم للمراجعة", "Count submitted for review"), tone: "success" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {L("سلّم الجرد", "Submit count")} · {done}/{count.lines.length}
            </Button>
            {count.kind === "full" && done < count.lines.length ? <p className="mt-1 text-center text-[12px] text-muted">{L("في الجرد الكامل السطر الفاضي = صفر", "On a full count an empty line counts as zero")}</p> : null}
          </div>
        </>
      ) : (
        <VarianceReport lines={count.lines} />
      )}

      {count.status === "submitted" ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-[14px] text-muted">{L("صافي الفرق", "Net variance")}</p>
            <p className={`text-[22px] font-semibold ${variance < 0 ? "text-danger" : "text-ok"}`}><Money value={variance} signed /></p>
            {big ? <p className="text-[12.5px] text-warn">{L("فرق كبير — راجع قبل الاعتماد", "Large variance — double-check before approving")}</p> : null}
          </div>
          {can("inventory.manage") ? (
            <Button
              size="lg"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await approveCount(db, count.id, db.actorId);
                  toast({ title: L("اتعتمد — المخزن اتسوّى", "Approved — stock adjusted"), description: formatMoney(variance, { lang, signed: true }), tone: "success" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {L("اعتمد وسوّي المخزن", "Approve & adjust stock")}
            </Button>
          ) : (
            <Badge tone="warn">{L("مستني المدير أو الشيف", "Waiting for a manager or the chef")}</Badge>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function VarianceReport({ lines }: { lines: CountLine[] }) {
  const { L, loc } = useT();
  const inv = useInventory();
  const rows = [...lines].filter((l) => l.counted != null).sort((a, b) => Math.abs(lineVarianceValue(b)) - Math.abs(lineVarianceValue(a)));
  const cols: Column<CountLine>[] = [
    { key: "i", header: L("الخامة", "Item"), cell: (l) => <span className="font-semibold">{loc(inv.itemById.get(l.itemId)?.name)}</span> },
    { key: "e", header: L("المتوقع", "Expected"), align: "end", cell: (l) => { const it = inv.itemById.get(l.itemId); return it ? <Qty qty={l.expected} item={it} /> : null; } },
    { key: "c", header: L("المعدود", "Counted"), align: "end", cell: (l) => { const it = inv.itemById.get(l.itemId); return it ? <Qty qty={l.counted ?? 0} item={it} className="font-semibold" /> : null; } },
    { key: "d", header: L("الفرق", "Diff"), align: "end", cell: (l) => { const it = inv.itemById.get(l.itemId); const d = lineVariance(l); return it ? <Qty qty={d} item={it} className={d < 0 ? "text-danger" : d > 0 ? "text-ok" : "text-muted"} /> : null; } },
    { key: "v", header: L("القيمة", "Value"), align: "end", cell: (l) => <Money value={lineVarianceValue(l)} signed className={lineVarianceValue(l) < 0 ? "text-danger" : ""} /> },
  ];
  return (
    <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
      <Table dense columns={cols} rows={rows} rowKey={(l) => `${l.itemId}:${l.locationId}`} caption={L("تقرير الفروق", "Variance report")} />
    </div>
  );
}
