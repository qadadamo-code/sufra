# Operations extras — design notes (Wave 3)

Cameras, walkie-talkie, support desk & hotline, alerts center. Code: `src/modules/ops/*`, schema
`supabase/migrations/0013_ops.sql` (+ `supabase/tests/ops_run.sh`), server functions `api/support-ticket.ts`,
`api/radio-token.ts` (`api/_lib/ops-*.ts`).

```
ops/
  types.ts  settings.ts  seed.ts  shell.tsx (radio runtime, floating/top-bar PTT, alert toasts)  ui.tsx
  cameras/  module.tsx  CamerasPage (live wall) · EventsView · OccupancyView · SetupView
            nvr.ts (playback/live URL patterns) · events.ts (audit → video events → cameras) · occupancy.ts · DemoFeed
  radio/    module.tsx  RadioPage · PttButton · DriverRadio · engine.ts (runtime) · ptt.ts (state machine)
            channels.ts (membership) · recorder.ts (MediaRecorder) · transport.ts (local / Supabase / live-voice interface)
  support/  module.tsx  TicketsPage (/support) · TicketDetail · HelpPage (/help) · DeskPage (/sufra-desk) · OpsSettingsPage
            ContactRestaurant (guest sheet) · tickets.ts (SLA) · articles.ts (help + search) · diagnostics.ts · ops.ts
  help/ desk/ alerts/   module definitions; alerts/alerts.ts (aggregator + rules) · useAlerts.ts · AlertsPage
```

## Cameras

### What a browser can play
Browsers do not play RTSP. Every live tile therefore uses one of:

| `stream` | URL | Notes |
| --- | --- | --- |
| `webrtc` | go2rtc `…/stream.html?src=<name>` (iframe) or MediaMTX `:8889/<path>` | lowest latency, works in every browser |
| `hls` | `…/index.m3u8` (MediaMTX `:8888/<path>/index.m3u8`, go2rtc `/api/stream.m3u8?src=`) | native HLS only (Safari/iOS, recent Chrome on Android); otherwise the tile says “use WebRTC” — no hls.js dependency added |
| `mjpeg` | MJPEG endpoint | simple, heavier on bandwidth |
| `snapshot` | JPEG URL polled every `snapshotSec` (cache-busted) | works through almost anything |
| `demo` | — | animated canvas placeholder with a permanent “DEMO · ليس بثاً حقيقياً” banner. No real-looking footage is ever shown (sufra-web/public has no CC0 restaurant video). |

`rtsp://` URLs are refused by the UI and by a CHECK in `cameras.url`, as are `user:pass@` URLs: credentials stay on the
gateway/NVR.

### Small on-site gateway (recommended)
A mini-PC / Raspberry Pi on the restaurant LAN runs **go2rtc** (single binary) with the NVR's RTSP channels; Setup
generates the `go2rtc.yaml` (`streams: camN: rtsp://USER:PASS@<nvr><path>`, RTSP live paths from `rtspLivePath()`:
Hikvision `/Streaming/Channels/<ch>0<1|2>`, Dahua `/cam/realmonitor?channel=N&subtype=0|1`, Uniview `/unicast/cN/s0|1/live`).
Expose it with **HTTPS + auth** (Cloudflare Tunnel / Tailscale Funnel) — go2rtc's API on :1984 has no password by
default [go2rtc]. Alternative: **MediaMTX**, which can also *record* and serve clips over HTTP (playback server).
NVR vendor clouds (Hik-Connect, DMSS) are P2P apps without a stable embeddable URL; use the gateway.

### POS ↔ video exceptions
Every sensitive POS action is already in `audit_log`. `events.ts#eventFromAudit` keeps the ones a loss-prevention review
needs — the proven pattern of POS-overlay / exception search (Envysion, March Networks):

| audit action | event | severity |
| --- | --- | --- |
| `order.void` (manager-approved after send), `payment.void` | void | warn / high |
| `payment.refund` | refund | high |
| `check.discount` / `item.discount` above `settings.discountApprovalPct` (pct, basis-point rate or amount share) or manager-approved | discount | warn, high ≥ 30 % |
| `drawer.open` (no-sale) | no_sale | warn |
| `shift.close` / `delivery.settle` with `difference ≠ 0` | cash_variance | short = high |
| `menu.86` | item_86 (device `KDS`) | info |

Device: `data.device` → the shift / cash movement / receipt row → the actor's open shift at that time. Cameras:
`camerasFor()` = same branch, active, linked to the device or drawer (score 2) and/or one of the event's tables (score 1).
Reviews (OK / suspicious) are `ops_acks` rows keyed by the audit id. Cloud mirror: view `ops_video_events`.

“Open clip” fills the brand's playback template for `event time ± clipPadSec` (Settings → Cameras → templates can override
per brand). RTSP results open in VLC / the NVR client; HTTP results (MediaMTX) open in the browser.

| brand | default template | confidence | source |
| --- | --- | --- | --- |
| Hikvision | `rtsp://{host}/Streaming/tracks/{ch}01?starttime={start_iso}&endtime={end_iso}` (UTC `YYYY-MM-DDTHH:MM:SSZ`) | **unconfirmed** (community; some firmware ignores `starttime`; the compact `20190814T090516z` form reportedly fails) | [vxg], [ipcamtalk] |
| Dahua | `rtsp://{host}/cam/playback?channel={ch}&starttime={start_dahua}&endtime={end_dahua}` (`YYYY_MM_DD_HH_MM_SS`) | **unconfirmed** (third-party says UTC; many NVRs use local time → `{start_local_dahua}`) | [vxg], [ha] |
| Uniview | `rtsp://{host}/c{ch}/b{unix}/e{unix}/replay/` | documented (Uniview PDF) | [unv] |
| Other / MediaMTX | `{gateway}/get?path=cam{ch}&start={start_iso}&duration={sec}` (fMP4 over HTTP) | **unconfirmed** in this repo (third-party summary of the playback server) | [mtx] |

Hikvision ISAPI search (`/ISAPI/ContentMgmt/search`) is a POST with XML, not a link — out of scope for a URL template.

### Occupancy (BETA)
Manual head counts per zone (host) + camera line-crossing counts (`people_counts`, source `camera`). Estimate = last manual
anchor + net flow after it, ≥ 0, with a confidence label; clearly marked BETA and never changes table status. Counter
ingestion is an interface (`PeopleCounterSource`): a poller (on the gateway box or a cron function with the service role)
reads the NVR's counting API and inserts rows. Vendor endpoints (Hikvision people-counting search under ISAPI, Dahua
`videoStatServer.cgi`) are **unconfirmed** and differ by model — verify on the device before building the poller.

**Table occupancy AI — design note only.** A ceiling camera + a person/chair detector can estimate occupied tables and
flag “occupied but no open check”. It needs per-venue calibration (table polygons in camera space), privacy review
(PDPL 151/2020 notices), and is not reliable enough to drive table state today. If piloted: run on the gateway, emit
`{tableId, occupied, confidence}` only (no images leave the site), show as a hint on the floor, never auto-change status.

## Walkie-talkie

* **Hold-to-talk** (`PttButton`): pointer down → `getUserMedia` (echo cancellation, mono) → `MediaRecorder`
  (`audio/webm;codecs=opus` → `audio/ogg;codecs=opus` → `audio/mp4` AAC for Safari/iOS) → release → clip. Space/Enter
  on the focused button also works. State machine `ptt.ts`: clips under `minClipMs` (400) are discarded, recording is
  hard-cut at `maxClipSec` (30) like a radio's time-out timer, early release while the mic opens = discarded.
* **Delivery**: the audio is stored first, then a `radio_clips` row is inserted, so receivers always find the blob.
  - local: IndexedDB `sufra-os-radio` (shared by every tab of the origin) + the LocalAdapter BroadcastChannel for the row,
    and `sufra-os:radio` BroadcastChannel for “on air” presence.
  - cloud: Supabase Storage bucket `radio` (`<restaurant>/<clip>.<ext>`, members only) + Realtime `postgres_changes`
    for rows (RLS `radio_can_hear`) + a Realtime broadcast channel `radio:<restaurant>` for presence.
* **Auto-play**: browsers block audio until a user gesture; the first tap/keypress anywhere unlocks an `AudioContext`.
  If `play()` is still refused the clip is queued, the phone vibrates and a toast offers “Play”.
* **Channels** (`channels.ts`, mirrored in SQL `radio_can_hear`): الكل (all roles), الصالة, المطبخ, الدليفري, الإدارة +
  direct `dm:<a>:<b>`. Each role auto-plays its default channels; people change it on /radio. Quick canned messages
  (“طاولة ٥ محتاجة جرسون” …) are text clips read aloud with speech synthesis.
* **Floating PTT**: phones get a floating button (manager, waiter, kitchen/chef, delivery) on their default channel;
  desktops get a pill in the top bar. The rider app has its own dispatch card (`DriverRadio`).
* **Live low-latency voice** (`RealtimeVoiceAdapter`, interface only): LiveKit / Agora / Zello Work rooms per channel,
  mic track published only while held. Env: `VITE_PTT_PROVIDER`, `VITE_LIVEKIT_URL` | `VITE_AGORA_APP_ID` |
  `VITE_ZELLO_NETWORK`; server tokens via `api/radio-token.ts` (`PTT_PROVIDER`, `LIVEKIT_API_KEY/SECRET`,
  `AGORA_APP_CERTIFICATE`, `ZELLO_API_KEY`) — returns 501 until implemented.

## Support & hotline

* **Guest hotline**: `ContactRestaurant` on the QR table menu, online menu and tracking page → call / WhatsApp
  (`ops_settings.hotline_phone` / `whatsapp_phone`, fallback branch phone; anon RPC `guest_contact`) / complaint form →
  `guest_complaint_submit` (anon RPC: phone normalised, 5/hour flood guard, priority guessed — allergy/foreign object =
  urgent, billing = high). Tickets carry the customer, order, check and table → the detail shows orders, payments, table
  calls, feedback and earlier tickets.
* **Tickets** (`tickets.ts`): SLA per priority (first reply / resolve, minutes, Settings → Operations), states
  new → open → pending → resolved → closed (reopen allowed), escalation one level up when a clock is breached (again only
  after another response window), internal notes vs replies, resolution, WhatsApp follow-up (click-to-chat).
* **Sufra support**: `/help` — 27 bilingual articles with Arabic-normalised search, “اطلب دعم” with scrubbed diagnostics
  (version, device, screen, sync status, last 15 errors from window errors + the shell ErrorBoundary via `sufra:error`),
  my requests, live status (sync + API probes). `/sufra-desk` for `platform_admin` lists every restaurant's tickets
  (RLS `is_platform_admin()`). `api/support-ticket.ts` optionally forwards to `SUPPORT_WEBHOOK_URL` (Slack-aware,
  HMAC `X-Sufra-Signature` with `SUPPORT_WEBHOOK_SECRET`) and/or e-mail via Resend (`RESEND_API_KEY`, `SUPPORT_EMAIL_TO`).

## Alerts center
`alerts.ts#buildAlerts` aggregates escalated guest calls, late deliveries (`dispatch.promisedAt` + grace), low stock
(pluggable `registerLowStockSource()` for the inventory module), cash over/short ≥ threshold, high-severity camera
exceptions, failed online payments and tickets past SLA. Rules (`ops_settings.alert_rules`): on/off, threshold and the
roles that get a toast. Acknowledgements are `ops_acks` rows.

## Sources
- [vxg] VXG, “RTSP URL formats for SD-card playback” — https://help.videoexpertsgroup.com/kb/rtsp-url-formats-for-sd-card-playback
- [ipcamtalk] IPCamTalk, “Playback recorded video using RTSP” — https://ipcamtalk.com/threads/playback-recorded-video-using-rtsp.41227/ ; “Play recorded videos via RTSP” — https://ipcamtalk.com/threads/play-recorded-videos-via-rtsp.414/
- [ha] Home Assistant community, Dahua playback example — https://community.home-assistant.io/t/rtsp-stream-url-play-via-mobile/968469
- [unv] Uniview, “How to Get the URLs for Uniview IPC and NVR” — https://www.uniview.com/res/202310/26/20231026_1890323_How%20to%20Get%20the%20URLs%20for%20Uniview%20IPC%20and%20NVR_975509_168459_0.pdf
- [mtx] MediaMTX recording & playback (DeepWiki summary) — https://deepwiki.com/bluenviron/mediamtx/5-recording-and-playback ; repo https://github.com/bluenviron/mediamtx
- [go2rtc] AlexxIT/go2rtc — https://github.com/AlexxIT/go2rtc (ports 1984/8554/8555, no password by default); stream.html / api/frame.jpeg / api/stream.m3u8 endpoint names from the project README — **verify against your go2rtc version**.
