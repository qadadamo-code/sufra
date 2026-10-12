// Shared bits for the two "voxel" video cards: tilt-on-pointer, a live pill, a mute toggle and a poster fallback.
import * as React from "react";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

export function useTilt(maxX: number, maxY: number) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [t, setT] = React.useState({ x: 0, y: 0 });
  const reduce = React.useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const onPointerMove = (e: React.PointerEvent) => {
    if (reduce || e.pointerType === "touch") return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    setT({ x: px * 2 * maxX, y: -py * 2 * maxY });
  };
  const onPointerLeave = () => setT({ x: 0, y: 0 });
  const style: React.CSSProperties = { transform: `perspective(1000px) rotateX(${t.y.toFixed(2)}deg) rotateY(${t.x.toFixed(2)}deg)`, transition: "transform .15s ease-out" };
  return { ref, style, onPointerMove, onPointerLeave };
}

export function snapshotMode() {
  if (typeof window === "undefined") return false;
  const q = window.location.search + window.location.hash;
  return /[?&](capture|snapshot)=1/.test(q);
}

export function VideoFrame({
  videoSrc,
  posterSrc,
  badge,
  muteLabels = { off: "Audio", on: "Playing" },
  className,
  fallback,
}: {
  videoSrc?: string | null;
  posterSrc?: string | null;
  badge: string;
  muteLabels?: { off: string; on: string };
  className?: string;
  fallback?: React.ReactNode;
}) {
  const vRef = React.useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = React.useState(true);
  const still = snapshotMode() || !videoSrc;
  const reduce = React.useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-2xl bg-muted", className)}>
      {still ? (
        posterSrc ? <img src={posterSrc} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" /> : fallback
      ) : (
        <video ref={vRef} className="absolute inset-0 size-full object-cover" src={videoSrc!} poster={posterSrc ?? undefined} autoPlay={!reduce} loop muted={muted} playsInline preload="metadata" />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
      <span className="absolute start-3 top-3 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs font-medium text-white backdrop-blur">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-brass opacity-70" />
          <span className="relative inline-flex size-2 rounded-full bg-brass" />
        </span>
        {badge}
      </span>
      {!still ? (
        <button
          type="button"
          onClick={() => {
            setMuted((m) => !m);
            void vRef.current?.play().catch(() => {});
          }}
          className="absolute bottom-3 end-3 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-black/60"
          aria-pressed={!muted}
        >
          {muted ? <VolumeX className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
          {muted ? muteLabels.off : muteLabels.on}
        </button>
      ) : null}
    </div>
  );
}
