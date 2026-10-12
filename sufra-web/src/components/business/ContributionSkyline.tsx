/**
 * ContributionSkyline — a year of daily counts as a heat map that folds into an isometric 3D skyline (canvas).
 * Built from the owner's spec: 2D/3D toggle, the camera swings while bars rise in a wave oldest → newest, stats
 * (total, busiest day, longest / current streak), legend hover isolates a level, drag to orbit in 3D.
 * Time runs left → right (oldest → newest) in both languages, like any calendar heat map.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Box, Grid2x2 } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { useIsDark } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Segmented } from "./kit";

export interface SkylineDay {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface SkylineStats {
  total: number;
  busiest: SkylineDay | null;
  longest: number;
  current: number;
  max: number;
}

export function skylineStats(days: SkylineDay[]): SkylineStats {
  let total = 0;
  let busiest: SkylineDay | null = null;
  let longest = 0;
  let run = 0;
  for (const d of days) {
    total += d.count;
    if (!busiest || d.count > busiest.count) busiest = d;
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = days.length - 1; i >= 0 && days[i].count > 0; i--) current++;
  return { total, busiest, longest, current, max: busiest?.count ?? 0 };
}

export const levelOf = (count: number, max: number) => (count <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((count / max) * 4))));

type Cell = { week: number; dow: number; count: number; level: number; date: string };

export function ContributionSkyline({ days, unit, className }: { days: SkylineDay[]; unit: { one: string; other: string }; className?: string }) {
  const { L, lang } = useLang();
  const dark = useIsDark();
  const reduced = useReducedMotion();
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // on narrow screens the year scrolls inside the card; start at the most recent weeks
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const [mode, setMode] = useState<"2d" | "3d">("2d");
  const [iso, setIso] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; cell: Cell } | null>(null);
  const stats = useMemo(() => skylineStats(days), [days]);

  const cells = useMemo<Cell[]>(() => {
    if (!days.length) return [];
    const first = new Date(days[0].date + "T00:00:00");
    const offset = first.getDay(); // Sunday-first rows
    return days.map((d, i) => {
      const idx = i + offset;
      return { week: Math.floor(idx / 7), dow: idx % 7, count: d.count, level: levelOf(d.count, stats.max), date: d.date };
    });
  }, [days, stats.max]);
  const weeks = cells.length ? cells[cells.length - 1].week + 1 : 0;

  // animation state lives in refs; React state only drives toggles
  const anim = useRef({ m: 0, target: 0, rise: 0, yaw: -0.62, pitch: 0.58, t0: 0, iso: null as number | null, hover: -1 });
  anim.current.iso = iso;
  useEffect(() => {
    anim.current.target = mode === "3d" ? 1 : 0;
    if (mode === "3d") anim.current.rise = reduced ? 1 : 0;
    anim.current.t0 = performance.now();
  }, [mode, reduced]);

  useEffect(() => {
    const cv = canvas.current;
    const host = wrap.current;
    if (!cv || !host) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(document.documentElement);
    const primary = css.getPropertyValue("--sf-primary").trim() || "#0d5a53";
    const brass = css.getPropertyValue("--sf-brass").trim() || "#a8700c";
    const empty = css.getPropertyValue("--muted").trim() || "#e1e8e2";
    const ink = css.getPropertyValue("--sf-muted").trim() || "#5b6a64";
    const mix = (a: string, b: string, k: number) => {
      const p = (h: string) => {
        const v = h.replace("#", "");
        const n = parseInt(v.length === 3 ? v.split("").map((c) => c + c).join("") : v, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const [r1, g1, b1] = p(a);
      const [r2, g2, b2] = p(b);
      return [Math.round(r1 + (r2 - r1) * k), Math.round(g1 + (g2 - g1) * k), Math.round(b1 + (b2 - b1) * k)];
    };
    const base = [empty, ...[0.3, 0.55, 0.8, 1].map((k) => `rgb(${mix(empty, primary, k).join(",")})`)];
    const shade = (lvl: number, f: number) => {
      const c = lvl === 0 ? mix(empty, "#000000", 0) : mix(empty, primary, [0, 0.3, 0.55, 0.8, 1][lvl]);
      return `rgb(${c.map((v) => Math.round(v * f)).join(",")})`;
    };
    let raf = 0;
    let w = 0;
    let h = 0;
    const resize = () => {
      const r = host.getBoundingClientRect();
      w = Math.max(200, r.width);
      h = Math.max(160, Math.min(320, w * 0.42));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const months = (() => {
      const out: { week: number; label: string }[] = [];
      let last = -1;
      for (const c of cells) {
        const mth = Number(c.date.slice(5, 7)) - 1;
        if (mth !== last && c.dow === 0) {
          out.push({ week: c.week, label: new Date(2026, mth, 1).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { month: "short" }) });
          last = mth;
        }
      }
      return out.filter((m, i) => (i > 0 || out.length < 2 || out[1].week - m.week > 2) && (i === out.length - 1 || out[i + 1].week - m.week > 2));
    })();

    type Quad = { pts: [number, number][]; cell: number };
    let tops: Quad[] = [];

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const a = anim.current;
      const speed = reduced ? 1 : 0.07;
      a.m += (a.target - a.m) * speed;
      if (Math.abs(a.target - a.m) < 0.001) a.m = a.target;
      if (a.target === 1 && a.rise < 1) a.rise = reduced ? 1 : Math.min(1, (now - a.t0) / 1500);
      const m = a.m;
      ctx.clearRect(0, 0, w, h);
      // camera: top-down (pitch 90°, yaw 0) → isometric (pitch ~33°, yaw ~-35°)
      const yaw = a.yaw * m;
      const pitch = Math.PI / 2 + (a.pitch - Math.PI / 2) * m;
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const sp = Math.sin(pitch);
      const cp = Math.cos(pitch);
      const S = 1;
      const gap = 0.18;
      const maxH = 7;
      const proj = (x: number, y: number, z: number): [number, number, number] => {
        const xr = x * cy - z * sy;
        const zr = x * sy + z * cy;
        return [xr, zr * sp - y * cp, zr * cp + y * sp];
      };
      // fit
      const cx = (weeks * S) / 2;
      const cz = (7 * S) / 2;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [x, z] of [[0, 0], [weeks, 0], [0, 7], [weeks, 7]]) {
        for (const y of [0, maxH * m]) {
          const [px, py] = proj(x - cx, y, z - cz);
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
      }
      const padTop = m < 0.5 ? 18 : 10;
      const scale = Math.min((w - 16) / (maxX - minX), (h - padTop - 8) / (maxY - minY));
      const ox = (w - (maxX - minX) * scale) / 2 - minX * scale;
      const oy = padTop + (h - padTop - 8 - (maxY - minY) * scale) / 2 - minY * scale;
      const P = (x: number, y: number, z: number): [number, number] => {
        const [px, py] = proj(x - cx, y, z - cz);
        return [ox + px * scale, oy + py * scale];
      };
      // months (2D only)
      if (m < 0.6) {
        ctx.globalAlpha = 1 - m / 0.6;
        ctx.fillStyle = ink;
        ctx.font = `500 10px ${lang === "ar" ? "IBM Plex Sans Arabic" : "IBM Plex Mono"}, sans-serif`;
        ctx.textAlign = "left";
        for (const mo of months) {
          const [x, y] = P(mo.week, 0, 0);
          ctx.fillText(mo.label, x, y - 5);
        }
        ctx.globalAlpha = 1;
      }
      // painter's order: far → near
      const order = cells.map((c, i) => ({ i, d: proj(c.week + 0.5 - cx, 0, c.dow + 0.5 - cz)[2] })).sort((p, q) => p.d - q.d);
      tops = [];
      const isoLvl = a.iso;
      const showX = Math.sin(yaw) < 0 ? 1 : 0; // which side faces are visible
      for (const { i } of order) {
        const c = cells[i];
        const x0 = c.week + gap / 2;
        const x1 = c.week + 1 - gap / 2;
        const z0 = c.dow + gap / 2;
        const z1 = c.dow + 1 - gap / 2;
        const wave = a.target === 1 ? Math.max(0, Math.min(1, a.rise * 1.6 - (c.week / Math.max(1, weeks)) * 0.6)) : 1;
        const hh = (c.level === 0 ? 0.08 : 0.3 + (c.count / Math.max(1, stats.max)) * maxH) * m * (a.target === 1 ? wave : 1);
        const dim = isoLvl !== null && isoLvl !== c.level ? 0.18 : 1;
        ctx.globalAlpha = dim;
        const top: [number, number][] = [P(x0, hh, z0), P(x1, hh, z0), P(x1, hh, z1), P(x0, hh, z1)];
        if (hh > 0.02 && m > 0.02) {
          // front face (z1) and side face (x1 or x0)
          const front: [number, number][] = [P(x0, 0, z1), P(x1, 0, z1), P(x1, hh, z1), P(x0, hh, z1)];
          const sx = showX ? x0 : x1;
          const side: [number, number][] = [P(sx, 0, z0), P(sx, 0, z1), P(sx, hh, z1), P(sx, hh, z0)];
          for (const [poly, f] of [[side, 0.62], [front, 0.78]] as const) {
            ctx.fillStyle = shade(c.level, f);
            ctx.beginPath();
            poly.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.fillStyle = a.hover === i ? brass : base[c.level];
        ctx.beginPath();
        top.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        ctx.closePath();
        ctx.fill();
        tops.push({ pts: top, cell: i });
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    const inside = (pts: [number, number][], x: number, y: number) => {
      let ins = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) ins = !ins;
      }
      return ins;
    };
    let drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    const onMove = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (drag) {
        anim.current.yaw = Math.max(-1.4, Math.min(1.4, drag.yaw + (x - drag.x) * 0.008));
        anim.current.pitch = Math.max(0.25, Math.min(1.2, drag.pitch + (y - drag.y) * 0.005));
        setTip(null);
        return;
      }
      for (let k = tops.length - 1; k >= 0; k--) {
        if (inside(tops[k].pts, x, y)) {
          anim.current.hover = tops[k].cell;
          setTip({ x, y, cell: cells[tops[k].cell] });
          return;
        }
      }
      anim.current.hover = -1;
      setTip(null);
    };
    const onDown = (e: PointerEvent) => {
      if (anim.current.target !== 1) return;
      const r = cv.getBoundingClientRect();
      drag = { x: e.clientX - r.left, y: e.clientY - r.top, yaw: anim.current.yaw, pitch: anim.current.pitch };
      cv.setPointerCapture(e.pointerId);
    };
    const onUp = () => (drag = null);
    const onLeave = () => {
      anim.current.hover = -1;
      setTip(null);
    };
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener("pointermove", onMove);
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointerup", onUp);
      cv.removeEventListener("pointercancel", onUp);
      cv.removeEventListener("pointerleave", onLeave);
    };
  }, [cells, weeks, stats.max, dark, reduced, lang]);

  const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-US", { weekday: "short", day: "numeric", month: "short" });
  const levelDays = useMemo(() => [0, 1, 2, 3, 4].map((l) => cells.filter((c) => c.level === l).length), [cells]);
  const range = (l: number) => {
    if (l === 0) return "0";
    const lo = Math.floor(((l - 1) / 4) * stats.max) + 1;
    const hi = Math.floor((l / 4) * stats.max);
    return `${lo}–${hi}`;
  };

  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <div><dt className="text-[12px] text-muted-foreground">{L("إجمالي السنة", "Year total")}</dt><dd className="num font-display text-xl font-bold">{stats.total.toLocaleString("en-US")}</dd></div>
          <div><dt className="text-[12px] text-muted-foreground">{L("أعلى يوم", "Busiest day")}</dt><dd className="text-[14px] font-semibold">{stats.busiest ? <><span className="num">{stats.busiest.count}</span> · {fmtDate(stats.busiest.date)}</> : "—"}</dd></div>
          <div><dt className="text-[12px] text-muted-foreground">{L("أطول سلسلة", "Longest streak")}</dt><dd className="text-[14px] font-semibold"><span className="num">{stats.longest}</span> {L("يوم", "days")}</dd></div>
          <div><dt className="text-[12px] text-muted-foreground">{L("السلسلة الحالية", "Current streak")}</dt><dd className="text-[14px] font-semibold"><span className="num">{stats.current}</span> {L("يوم", "days")}</dd></div>
        </dl>
        <Segmented size="sm" label={L("طريقة العرض", "View")} value={mode} onChange={setMode} options={[{ id: "2d", label: <span className="inline-flex items-center gap-1"><Grid2x2 className="size-3.5" aria-hidden />2D</span> }, { id: "3d", label: <span className="inline-flex items-center gap-1"><Box className="size-3.5" aria-hidden />3D</span> }]} />
      </div>
      <div ref={scroller} className="mt-3 overflow-x-auto no-scrollbar" dir="ltr">
      <div ref={wrap} className="relative min-w-[640px]">
        <canvas
          ref={canvas}
          className={cn("block w-full touch-pan-y", mode === "3d" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair")}
          role="img"
          aria-label={L(`خريطة حرارية لـ ${stats.total} ${unit.other} على مدار سنة. أعلى يوم ${stats.busiest?.count ?? 0}. ${mode === "3d" ? "عرض ثلاثي الأبعاد — اسحب للتدوير." : ""}`, `Heat map of ${stats.total} ${unit.other} over a year. Busiest day ${stats.busiest?.count ?? 0}. ${mode === "3d" ? "3D view — drag to orbit." : ""}`)}
        />
        {tip ? (
          <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-[12px] font-semibold text-background shadow-lg" style={{ left: tip.x, top: tip.y - 8 }} dir={lang === "ar" ? "rtl" : "ltr"}>
            <span className="num">{tip.cell.count}</span> {tip.cell.count === 1 ? unit.one : unit.other} · {fmtDate(tip.cell.date)}
          </div>
        ) : null}
      </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>{mode === "3d" ? L("اسحب للتدوير", "Drag to orbit") : L("مرّر على يوم لتفاصيله", "Hover a day for details")}</span>
        <div className="flex items-center gap-1.5" onMouseLeave={() => setIso(null)}>
          <span>{L("أقل", "Less")}</span>
          {[0, 1, 2, 3, 4].map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={iso === l}
              aria-label={L(`المستوى ${l}: ${range(l)} ${unit.other} — ${levelDays[l]} يوم`, `Level ${l}: ${range(l)} ${unit.other} — ${levelDays[l]} days`)}
              title={`${range(l)} · ${levelDays[l]} ${L("يوم", "days")}`}
              onMouseEnter={() => setIso(l)}
              onFocus={() => setIso(l)}
              onBlur={() => setIso(null)}
              onClick={() => setIso((v) => (v === l ? null : l))}
              className={cn("size-3.5 rounded-[3px] ring-offset-1 ring-offset-card", iso === l && "ring-2 ring-brass")}
              style={{ background: l === 0 ? "var(--muted)" : `color-mix(in srgb, var(--sf-primary) ${[0, 30, 55, 80, 100][l]}%, var(--muted))` }}
            />
          ))}
          <span>{L("أكتر", "More")}</span>
        </div>
      </div>
      {iso !== null ? <p className="mt-1 text-[12px] text-muted-foreground" aria-live="polite">{L(`${levelDays[iso]} يوم فيهم ${range(iso)} ${unit.other}`, `${levelDays[iso]} days with ${range(iso)} ${unit.other}`)}</p> : null}
    </div>
  );
}

export default ContributionSkyline;
