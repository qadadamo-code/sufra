/**
 * Real map, default engine: Leaflet + OpenStreetMap raster tiles (no key). Lazy-loaded with its CSS.
 * Cooperative gestures so the page always scrolls: on touch, one finger scrolls the page and two fingers pan/zoom
 * (Leaflet's touchZoom pans around the pinch centre); on desktop, the wheel scrolls the page and Ctrl/⌘+wheel zooms.
 * If tiles never load (offline / blocked host) it calls onFail and the wrapper swaps in the stylised SVG map.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CAIRO, clusterHtml, cssVar, makeIndex, originHtml, pinHtml, userHtml, type EngineHandle, type EngineProps } from "./types";

const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const coarse = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

const LeafletEngine = forwardRef<EngineHandle, EngineProps>(function LeafletEngine(props, ref) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const extras = useRef<L.LayerGroup | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const fitAll = () => {
    const m = map.current;
    if (!m) return;
    const p = propsRef.current;
    const pts = [...(p.points ?? []), ...(p.user ? [p.user] : []), ...(p.origin ? [p.origin] : [])];
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts.map((x) => [x.lat, x.lng] as [number, number])), { padding: [48, 48], maxZoom: 15 });
    else if (pts.length === 1) m.setView([pts[0].lat, pts[0].lng], 15);
  };

  useImperativeHandle(ref, () => ({
    zoomBy: (d) => map.current?.setZoom(map.current.getZoom() + d),
    panTo: (p, z) => map.current?.setView([p.lat, p.lng], z ?? Math.max(map.current.getZoom(), 14)),
    fit: fitAll,
  }));

  /* ── create once ── */
  useEffect(() => {
    if (!el.current) return;
    const p = propsRef.current;
    const touch = coarse();
    const c = p.center ?? p.user ?? p.origin ?? CAIRO;
    const m = L.map(el.current, {
      center: [c.lat, c.lng],
      zoom: p.zoom ?? 12,
      zoomControl: false,
      scrollWheelZoom: false, // Ctrl/⌘ + wheel only (below)
      dragging: !touch, // one-finger drag stays page scroll on phones
      touchZoom: true, // two fingers: pinch + pan
      tapHold: false,
      attributionControl: true,
      maxBounds: L.latLngBounds([29.3, 30.3], [30.8, 32.3]),
      minZoom: 9,
      maxZoom: 19,
    });
    m.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    map.current = m;

    let loads = 0;
    let errors = 0;
    let failed = false;
    const fail = (why: string) => {
      if (failed || loads) return;
      failed = true;
      propsRef.current.onFail(why);
    };
    const tiles = L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19, crossOrigin: true, className: "sf-tiles" });
    tiles.on("tileload", () => {
      if (!loads++) propsRef.current.onReady();
    });
    tiles.on("tileerror", () => {
      errors++;
      if (errors >= 3 && !loads) fail("tiles-error");
    });
    if (typeof navigator !== "undefined" && navigator.onLine === false) fail("offline");
    else tiles.addTo(m);
    const timer = window.setTimeout(() => fail("tiles-timeout"), 9000);

    layer.current = L.layerGroup().addTo(m);
    extras.current = L.layerGroup().addTo(m);

    // Ctrl/⌘ + wheel zooms; a plain wheel scrolls the page (never preventDefault it) and shows a hint
    const box = el.current;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const pt = m.mouseEventToContainerPoint(e);
        m.setZoomAround(pt, m.getZoom() + (e.deltaY < 0 ? 1 : -1));
      } else propsRef.current.onHint("wheel");
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    // one finger on a phone → page scrolls; tell the user how to move the map
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && !propsRef.current.touchDrag && coarse()) propsRef.current.onHint("touch");
    };
    box.addEventListener("touchmove", onTouchMove, { passive: true });

    m.on("click", (e: L.LeafletMouseEvent) => {
      const cb = propsRef.current;
      if (cb.onPick) cb.onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
      else cb.onSelect?.(null);
    });
    if (p.fit) fitAll();
    return () => {
      window.clearTimeout(timer);
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("touchmove", onTouchMove);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── touch drag toggle ── */
  useEffect(() => {
    const m = map.current;
    if (!m || !coarse()) return;
    if (props.touchDrag) m.dragging.enable();
    else m.dragging.disable();
  }, [props.touchDrag]);

  /* ── pins + clusters ── */
  const index = useRef<ReturnType<typeof makeIndex> | null>(null);
  useEffect(() => {
    index.current = makeIndex(props.points ?? []);
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const g = layer.current;
      if (!g || !index.current) return;
      g.clearLayers();
      const p = propsRef.current;
      const byId = new Map((p.points ?? []).map((x) => [x.id, x]));
      const b = m.getBounds().pad(0.2);
      const z = Math.round(m.getZoom());
      const feats = (p.points?.length ?? 0) <= 2 ? (p.points ?? []).map((x) => ({ properties: { id: x.id }, geometry: { coordinates: [x.lng, x.lat] } })) : index.current.getClusters([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], z);
      for (const f of feats as { properties: { id?: string; cluster?: boolean; cluster_id?: number; point_count?: number }; geometry: { coordinates: number[] } }[]) {
        const [lng, lat] = f.geometry.coordinates;
        if (f.properties.cluster) {
          const n = f.properties.point_count ?? 0;
          const mk = L.marker([lat, lng], { icon: L.divIcon({ html: clusterHtml(n), className: "sf-divicon", iconSize: [0, 0] }), keyboard: true, title: p.labels.cluster(n), riseOnHover: true });
          mk.on("click", () => m.setView([lat, lng], Math.min(18, index.current!.getClusterExpansionZoom(f.properties.cluster_id!))));
          mk.addTo(g);
        } else {
          const pt = byId.get(f.properties.id!);
          if (!pt) continue;
          const sel = pt.id === p.selectedId;
          const mk = L.marker([lat, lng], { icon: L.divIcon({ html: pinHtml(pt, sel), className: "sf-divicon", iconSize: [0, 0] }), keyboard: true, title: pt.label, zIndexOffset: sel ? 1000 : 0, riseOnHover: true });
          mk.on("click", (e) => {
            L.DomEvent.stopPropagation(e);
            propsRef.current.onSelect?.(pt.id);
          });
          mk.addTo(g);
        }
      }
    };
    draw();
    m.on("moveend zoomend", draw);
    return () => {
      m.off("moveend zoomend", draw);
    };
  }, [props.points, props.selectedId]);

  /* ── user dot, origin, path ── */
  useEffect(() => {
    const g = extras.current;
    if (!g) return;
    g.clearLayers();
    const { user, origin, path, labels } = props;
    if (path && path.length > 1) L.polyline(path.map((x) => [x.lat, x.lng] as [number, number]), { color: cssVar("--sf-brass", "#a8700c"), weight: 4, dashArray: "8 8", opacity: 0.9, interactive: false }).addTo(g);
    if (origin && !user) L.marker([origin.lat, origin.lng], { icon: L.divIcon({ html: originHtml, className: "sf-divicon", iconSize: [0, 0] }), title: labels.home, interactive: false, keyboard: false }).addTo(g);
    if (user) {
      if (user.accuracy && user.accuracy > 10) L.circle([user.lat, user.lng], { radius: user.accuracy, color: cssVar("--sf-primary"), weight: 1, fillColor: cssVar("--sf-primary"), fillOpacity: 0.12, interactive: false }).addTo(g);
      L.marker([user.lat, user.lng], { icon: L.divIcon({ html: userHtml, className: "sf-divicon", iconSize: [0, 0] }), title: labels.you, interactive: false, keyboard: false, zIndexOffset: 900 }).addTo(g);
    }
  }, [props.user, props.origin, props.path, props.labels, props.dark]);

  /* ── follow the selected place ── */
  useEffect(() => {
    const m = map.current;
    const s = props.selectedId ? props.points?.find((p) => p.id === props.selectedId) : null;
    if (m && s && !m.getBounds().pad(-0.15).contains([s.lat, s.lng])) m.panTo([s.lat, s.lng]);
  }, [props.selectedId, props.points]);

  return <div ref={el} className="absolute inset-0" dir="ltr" data-engine="leaflet" />;
});

export default LeafletEngine;
