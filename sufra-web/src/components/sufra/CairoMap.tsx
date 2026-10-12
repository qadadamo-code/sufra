/**
 * A stylised, hand-drawn map of Cairo (no tiles, no network): the Nile with Gezira island, a ring-road hint,
 * the desert corridors to Sheikh Zayed and New Cairo, and the 12 Sufra areas placed from their lat/lng.
 * Pins are clustered in screen space; pan with drag, zoom with wheel / pinch / buttons / keyboard.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Minus, Plus, RotateCcw } from "lucide-react";
import { areas } from "@/lib/data";
import type { LatLng } from "@/lib/geo";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type MapPoint = { id: string; lat: number; lng: number; label: string; tone?: "open" | "closed" | "offer" };

const LNG0 = 30.88, LNG1 = 31.56, LAT0 = 29.9, LAT1 = 30.16;
const PX_LNG = 1000 / (LNG1 - LNG0);
const PX_LAT = PX_LNG / Math.cos((30 * Math.PI) / 180);
const MAP_W = 1000;
const MAP_H = (LAT1 - LAT0) * PX_LAT; // ≈ 441
const proj = (lat: number, lng: number): [number, number] => [(lng - LNG0) * PX_LNG, (LAT1 - lat) * PX_LAT];
const unproj = (x: number, y: number): LatLng => ({ lng: x / PX_LNG + LNG0, lat: LAT1 - y / PX_LAT });
const path = (pts: [number, number][], close = false) => pts.map(([la, ln], i) => (i ? "L" : "M") + proj(la, ln).map((v) => v.toFixed(1)).join(" ")).join(" ") + (close ? " Z" : "");
const smooth = (pts: [number, number][]) => {
  const p = pts.map(([la, ln]) => proj(la, ln));
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    d += ` Q${p[i][0].toFixed(1)} ${p[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const l = p[p.length - 1];
  return d + ` L${l[0].toFixed(1)} ${l[1].toFixed(1)}`;
};

const NILE: [number, number][] = [
  [29.9, 31.262], [29.93, 31.257], [29.96, 31.248], [29.99, 31.236], [30.012, 31.229], [30.03, 31.229], [30.045, 31.23],
  [30.062, 31.227], [30.08, 31.229], [30.1, 31.236], [30.12, 31.24], [30.14, 31.238], [30.16, 31.236],
];
const NILE_WEST: [number, number][] = [[30.038, 31.228], [30.048, 31.214], [30.062, 31.209], [30.076, 31.213], [30.086, 31.229]];
const RODA: [number, number][] = [[30.0, 31.229], [30.012, 31.226], [30.028, 31.227], [30.03, 31.231], [30.012, 31.232], [30.0, 31.232]];
const RING: [number, number][] = [
  [30.125, 31.16], [30.142, 31.24], [30.132, 31.33], [30.095, 31.4], [30.035, 31.425], [29.982, 31.385], [29.955, 31.3],
  [29.962, 31.22], [29.99, 31.15], [30.05, 31.118], [30.1, 31.13], [30.125, 31.16],
];
const ROAD_WEST: [number, number][] = [[30.058, 31.205], [30.055, 31.12], [30.05, 31.04], [30.046, 30.97], [30.0, 30.95], [29.97, 30.93]];
const ROAD_EAST: [number, number][] = [[30.07, 31.32], [30.045, 31.4], [30.022, 31.45], [30.008, 31.5], [30.04, 31.5], [30.062, 31.49]];

type View = { k: number; tx: number; ty: number };

export function CairoMap({
  points = [],
  selectedId,
  onSelect,
  home,
  onPick,
  className,
  center,
  ariaLabel,
}: {
  points?: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  home?: LatLng | null;
  onPick?: (p: LatLng) => void;
  className?: string;
  center?: LatLng;
  ariaLabel?: string;
}) {
  const { L, lang } = useLang();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const base = useMemo(() => Math.max(Math.min(size.w / MAP_W, size.h / MAP_H), (size.h * 0.8) / MAP_H), [size]);
  const fit = useCallback(
    (c?: LatLng, k = 1): View => {
      const [cx, cy] = c ? proj(c.lat, c.lng) : proj(30.045, 31.235);
      return { k, tx: size.w / 2 - cx * base * k, ty: size.h / 2 - cy * base * k };
    },
    [size, base],
  );
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 });
  const ready = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    // first layout (and every container resize) re-centres
    setView(fit(center ?? home ?? undefined, ready.current ? view.k : 1));
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h]);

  const s = base * view.k;
  const toScreen = (lat: number, lng: number): [number, number] => {
    const [x, y] = proj(lat, lng);
    return [x * s + view.tx, y * s + view.ty];
  };
  const zoomAt = useCallback(
    (factor: number, sx: number, sy: number) => {
      setView((v) => {
        const k = Math.min(14, Math.max(0.8, v.k * factor));
        const f = k / v.k;
        return { k, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f };
      });
    },
    [],
  );

  // pointer: drag to pan, two fingers to pinch, tap to pick
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; dist?: number; sx: number; sy: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as Element).closest("[data-pin]")) return;
    box.current?.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2 };
    } else gesture.current = { moved: false, sx: p.x, sy: p.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (pointers.current.size >= 2 && g.dist) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      setView((v) => ({ ...v, tx: v.tx + (mx - g.sx), ty: v.ty + (my - g.sy) }));
      zoomAt(d / g.dist, mx, my);
      g.dist = d;
      g.sx = mx;
      g.sy = my;
      return;
    }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) > 5) g.moved = true;
    if (g.moved) setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const p = local(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      if (g && !g.moved) {
        if (onPick) {
          const [mx, my] = [(p.x - view.tx) / s, (p.y - view.ty) / s];
          if (mx >= 0 && my >= 0 && mx <= MAP_W && my <= MAP_H) onPick(unproj(mx, my));
        } else onSelect?.(null);
      }
      gesture.current = null;
    } else if (pointers.current.size === 1) {
      const [a] = [...pointers.current.values()];
      gesture.current = { moved: true, sx: a.x, sy: a.y };
    }
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // greedy screen-space clustering: a pin joins the first cluster whose centre is within R px
  const clusters = useMemo(() => {
    const R = view.k >= 9 ? 0 : 50;
    const out: { pts: MapPoint[]; x: number; y: number; sx: number; sy: number }[] = [];
    for (const p of points) {
      const [x, y] = toScreen(p.lat, p.lng);
      if (x < -60 || y < -60 || x > size.w + 60 || y > size.h + 60) continue;
      const c = R ? out.find((c) => Math.hypot(c.x - x, c.y - y) < R) : undefined;
      if (c) {
        c.pts.push(p);
        c.sx += x;
        c.sy += y;
        c.x = c.sx / c.pts.length;
        c.y = c.sy / c.pts.length;
      } else out.push({ pts: [p], x, y, sx: x, sy: y });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, view, size]);

  const onKey = (e: React.KeyboardEvent) => {
    const step = 60;
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowLeft") setView((v) => ({ ...v, tx: v.tx + step }));
    else if (e.key === "ArrowRight") setView((v) => ({ ...v, tx: v.tx - step }));
    else if (e.key === "ArrowUp") setView((v) => ({ ...v, ty: v.ty + step }));
    else if (e.key === "ArrowDown") setView((v) => ({ ...v, ty: v.ty - step }));
    else if (e.key === "+" || e.key === "=") zoomAt(1.4, size.w / 2, size.h / 2);
    else if (e.key === "-") zoomAt(1 / 1.4, size.w / 2, size.h / 2);
    else return;
    e.preventDefault();
  };

  const homeXY = home ? toScreen(home.lat, home.lng) : null;
  const btn = "grid size-10 place-items-center rounded-full border bg-card text-foreground shadow-sm hover:bg-surface-2";

  return (
    <div
      ref={box}
      className={cn("relative touch-none select-none overflow-hidden rounded-[24px] border bg-[var(--sf-land)] outline-none", onPick ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKey}
      tabIndex={0}
      role="application"
      aria-roledescription={L("خريطة", "map")}
      aria-label={ariaLabel ?? L("خريطة القاهرة — اسحب للتحريك، والأسهم و+/− للتكبير", "Map of Cairo — drag to pan; arrows and +/− to zoom")}
      dir="ltr"
    >
      <svg width={size.w} height={size.h} className="absolute inset-0" aria-hidden>
        <defs>
          <pattern id="sf-dots" width="14" height="14" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1" fill="var(--foreground)" opacity="0.06" />
          </pattern>
        </defs>
        <rect width={size.w} height={size.h} fill="url(#sf-dots)" />
        <g transform={`translate(${view.tx.toFixed(1)} ${view.ty.toFixed(1)}) scale(${s.toFixed(4)})`}>
          {/* built-up areas */}
          {areas.map((a) => {
            const [x, y] = proj(a.lat, a.lng);
            return <circle key={a.id} cx={x} cy={y} r={34} fill="var(--foreground)" opacity="0.045" />;
          })}
          {/* corridors and ring road */}
          <path d={smooth(ROAD_WEST)} fill="none" stroke="var(--sf-muted)" strokeOpacity=".35" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d={smooth(ROAD_EAST)} fill="none" stroke="var(--sf-muted)" strokeOpacity=".35" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          <path d={smooth(RING)} fill="none" stroke="var(--sf-brass)" strokeOpacity=".55" strokeWidth="2" strokeDasharray="7 6" vectorEffect="non-scaling-stroke" />
          {/* the Nile */}
          <path d={smooth(NILE)} fill="none" stroke="var(--sf-nile)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <path d={smooth(NILE_WEST)} fill="none" stroke="var(--sf-nile)" strokeWidth="5" strokeLinecap="round" />
          <path d={path(RODA, true)} fill="var(--sf-land)" />
          <path d={smooth(NILE)} fill="none" stroke="white" strokeOpacity=".25" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </g>
        {/* labels in screen space (constant size) */}
        {(() => {
          const [nx, ny] = toScreen(30.105, 31.239);
          return (
            <text x={nx + 8} y={ny} fontSize="11" fontStyle="italic" fill="var(--sf-primary)" opacity=".7" style={{ fontFamily: "var(--font-sans)" }}>
              {L("النيل", "The Nile")}
            </text>
          );
        })()}
        {view.k < 7 &&
          (() => {
            // greedy label placement: skip a label that would collide with one already drawn
            const placed: [number, number, number][] = [];
            const fs = view.k > 2.5 ? 13 : 11.5;
            return areas.map((a) => {
              const [x, y] = toScreen(a.lat, a.lng);
              const w = a[lang].length * fs * (lang === "ar" ? 0.55 : 0.6);
              if (placed.some(([px, py, pw]) => Math.abs(px - x) < (pw + w) / 2 + 6 && Math.abs(py - (y + 30)) < fs + 6)) return null;
              placed.push([x, y + 30, w]);
              return (
                <text key={a.id} x={x} y={y + 30} textAnchor="middle" fontSize={fs} fontWeight={600} fill="var(--sf-muted)" stroke="var(--sf-land)" strokeWidth="4" paintOrder="stroke" style={{ fontFamily: "var(--font-sans)", letterSpacing: lang === "en" ? ".04em" : 0 }}>
                  {a[lang]}
                </text>
              );
            });
          })()}
        {homeXY ? (
          <g transform={`translate(${homeXY[0]} ${homeXY[1]})`}>
            <circle r="16" fill="var(--sf-brass)" opacity=".18" />
            <circle r="9" fill="var(--sf-brass)" stroke="var(--card)" strokeWidth="2.5" />
            <circle r="3.2" cx="1.5" cy="-1.5" fill="var(--sf-primary)" />
          </g>
        ) : null}
      </svg>

      {/* pins & clusters (HTML buttons for focus + labels) */}
      {clusters.map((c) => {
        if (c.pts.length > 1) {
          const n = c.pts.length;
          const d = Math.min(48, 30 + Math.sqrt(n) * 4);
          return (
            <button
              key={c.pts[0].id + n}
              type="button"
              data-pin
              className="absolute grid place-items-center rounded-full border-2 border-card bg-primary text-[13px] font-bold text-primary-foreground shadow-md transition-transform hover:scale-110"
              style={{ left: c.x - d / 2, top: c.y - d / 2, width: d, height: d }}
              aria-label={L(`${n} أماكن هنا — كبّر`, `${n} places here — zoom in`)}
              onClick={() => zoomAt(2.4, c.x, c.y)}
            >
              <span className="num">{n}</span>
            </button>
          );
        }
        const p = c.pts[0];
        const sel = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            data-pin
            aria-label={p.label}
            aria-pressed={sel}
            onClick={() => onSelect?.(p.id)}
            className={cn("absolute -translate-x-1/2 -translate-y-full transition-transform hover:scale-110", sel && "z-10 scale-125")}
            style={{ left: c.x, top: c.y }}
          >
            <svg width="28" height="36" viewBox="0 0 28 36" aria-hidden>
              <path d="M14 35s11-11.2 11-20A11 11 0 0 0 3 15c0 8.8 11 20 11 20z" fill={p.tone === "offer" ? "var(--sf-brass)" : p.tone === "closed" ? "var(--sf-muted)" : "var(--sf-primary)"} stroke="var(--card)" strokeWidth="2" />
              <circle cx="14" cy="14.5" r="4.2" fill="var(--card)" />
            </svg>
            {sel ? <span className="absolute left-1/2 top-[-26px] -translate-x-1/2 whitespace-nowrap rounded-full bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">{p.label}</span> : null}
          </button>
        );
      })}

      <div className="absolute end-3 top-3 flex flex-col gap-2" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className={btn} aria-label={L("كبّر", "Zoom in")} onClick={() => zoomAt(1.5, size.w / 2, size.h / 2)}>
          <Plus className="size-4" aria-hidden />
        </button>
        <button type="button" className={btn} aria-label={L("صغّر", "Zoom out")} onClick={() => zoomAt(1 / 1.5, size.w / 2, size.h / 2)}>
          <Minus className="size-4" aria-hidden />
        </button>
        {home ? (
          <button type="button" className={btn} aria-label={L("روح لبيتي", "Centre on my home")} onClick={() => setView(fit(home, Math.max(view.k, 3)))}>
            <Crosshair className="size-4" aria-hidden />
          </button>
        ) : null}
        <button type="button" className={btn} aria-label={L("رجّع الخريطة", "Reset map")} onClick={() => setView(fit(undefined, 1))}>
          <RotateCcw className="size-4" aria-hidden />
        </button>
      </div>
      <div className="pointer-events-none absolute bottom-3 start-3 flex flex-wrap gap-x-3 gap-y-1 rounded-full bg-card/85 px-3 py-1.5 text-[11px] font-medium text-muted-foreground backdrop-blur" dir={lang === "ar" ? "rtl" : "ltr"}>
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-primary" />{L("مفتوح", "Open")}</span>
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-[var(--sf-muted)]" />{L("مقفول", "Closed")}</span>
        <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-brass" />{L("عرض", "Offer")}</span>
        {home ? <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full border-2 border-brass" />{L("بيتك", "Home")}</span> : null}
      </div>
    </div>
  );
}
