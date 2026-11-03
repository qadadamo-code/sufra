import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ClipboardCheck, Plus } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { StockCategory, StockCount } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { ago } from "@/lib/time";
import { Badge, Button, Dialog, EmptyState, Money, Segmented, Select, Switch, Table, useToast, type Column } from "@/ui";
import { CATEGORY_LABEL } from "./bits";
import { startCount } from "./stock";
import { useInventory } from "./useInventory";

export const COUNT_STATUS: Record<StockCount["status"], { ar: string; en: string; tone: "info" | "warn" | "ok" | "danger" }> = {
  open: { ar: "شغّال", en: "In progress", tone: "info" },
  submitted: { ar: "مستني الاعتماد", en: "Awaiting approval", tone: "warn" },
  approved: { ar: "اتعتمد", en: "Approved", tone: "ok" },
  cancelled: { ar: "اتلغى", en: "Cancelled", tone: "danger" },
};

export default function CountsPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const nav = useNavigate();
  const inv = useInventory();
  const [params, setParams] = useSearchParams();
  const counts = useLive("stockCounts", { orderBy: [{ field: "startedAt", dir: "desc" }] }).data.filter((c) => !inv.branchId || c.branchId === inv.branchId);
  const members = useLive("memberships").data;
  const [start, setStart] = useState(params.get("new") === "1");
  useEffect(() => {
    if (params.get("new") === "1") setStart(true);
  }, [params]);
  const cols: Column<StockCount>[] = [
    { key: "when", header: L("بدأ", "Started"), cell: (c) => <span className="text-[13.5px]">{ago(c.startedAt, lang)}</span> },
    { key: "where", header: L("المكان", "Where"), cell: (c) => <span className="font-semibold">{c.locationId ? loc(inv.locationById.get(c.locationId)?.name) : L("كل الأماكن", "All locations")}</span> },
    { key: "kind", header: L("النوع", "Type"), hideOnMobile: true, cell: (c) => <span className="text-[13px]">{c.kind === "full" ? L("جرد كامل", "Full") : L("جرد جزئي", "Partial")}{c.blind ? ` · ${L("أعمى", "blind")}` : ""}</span> },
    { key: "by", header: L("مين", "By"), hideOnMobile: true, cell: (c) => <span className="text-[13px] text-muted">{members.find((m) => m.id === c.startedBy)?.name ?? "—"}</span> },
    { key: "lines", header: L("سطور", "Lines"), align: "end", hideOnMobile: true, cell: (c) => <span className="num">{c.lines.filter((l) => l.counted != null).length}/{c.lines.length}</span> },
    { key: "var", header: L("الفرق", "Variance"), align: "end", cell: (c) => (c.status === "open" ? "—" : <Money value={c.varianceValue} signed className={c.varianceValue < 0 ? "text-danger" : "text-ok"} />) },
    { key: "st", header: L("الحالة", "Status"), align: "end", cell: (c) => <Badge size="sm" tone={COUNT_STATUS[c.status].tone} dot>{COUNT_STATUS[c.status][lang]}</Badge> },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-[13.5px] text-muted">{L("الجرد الأعمى من الموبايل: اللي بيعد مش بيشوف الرصيد المتوقع. المدير بيراجع الفروق ويعتمد، والتسوية بتتقيد على حساب فروق المخزون (٥٤٠١).", "Blind counts on the phone: the counter never sees the expected figure. A manager reviews the variance and approves; the adjustment posts to inventory variance (5401).")}</p>
        {can("inventory.count") ? <Button icon={<Plus className="size-4" />} onClick={() => setStart(true)}>{L("جرد جديد", "New count")}</Button> : null}
      </div>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table columns={cols} rows={counts} rowKey={(c) => c.id} onRowClick={(c) => nav(`/inventory/counts/${c.id}`)} caption={L("الجرد", "Counts")} empty={<EmptyState compact icon={<ClipboardCheck />} title={L("مفيش جرد لسه", "No counts yet")} />} />
      </div>
      <StartCountDialog
        open={start}
        onClose={() => {
          setStart(false);
          if (params.get("new")) setParams({}, { replace: true });
        }}
      />
    </div>
  );
}

function StartCountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const nav = useNavigate();
  const { toast } = useToast();
  const inv = useInventory();
  const [kind, setKind] = useState<"full" | "partial">("partial");
  const [locationId, setLocationId] = useState("");
  const [category, setCategory] = useState<StockCategory | "">("");
  const [blind, setBlind] = useState(true);
  const [busy, setBusy] = useState(false);
  const cats = [...new Set(inv.items.map((i) => i.category))];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={L("جرد جديد", "New stock count")}
      footer={
        <Button block size="lg" loading={busy} disabled={!inv.branchId} onClick={async () => {
          if (!inv.branchId) return;
          setBusy(true);
          try {
            const itemIds = kind === "partial" && category ? inv.items.filter((i) => i.category === category).map((i) => i.id) : undefined;
            const c = await startCount(db, { branchId: inv.branchId, locationId: locationId || null, kind, blind, itemIds });
            if (!c.lines.length) toast({ title: L("مفيش خامات في الاختيار ده", "Nothing to count in that selection"), tone: "warn" });
            onClose();
            nav(`/inventory/counts/${c.id}`);
          } finally {
            setBusy(false);
          }
        }}>
          {L("ابدأ", "Start")}
        </Button>
      }
    >
      <div className="grid gap-4 pb-1">
        <Segmented block label={L("النوع", "Type")} value={kind} onChange={setKind} options={[{ value: "partial", label: L("جزئي (قسم أو مكان)", "Partial (cycle)") }, { value: "full", label: L("كامل", "Full") }]} />
        <Select label={L("المكان", "Location")} value={locationId} onChange={(e) => setLocationId(e.target.value)} options={[{ value: "", label: L("كل الأماكن", "All locations") }, ...inv.locations.map((l) => ({ value: l.id, label: loc(l.name) }))]} />
        {kind === "partial" ? <Select label={L("القسم", "Category")} value={category} onChange={(e) => setCategory(e.target.value as StockCategory)} options={[{ value: "", label: L("كل الأقسام", "All categories") }, ...cats.map((c) => ({ value: c, label: CATEGORY_LABEL[c][lang] }))]} /> : null}
        <Switch checked={blind} onChange={setBlind} label={L("جرد أعمى", "Blind count")} description={L("اللي بيعد مش هيشوف الكمية المتوقعة", "The counter does not see the expected quantity")} />
      </div>
    </Dialog>
  );
}
