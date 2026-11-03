import { useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Camera, Factory, Search, Trash2 } from "lucide-react";
import { useSession } from "@/auth/session";
import { useDb, useLive } from "@/data/hooks";
import type { MoveKind, StockMove, WasteReason } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { matches } from "@/lib/arabic";
import { formatMoney } from "@/lib/money";
import { ago } from "@/lib/time";
import { Badge, Button, Dialog, EmptyState, Input, Money, Segmented, Select, Table, useToast, type Column } from "@/ui";
import { MOVE_LABEL, MOVE_TONE, Qty, QtyInput, WASTE_REASONS, readImage, wasteLabel } from "./bits";
import { linesCost } from "./costing";
import { moveNow, produce, recordWaste, requestTransfer, sendTransfer } from "./stock";
import { useInventory } from "./useInventory";

type Filter = "all" | "sale" | "waste" | "receive" | "transfer" | "production" | "count";
const FILTER_KINDS: Record<Filter, MoveKind[] | null> = {
  all: null,
  sale: ["sale", "sale_reversal"],
  waste: ["waste", "staff_meal"],
  receive: ["receive", "opening"],
  transfer: ["transfer_in", "transfer_out"],
  production: ["production_in", "production_out"],
  count: ["count_adjust"],
};

export default function MovesPage() {
  const { L, lang, loc } = useT();
  const { can } = useSession();
  const inv = useInventory();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<null | "waste" | "transfer" | "produce">(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const kinds = FILTER_KINDS[filter];
  const moves = useLive("stockMoves", { ...(kinds ? { where: { kind: kinds } } : {}), orderBy: [{ field: "at", dir: "desc" }], limit: 400 }).data;
  const rows = useMemo(() => {
    const n = q.trim();
    return moves.filter((m) => (!inv.branchId || m.branchId === inv.branchId) && (!n || matches(`${inv.itemById.get(m.itemId)?.name.ar} ${inv.itemById.get(m.itemId)?.name.en} ${m.note}`, n)));
  }, [moves, q, inv]);
  const cols: Column<StockMove>[] = [
    { key: "at", header: L("إمتى", "When"), cell: (m) => <span className="text-[13px] text-muted">{ago(m.at, lang)}</span>, width: "110px" },
    { key: "item", header: L("الخامة", "Item"), cell: (m) => <span className="font-semibold">{loc(inv.itemById.get(m.itemId)?.name)}</span> },
    { key: "kind", header: L("الحركة", "Move"), cell: (m) => <Badge size="sm" tone={MOVE_TONE[m.kind] ?? "neutral"}>{MOVE_LABEL[m.kind][lang]}</Badge> },
    { key: "qty", header: L("الكمية", "Qty"), align: "end", cell: (m) => { const it = inv.itemById.get(m.itemId); return it ? <Qty qty={m.qty} item={it} className={m.qty > 0 ? "text-ok" : ""} /> : null; } },
    { key: "value", header: L("القيمة", "Value"), align: "end", hideOnMobile: true, cell: (m) => <Money value={m.value} signed /> },
    { key: "loc", header: L("المكان", "Location"), hideOnMobile: true, cell: (m) => <span className="text-[13px]">{loc(inv.locationById.get(m.locationId)?.name)}</span> },
    {
      key: "note", header: L("ملاحظة", "Note"), hideOnMobile: true, cell: (m) => (
        <span className="flex items-center gap-2 text-[13px] text-muted">
          {m.reason ? <Badge size="sm" tone="danger">{wasteLabel(m.reason, lang)}</Badge> : null}
          <span className="truncate">{m.note}</span>
          {m.photo ? <button type="button" onClick={() => setPhoto(m.photo)} aria-label={L("الصورة", "Photo")}><Camera className="size-4 text-primary" /></button> : null}
        </span>
      ),
    },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input wrapClassName="min-w-56 flex-1" icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder={L("دوّر بالخامة أو الملاحظة", "Search item or note")} aria-label={L("بحث", "Search")} />
        {can("inventory.count") ? <Button variant="danger-soft" icon={<Trash2 className="size-4" />} onClick={() => setDialog("waste")}>{L("هالك", "Waste")}</Button> : null}
        {can("inventory.manage") ? <Button variant="secondary" icon={<ArrowLeftRight className="size-4" />} onClick={() => setDialog("transfer")}>{L("تحويل", "Transfer")}</Button> : null}
        {can("inventory.manage") ? <Button variant="secondary" icon={<Factory className="size-4" />} onClick={() => setDialog("produce")}>{L("إنتاج", "Produce")}</Button> : null}
      </div>
      <div className="-mx-4 overflow-x-auto px-4 no-scrollbar md:mx-0 md:px-0">
        <Segmented
          label={L("نوع الحركة", "Move type")}
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: L("الكل", "All") },
            { value: "sale", label: L("بيع", "Sales") },
            { value: "waste", label: L("هالك", "Waste") },
            { value: "receive", label: L("استلام", "Received") },
            { value: "transfer", label: L("تحويلات", "Transfers") },
            { value: "production", label: L("إنتاج", "Production") },
            { value: "count", label: L("جرد", "Counts") },
          ]}
        />
      </div>
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-sf-sm">
        <Table dense columns={cols} rows={rows} rowKey={(m) => m.id} caption={L("حركة المخزن", "Stock movements")} empty={<EmptyState compact icon={<ArrowLeftRight />} title={L("مفيش حركة", "No movements")} />} />
      </div>
      <WasteDialog open={dialog === "waste"} onClose={() => setDialog(null)} />
      <TransferDialog open={dialog === "transfer"} onClose={() => setDialog(null)} />
      <ProduceDialog open={dialog === "produce"} onClose={() => setDialog(null)} />
      <Dialog open={!!photo} onClose={() => setPhoto(null)} title={L("صورة الهالك", "Waste photo")}>
        {photo ? <img src={photo} alt="" className="mx-auto max-h-[60vh] rounded-2xl" /> : null}
      </Dialog>
    </div>
  );
}

function ItemSelect({ value, onChange, label, filter }: { value: string; onChange: (id: string) => void; label: string; filter?: (id: string) => boolean }) {
  const { lang } = useT();
  const inv = useInventory();
  const opts = inv.items.filter((i) => i.active && (!filter || filter(i.id))).sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang));
  return <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} options={[{ value: "", label: "—" }, ...opts.map((i) => ({ value: i.id, label: i.name[lang] }))]} />;
}

export function WasteDialog({ open, onClose, itemId: initial }: { open: boolean; onClose: () => void; itemId?: string }) {
  const { L, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const [itemId, setItemId] = useState(initial ?? "");
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState<WasteReason>("spoiled");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const item = inv.itemById.get(itemId);
  const home = item ? inv.locations.find((l) => item.defaultLocationIds.includes(l.id)) ?? inv.locations[0] : null;
  const value = item ? Math.round(qty * inv.unitCost(item.id)) : 0;
  const reset = () => {
    setQty(0);
    setNote("");
    setPhoto(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={reset}
      title={L("تسجيل هالك", "Record waste")}
      description={L("الهالك بيتخصم من المخزن وبيتقيد مصروف (٥٢٠١) بالتكلفة", "Waste leaves stock and is expensed (5201) at cost")}
      footer={
        <Button
          block
          size="lg"
          variant="danger"
          loading={busy}
          disabled={!item || qty <= 0 || !home || !inv.branchId}
          onClick={async () => {
            if (!item || !home || !inv.branchId) return;
            setBusy(true);
            try {
              await recordWaste(db, { itemId: item.id, locationId: home.id, branchId: inv.branchId, qty, reason, note, photo });
              toast({ title: L("اتسجل الهالك", "Waste recorded"), description: formatMoney(value, { lang }), tone: "success" });
              reset();
            } finally {
              setBusy(false);
            }
          }}
        >
          {L("سجّل", "Record")} {value ? formatMoney(value, { lang }) : ""}
        </Button>
      }
    >
      <div className="grid gap-4 pb-1">
        <ItemSelect label={L("الخامة", "Item")} value={itemId} onChange={setItemId} />
        {item ? <QtyInput key={item.id} item={item} value={qty} onChange={setQty} label={L("الكمية", "Quantity")} autoFocus /> : null}
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={L("السبب", "Reason")}>
          {WASTE_REASONS.filter((r) => r.id !== "void_after_send").map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={reason === r.id} onClick={() => setReason(r.id)} className={`h-10 rounded-full border px-3.5 text-[13.5px] font-semibold ${reason === r.id ? "border-danger bg-danger-soft text-danger" : "border-line hover:bg-surface-2"}`}>
              {r[lang]}
            </button>
          ))}
        </div>
        <Input label={L("ملاحظة", "Note")} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex items-center gap-3">
          <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await readImage(f, 480)); }} />
          <Button variant="secondary" icon={<Camera className="size-4" />} onClick={() => file.current?.click()}>{photo ? L("غيّر الصورة", "Change photo") : L("صوّر الهالك", "Take a photo")}</Button>
          {photo ? <img src={photo} alt="" className="size-14 rounded-xl object-cover" /> : null}
        </div>
      </div>
    </Dialog>
  );
}

export function TransferDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { L, loc, lang } = useT();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const item = inv.itemById.get(itemId);
  const all = inv.allLocations.filter((l) => l.active);
  const fromLoc = inv.locationById.get(from);
  const toLoc = inv.locationById.get(to);
  const crossBranch = !!fromLoc && !!toLoc && fromLoc.branchId !== toLoc.branchId;
  const opt = all.map((l) => ({ value: l.id, label: loc(l.name) }));
  const fromQty = item && from ? inv.allLevels.filter((l) => l.itemId === item.id && l.locationId === from).reduce((a, l) => a + l.qty, 0) : 0;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={L("تحويل بين الأماكن", "Transfer between locations")}
      description={L("في نفس الفرع بيتنقل على طول؛ بين فرعين بيتبعت ويستناه الفرع التاني يستلم", "Within a branch it moves at once; between branches it is dispatched and the other branch receives it")}
      footer={
        <Button
          block
          size="lg"
          loading={busy}
          disabled={!item || qty <= 0 || !from || !to || from === to}
          onClick={async () => {
            if (!fromLoc || !toLoc || !item) return;
            setBusy(true);
            try {
              const t = { fromBranchId: fromLoc.branchId, fromLocationId: from, toBranchId: toLoc.branchId, toLocationId: to, note: "", lines: [{ itemId: item.id, qty }] };
              if (crossBranch) await sendTransfer(db, (await requestTransfer(db, t)).id);
              else await moveNow(db, t);
              toast({ title: crossBranch ? L("اتبعت — مستني الاستلام", "Dispatched — awaiting receipt") : L("اتنقل", "Moved"), tone: "success" });
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {L("حوّل", "Transfer")}
        </Button>
      }
    >
      <div className="grid gap-4 pb-1">
        <ItemSelect label={L("الخامة", "Item")} value={itemId} onChange={setItemId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={L("من", "From")} value={from} onChange={(e) => setFrom(e.target.value)} options={[{ value: "", label: "—" }, ...opt]} />
          <Select label={L("إلى", "To")} value={to} onChange={(e) => setTo(e.target.value)} options={[{ value: "", label: "—" }, ...opt]} />
        </div>
        {item ? <QtyInput key={item.id} item={item} value={qty} onChange={setQty} label={L("الكمية", "Quantity")} /> : null}
        {item && from ? <p className="text-[13px] text-muted">{L("الموجود هناك", "On hand there")}: <Qty qty={fromQty} item={item} /> {lang === "ar" ? "" : ""}</p> : null}
      </div>
    </Dialog>
  );
}

export function ProduceDialog({ open, onClose, prepId }: { open: boolean; onClose: () => void; prepId?: string }) {
  const { L, lang, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const inv = useInventory();
  const preps = inv.items.filter((i) => i.kind === "prep" && i.active);
  const [itemId, setItemId] = useState(prepId ?? "");
  const [batches, setBatches] = useState(1);
  const [busy, setBusy] = useState(false);
  const item = inv.itemById.get(itemId);
  const recipe = item ? inv.recipeFor("prep", item.id) : null;
  const cost = recipe ? linesCost(recipe.lines, inv.costCtx) * batches : 0;
  const home = item ? inv.locations.find((l) => item.defaultLocationIds.includes(l.id)) ?? inv.locations.find((l) => l.kind === "kitchen") : null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={L("إنتاج تحضيرات", "Produce prep items")}
      description={L("المكونات بتتخصم بمتوسط تكلفتها والتحضير بيدخل المخزن بنفس القيمة", "Ingredients leave at average cost; the prep item enters stock at exactly that value")}
      footer={
        <Button block size="lg" loading={busy} disabled={!recipe || batches <= 0 || !home || !inv.branchId} onClick={async () => {
          if (!item || !home || !inv.branchId) return;
          setBusy(true);
          try {
            const r = await produce(db, { prepItemId: item.id, batches, locationId: home.id, branchId: inv.branchId });
            toast({ title: L("اتعمل", "Produced"), description: `${loc(item.name)} · ${formatMoney(r.value, { lang })}`, tone: "success" });
            onClose();
          } finally {
            setBusy(false);
          }
        }}>
          {L("اعمل", "Produce")} {cost ? formatMoney(cost, { lang }) : ""}
        </Button>
      }
    >
      <div className="grid gap-4 pb-1">
        <Select label={L("التحضير", "Prep item")} value={itemId} onChange={(e) => setItemId(e.target.value)} options={[{ value: "", label: "—" }, ...preps.map((p) => ({ value: p.id, label: loc(p.name) }))]} />
        <Input label={L("عدد التشغيلات", "Batches")} type="number" inputMode="decimal" min={0.25} step={0.25} value={batches} onChange={(e) => setBatches(Math.max(0, Number(e.target.value) || 0))} className="num" />
        {item && recipe ? (
          <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
            <p className="mb-2 text-[13px] font-semibold text-ink-2">
              {L("هيطلع", "Yields")} <Qty qty={recipe.yieldQty * batches} item={item} /> · {L("هيستخدم", "uses")}:
            </p>
            <ul className="grid gap-1 text-[13px]">
              {recipe.lines.map((l) => {
                const it = inv.itemById.get(l.itemId);
                const have = inv.onHand.get(l.itemId)?.qty ?? 0;
                const need = l.qty * batches;
                return it ? (
                  <li key={l.itemId} className="flex justify-between gap-2">
                    <span>{loc(it.name)}</span>
                    <span className={need > have ? "text-danger" : "text-muted"}>
                      <Qty qty={need} item={it} /> / <Qty qty={have} item={it} />
                    </span>
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
