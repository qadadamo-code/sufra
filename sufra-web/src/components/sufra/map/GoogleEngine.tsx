/**
 * Google Maps engine — used only when VITE_GOOGLE_MAPS_KEY is set. Same pins/clusters/cards as the Leaflet engine,
 * `gestureHandling: "cooperative"` (two fingers / Ctrl+wheel move the map, the page keeps scrolling).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { CAIRO, clusterHtml, cssVar, makeIndex, originHtml, pinHtml, userHtml, type EngineHandle, type EngineProps } from "./types";
import { loadGoogle } from "@/lib/google";

const el = (html: string) => {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
};

const GoogleEngine = forwardRef<EngineHandle, EngineProps>(function GoogleEngine(props, ref) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const libs = useRef<{ Marker: typeof google.maps.marker.AdvancedMarkerElement } | null>(null);
  const markers = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);
  const extras = useRef<(google.maps.marker.AdvancedMarkerElement | google.maps.Circle | google.maps.Polyline)[]>([]);
  const propsRef = useRef(props);
  propsRef.current = props;
  const index = useRef(makeIndex(props.points ?? []));

  const fitAll = () => {
    const m = map.current;
    if (!m) return;
    const p = propsRef.current;
    const pts = [...(p.points ?? []), ...(p.user ? [p.user] : []), ...(p.origin ? [p.origin] : [])];
    if (pts.length > 1) {
      const b = new google.maps.LatLngBounds();
      pts.forEach((x) => b.extend(x));
      m.fitBounds(b, 48);
    } else if (pts.length === 1) {
      m.setCenter(pts[0]);
      m.setZoom(15);
    }
  };
  useImperativeHandle(ref, () => ({
    zoomBy: (d) => map.current?.setZoom((map.current.getZoom() ?? 12) + d),
    panTo: (p, z) => {
      map.current?.panTo(p);
      if (z) map.current?.setZoom(z);
    },
    fit: fitAll,
  }));

  const draw = () => {
    const m = map.current;
    const Marker = libs.current?.Marker;
    if (!m || !Marker) return;
    markers.current.forEach((mk) => (mk.map = null));
    markers.current = [];
    const p = propsRef.current;
    const b = m.getBounds();
    const z = Math.round(m.getZoom() ?? 12);
    const byId = new Map((p.points ?? []).map((x) => [x.id, x]));
    const feats = !b || (p.points?.length ?? 0) <= 2 ? (p.points ?? []).map((x) => ({ properties: { id: x.id } as { id?: string; cluster?: boolean; cluster_id?: number; point_count?: number }, geometry: { coordinates: [x.lng, x.lat] } })) : index.current.getClusters([b.getSouthWest().lng(), b.getSouthWest().lat(), b.getNorthEast().lng(), b.getNorthEast().lat()], z);
    for (const f of feats as { properties: { id?: string; cluster?: boolean; cluster_id?: number; point_count?: number }; geometry: { coordinates: number[] } }[]) {
      const [lng, lat] = f.geometry.coordinates;
      if (f.properties.cluster) {
        const n = f.properties.point_count ?? 0;
        const mk = new Marker({ map: m, position: { lat, lng }, content: el(clusterHtml(n)), title: p.labels.cluster(n), gmpClickable: true });
        mk.addListener("click", () => {
          m.setCenter({ lat, lng });
          m.setZoom(Math.min(18, index.current.getClusterExpansionZoom(f.properties.cluster_id!)));
        });
        markers.current.push(mk);
      } else {
        const pt = byId.get(f.properties.id!);
        if (!pt) continue;
        const sel = pt.id === p.selectedId;
        const mk = new Marker({ map: m, position: { lat, lng }, content: el(pinHtml(pt, sel)), title: pt.label, zIndex: sel ? 1000 : undefined, gmpClickable: true });
        mk.addListener("click", () => propsRef.current.onSelect?.(pt.id));
        markers.current.push(mk);
      }
    }
  };

  useEffect(() => {
    let alive = true;
    const p = propsRef.current;
    loadGoogle(p.rtl ? "ar" : "en")
      .then(async (g) => {
        if (!alive || !box.current) return;
        const c = p.center ?? p.user ?? p.origin ?? CAIRO;
        const m = new g.maps.Map(box.current, {
          center: c,
          zoom: p.zoom ?? 12,
          mapId: import.meta.env.VITE_GOOGLE_MAP_ID || "DEMO_MAP_ID",
          gestureHandling: "cooperative",
          disableDefaultUI: true,
          clickableIcons: false,
          colorScheme: p.dark ? g.maps.ColorScheme.DARK : g.maps.ColorScheme.LIGHT,
        });
        map.current = m;
        libs.current = { Marker: g.marker.AdvancedMarkerElement };
        m.addListener("idle", draw);
        m.addListener("tilesloaded", () => propsRef.current.onReady());
        m.addListener("click", (e: google.maps.MapMouseEvent) => {
          const cb = propsRef.current;
          if (cb.onPick && e.latLng) cb.onPick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
          else cb.onSelect?.(null);
        });
        if (p.fit) fitAll();
        drawExtras();
      })
      .catch(() => alive && propsRef.current.onFail("google-load"));
    return () => {
      alive = false;
      markers.current.forEach((mk) => (mk.map = null));
      extras.current.forEach((x) => ("setMap" in x ? x.setMap(null) : (x.map = null)));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    index.current = makeIndex(props.points ?? []);
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.points, props.selectedId]);

  const drawExtras = () => {
    const m = map.current;
    const Marker = libs.current?.Marker;
    if (!m || !Marker) return;
    extras.current.forEach((x) => ("setMap" in x ? x.setMap(null) : (x.map = null)));
    extras.current = [];
    const { user, origin, path, labels } = propsRef.current;
    if (path && path.length > 1) extras.current.push(new google.maps.Polyline({ map: m, path, strokeColor: cssVar("--sf-brass", "#a8700c"), strokeOpacity: 0.9, strokeWeight: 4 }));
    if (origin && !user) extras.current.push(new Marker({ map: m, position: origin, content: el(originHtml), title: labels.home }));
    if (user) {
      if (user.accuracy && user.accuracy > 10) extras.current.push(new google.maps.Circle({ map: m, center: user, radius: user.accuracy, strokeColor: cssVar("--sf-primary"), strokeWeight: 1, fillColor: cssVar("--sf-primary"), fillOpacity: 0.12, clickable: false }));
      extras.current.push(new Marker({ map: m, position: user, content: el(userHtml), title: labels.you, zIndex: 900 }));
    }
  };
  useEffect(drawExtras, [props.user, props.origin, props.path, props.labels, props.dark]);

  return <div ref={box} className="absolute inset-0" data-engine="google" />;
});

export default GoogleEngine;
