/** /settings/delivery — delivery zones on the map (polygon or radius ring) + delivery rules. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Circle, Hexagon, MapPinned, Plus, Save, Trash2, Undo2, Settings2, Store } from "lucide-react";
import { useDb, useLive } from "@/data/hooks";
import type { DeliveryZoneRow, LatLng, ZoneGeometry } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { major } from "@/lib/money";
import { latinDigits } from "@/lib/arabic";
import { Badge, Button, Card, EmptyState, Input, Money, Segmented, Select, Switch, useToast } from "@/ui";
import { PageHeader } from "@/shell/PageHeader";
import { SettingsNav } from "@/modules/settings/SettingsNav";
import { areaKm2 } from "./geo";
import { deliverySettings } from "./settings";
import { DeliveryMap, type MapHandle } from "./map/DeliveryMap";

const COLORS = ["#0d5a53", "#c2412d", "#2f6f9f", "#a8700c", "#6b4fa0", "#1d7f4a", "#9a3b6b"];

type Draft = Omit<DeliveryZoneRow, "id" | "restaurantId" | "createdAt" | "updatedAt"> & { id: string | null };

const toMajor = (u: number | null) => (u === null ? "" : String(u / 100_000));
const fromMajor = (s: string) => (s.trim() === "" ? null : major(Number(latinDigits(s)) || 0));

export default function ZonesPage() {
  const { L } = useT();
  const [tab, setTab] = useState<"zones" | "rules">("zones");
  return (
    <div className="mx-auto grid max-w-[1500px] gap-5">
      <SettingsNav />
      <PageHeader
        icon={<MapPinned />}
        title={L("التوصيل", "Delivery")}
        subtitle={L("ارسم المناطق على الخريطة: رسوم، أقل طلب، الوقت، التوصيل المجاني والمواعيد", "Draw zones on the map: fee, minimum, ETA, free-delivery threshold and hours")}
        actions={
          <Segmented
            label={L("القسم", "Section")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "zones", label: L("المناطق", "Zones"), icon: <Hexagon /> },
              { value: "rules", label: L("القواعد", "Rules"), icon: <Settings2 /> },
            ]}
          />
        }
      />
      {tab === "zones" ? <ZonesEditor /> : <Rules />}
    </div>
  );
}

function blank(n: number): Draft {
  return { id: null, branchId: null, slug: `zone-${n}`, name: { ar: `منطقة ${n}`, en: `Zone ${n}` }, fee: major(30), minOrder: major(150), freeOver: null, etaMin: 30, etaMax: 45, geometry: null, hours: null, color: COLORS[n % COLORS.length], sort: n, active: true };
}

function ZonesEditor() {
  const { L, loc } = useT();
  const db = useDb();
  const { toast } = useToast();
  const zones = useLive("deliveryZones", { orderBy: [{ field: "sort" }] });
  const settings = useLive("settings");
  const origin = deliverySettings(settings.data[0]).origin;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tool, setTool] = useState<"polygon" | "ring">("polygon");
  const [busy, setBusy] = useState(false);
  const mapRef = useRef<MapHandle>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (!draft && zones.data[0]) edit(zones.data[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zones.data.length]);

  function edit(z: DeliveryZoneRow) {
    const { restaurantId: _r, createdAt: _c, updatedAt: _u, ...rest } = z;
    setDraft({ ...rest });
    setTool(z.geometry?.kind ?? "polygon");
  }
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const points = draft?.geometry?.kind === "polygon" ? draft.geometry.points : [];
  const pick = (p: LatLng) => {
    if (!draft) return;
    if (tool === "ring") set({ geometry: { kind: "ring", center: p, radiusKm: draft.geometry?.kind === "ring" ? draft.geometry.radiusKm : 1 } });
    else set({ geometry: { kind: "polygon", points: [...points, p] } });
  };
  const movePoint = (i: number, p: LatLng) => set({ geometry: { kind: "polygon", points: points.map((x, k) => (k === i ? p : x)) } });

  const shapes = useMemo(
    () =>
      zones.data
        .filter((z) => z.geometry && z.id !== draft?.id)
        .map((z) => ({ id: z.id, geometry: z.geometry!, color: z.color, label: loc(z.name), dim: !z.active || editing }))
        .concat(draft?.geometry && (draft.geometry.kind === "ring" || draft.geometry.points.length > 2) ? [{ id: "draft", geometry: draft.geometry, color: draft.color, label: loc(draft.name), dim: false }] : []),
    [zones.data, draft, editing, loc],
  );

  const valid = !!draft && !!draft.name.ar.trim() && !!draft.slug.trim() && !!draft.geometry && (draft.geometry.kind === "ring" ? draft.geometry.radiusKm > 0 : draft.geometry.points.length >= 3) && draft.etaMax >= draft.etaMin;
  const save = async () => {
    if (!draft || !valid) return;
    setBusy(true);
    try {
      const { id, ...row } = draft;
      const slug = row.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const clash = zones.data.find((z) => z.slug === slug && z.id !== id);
      if (clash) throw new Error(L("الكود ده مستخدم لمنطقة تانية", "That code is used by another zone"));
      const out = id ? await db.update("deliveryZones", id, { ...row, slug }) : await db.insert("deliveryZones", { ...row, slug });
      await db.audit(id ? "delivery.zone_update" : "delivery.zone_create", "deliveryZones", out.id, { slug, fee: row.fee, minOrder: row.minOrder });
      edit(out);
      toast({ title: L("المنطقة اتحفظت — الأونلاين بيستخدمها على طول", "Zone saved — online ordering uses it right away"), tone: "success" });
    } catch (e) {
      toast({ title: String((e as Error).message), tone: "error" });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!draft?.id) return setDraft(null);
    await db.remove("deliveryZones", draft.id);
    await db.audit("delivery.zone_delete", "deliveryZones", draft.id, { slug: draft.slug });
    setDraft(null);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="grid content-start gap-3">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[15px] font-bold">{L(`${zones.data.length} منطقة`, `${zones.data.length} zones`)}</p>
          <Button size="sm" icon={<Plus />} onClick={() => setDraft(blank(zones.data.length + 1))}>
            {L("منطقة جديدة", "New zone")}
          </Button>
        </div>
        <ul className="grid gap-1.5">
          {zones.data.map((z) => (
            <li key={z.id}>
              <button type="button" onClick={() => edit(z)} className={cn("flex w-full items-center gap-3 rounded-2xl border bg-surface px-3 py-2.5 text-start", draft?.id === z.id ? "border-primary ring-2 ring-primary/20" : "border-line hover:border-line-strong", !z.active && "opacity-60")}>
                <span className="size-3.5 shrink-0 rounded-full" style={{ background: z.color }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-semibold">{loc(z.name)}</span>
                  <span className="block text-[12px] text-muted">
                    {z.geometry?.kind === "ring" ? L(`دايرة ${z.geometry.radiusKm} كم`, `${z.geometry.radiusKm} km ring`) : z.geometry ? L(`${z.geometry.points.length} نقطة`, `${z.geometry.points.length} points`) : L("من غير شكل", "no shape")} · <span className="num">{areaKm2(z.geometry).toFixed(1)} km²</span>
                  </span>
                </span>
                <span className="text-end text-[12.5px]">
                  <Money value={z.fee} compact className="block font-bold" />
                  <span className="num text-muted" dir="ltr">{z.etaMin}–{z.etaMax}′</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!zones.data.length && !draft ? <EmptyState compact icon={<Hexagon />} title={L("مفيش مناطق", "No zones yet")} body={L("الأونلاين بيستخدم المناطق الافتراضية لحد ما ترسم", "Online ordering uses the default list until you draw some")} /> : null}

        {draft ? (
          <Card className="grid gap-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              <Input label={L("الاسم (عربي)", "Name (Arabic)")} value={draft.name.ar} onChange={(e) => set({ name: { ...draft.name, ar: e.target.value } })} />
              <Input label={L("الاسم (إنجليزي)", "Name (English)")} value={draft.name.en} onChange={(e) => set({ name: { ...draft.name, en: e.target.value } })} dir="ltr" />
              <Input label={L("الرسوم (ج.م)", "Fee (EGP)")} inputMode="decimal" dir="ltr" value={toMajor(draft.fee)} onChange={(e) => set({ fee: fromMajor(e.target.value) ?? 0 })} />
              <Input label={L("أقل طلب", "Minimum order")} inputMode="decimal" dir="ltr" value={toMajor(draft.minOrder)} onChange={(e) => set({ minOrder: fromMajor(e.target.value) ?? 0 })} />
              <Input label={L("توصيل مجاني من", "Free delivery from")} hint={L("فاضي = مفيش", "empty = never")} inputMode="decimal" dir="ltr" value={toMajor(draft.freeOver)} onChange={(e) => set({ freeOver: fromMajor(e.target.value) })} />
              <div className="grid grid-cols-2 gap-1.5">
                <Input label={L("الوقت من", "ETA from")} inputMode="numeric" dir="ltr" value={String(draft.etaMin)} onChange={(e) => set({ etaMin: Number(latinDigits(e.target.value)) || 0 })} />
                <Input label={L("لحد", "to")} inputMode="numeric" dir="ltr" value={String(draft.etaMax)} onChange={(e) => set({ etaMax: Number(latinDigits(e.target.value)) || 0 })} />
              </div>
              <Input label={L("الكود", "Code")} hint={L("بيتبعت مع طلب الأونلاين", "sent with online orders")} dir="ltr" value={draft.slug} onChange={(e) => set({ slug: e.target.value })} />
              <Select label={L("اللون", "Colour")} value={draft.color} onChange={(e) => set({ color: e.target.value })} options={COLORS.map((c) => ({ value: c, label: c }))} />
            </div>
            <div className="grid gap-2 rounded-2xl bg-surface-2 p-3">
              <Switch checked={!!draft.hours} onChange={(v) => set({ hours: v ? { open: "12:00", close: "23:00" } : null })} label={L("مواعيد خاصة للمنطقة", "Zone-specific hours")} description={L("مقفول = طول ما الفرع فاتح", "Off = whenever the branch is open")} />
              {draft.hours ? (
                <div className="grid grid-cols-2 gap-2">
                  <Input type="time" label={L("من", "From")} value={draft.hours.open} onChange={(e) => set({ hours: { ...draft.hours!, open: e.target.value } })} dir="ltr" />
                  <Input type="time" label={L("لحد", "Until")} value={draft.hours.close} onChange={(e) => set({ hours: { ...draft.hours!, close: e.target.value } })} dir="ltr" />
                </div>
              ) : null}
              <Switch checked={draft.active} onChange={(v) => set({ active: v })} label={L("المنطقة شغالة", "Zone active")} />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" className="text-danger" icon={<Trash2 />} onClick={remove}>
                {draft.id ? L("امسح", "Delete") : L("إلغاء", "Discard")}
              </Button>
              <Button className="flex-1" icon={<Save />} disabled={!valid} loading={busy} onClick={save}>
                {L("احفظ", "Save")}
              </Button>
            </div>
          </Card>
        ) : null}
      </div>

      <div className="grid content-start gap-2 lg:sticky lg:top-4 lg:self-start">
        {draft ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface p-2">
            <Segmented
              size="sm"
              label={L("الشكل", "Shape")}
              value={tool}
              onChange={(t) => {
                setTool(t);
                if (draft.geometry && draft.geometry.kind !== t) set({ geometry: null });
              }}
              options={[
                { value: "polygon", label: L("شكل حر", "Polygon"), icon: <Hexagon /> },
                { value: "ring", label: L("دايرة", "Radius"), icon: <Circle /> },
              ]}
            />
            {tool === "polygon" ? (
              <>
                <span className="text-[12.5px] text-muted">{L("اضغط على الخريطة تضيف نقطة، واسحب النقط تعدّلها", "Click the map to add points, drag to adjust")}</span>
                <Button size="sm" variant="ghost" icon={<Undo2 />} disabled={!points.length} onClick={() => set({ geometry: points.length > 1 ? { kind: "polygon", points: points.slice(0, -1) } : null })}>
                  {L("تراجع", "Undo")}
                </Button>
              </>
            ) : (
              <>
                <span className="text-[12.5px] text-muted">{L("اضغط تحدد المركز", "Click to set the centre")}</span>
                {draft.geometry?.kind === "ring" ? (
                  <label className="flex items-center gap-2 text-[13px] font-semibold">
                    <input type="range" min={0.3} max={6} step={0.1} value={draft.geometry.radiusKm} onChange={(e) => set({ geometry: { ...(draft.geometry as Extract<ZoneGeometry, { kind: "ring" }>), radiusKm: Number(e.target.value) } })} className="w-36 accent-[var(--sf-primary)]" />
                    <span className="num w-14">{draft.geometry.radiusKm.toFixed(1)} km</span>
                  </label>
                ) : null}
              </>
            )}
            <Button size="sm" variant="ghost" className="ms-auto" onClick={() => mapRef.current?.fit()}>
              {L("اعرض الكل", "Fit")}
            </Button>
          </div>
        ) : null}
        <DeliveryMap
          ref={mapRef}
          className="h-[min(70vh,680px)] rounded-[22px] border border-line shadow-sf-sm"
          ariaLabel={L("خريطة مناطق التوصيل", "Delivery zones map")}
          shapes={shapes}
          pins={[{ id: "kitchen", kind: "kitchen", lat: origin.lat, lng: origin.lng, label: L("المطبخ", "Kitchen") }]}
          editPoints={tool === "polygon" ? points : []}
          onEditPoint={movePoint}
          onPick={draft ? pick : undefined}
          onShapeSelect={(id) => {
            const z = zones.data.find((x) => x.id === id);
            if (z) edit(z);
          }}
          center={origin}
          zoom={13}
          fitKey={zones.data.length}
        />
      </div>
    </div>
  );
}

function Rules() {
  const { L } = useT();
  const db = useDb();
  const { toast } = useToast();
  const settings = useLive("settings");
  const s = settings.data[0] ?? null;
  const cfg = deliverySettings(s);
  const [pickOrigin, setPickOrigin] = useState(false);
  const save = async (patch: Partial<typeof cfg>) => {
    if (!s) return;
    await db.update("settings", s.id, { delivery: { ...cfg, ...patch } });
    toast({ title: L("اتحفظ", "Saved"), tone: "success", duration: 1200 });
  };
  const num = (k: "defaultPrepMin" | "speedKmh" | "lateGraceMin" | "autoRejectMin" | "maxBatch", label: string, hint?: string) => (
    <Input label={label} hint={hint} inputMode="numeric" dir="ltr" defaultValue={String(cfg[k])} onBlur={(e) => save({ [k]: Math.max(0, Number(latinDigits(e.target.value)) || 0) } as Partial<typeof cfg>)} />
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="grid content-start gap-3 p-5">
        <p className="text-[15.5px] font-bold">{L("القبول", "Accepting")}</p>
        <Switch checked={cfg.autoAccept.online_delivery} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, online_delivery: v } })} label={L("قبول تلقائي — توصيل أونلاين", "Auto-accept online delivery")} />
        <Switch checked={cfg.autoAccept.online_takeaway} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, online_takeaway: v } })} label={L("قبول تلقائي — استلام أونلاين", "Auto-accept online pickup")} />
        <Switch checked={cfg.autoAccept.phone} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, phone: v } })} label={L("قبول تلقائي — تليفون", "Auto-accept phone")} />
        <Switch checked={cfg.autoAccept.aggregator} onChange={(v) => save({ autoAccept: { ...cfg.autoAccept, aggregator: v } })} label={L("قبول تلقائي — تطبيقات", "Auto-accept delivery apps")} />
        <div className="grid grid-cols-2 gap-2">
          {num("autoRejectMin", L("رفض تلقائي بعد (د)", "Auto-reject after (min)"), L("٠ = أبدًا", "0 = never"))}
          {num("defaultPrepMin", L("وقت التجهيز الافتراضي (د)", "Default prep (min)"))}
        </div>
        <Switch checked={cfg.sound} onChange={(v) => save({ sound: v })} label={L("صوت تنبيه للطلبات الجديدة", "Chime on new orders")} />
      </Card>
      <Card className="grid content-start gap-3 p-5">
        <p className="text-[15.5px] font-bold">{L("التوزيع والتسليم", "Dispatch & hand-over")}</p>
        <div className="grid grid-cols-2 gap-2">
          {num("speedKmh", L("سرعة الطيار (كم/س)", "Rider speed (km/h)"), L("لحساب الوقت المتوقع", "for ETAs"))}
          {num("lateGraceMin", L("سماح التأخير (د)", "Late grace (min)"))}
          <Input label={L("مسافة التجميع (كم)", "Batch radius (km)")} inputMode="decimal" dir="ltr" defaultValue={String(cfg.batchRadiusKm)} onBlur={(e) => save({ batchRadiusKm: Math.max(0.1, Number(latinDigits(e.target.value)) || 1) })} />
          {num("maxBatch", L("أقصى طلبات في الرحلة", "Max orders per trip"))}
        </div>
        <Select
          label={L("إثبات التسليم", "Proof of delivery")}
          value={cfg.proof}
          onChange={(e) => save({ proof: e.target.value as typeof cfg.proof })}
          options={[
            { value: "either", label: L("كود العميل أو صورة", "Customer code or photo") },
            { value: "otp", label: L("كود العميل بس", "Customer code only") },
            { value: "photo", label: L("صورة بس", "Photo only") },
            { value: "none", label: L("مش مطلوب", "Not required") },
          ]}
        />
        <div className="grid gap-2">
          <div className="flex items-center gap-2">
            <Store className="size-4.5 text-muted" />
            <p className="flex-1 text-[13.5px] font-semibold">{L("مكان المطبخ (بداية كل توصيلة)", "Kitchen location (every trip starts here)")}</p>
            <Badge tone={pickOrigin ? "primary" : "neutral"}>{pickOrigin ? L("اضغط على الخريطة", "Click the map") : `${cfg.origin.lat.toFixed(4)}, ${cfg.origin.lng.toFixed(4)}`}</Badge>
            <Button size="sm" variant="secondary" onClick={() => setPickOrigin((x) => !x)}>
              {pickOrigin ? L("إلغاء", "Cancel") : L("غيّر", "Change")}
            </Button>
          </div>
          <DeliveryMap
            className="h-[240px] rounded-2xl border border-line"
            ariaLabel={L("مكان المطبخ", "Kitchen location")}
            pins={[{ id: "kitchen", kind: "kitchen", lat: cfg.origin.lat, lng: cfg.origin.lng }]}
            center={cfg.origin}
            zoom={15}
            onPick={
              pickOrigin
                ? (p) => {
                    setPickOrigin(false);
                    void save({ origin: p });
                  }
                : undefined
            }
          />
        </div>
      </Card>
    </div>
  );
}
