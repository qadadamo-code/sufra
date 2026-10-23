import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalDistributeCenter, AppWindow, BrickWall, Copy, DoorOpen, Eye, EyeOff, ImageUp, Lock, LockOpen, Magnet, Minus, MousePointer2, Plus, Redo2, RotateCw, Ruler,
  ScanSearch, Sprout, Store, Trash2, Undo2, Columns2, Pencil, Maximize2,
} from "lucide-react";
import type { DecorKind, DiningTable, FloorDecor, TableShape, Zone, ZoneBackground } from "@/data/types";
import { useDict, useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { Badge, Button, IconButton, Input, Popover, Segmented, Spinner } from "@/ui";
import { floorDict } from "./dict";
import { autoSeatCount } from "./core/seats";

export const SHAPES: TableShape[] = ["square", "rect", "round", "oval", "booth", "bar"];
export const DECOR_ICON: Record<DecorKind, typeof BrickWall> = { wall: BrickWall, pillar: Columns2, door: DoorOpen, window: AppWindow, counter: Store, plant: Sprout };

export function ShapeIcon({ shape, className }: { shape: TableShape; className?: string }) {
  const common = { fill: "currentColor", fillOpacity: 0.16, stroke: "currentColor", strokeWidth: 2 };
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      {shape === "square" && <rect x={5} y={5} width={14} height={14} rx={2.5} {...common} />}
      {shape === "rect" && <rect x={2.5} y={7} width={19} height={10} rx={2.5} {...common} />}
      {shape === "round" && <circle cx={12} cy={12} r={7.5} {...common} />}
      {shape === "oval" && <ellipse cx={12} cy={12} rx={10} ry={6} {...common} />}
      {shape === "booth" && (
        <>
          <rect x={4} y={8.5} width={16} height={7} rx={2} {...common} />
          <rect x={4} y={3.5} width={16} height={3} rx={1.5} fill="currentColor" />
          <rect x={4} y={17.5} width={16} height={3} rx={1.5} fill="currentColor" />
        </>
      )}
      {shape === "bar" && (
        <>
          <rect x={2} y={6} width={20} height={6} rx={1.5} {...common} />
          {[5, 10, 15, 20].map((x) => (
            <circle key={x} cx={x - 1} cy={17} r={1.8} fill="currentColor" />
          ))}
        </>
      )}
    </svg>
  );
}

export interface DesignToolbarProps {
  onAddTable: (s: TableShape) => void;
  onAddDecor: (k: DecorKind) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  snap: boolean;
  onSnap: (v: boolean) => void;
}

export function DesignToolbar(p: DesignToolbarProps) {
  const f = useDict(floorDict);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Popover
        width="w-64"
        trigger={({ props }) => (
          <Button size="sm" icon={<Plus />} {...props}>
            {f("design.tables")}
          </Button>
        )}
      >
        {(close) => (
          <div className="grid grid-cols-3 gap-1.5 p-1">
            {SHAPES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  p.onAddTable(s);
                  close();
                }}
                className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface-2 px-1 py-2.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-primary hover:text-primary"
              >
                <ShapeIcon shape={s} className="size-7" />
                {f(`shape.${s}`)}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <Popover
        width="w-64"
        trigger={({ props }) => (
          <Button size="sm" variant="secondary" icon={<Plus />} {...props}>
            {f("design.decor")}
          </Button>
        )}
      >
        {(close) => (
          <div className="grid grid-cols-3 gap-1.5 p-1">
            {(Object.keys(DECOR_ICON) as DecorKind[]).map((k) => {
              const Icon = DECOR_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    p.onAddDecor(k);
                    close();
                  }}
                  className="flex flex-col items-center gap-1 rounded-xl border border-line bg-surface-2 px-1 py-2.5 text-[12px] font-semibold text-ink-2 transition-colors hover:border-primary hover:text-primary"
                >
                  <Icon className="size-6" />
                  {f(`decor.${k}`)}
                </button>
              );
            })}
          </div>
        )}
      </Popover>
      <span className="mx-0.5 h-6 w-px bg-line" aria-hidden />
      <IconButton size="sm" label={f("undo")} onClick={p.onUndo} disabled={!p.canUndo}>
        <Undo2 className="flip-rtl" />
      </IconButton>
      <IconButton size="sm" label={f("redo")} onClick={p.onRedo} disabled={!p.canRedo}>
        <Redo2 className="flip-rtl" />
      </IconButton>
      <button
        type="button"
        role="switch"
        aria-checked={p.snap}
        onClick={() => p.onSnap(!p.snap)}
        className={cn("inline-flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold transition-colors", p.snap ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-3")}
      >
        <Magnet className="size-4" />
        {f("design.snap")}
      </button>
    </div>
  );
}

/* ───────────── inspector ───────────── */

export type InspectorTab = "item" | "drawing" | "zone";

export interface InspectorProps {
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  selection: (DiningTable | FloorDecor)[];
  capacityOf: (id: string) => number;
  onPatch: (patch: Partial<DiningTable & FloorDecor>) => void;
  onShape: (s: TableShape) => void;
  onRotate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onAlign: (k: "left" | "cx" | "right" | "top" | "cy" | "bottom" | "dh" | "dv") => void;
  zone: Zone;
  onZonePatch: (p: Partial<Zone>) => void;
  onAddZone: () => void;
  onDeleteZone: () => void;
  // drawing
  background: ZoneBackground | null;
  onUpload: (f: File) => void;
  uploading: boolean;
  onBackground: (bg: ZoneBackground | null) => void;
  calibrating: boolean;
  onCalibrate: () => void;
  calibLineCm: number | null;
  onApplyScale: (meters: number) => void;
  onFitZone: () => void;
  onDetect: () => void;
  detecting: boolean;
  suggestions: number | null;
  onAcceptAll: () => void;
  onDiscard: () => void;
  onDemoPlan: () => void;
}

export function Inspector(p: InspectorProps) {
  const f = useDict(floorDict);
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-2.5">
        <Segmented
          size="sm"
          block
          label={f("floor.mode")}
          value={p.tab}
          onChange={p.onTab}
          options={[
            { value: "item", label: p.selection.length > 1 ? f("design.multi", { n: p.selection.length }) : p.selection[0] ? ("label" in p.selection[0] ? p.selection[0].label : f(`decor.${(p.selection[0] as FloorDecor).kind}`)) : f("design.tables"), icon: <MousePointer2 /> },
            { value: "drawing", label: f("draw.tab"), icon: <ImageUp /> },
            { value: "zone", label: f("design.zone"), icon: <Maximize2 /> },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5 thin-scrollbar">
        {p.tab === "item" ? <ItemPanel {...p} /> : p.tab === "drawing" ? <DrawingPanel {...p} /> : <ZonePanel {...p} />}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] font-semibold text-muted">{label}</p>
      {children}
    </div>
  );
}

function NumberField({ value, onCommit, step = 10, min = 10, max = 3000, label, suffix }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; max?: number; label: string; suffix?: string }) {
  const [v, setV] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setV(String(value));
  }, [value]);
  const commit = (raw: string) => {
    const n = Math.round(Number(raw.replace(/[^\d.]/g, "")));
    if (Number.isFinite(n) && n >= min) onCommit(Math.min(max, n));
    else setV(String(value));
  };
  return (
    <label className="flex h-11 min-w-0 items-center gap-1 rounded-xl border border-line bg-surface ps-1 pe-2 focus-within:border-primary">
      <button type="button" aria-label={`${label} −`} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-3" onClick={() => onCommit(Math.max(min, value - step))}>
        <Minus className="size-4" />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        className="num w-full min-w-0 bg-transparent text-center text-[15px] font-semibold outline-none"
        value={v}
        onFocus={() => (focused.current = true)}
        onBlur={(e) => {
          focused.current = false;
          commit(e.target.value);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        onChange={(e) => setV(e.target.value)}
      />
      {suffix ? <span className="shrink-0 text-[12px] text-faint">{suffix}</span> : null}
      <button type="button" aria-label={`${label} +`} className="grid size-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface-3" onClick={() => onCommit(Math.min(max, value + step))}>
        <Plus className="size-4" />
      </button>
    </label>
  );
}

function ItemPanel(p: InspectorProps) {
  const f = useDict(floorDict);
  const { L } = useT();
  const sel = p.selection;
  if (!sel.length)
    return (
      <div className="grid place-items-center gap-3 py-8 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-surface-3 text-muted">
          <MousePointer2 className="size-6" />
        </span>
        <p className="max-w-[16rem] text-[14px] text-muted">{f("design.nothing")}</p>
        <p className="max-w-[18rem] text-[12.5px] text-faint">{f("design.hint")}</p>
      </div>
    );
  if (sel.length > 1) {
    const btn = (k: Parameters<InspectorProps["onAlign"]>[0], icon: ReactNode, label: string) => (
      <IconButton key={k} label={label} variant="secondary" onClick={() => p.onAlign(k)}>
        {icon}
      </IconButton>
    );
    return (
      <div className="space-y-4">
        <Row label={f("design.align")}>
          <div className="flex flex-wrap gap-1.5">
            {btn("left", <AlignStartVertical />, f("design.alignLeft"))}
            {btn("cx", <AlignCenterVertical />, f("design.alignCenterX"))}
            {btn("right", <AlignEndVertical />, f("design.alignRight"))}
            {btn("top", <AlignStartHorizontal />, f("design.alignTop"))}
            {btn("cy", <AlignCenterHorizontal />, f("design.alignMiddle"))}
            {btn("bottom", <AlignEndHorizontal />, f("design.alignBottom"))}
          </div>
        </Row>
        <Row label={L("وزّع بمسافات متساوية", "Equal spacing")}>
          <div className="flex gap-1.5">
            {btn("dh", <AlignHorizontalDistributeCenter />, f("design.distH"))}
            {btn("dv", <AlignVerticalDistributeCenter />, f("design.distV"))}
          </div>
        </Row>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="secondary" icon={<Copy />} onClick={p.onDuplicate}>
            {f("design.duplicate")}
          </Button>
          <Button variant="danger-soft" icon={<Trash2 />} onClick={p.onDelete}>
            {f("design.delete")}
          </Button>
        </div>
      </div>
    );
  }
  const it = sel[0];
  const isTable = "label" in it;
  const t = isTable ? (it as DiningTable) : null;
  const auto = t ? autoSeatCount(t) : 0;
  return (
    <div className="space-y-4">
      {t ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Input label={f("design.label")} defaultValue={t.label} key={t.id + t.label} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.label && p.onPatch({ label: e.target.value.trim() })} />
            <Input label={f("design.code")} defaultValue={t.code} key={t.id + t.code} className="num" dir="ltr" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.code && p.onPatch({ code: e.target.value.trim().toUpperCase() })} />
          </div>
          <Row label={f("design.shape")}>
            <div className="grid grid-cols-6 gap-1">
              {SHAPES.map((s) => (
                <button key={s} type="button" title={f(`shape.${s}`)} aria-label={f(`shape.${s}`)} aria-pressed={t.shape === s} onClick={() => p.onShape(s)} className={cn("grid h-11 place-items-center rounded-xl border transition-colors", t.shape === s ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface text-ink-2 hover:border-line-strong")}>
                  <ShapeIcon shape={s} className="size-6" />
                </button>
              ))}
            </div>
          </Row>
        </>
      ) : (
        <div className="flex items-center gap-2 text-[15px] font-bold">
          {(() => {
            const Icon = DECOR_ICON[(it as FloorDecor).kind];
            return <Icon className="size-5 text-primary" />;
          })()}
          {f(`decor.${(it as FloorDecor).kind}`)}
        </div>
      )}
      <Row label={f("design.size")}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={f("design.width")} value={it.w} onCommit={(w) => p.onPatch(t && (t.shape === "square" || t.shape === "round") ? { w, h: w } : { w })} suffix="cm" />
          <NumberField label={f("design.depth")} value={it.h} onCommit={(h) => p.onPatch(t && (t.shape === "square" || t.shape === "round") ? { w: h, h } : { h })} suffix="cm" />
        </div>
      </Row>
      {t ? (
        <Row
          label={
            <span className="flex items-center justify-between">
              <span>{f("design.seats")}</span>
              <Badge size="sm" tone={t.seatsOverride == null ? "primary" : "brass"}>
                {t.seatsOverride == null ? f("design.auto") : L("يدوي", "Manual")}
              </Badge>
            </span>
          }
        >
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <NumberField label={f("design.seats")} value={t.seatsOverride ?? p.capacityOf(t.id)} step={1} min={1} max={40} onCommit={(n) => p.onPatch({ seatsOverride: n === auto ? null : n })} />
            </div>
            {t.seatsOverride != null ? (
              <Button size="sm" variant="ghost" onClick={() => p.onPatch({ seatsOverride: null })}>
                {f("design.auto")}
              </Button>
            ) : null}
          </div>
          <p className="text-[12px] text-faint">{f("design.autoHint")}</p>
        </Row>
      ) : null}
      <div className="grid grid-cols-3 gap-2 pt-1">
        <Button variant="secondary" icon={<RotateCw />} onClick={p.onRotate} className="px-2 text-[13px]">
          {f("design.rotate")}
        </Button>
        <Button variant="secondary" icon={<Copy />} onClick={p.onDuplicate} className="px-2 text-[13px]">
          {f("design.duplicate")}
        </Button>
        <Button variant="danger-soft" icon={<Trash2 />} onClick={p.onDelete} className="px-2 text-[13px]">
          {f("design.delete")}
        </Button>
      </div>
    </div>
  );
}

function DrawingPanel(p: InspectorProps) {
  const f = useDict(floorDict);
  const { L } = useT();
  const file = useRef<HTMLInputElement>(null);
  const [meters, setMeters] = useState("");
  const bg = p.background;
  return (
    <div className="space-y-4">
      <input ref={file} type="file" accept="image/*,application/pdf,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && p.onUpload(e.target.files[0])} />
      {!bg ? (
        <div className="space-y-3">
          <button type="button" onClick={() => file.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong bg-surface-2/60 px-4 py-7 text-center transition-colors hover:border-primary hover:bg-primary-soft/40">
            {p.uploading ? <Spinner /> : <ImageUp className="size-8 text-primary" />}
            <span className="text-[14.5px] font-bold">{p.uploading ? f("draw.loading") : f("draw.upload")}</span>
            <span className="text-[12.5px] text-muted">PNG · JPG · PDF</span>
          </button>
          <Button size="sm" variant="ghost" block onClick={p.onDemoPlan}>
            {L("جرّب برسمة تجريبية", "Try with a sample plan")}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/60 p-2.5">
            <img src={bg.src} alt="" className="size-14 shrink-0 rounded-xl border border-line object-cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold">{bg.fileName ?? f("draw.title")}</p>
              <p className="num text-[12px] text-muted">{f("draw.scale", { px: Math.round(100 / bg.cmPerPx) })}</p>
            </div>
            <IconButton size="sm" label={f("draw.replace")} onClick={() => file.current?.click()}>
              <Pencil />
            </IconButton>
          </div>
          <Row label={`${f("draw.opacity")} · ${Math.round(bg.opacity * 100)}%`}>
            <input type="range" min={10} max={100} value={Math.round(bg.opacity * 100)} onChange={(e) => p.onBackground({ ...bg, opacity: Number(e.target.value) / 100 })} className="w-full accent-[var(--sf-primary)]" aria-label={f("draw.opacity")} />
          </Row>
          <div className="flex gap-2">
            <Button size="sm" variant={bg.visible ? "soft" : "secondary"} icon={bg.visible ? <Eye /> : <EyeOff />} onClick={() => p.onBackground({ ...bg, visible: !bg.visible })} className="flex-1">
              {f("draw.show")}
            </Button>
            <Button size="sm" variant={bg.locked ? "soft" : "secondary"} icon={bg.locked ? <Lock /> : <LockOpen />} onClick={() => p.onBackground({ ...bg, locked: !bg.locked })} className="flex-1">
              {f("draw.lock")}
            </Button>
          </div>

          <section className="space-y-2.5 rounded-2xl border border-line p-3">
            <p className="flex items-center gap-2 text-[14px] font-bold">
              <Ruler className="size-4 text-primary" /> {f("draw.calibrate")}
            </p>
            <p className="text-[12.5px] text-muted">{f("draw.calibrateHint")}</p>
            {p.calibLineCm == null ? (
              <Button size="sm" variant={p.calibrating ? "brass" : "secondary"} block onClick={p.onCalibrate}>
                {p.calibrating ? L("ارسم الخط على الخريطة…", "Draw the line on the map…") : f("draw.calibrate")}
              </Button>
            ) : (
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const m = Number(meters.replace(",", "."));
                  if (m > 0) p.onApplyScale(m);
                }}
              >
                <Input label={f("draw.length")} inputMode="decimal" value={meters} onChange={(e) => setMeters(e.target.value)} placeholder="4.5" className="num" wrapClassName="flex-1" autoFocus />
                <Button type="submit" disabled={!(Number(meters.replace(",", ".")) > 0)}>
                  {f("draw.apply")}
                </Button>
              </form>
            )}
            <Button size="sm" variant="ghost" block onClick={p.onFitZone} icon={<Maximize2 />}>
              {f("draw.fitZone")}
            </Button>
          </section>

          <section className="space-y-2.5 rounded-2xl border border-brass/40 bg-brass-soft/40 p-3">
            <p className="flex items-center gap-2 text-[14px] font-bold">
              <ScanSearch className="size-4 text-brass" /> {f("draw.detect")}
              <Badge size="sm" tone="brass">
                {f("draw.beta")}
              </Badge>
            </p>
            <p className="text-[12.5px] text-muted">{f("draw.detectHint")}</p>
            {p.suggestions == null ? (
              <Button size="sm" variant="brass" block loading={p.detecting} onClick={p.onDetect} icon={<ScanSearch />}>
                {f("draw.detect")}
              </Button>
            ) : (
              <div className="space-y-2">
                <p className="text-[13.5px] font-semibold">{p.suggestions ? f("draw.found", { n: p.suggestions }) : f("draw.none")}</p>
                <div className="flex gap-2">
                  {p.suggestions ? (
                    <Button size="sm" variant="brass" className="flex-1" onClick={p.onAcceptAll}>
                      {f("draw.acceptAll")}
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" className="flex-1" onClick={p.onDiscard}>
                    {f("draw.discard")}
                  </Button>
                </div>
                {p.suggestions ? <p className="text-[12px] text-muted">{L("دوس على أي اقتراح على الخريطة عشان تضيفه لوحده", "Tap a suggestion on the map to add just that one")}</p> : null}
              </div>
            )}
          </section>
          <Button size="sm" variant="danger-soft" block icon={<Trash2 />} onClick={() => p.onBackground(null)}>
            {f("draw.remove")}
          </Button>
        </>
      )}
    </div>
  );
}

function ZonePanel(p: InspectorProps) {
  const f = useDict(floorDict);
  const z = p.zone;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Input label={`${f("design.zoneName")} (ع)`} defaultValue={z.name.ar} key={z.id + "ar" + z.name.ar} onBlur={(e) => e.target.value.trim() && e.target.value !== z.name.ar && p.onZonePatch({ name: { ...z.name, ar: e.target.value.trim() } })} />
        <Input label={`${f("design.zoneName")} (EN)`} defaultValue={z.name.en} dir="ltr" key={z.id + "en" + z.name.en} onBlur={(e) => e.target.value.trim() && e.target.value !== z.name.en && p.onZonePatch({ name: { ...z.name, en: e.target.value.trim() } })} />
      </div>
      <Row label={f("design.zoneSize")}>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label={f("design.width")} value={z.width / 100} step={1} min={2} max={100} onCommit={(m) => p.onZonePatch({ width: m * 100 })} suffix="m" />
          <NumberField label={f("design.depth")} value={z.height / 100} step={1} min={2} max={100} onCommit={(m) => p.onZonePatch({ height: m * 100 })} suffix="m" />
        </div>
      </Row>
      <div className="grid grid-cols-2 gap-2 pt-2">
        <Button variant="secondary" icon={<Plus />} onClick={p.onAddZone}>
          {f("design.addZone")}
        </Button>
        <Button variant="danger-soft" icon={<Trash2 />} onClick={p.onDeleteZone}>
          {f("design.deleteZone")}
        </Button>
      </div>
    </div>
  );
}
