/**
 * Wave 3 — Operations extras: cameras, walkie-talkie, support desk, alerts.
 * Rows for supabase/migrations/0013_ops.sql. Pure rules live next to each feature (cameras/nvr.ts, cameras/events.ts,
 * radio/ptt.ts, radio/channels.ts, support/tickets.ts, support/articles.ts, alerts/alerts.ts).
 */
import type { Localized, TenantRow } from "@/data/types";
import type { Role } from "@/auth/roles";

/* ───────────── cameras ───────────── */

export type NvrBrand = "hikvision" | "dahua" | "uniview" | "other";
/** What the browser plays. RTSP never plays in a browser: an on-site gateway (go2rtc / MediaMTX) or the NVR cloud converts it. */
export type StreamKind = "hls" | "webrtc" | "mjpeg" | "snapshot" | "demo";

export interface Camera extends TenantRow {
  branchId: string;
  name: Localized;
  /** free label: "الكاشير", "المطبخ", "المدخل" … */
  area: string;
  /** floor zone (for occupancy) */
  zoneId: string | null;
  brand: NvrBrand;
  /** NVR channel number (1-based) — playback URL templates use it */
  channel: number;
  stream: StreamKind;
  /** browser-playable URL: .m3u8 (hls), go2rtc/MediaMTX WebRTC page (webrtc), MJPEG/snapshot URL */
  url: string;
  /** seconds between snapshot refreshes */
  snapshotSec: number;
  /** links: these devices / tables / drawers are in this camera's view */
  posDevices: string[];
  tableIds: string[];
  drawers: string[];
  /** counts people at an entrance (camera counter) */
  counter: boolean;
  active: boolean;
  sort: number;
}

/** A people-count sample for a zone: manual entry by the host, or ingested from a camera counter. */
export interface PeopleCount extends TenantRow {
  branchId: string;
  zoneId: string | null;
  cameraId: string | null;
  source: "manual" | "camera";
  /** people entering / leaving since the previous sample (camera line-crossing), or 0 */
  inCount: number;
  outCount: number;
  /** absolute head count when known (manual) */
  occupancy: number | null;
  at: string;
  actorId: string | null;
}

/* ───────────── walkie-talkie ───────────── */

export type RadioChannelId = "all" | "floor" | "kitchen" | "delivery" | "managers" | `dm:${string}`;

export interface RadioClip extends TenantRow {
  branchId: string | null;
  channel: RadioChannelId;
  fromId: string;
  fromName: string;
  mime: string;
  durationMs: number;
  bytes: number;
  /** local: IndexedDB key (same as id) · cloud: Supabase Storage path radio/<restaurant>/<id>.<ext> */
  storagePath: string;
  /** canned text message (no audio) */
  text: string | null;
  at: string;
}

/* ───────────── support desk ───────────── */

export type TicketKind = "guest" | "sufra";
export type TicketStatus = "new" | "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketChannel = "qr" | "online" | "phone" | "whatsapp" | "walk_in" | "app";

export interface TicketNote {
  id: string;
  at: string;
  by: string | null;
  byName: string;
  /** internal = staff only · reply = sent to the guest/restaurant · system = status changes */
  kind: "internal" | "reply" | "system";
  text: string;
}

export interface Diagnostics {
  appVersion: string;
  build: string;
  userAgent: string;
  platform: string;
  screen: string;
  online: boolean;
  lang: string;
  url: string;
  sync: { mode: string; online: boolean; pending: number; peers: number; lastSyncAt: string | null; error: string | null };
  role: string | null;
  errors: { at: string; message: string; stack?: string }[];
  standalone: boolean;
  at: string;
}

export interface SupportTicket extends TenantRow {
  branchId: string | null;
  kind: TicketKind;
  /** human number: G-1042 / S-0007 */
  number: string;
  subject: string;
  body: string;
  category: string;
  channel: TicketChannel;
  priority: TicketPriority;
  status: TicketStatus;
  /** guest side */
  customerId: string | null;
  contactName: string;
  contactPhone: string;
  orderId: string | null;
  checkId: string | null;
  tableId: string | null;
  /** staff that raised it (sufra tickets) */
  raisedBy: string | null;
  assigneeId: string | null;
  notes: TicketNote[];
  resolution: string;
  /** follow-up message to the guest after resolution */
  followUp: string | null;
  followUpAt: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
  diagnostics: Diagnostics | null;
  /** forwarded to Sufra support (api/support-ticket) */
  forwardedAt: string | null;
}

/* ───────────── settings & acks ───────────── */

export type AlertKind = "call_escalated" | "late_delivery" | "low_stock" | "cash_variance" | "camera_exception" | "payment_failed" | "ticket_sla" | "device_offline";

export interface AlertRule {
  kind: AlertKind;
  enabled: boolean;
  /** roles that get a toast/push for it */
  notify: Role[];
  /** kind-specific threshold (minutes late, money units, …) */
  threshold: number;
}

export interface OpsSettings extends TenantRow {
  /** guest hotline shown on the guest "contact the restaurant" sheet (falls back to the branch phone) */
  hotlinePhone: string;
  whatsappPhone: string;
  /** Sufra technical support line (placeholder until Sufra publishes one) */
  sufraSupportPhone: string;
  sufraSupportWhatsapp: string;
  /** on-site camera gateway base URL (go2rtc / MediaMTX) — playback templates may use {gateway} */
  gatewayUrl: string;
  /** per-brand playback template overrides (see cameras/nvr.ts) */
  playbackTemplates: Partial<Record<NvrBrand, string>>;
  /** NVR address on the LAN (for the templates) */
  nvrHost: string;
  /** seconds before/after an event when opening a clip */
  clipPadSec: number;
  /** zone capacity for estimated occupancy */
  zoneCapacity: Record<string, number>;
  /** ticket SLAs in minutes: first response / resolution per priority */
  sla: Record<TicketPriority, { response: number; resolve: number }>;
  alertRules: AlertRule[];
  radio: { maxClipSec: number; minClipMs: number; autoplay: boolean };
}

/** Reviewed / acknowledged marker for a camera event or an alert (id = the event/alert key). */
export interface OpsAck extends TenantRow {
  kind: "event" | "alert";
  by: string | null;
  note: string;
  /** event review outcome */
  verdict: "ok" | "suspicious" | "action" | null;
}
