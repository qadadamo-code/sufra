/**
 * Delivery map: Leaflet + OpenStreetMap raster tiles (no key), engine copied from sufra-web's LeafletEngine (not imported
 * across packages). If tiles can't load (offline, blocked host) the same Leaflet map keeps working on a drawn base —
 * a paper grid, the Nile and district names — so pins, zones, riders and drawing never depend on the network.
 *
 * Shared by dispatch (orders + riders), the zones editor (polygons / rings, click to draw) and the guest tracking page.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./map.css";
import type { LatLng, ZoneGeometry } from "@/data/types";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import { ringPoints } from "../geo";

export type PinTone = "primary" | "brass" | "danger" | "ok" | "info" | "warn" | "muted";
export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  kind: "kitchen" | "order" | "rider" | "door";
  /** short text inside the pin (order number) */
  text?: string;
  /** label shown above (selected pins, riders) */
  label?: string;
  tone?: PinTone;
  heading?: number | null;
  stale?: boolean;
}
export interface MapShape {
  id: string;
  geometry: ZoneGeometry;
  color: string;
  label?: string;
  dim?: boolean;
}
export interface MapLine {
  id: string;
  points: LatLng[];
  color?: string;
  dashed?: boolean;
}
export interface MapHandle {
  fit(): void;
  panTo(p: LatLng, zoom?: number): void;
}
export interface DeliveryMapProps {
  pins?: MapPin[];
  shapes?: MapShape[];
  lines?: MapLine[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onShapeSelect?: (id: string) => void;
  /** click on the map (drawing / picking an address) */
  onPick?: (p: LatLng) => void;
  /** draggable vertices of the polygon being drawn */
  editPoints?: LatLng[];
  onEditPoint?: (index: number, p: LatLng) => void;
  center?: LatLng;
  zoom?: number;
  /** fit everything on the first real size (and when `fitKey` changes) */
  fitKey?: string | number;
  className?: string;
  ariaLabel: string;
  /** keep one-finger drag (phones: the map is the page, e.g. rider app) */
  touchDrag?: boolean;
}

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const BROKEN = "sufra.tiles.broken";

const TONE: Record<PinTone, string> = { primary: "--sf-primary", brass: "--sf-brass", danger: "--sf-danger", ok: "--sf-ok", info: "--sf-info", warn: "--sf-warn", muted: "--sf-muted" };
const cssVar = (name: string, fallback: string) => (typeof document === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

const ICON_CHEF = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/></svg>`;
const ICON_BIKE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`;
const ICON_HOME = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" fill="#fff"/></svg>`;

function pinHtml(p: MapPin, selected: boolean): string {
  const c = `var(${TONE[p.tone ?? "primary"]})`;
  const tag = p.label && (selected || p.kind === "rider") ? `<span class="dm-tag">${esc(p.label)}</span>` : "";
  if (p.kind === "kitchen") return `<div class="dm-kitchen" title="${esc(p.label ?? "")}">${ICON_CHEF}</div>`;
  if (p.kind === "rider") {
    const h = p.heading == null ? "" : `<em style="--h:${Math.round(p.heading)}deg"></em>`;
    return `<div class="dm-rider${p.stale ? " is-stale" : ""}" style="--c:${c}"><i></i>${h}${ICON_BIKE}${tag}</div>`;
  }
  const s = selected ? 1.25 : 1;
  const inner = p.kind === "door" ? `<span style="position:absolute;inset:7px 0 auto 0;display:grid;place-items:center">${ICON_HOME}</span>` : p.text ? `<b>${esc(p.text)}</b>` : "";
  return `<div class="dm-pin" style="--s:${s}"><svg width="30" height="39" viewBox="0 0 30 39" aria-hidden="true"><path d="M15 38s12-12.2 12-21.6A12 12 0 0 0 3 16.4C3 25.8 15 38 15 38z" fill="${c}" stroke="var(--sf-surface)" stroke-width="2.2"/></svg>${inner}${tag}</div>`;
}

/* drawn base: the Nile around Zamalek + district names (approximate, for orientation only) */
const NILE_EAST: [number, number][] = [[30.098, 31.231], [30.082, 31.2285], [30.0745, 31.2272], [30.064, 31.2275], [30.0545, 31.2272], [30.0465, 31.2262], [30.038, 31.2268], [30.028, 31.2283], [30.015, 31.2295], [30.0, 31.2275]];
const NILE_WEST: [number, number][] = [[30.082, 31.2268], [30.0755, 31.2165], [30.0705, 31.2128], [30.062, 31.2128], [30.054, 31.2155], [30.048, 31.2195], [30.0445, 31.2232], [30.038, 31.2262]];
const DISTRICTS: { at: [number, number]; ar: string; en: string }[] = [
  { at: [30.0628, 31.221], ar: "الزمالك", en: "ZAMALEK" },
  { at: [30.0375, 31.2075], ar: "الدقي", en: "DOKKI" },
  { at: [30.0565, 31.1965], ar: "المهندسين", en: "MOHANDESSIN" },
  { at: [30.0625, 31.2088], ar: "العجوزة", en: "AGOUZA" },
  { at: [30.0362, 31.2318], ar: "جاردن سيتي", en: "GARDEN CITY" },
  { at: [30.0488, 31.2425], ar: "وسط البلد", en: "DOWNTOWN" },
  { at: [30.0265, 31.2105], ar: "الجيزة", en: "GIZA" },
];

export const DeliveryMap = forwardRef<MapHandle, DeliveryMapProps>(function DeliveryMap(props, ref) {
  const { lang } = useT();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const groups = useRef<{ base: L.LayerGroup; shapes: L.LayerGroup; lines: L.LayerGroup; pins: L.LayerGroup; edit: L.LayerGroup } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [drawn, setDrawn] = useState(() => {
    try {
      return typeof navigator !== "undefined" && (navigator.onLine === false || sessionStorage.getItem(BROKEN) === "1");
    } catch {
      return false;
    }
  });

  const fitAll = () => {
    const m = map.current;
    if (!m) return;
    const p = propsRef.current;
    const pts: [number, number][] = [...(p.pins ?? []).map((x) => [x.lat, x.lng] as [number, number])];
    for (const s of p.shapes ?? []) {
      const g = s.geometry;
      for (const q of g.kind === "ring" ? ringPoints(g.center, g.radiusKm, 12) : g.points) pts.push([q.lat, q.lng]);
    }
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
    else if (pts.length === 1) m.setView(pts[0], 15);
  };

  useImperativeHandle(ref, () => ({ fit: fitAll, panTo: (p, z) => map.current?.setView([p.lat, p.lng], z ?? Math.max(map.current.getZoom(), 15)) }));

  /* create once */
  useEffect(() => {
    if (!el.current) return;
    const p = propsRef.current;
    const c = p.center ?? { lat: 30.0565, lng: 31.214 };
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const m = L.map(el.current, { center: [c.lat, c.lng], zoom: p.zoom ?? 14, zoomControl: false, scrollWheelZoom: true, dragging: !coarse || !!p.touchDrag, touchZoom: true, attributionControl: true, minZoom: 10, maxZoom: 19 });
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    L.control.zoom({ position: "bottomright" }).addTo(m);
    map.current = m;
    groups.current = { base: L.layerGroup().addTo(m), shapes: L.layerGroup().addTo(m), lines: L.layerGroup().addTo(m), pins: L.layerGroup().addTo(m), edit: L.layerGroup().addTo(m) };

    let failed = false;
    let loaded = 0;
    const fail = () => {
      if (failed || loaded) return;
      failed = true;
      try {
        sessionStorage.setItem(BROKEN, "1");
      } catch {
        /* ignore */
      }
      setDrawn(true);
    };
    let broken = false;
    try {
      broken = sessionStorage.getItem(BROKEN) === "1";
    } catch {
      /* ignore */
    }
    if (!broken && navigator.onLine !== false) {
      const tiles = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19, crossOrigin: true, className: "dm-tiles" });
      tiles.on("tileload", () => {
        loaded++;
      });
      let errors = 0;
      tiles.on("tileerror", () => {
        if (++errors >= 3 && !loaded) {
          m.removeLayer(tiles);
          fail();
        }
      });
      // probe ONE tile first so a blocked host costs one request, not a screenful
      const probe = new Image();
      probe.crossOrigin = "anonymous";
      probe.onload = () => !failed && map.current === m && tiles.addTo(m);
      probe.onerror = fail;
      probe.src = TILE_URL.replace("{z}", "13").replace("{x}", "4877").replace("{y}", "3383");
      const timer = window.setTimeout(fail, 8000);
      m.once("unload", () => window.clearTimeout(timer));
    } else setDrawn(true);

    m.on("click", (e: L.LeafletMouseEvent) => {
      const cb = propsRef.current;
      if (cb.onPick) cb.onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
      else cb.onSelect?.(null);
    });
    let fitted = false;
    const box = el.current;
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
      if (!fitted && box.clientHeight > 0) {
        fitted = true;
        fitAll();
      }
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
      groups.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* drawn base */
  useEffect(() => {
    const g = groups.current?.base;
    if (!g) return;
    g.clearLayers();
    if (!drawn) return;
    const water = cssVar("--sf-info", "#2f6f9f");
    for (const line of [NILE_EAST, NILE_WEST]) L.polyline(line, { color: water, weight: 16, opacity: 0.22, interactive: false, lineCap: "round" }).addTo(g);
    for (const d of DISTRICTS) L.marker(d.at, { icon: L.divIcon({ html: `<div class="dm-label">${lang === "ar" ? d.ar : d.en}</div>`, className: "dm-icon", iconSize: [0, 0] }), interactive: false, keyboard: false }).addTo(g);
  }, [drawn, lang]);

  /* zones */
  useEffect(() => {
    const g = groups.current?.shapes;
    if (!g) return;
    g.clearLayers();
    for (const s of props.shapes ?? []) {
      const style: L.PathOptions = { color: s.color, weight: s.dim ? 2 : 3, opacity: s.dim ? 0.75 : 0.95, fillColor: s.color, fillOpacity: s.dim ? 0.08 : 0.16, dashArray: s.dim ? "5 6" : undefined };
      const layer = s.geometry.kind === "ring" ? L.circle([s.geometry.center.lat, s.geometry.center.lng], { radius: s.geometry.radiusKm * 1000, ...style }) : L.polygon(s.geometry.points.map((p) => [p.lat, p.lng] as [number, number]), style);
      if (s.label) layer.bindTooltip(esc(s.label), { direction: "center", permanent: !s.dim, className: "dm-zone-tip" });
      layer.on("click", (e) => {
        const cb = propsRef.current;
        if (cb.onPick) return; // drawing: let the click reach the map
        L.DomEvent.stopPropagation(e);
        cb.onShapeSelect?.(s.id);
      });
      layer.addTo(g);
    }
  }, [props.shapes]);

  /* routes */
  useEffect(() => {
    const g = groups.current?.lines;
    if (!g) return;
    g.clearLayers();
    for (const l of props.lines ?? []) L.polyline(l.points.map((p) => [p.lat, p.lng] as [number, number]), { color: l.color ?? cssVar("--sf-brass", "#a8700c"), weight: 4, opacity: 0.85, dashArray: l.dashed === false ? undefined : "8 8", interactive: false }).addTo(g);
  }, [props.lines]);

  /* pins */
  useEffect(() => {
    const g = groups.current?.pins;
    if (!g) return;
    g.clearLayers();
    for (const p of props.pins ?? []) {
      const sel = p.id === props.selectedId;
      const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ html: pinHtml(p, sel), className: "dm-icon", iconSize: [0, 0] }), title: p.label ?? p.text ?? "", keyboard: p.kind !== "kitchen", zIndexOffset: sel ? 1000 : p.kind === "rider" ? 600 : p.kind === "kitchen" ? 300 : 0, riseOnHover: true });
      mk.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        propsRef.current.onSelect?.(p.id);
      });
      mk.addTo(g);
    }
  }, [props.pins, props.selectedId]);

  /* polygon being drawn: vertices (draggable) + outline */
  useEffect(() => {
    const g = groups.current?.edit;
    if (!g) return;
    g.clearLayers();
    const pts = props.editPoints ?? [];
    if (!pts.length) return;
    const color = cssVar("--sf-primary", "#0d5a53");
    if (pts.length > 1) L.polygon(pts.map((p) => [p.lat, p.lng] as [number, number]), { color, weight: 2.5, dashArray: "6 6", fillOpacity: 0.08, interactive: false }).addTo(g);
    pts.forEach((p, i) => {
      const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ html: `<div class="dm-vertex"></div>`, className: "dm-icon", iconSize: [0, 0] }), draggable: true, keyboard: false });
      mk.on("dragend", () => {
        const ll = mk.getLatLng();
        propsRef.current.onEditPoint?.(i, { lat: ll.lat, lng: ll.lng });
      });
      mk.on("click", (e) => L.DomEvent.stopPropagation(e));
      mk.addTo(g);
    });
  }, [props.editPoints]);

  /* re-fit when asked */
  const firstFit = useRef(true);
  useEffect(() => {
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    fitAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fitKey]);

  return (
    <div className={cn("dm-map relative isolate overflow-hidden", drawn && "dm-drawn", props.className)} role="application" aria-label={props.ariaLabel}>
      <div ref={el} className="absolute inset-0" dir="ltr" data-engine={drawn ? "drawn" : "leaflet"} />
    </div>
  );
});

export default DeliveryMap;
