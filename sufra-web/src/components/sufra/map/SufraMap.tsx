/**
 * The one map component the pages use.
 *  - VITE_GOOGLE_MAPS_KEY set → Google Maps; otherwise Leaflet + OpenStreetMap tiles.
 *  - Tiles/Google unreachable (offline, blocked host, static preview) → the stylised offline SVG map, automatically.
 *  - Cooperative gestures everywhere: the page always scrolls; two fingers / Ctrl+wheel move the map, or tap
 *    "حرّك الخريطة" on a phone to drag with one finger.
 *  - Controls are React buttons positioned with logical (start/end) insets, so they are RTL-safe.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Hand, LocateFixed, Maximize2, Minus, Plus } from "lucide-react";
import { CairoMap } from "@/components/sufra/CairoMap";
import { hasGoogleKey } from "@/lib/google";
import type { LatLng } from "@/lib/geo";
import { useLang } from "@/lib/i18n";
import { useHome } from "@/lib/store";
import { useIsDark } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useLocate } from "@/components/sufra/LocateButton";
import type { EngineHandle, MapProps } from "./types";
import "./map.css";

export type { MapPoint } from "./types";

const LeafletEngine = lazy(() => import("./LeafletEngine"));
const GoogleEngine = lazy(() => import("./GoogleEngine"));

/** Once tiles failed in this tab, don't retry on every page (no repeated network errors). */
let tilesBroken = false;

export function SufraMap({
  origin,
  user,
  legend = true,
  ...props
}: MapProps & {
  /** undefined → the current origin (GPS dot, or home/area marker); null → none */
  origin?: LatLng | null;
  user?: MapProps["user"];
  legend?: boolean;
}) {
  const { L, lang, dir } = useLang();
  const dark = useIsDark();
  const o = useHome();
  const locateMe = useLocate();
  const engine = useRef<EngineHandle>(null);
  const [failed, setFailed] = useState(tilesBroken);
  const [ready, setReady] = useState(false);
  const [touchDrag, setTouchDrag] = useState(false);
  const [hint, setHint] = useState<"touch" | "wheel" | null>(null);
  const hintTimer = useRef(0);
  const coarse = useMemo(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches, []);

  const autoUser = o.source === "gps" ? { lat: o.home.lat, lng: o.home.lng, accuracy: o.accuracy } : null;
  const userDot = user === undefined ? autoUser : user;
  const originPt = origin === undefined ? (o.source === "gps" ? null : o.home) : origin;

  const onHint = useCallback((k: "touch" | "wheel") => {
    window.clearTimeout(hintTimer.current);
    setHint(k);
    hintTimer.current = window.setTimeout(() => setHint(null), 1500);
  }, []);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const labels = useMemo(() => ({ cluster: (n: number) => L(`${n} أماكن — كبّر`, `${n} places — zoom in`), you: L("إنت هنا", "You are here"), home: L("نقطة البداية", "Your starting point") }), [L]);
  const onFail = useCallback(() => {
    tilesBroken = true;
    setFailed(true);
  }, []);
  const onReady = useCallback(() => setReady(true), []);

  if (failed) {
    return (
      <div className={cn("relative", props.className)}>
        <CairoMap
          points={props.points?.map((p) => ({ ...p, tone: p.tone === "courier" ? "offer" : p.tone }))}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          home={userDot ?? originPt ?? null}
          onPick={props.onPick}
          center={props.center}
          ariaLabel={props.ariaLabel}
          className="size-full"
        />
        <p className="pointer-events-none absolute end-3 bottom-3 rounded-full bg-card/85 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur">{L("خريطة مبسّطة (الخريطة الحية مش متاحة دلوقتي)", "Simplified map (live map unavailable)")}</p>
      </div>
    );
  }

  const Engine = hasGoogleKey ? GoogleEngine : LeafletEngine;
  const btn = "grid size-10 place-items-center rounded-full border bg-card text-foreground shadow-sm hover:bg-surface-2 aria-pressed:bg-primary aria-pressed:text-primary-foreground";
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const recentre = userDot ?? originPt ?? props.center;

  return (
    <div
      className={cn("sf-map relative isolate overflow-hidden rounded-[24px] border bg-[var(--sf-land)]", touchDrag && "sf-map-drag", props.className)}
      role="region"
      aria-roledescription={L("خريطة", "map")}
      aria-label={props.ariaLabel ?? L("خريطة — صباعين أو Ctrl مع العجلة للتحريك والتكبير", "Map — two fingers or Ctrl + wheel to move and zoom")}
    >
      <Suspense fallback={null}>
        <Engine ref={engine} {...props} user={userDot} origin={originPt} touchDrag={touchDrag} dark={dark} rtl={dir === "rtl"} labels={labels} onReady={onReady} onFail={onFail} onHint={onHint} />
      </Suspense>
      {!ready ? <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground paper-grain">{L("بنحمّل الخريطة…", "Loading map…")}</div> : null}

      <div className="absolute end-3 top-3 z-[500] flex flex-col gap-2">
        <button type="button" className={btn} aria-label={L("كبّر", "Zoom in")} onClick={() => engine.current?.zoomBy(1)}>
          <Plus className="size-4" aria-hidden />
        </button>
        <button type="button" className={btn} aria-label={L("صغّر", "Zoom out")} onClick={() => engine.current?.zoomBy(-1)}>
          <Minus className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className={btn}
          aria-label={userDot ? L("رجّع على مكاني", "Recentre on me") : L("استخدم موقعي", "Use my location")}
          title={userDot ? L("رجّع على مكاني", "Recentre on me") : L("استخدم موقعي", "Use my location")}
          onClick={() => {
            if (userDot) engine.current?.panTo(userDot, 15);
            else void locateMe().then((s) => s !== "ok" && recentre && engine.current?.panTo(recentre, 13));
          }}
        >
          <LocateFixed className="size-4" aria-hidden />
        </button>
        {(props.points?.length ?? 0) > 1 ? (
          <button type="button" className={btn} aria-label={L("وريني كل الأماكن", "Show all places")} onClick={() => engine.current?.fit()}>
            <Maximize2 className="size-4" aria-hidden />
          </button>
        ) : null}
        {coarse && !hasGoogleKey ? (
          <button type="button" className={btn} aria-pressed={touchDrag} aria-label={touchDrag ? L("وقّف تحريك الخريطة", "Stop moving the map") : L("حرّك الخريطة بصباع واحد", "Move the map with one finger")} onClick={() => setTouchDrag((v) => !v)}>
            <Hand className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {hint ? (
        <div className="pointer-events-none absolute inset-0 z-[600] grid place-items-center bg-black/35 p-6 text-center text-[15px] font-semibold text-white" role="status">
          {hint === "touch" ? L("استخدم صباعين لتحريك الخريطة — أو دوس ✋", "Use two fingers to move the map — or tap ✋") : mac ? L("استخدم ⌘ مع العجلة للتكبير", "Use ⌘ + scroll to zoom the map") : L("استخدم Ctrl مع العجلة للتكبير", "Use Ctrl + scroll to zoom the map")}
        </div>
      ) : null}

      {legend ? (
        <div className="pointer-events-none absolute start-3 top-3 z-[500] flex flex-wrap gap-x-3 gap-y-1 rounded-full bg-card/90 px-3 py-1.5 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur" dir={dir}>
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-primary" />{L("مفتوح", "Open")}</span>
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-[var(--sf-muted)]" />{L("مقفول", "Closed")}</span>
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-brass" />{L("عرض", "Offer")}</span>
          {userDot ? <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-[#2f80ed]" />{L("إنت", "You")}</span> : null}
        </div>
      ) : null}
      <span className="sr-only" lang={lang}>{hasGoogleKey ? "Google Maps" : "OpenStreetMap"}</span>
    </div>
  );
}
