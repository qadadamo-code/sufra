/**
 * Diagnostics auto-attached to "اطلب دعم" tickets: app version, device, sync status, the last errors.
 * Errors come from window error/unhandledrejection and from the shell ErrorBoundary (it dispatches `sufra:error`).
 * Nothing secret goes in: no tokens, no rows, URLs without query strings.
 */
import type { SyncStatus } from "@/data/repo";
import type { Diagnostics } from "../types";

const MAX = 15;
const KEY = "sufra-os.diag.errors";
let errors: Diagnostics["errors"] = [];
let installed = false;

function load() {
  try {
    errors = JSON.parse(sessionStorage.getItem(KEY) ?? "[]");
  } catch {
    errors = [];
  }
}
function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(errors));
  } catch {
    /* private mode */
  }
}

/** Strips tokens / emails / long digit runs from a message before it leaves the device. */
export function scrub(s: string): string {
  return s
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\b(?:key|token|secret|password)=[^&\s]+/gi, (m) => m.split("=")[0] + "=[redacted]")
    .replace(/\d{9,}/g, "[number]")
    .slice(0, 500);
}

export function recordError(err: unknown) {
  const e = err as { message?: string; stack?: string } | string;
  const message = scrub(typeof e === "string" ? e : e?.message ?? String(err));
  if (!message) return;
  errors = [{ at: new Date().toISOString(), message, stack: typeof e === "object" && e?.stack ? scrub(e.stack.split("\n").slice(0, 4).join("\n")) : undefined }, ...errors].slice(0, MAX);
  save();
}

export function installDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  load();
  window.addEventListener("error", (e) => recordError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => recordError((e as PromiseRejectionEvent).reason));
  window.addEventListener("sufra:error", (e) => recordError((e as CustomEvent).detail));
}

export const recentErrors = () => errors.slice();

export function collectDiagnostics(x: { sync: SyncStatus; role: string | null; lang: string }): Diagnostics {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const w = typeof window !== "undefined" ? window : null;
  return {
    appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.1.0",
    build: typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : import.meta.env.MODE,
    userAgent: nav?.userAgent ?? "",
    platform: (nav as { userAgentData?: { platform?: string } } | null)?.userAgentData?.platform ?? nav?.platform ?? "",
    screen: w ? `${w.screen.width}×${w.screen.height} @${w.devicePixelRatio}x (${w.innerWidth}×${w.innerHeight})` : "",
    online: nav?.onLine ?? true,
    lang: x.lang,
    url: w ? w.location.pathname : "",
    sync: { mode: x.sync.mode, online: x.sync.online, pending: x.sync.pending, peers: x.sync.peers, lastSyncAt: x.sync.lastSyncAt, error: x.sync.error ? scrub(x.sync.error) : null },
    role: x.role,
    errors: recentErrors(),
    standalone: !!w?.matchMedia?.("(display-mode: standalone)").matches,
    at: new Date().toISOString(),
  };
}

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;
