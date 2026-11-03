/**
 * NVR playback + live-view URLs (pure). Sources and confidence per pattern: ../DESIGN.md §Cameras.
 *
 * Browsers cannot play RTSP. Playback templates that produce rtsp:// are for VLC / the NVR client / an on-site gateway;
 * HTTP(S) templates (MediaMTX playback server, NVR cloud portals, go2rtc) open straight in the browser.
 * Credentials NEVER go into these templates: they live on the gateway / NVR, not in rows a tablet can read.
 *
 * Placeholders:
 *   {host} NVR host[:port]  {channel} 1-based  {track} Hikvision track (channel×100+1)  {gateway} on-site gateway base URL
 *   {path} gateway stream name (cam<channel>)  {duration} seconds
 *   {start_iso} / {end_iso}           2026-11-03T18:22:30Z (UTC)
 *   {start_compact} / {end_compact}   20261103T182230Z (UTC)
 *   {start_dahua} / {end_dahua}       2026_11_03_18_22_30 (UTC)
 *   {start_local_dahua} / {end_local_dahua}  same, in the restaurant's time zone (many Dahua NVRs expect local time)
 *   {start_unix} / {end_unix}         seconds since epoch
 */
import type { Camera, NvrBrand, StreamKind } from "../types";

export interface PlaybackPattern {
  brand: NvrBrand;
  label: string;
  template: string;
  /** "documented" = vendor document · "community" = forum / third-party reports, test on your firmware */
  confidence: "documented" | "community";
  /** opens in a browser (http) or needs VLC / gateway (rtsp) */
  scheme: "rtsp" | "http";
  note: string;
}

export const PLAYBACK_PATTERNS: Record<NvrBrand, PlaybackPattern> = {
  hikvision: {
    brand: "hikvision",
    label: "Hikvision RTSP playback (Streaming/tracks)",
    template: "rtsp://{host}/Streaming/tracks/{track}?starttime={start_iso}&endtime={end_iso}",
    confidence: "community",
    scheme: "rtsp",
    note: "UTC, dashed ISO form. Some firmware ignores starttime and plays from the first recording — test on yours. ISAPI search (/ISAPI/ContentMgmt/search) is a POST, not a URL.",
  },
  dahua: {
    brand: "dahua",
    label: "Dahua RTSP playback (cam/playback)",
    template: "rtsp://{host}/cam/playback?channel={channel}&starttime={start_dahua}&endtime={end_dahua}",
    confidence: "community",
    scheme: "rtsp",
    note: "Times as YYYY_MM_DD_HH_MM_SS. Third-party docs say UTC; if clips are off by your UTC offset use {start_local_dahua}/{end_local_dahua}.",
  },
  uniview: {
    brand: "uniview",
    label: "Uniview RTSP replay (/cN/b…/e…/replay/)",
    template: "rtsp://{host}/c{channel}/b{start_unix}/e{end_unix}/replay/",
    confidence: "documented",
    scheme: "rtsp",
    note: "From Uniview's “How to Get the URLs for Uniview IPC and NVR” (begin/end are Unix time).",
  },
  other: {
    brand: "other",
    label: "MediaMTX playback server (generic gateway)",
    template: "{gateway}/get?path={path}&start={start_iso}&duration={duration}",
    confidence: "community",
    scheme: "http",
    note: "MediaMTX records the RTSP feed and serves clips over HTTP (playback server, default :9996). Returns MP4 that a browser plays directly.",
  },
};

export interface ClipWindow {
  /** ISO time of the event */
  at: string;
  /** seconds before/after */
  padSec: number;
}

const p2 = (n: number) => String(n).padStart(2, "0");

function partsUtc(d: Date) {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

function partsIn(d: Date, timeZone: string) {
  try {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const o: Record<string, string> = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  } catch {
    return partsUtc(d);
  }
}

export const isoUtc = (d: Date) => {
  const p = partsUtc(d);
  return `${p.y}-${p2(p.m)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}Z`;
};
export const compactUtc = (d: Date) => isoUtc(d).replace(/[-:]/g, "");
const dahua = (p: ReturnType<typeof partsUtc>) => `${p.y}_${p2(p.m)}_${p2(p.d)}_${p2(p.h)}_${p2(p.mi)}_${p2(p.s)}`;

export interface PlaybackInput {
  brand: NvrBrand;
  channel: number;
  host: string;
  gateway?: string;
  timeZone?: string;
  /** override the brand default */
  template?: string | null;
  window: ClipWindow;
}

/** Fills a playback template for an event. Unknown placeholders are left as-is (visible, not silently wrong). */
export function playbackUrl(x: PlaybackInput): string {
  const t = (x.template && x.template.trim()) || PLAYBACK_PATTERNS[x.brand].template;
  const at = Date.parse(x.window.at);
  const start = new Date(at - x.window.padSec * 1000);
  const end = new Date(at + x.window.padSec * 1000);
  const tz = x.timeZone ?? "UTC";
  const ch = Math.max(1, Math.floor(x.channel || 1));
  const gw = (x.gateway ?? "").replace(/\/+$/, "");
  const vars: Record<string, string> = {
    host: x.host.replace(/^\w+:\/\//, "").replace(/\/+$/, ""),
    channel: String(ch),
    track: String(ch * 100 + 1),
    gateway: gw,
    path: `cam${ch}`,
    duration: String(Math.round((end.getTime() - start.getTime()) / 1000)),
    start_iso: isoUtc(start),
    end_iso: isoUtc(end),
    start_compact: compactUtc(start),
    end_compact: compactUtc(end),
    start_dahua: dahua(partsUtc(start)),
    end_dahua: dahua(partsUtc(end)),
    start_local_dahua: dahua(partsIn(start, tz)),
    end_local_dahua: dahua(partsIn(end, tz)),
    start_unix: String(Math.floor(start.getTime() / 1000)),
    end_unix: String(Math.floor(end.getTime() / 1000)),
  };
  return t.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export const isBrowserUrl = (u: string) => /^https?:\/\//i.test(u);

/* ───────── live view through a gateway ───────── */

export interface GatewayKind {
  id: "go2rtc" | "mediamtx";
  /** live page/stream for a stream name */
  live: (gateway: string, name: string, kind: StreamKind) => string;
  snapshot: ((gateway: string, name: string) => string) | null;
}

/**
 * go2rtc (AlexxIT): HTTP API :1984 — stream.html?src=<name> (WebRTC/MSE player page), api/stream.m3u8?src=<name> (HLS),
 * api/frame.jpeg?src=<name> (snapshot). MediaMTX (bluenviron): HLS :8888/<path>/index.m3u8, WebRTC :8889/<path>.
 */
export const GATEWAYS: Record<GatewayKind["id"], GatewayKind> = {
  go2rtc: {
    id: "go2rtc",
    live: (g, n, k) => (k === "hls" ? `${g}/api/stream.m3u8?src=${encodeURIComponent(n)}` : k === "mjpeg" ? `${g}/api/stream.mjpeg?src=${encodeURIComponent(n)}` : `${g}/stream.html?src=${encodeURIComponent(n)}&mode=webrtc`),
    snapshot: (g, n) => `${g}/api/frame.jpeg?src=${encodeURIComponent(n)}`,
  },
  mediamtx: {
    id: "mediamtx",
    live: (g, n, k) => (k === "hls" ? `${g.replace(/:\d+$/, "")}:8888/${n}/index.m3u8` : `${g.replace(/:\d+$/, "")}:8889/${n}`),
    snapshot: null,
  },
};

/** RTSP live path on the NVR, for the gateway config (shown in setup, never played in the browser). */
export function rtspLivePath(brand: NvrBrand, channel: number, sub = true): string {
  const ch = Math.max(1, Math.floor(channel || 1));
  switch (brand) {
    case "hikvision":
      return `/Streaming/Channels/${ch * 100 + (sub ? 2 : 1)}`;
    case "dahua":
      return `/cam/realmonitor?channel=${ch}&subtype=${sub ? 1 : 0}`;
    case "uniview":
      return `/unicast/c${ch}/s${sub ? 1 : 0}/live`;
    default:
      return `/stream${ch}`;
  }
}

/** What the tile should do with a camera's configured URL. */
export function playMode(c: Pick<Camera, "stream" | "url">): "demo" | "hls" | "iframe" | "img" | "img-poll" | "unplayable" {
  if (c.stream === "demo") return "demo";
  if (!c.url || /^rtsps?:\/\//i.test(c.url)) return "unplayable";
  if (c.stream === "hls") return "hls";
  if (c.stream === "webrtc") return "iframe";
  if (c.stream === "mjpeg") return "img";
  return "img-poll";
}

/** Adds a cache-buster to a snapshot URL. */
export function bust(url: string, n: number): string {
  return url + (url.includes("?") ? "&" : "?") + "_t=" + n;
}
