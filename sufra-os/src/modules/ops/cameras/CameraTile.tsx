/** One camera on the wall: plays HLS / WebRTC page / MJPEG / snapshot polling / demo placeholder, with a status chip. */
import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, VideoOff } from "lucide-react";
import { useT } from "@/i18n/i18n";
import { cn } from "@/lib/cn";
import type { Camera } from "../types";
import { bust, playMode } from "./nvr";
import { DemoFeed } from "./DemoFeed";

export type TileStatus = "live" | "connecting" | "error" | "demo" | "off" | "unplayable";

export function statusOf(c: Camera, s: TileStatus | null): TileStatus {
  if (!c.active) return "off";
  const m = playMode(c);
  if (m === "demo") return "demo";
  if (m === "unplayable") return "unplayable";
  return s ?? "connecting";
}

export function StatusChip({ s }: { s: TileStatus }) {
  const { L } = useT();
  const map: Record<TileStatus, [string, string, string]> = {
    live: ["bg-ok", L("مباشر", "Live"), "text-white"],
    connecting: ["bg-warn", L("بيتصل…", "Connecting…"), "text-white"],
    error: ["bg-danger", L("مفيش إشارة", "No signal"), "text-white"],
    demo: ["bg-brass", L("تجريبي", "Demo"), "text-brass-ink"],
    off: ["bg-faint", L("متوقفة", "Disabled"), "text-white"],
    unplayable: ["bg-faint", L("محتاج بوابة", "Needs gateway"), "text-white"],
  };
  const [bg, label, fg] = map[s];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold", bg, fg)} data-status={s}>
      <span className={cn("size-1.5 rounded-full bg-current", s === "live" && "animate-pulse")} />
      {label}
    </span>
  );
}

export function CameraPlayer({ cam, onStatus, at }: { cam: Camera; onStatus?: (s: TileStatus) => void; at?: number }) {
  const { L, loc } = useT();
  const mode = cam.active ? playMode(cam) : "unplayable";
  const vid = useRef<HTMLVideoElement>(null);
  const [n, setN] = useState(0);
  const [hlsOk, setHlsOk] = useState(true);
  useEffect(() => {
    if (mode !== "img-poll") return;
    const id = setInterval(() => document.visibilityState !== "hidden" && setN((x) => x + 1), Math.max(1, cam.snapshotSec) * 1000);
    return () => clearInterval(id);
  }, [mode, cam.snapshotSec]);
  useEffect(() => {
    if (mode !== "hls" || !vid.current) return;
    const v = vid.current;
    if (!v.canPlayType("application/vnd.apple.mpegurl")) {
      setHlsOk(false);
      onStatus?.("error");
      return;
    }
    v.src = cam.url;
    void v.play().catch(() => undefined);
  }, [mode, cam.url]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cam.active)
    return (
      <div className="grid size-full place-items-center bg-[#101614] text-white/60">
        <VideoOff className="size-8" />
      </div>
    );
  if (mode === "demo") return <DemoFeed seed={cam.id} label={loc(cam.name)} at={at} />;
  if (mode === "unplayable")
    return (
      <div className="grid size-full place-items-center bg-[#101614] p-3 text-center text-[12.5px] text-white/70">
        <div>
          <VideoOff className="mx-auto mb-1 size-7" />
          {L("RTSP مش بيشتغل في المتصفح — حط رابط HLS/WebRTC من الـ NVR Cloud أو بوابة go2rtc", "RTSP can't play in a browser — use an HLS/WebRTC link from the NVR cloud or a go2rtc gateway")}
        </div>
      </div>
    );
  if (mode === "hls")
    return hlsOk ? (
      <video ref={vid} className="size-full bg-black object-cover" muted playsInline autoPlay onPlaying={() => onStatus?.("live")} onError={() => onStatus?.("error")} />
    ) : (
      <div className="grid size-full place-items-center bg-[#101614] p-3 text-center text-[12.5px] text-white/70">{L("المتصفح ده مش بيشغّل HLS مباشرة — استخدم وضع WebRTC (صفحة go2rtc)", "This browser has no native HLS — use WebRTC mode (go2rtc page)")}</div>
    );
  if (mode === "iframe") return <iframe title={loc(cam.name)} src={cam.url} className="size-full border-0 bg-black" allow="autoplay; fullscreen" onLoad={() => onStatus?.("live")} referrerPolicy="no-referrer" />;
  const src = mode === "img-poll" ? bust(cam.url, n) : cam.url;
  return <img alt={loc(cam.name)} src={src} className="size-full bg-black object-cover" onLoad={() => onStatus?.("live")} onError={() => onStatus?.("error")} referrerPolicy="no-referrer" />;
}

export function CameraTile({ cam, big }: { cam: Camera; big?: boolean }) {
  const { L, loc } = useT();
  const box = useRef<HTMLDivElement>(null);
  const [st, setSt] = useState<TileStatus | null>(null);
  const [full, setFull] = useState(false);
  const status = statusOf(cam, st);
  const toggleFull = async () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      setFull(false);
    } else if (el.requestFullscreen) {
      await el.requestFullscreen().then(() => setFull(true), () => setFull((v) => !v));
    } else setFull((v) => !v);
  };
  useEffect(() => {
    const f = () => !document.fullscreenElement && setFull(false);
    document.addEventListener("fullscreenchange", f);
    return () => document.removeEventListener("fullscreenchange", f);
  }, []);
  return (
    <div
      ref={box}
      data-camera={cam.id}
      onDoubleClick={() => void toggleFull()}
      className={cn("group relative overflow-hidden rounded-2xl border border-line bg-black", full ? "fixed inset-0 z-[90] rounded-none" : "aspect-video", big && "md:rounded-3xl")}
    >
      <CameraPlayer cam={cam} onStatus={setSt} />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/60 to-transparent p-2">
        <StatusChip s={status} />
        <span className="truncate text-[12.5px] font-semibold text-white">{loc(cam.name)}</span>
      </div>
      <button type="button" onClick={() => void toggleFull()} aria-label={full ? L("صغّر", "Exit fullscreen") : L("ملء الشاشة", "Fullscreen")} className="absolute end-2 top-2 grid size-9 place-items-center rounded-full bg-black/50 text-white opacity-80 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100">
        {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  );
}
