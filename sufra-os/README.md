# سُفرة OS — Sufra restaurant operating system

The staff-facing app: one shell that every module (POS, floor, kitchen, waiter, guest QR …) plugs into.
Vite + React 18 + TypeScript (strict) + Tailwind v4 + motion + lucide. Arabic-first (Egyptian dialect), full English/LTR, light/dark.

```bash
npm install
npm run dev          # http://localhost:5173/app/
npm test             # vitest: permissions, money, i18n coverage, registry, seed, LocalAdapter (CRUD + cross-tab), seed.sql sync
npx tsc --noEmit
npm run build        # dist/ (served under /app/)
npm run gen:seed     # regenerate supabase/seed.sql after editing src/data/seed.ts
node scripts/shots.mjs http://127.0.0.1:4318/app/ ./shots   # screenshots (needs `npx vite preview --port 4318`)
```

With no environment variables the whole backend runs **in the browser** (IndexedDB + demo seed). Open two tabs — e.g. the
guest QR menu in one and the owner overview in the other — and they update each other live (BroadcastChannel).
Set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (see `.env.example`, `supabase/README.md`) to switch to Postgres + Realtime.

## Demo logins

Email (password **`sufra2026`**): `owner@sufra.demo`, `admin@sufra.demo`, `manager@sufra.demo`, `accountant@sufra.demo`.
Sufra platform admin (Sufra staff, not a restaurant role): `platform@sufra.demo` / `sufra2026`, or PIN **0000** ("فريق منصة سُفرة") → `/platform`.
On the login screen these appear as one-tap demo accounts.

PIN (shared devices — `/app/login/pin`, the device is already paired to the demo restaurant in local mode):

| Name | Role | PIN | Lands on |
| --- | --- | --- | --- |
| كريم الشريف | owner (صاحب المطعم) | 1000 | /overview |
| منى عبد الحميد | admin | 2000 | /overview |
| تامر فؤاد | manager (مدير الصالة) | 3000 | /floor |
| سارة حسني | cashier (كاشير) | 4000 | /pos |
| مصطفى عادل | cashier | 4100 | /pos |
| أحمد سمير | waiter (جرسون) | 5000 | /waiter |
| يوسف محمود | waiter | 5100 | /waiter |
| نورهان علي | waiter | 5200 | /waiter |
| الشيف صابر | chef (شيف) | 6000 | /kitchen |
| محمد ربيع | kitchen (مطبخ) | 7000 | /kitchen |
| إسلام جمال | delivery (دليفري) | 8000 | /driver (rider app) |
| محمود سعيد | delivery | 8100 | /driver |
| عمر خالد | delivery | 8200 | /driver |
| هالة منصور | accountant (محاسب) | 9000 | /accounting |

Guest pages (no login): `/app/r/sufra-zamalek` (online menu) and `/app/r/sufra-zamalek/t/ZM05` (table 5 QR menu with
"call a waiter"). Table codes are `ZM01` … `ZM18`. User menu → "Reset demo data" restores the seed.

All people, phone numbers and orders in the seed are fictional.

## Layout

```
src/
  app/            App.tsx (providers + routes from the registry), guards (RequireStaff, RequirePermission, RoleHome)
  auth/           roles.ts · permissions.ts (matrix + authorize()) · session.tsx (email + PIN sessions, tenant/branch) · approval.tsx (manager-PIN approvals)
  data/           types.ts · repo.ts (the interface) · hooks.tsx (useDb/useLive/useRow/useSync) · query.ts · ops.ts · pricing.ts (→ @finance/tax)
                  seed.ts · seedSql.ts · local/ (LocalAdapter: IndexedDB + BroadcastChannel) · supabase/ (SupabaseAdapter: PostgREST + Realtime + outbox)
  i18n/           dict.ts (typed AR/EN copy) · i18n.tsx (useT, defineDict/useDict for modules)
  lib/            money.ts (Units) · time.ts · arabic.ts (search normalisation) · id.ts (uuid, seedId) · sha256.ts · storage.ts · cn.ts
  modules/        registry.tsx · types.ts (defineModule) · badges.ts · <one folder per module>/module.tsx
  pages/          LoginPage · PinLoginPage · NotFound
  shell/          AppShell (sidebar, top bar, bottom nav, auto-lock, ⌘K commands) · ComingSoon · Notifications · switchers · SyncIndicator · UserMenu
  theme/          ThemeProvider (system/light/dark)
  ui/             design system (see below)
supabase/         migrations/0001_init.sql · seed.sql (generated) · tests/ (RLS + RPC checks on plain Postgres) · README.md
```

## Modules plug in without touching the shell

Each module is a folder `src/modules/<name>/` whose `module.tsx` default-exports `defineModule({...})`.
`src/modules/registry.tsx` discovers them with `import.meta.glob` — routes, sidebar + phone bottom-bar items, ⌘K entries,
`g <key>` shortcuts, live nav badges, role homes and permission guards all come from that definition.
To build a module, replace the stub in your folder:

```tsx
// src/modules/pos/module.tsx
import { lazy } from "react";
import { Receipt } from "lucide-react";
import { defineModule } from "../types";

export default defineModule({
  id: "pos",
  status: "ready",                                // "soon" + no element → the "coming in the next wave" page
  icon: Receipt,
  title: { ar: "الكاشير", en: "POS" },
  description: { ar: "…", en: "…" },
  permission: "pos.use",                          // nav visibility + route guard
  homeFor: ["cashier"],                           // where these roles land after login
  shortcut: "g p",
  nav: { path: "/pos", group: "service", order: 10, mobile: true, useBadge: () => null },
  routes: [
    { path: "/pos/*", element: lazy(() => import("./PosPage")) },          // inside the shell
    // { path: "/kds", element: …, layout: "bare" },                       // signed-in, no chrome (kiosk/KDS)
    // { path: "/r/:restaurantSlug/x", element: …, layout: "guest" },      // public, no auth
  ],
});
```

Inside a module:

```tsx
const db = useDb();                                         // scoped to the current restaurant/branch/actor
const { data: items } = useLive("orderItems", { where: { status: ["sent", "preparing"] }, orderBy: [{ field: "firedAt" }] });
await setItemStatus(db, item.id, "ready");                  // every tab/device watching updates
const approve = useApproval();
const approver = await approve({ kind: "discount", pct: 15 }, L("خصم ١٥٪", "15% discount"));  // manager PIN when needed
const { t, L, loc, lang, dir } = useT();
useCommands([{ id: "pos.new", group: "actions", title: { ar: "طلب جديد", en: "New order" }, perform: … }]);
useHotkeys({ n: newOrder }, { descriptions: { n: { ar: "طلب جديد", en: "New order" } } });
```

Keep module copy in the module (`defineDict` + `useDict`); keep shared rules in `src/data/ops.ts`.

## Roles & permissions

Roles: `owner, admin, manager, cashier, waiter, chef, kitchen, delivery, accountant` (`src/auth/roles.ts`).
`src/auth/permissions.ts` holds the matrix (`can(role, "menu.edit")`) and sensitive-action rules (`authorize(role, action)`):

- discount above `settings.discountApprovalPct` (default 10%) → manager PIN (owner/admin/manager approve)
- void after the item was sent to the kitchen → manager PIN; before that, free
- refunds, reopening a paid check, opening the drawer without a sale → manager PIN
- payroll: owner/admin/accountant only; billing: owner only

Postgres RLS enforces the data side of the same rules (see `supabase/README.md`).

## Data layer

`Repo` (`src/data/repo.ts`) — two implementations behind the same interface:

- **LocalAdapter** — rows in memory, written through to IndexedDB (memory fallback in private mode), every write broadcast on a
  `BroadcastChannel` so tabs act like devices on the same restaurant network; peers are counted for the sync indicator.
- **SupabaseAdapter** — PostgREST queries, optimistic writes (listeners get the row immediately, then the server row or a rollback),
  a persisted outbox replayed in order when the connection returns, reads falling back to the last rows seen, and one Realtime
  channel per restaurant (`postgres_changes` filtered by `restaurant_id`).

Money is `Units` everywhere: integer 0.00001 EGP (1 EGP = 100 000) — exactly sufra-finance's bigint `Amount`
(`toAmount()` / `fromAmount()` in `src/lib/money.ts`), and the unit of every money column in Postgres.
Check totals are always computed by `@finance/tax` via `src/data/pricing.ts` (14% VAT T1/V009, 12% service T9/SC01 on dine-in by default).

`@finance/*` resolves to `../sufra-finance/src/*` (tsconfig `paths` + Vite alias). `eta-receipt.ts` imports `node:crypto` (server
side); the browser imports `eta-receipt-core.ts` (WebCrypto wrapper in `src/lib/receipt/eta.ts`) and `money`, `tax`, `ledger`,
`posting`, `shift`, `eta-client` freely.

## Delivery & online-order operations (`src/modules/delivery`, `supabase/migrations/0006_delivery.sql`)

- **Inbox** (`/delivery`): online/phone/app orders waiting for a decision — accept with a prep time (items fire to the kitchen,
  customer gets the ETA) or reject with a reason (order voided, customer told why). Auto-accept per channel
  (`settings.delivery.autoAccept`; default manual for online delivery/pickup, QR keeps waiter-confirm) and an auto-reject countdown
  (`autoRejectMin`). The nav badge counts waiting orders and chimes on new ones. "Phone order" = customer by phone → address/pin →
  a delivery ticket opened in the POS (`/pos?check=…`); "App order" = manual Talabat/elmenus/… entry with commission %.
- **Dispatch** (`/delivery/dispatch`): preparing → ready → assigned → out → delivered, live map (Leaflet + OSM; drawn fallback when tiles
  are blocked) with the kitchen, doors and riders, rider suggestions (`assign.ts`: idle/returning/batch, ETA = haversine × road factor ÷
  speed + hand-over), batching of nearby orders, late alerts, delay notices.
- **Rider app** (`/driver`, home of the delivery role): shift on/off, my orders, call/WhatsApp, navigate (Google Maps directions), amount to
  collect vs paid, picked up → arrived → delivered (door code or photo proof) / failed, live GPS (`watchPosition`, throttled) into
  `driverLocations`; the guest tracking page shows the rider, ETA and door code while out for delivery.
- **Rider cash** (`/delivery/settle`): expected vs handed in per shift; settling closes the delivered checks on this POS (receipt + ETA +
  `postSale`) and posts any short/over with finance `postCashMove` (6901).
- **Zones** (`/settings/delivery`): polygons or radius rings on the map, fee, minimum, ETA, free-delivery threshold, hours — used by guest
  checkout (local `deliveryZones`, cloud `delivery_zones`) + delivery rules. **Reports** (`/delivery/reports`): channel/zone/hour, prep and
  ride times, late %, riders (deliveries, time, cash, rating), aggregator commission.
- Every customer-facing stage goes through `notifyOrderStage(order, stage, { db })` (`src/modules/delivery/notify.ts`); the default sender
  is the guest `LogNotifier`, `registerOrderNotifier()` plugs in WhatsApp. Stage rules live in `stages.ts` (illegal transitions throw).

## POS, receipts & ETA (`src/modules/pos`, `src/modules/orders`, `src/lib/receipt`)

- **Register** (`/pos`): category rail + search (Arabic-normalised, Enter adds the first hit), tap to add / long-press for the
  modifiers sheet (required/optional groups with min/max, notes, seat, course, qty). Dine-in (mini floor map), takeaway, pickup
  (ready-in time), delivery (customer by phone, address, fee). Courses: course 1 goes with **Send**, later courses are held until
  **Fire**; sent lines carry `stationId`, so kitchen displays pick them up live. Item/bill discounts (% or amount, reason; manager
  PIN above `settings.discountApprovalPct`), void (free before send, manager PIN after), transfer lines / table, merge, split by
  item · seat (new checks) or evenly · by amount (payment shares; `splitEvenly` uses finance `allocate`, so shares always add up).
  Keys: `S` search · `N` new · `K` send · `H` hold · `P` pay · `D` discount · `X` split · `T` transfer · `O` open checks.
- **Payments**: cash (quick notes, change), card, wallet, InstaPay, pay-link placeholder, split tender, tips on non-cash. When the
  tenders cover the total the check closes: the bill is frozen (`receipts.bill`), a **receipt** with a continuous number per POS
  device is issued (`POS1-000001`), the **ETA e-receipt** is built and chained (`previousUUID` = the device's previous receipt), and
  the sale is posted with sufra-finance `postSale` into `ledgerEntries`. Returns (Orders → refund, manager PIN) are RC receipts in
  the same chain referencing the sale, posted with `postReturn`.
- **Shift & drawer** (`/pos/shift`): open with a float, paid in/out (posted with `postCashMove`), no-sale (manager PIN, logged),
  X report, blind count → **Z report** (sufra-finance `zReport`, frozen on the shift row) with over/short (`postDrawerCount`).
  The device code (`POS1`) is per tablet (localStorage `sufra-os.pos.device`).
- **Receipts**: `src/lib/receipt` — `buildReceiptModel` (pure) + `ReceiptView` (58 mm / 80 mm / A4, AR/EN/bilingual, logo, RIN,
  activity code, service/VAT lines, payments, change, ETA QR + UUID) + `printNode` (`window.print()` with a page-size print sheet).
  QR codes are encoded in the browser (`qrcode-generator`). Designer: `/settings/invoice`; tax profile + ETA setup: `/settings/tax`.
- Schema: `supabase/migrations/0002_pos.sql` (`shifts`, `cash_movements`, `receipts` — immutable except ETA status fields —,
  `ledger_entries`, `orders.pickup_at`, `checks.discount_reason/split_from`, `settings.eta`).

### ETA in the browser, submission on the server

sufra-finance's `eta-receipt.ts` hashes with `node:crypto`; its crypto-free core `eta-receipt-core.ts` (same serializer/document)
takes an async hash, and `src/lib/receipt/eta.ts` passes WebCrypto (`crypto.subtle.digest`). `eta.test.ts` proves the browser uuid
and JSON equal the node implementation for sales, chained receipts and returns. The ETA queue (`/pos/eta`) shows
pending/submitted/valid/rejected with sufra-finance `triage()` (24 h deadline, 30-day late-request limit) and can re-verify any uuid.

**Submitting needs the POS client id/secret — server-side secrets, never in the browser or in rows a tablet can read.** The
"Submit" button stays disabled until a server function exists. Design for `api/eta-submit.ts` (Vercel function, not built yet):

```ts
// api/eta-submit.ts — runs every minute (Vercel cron) and on demand; env: ETA_CLIENT_ID, ETA_CLIENT_SECRET, ETA_POS_SERIAL,
// ETA_POS_OS_VERSION, ETA_ENV (preprod|prod), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// 1. select receipts where eta_status = 'pending' order by device, seq (chain order) — service role, per restaurant
// 2. new EtaClient(creds, endpoints, fetch).submit(batch) for PosChain.batches(json[]) (≤500 receipts / ≤1.5 MB, in order)
// 3. accepted → eta_status 'submitted' + eta_submission_uuid; rejected → 'invalid' + eta_errors
// 4. later: EtaClient.details(submissionUuid) → 'valid' / 'invalid'; triage() → alert the owner about overdue receipts
// Only eta_status / eta_submission_uuid / eta_errors may change (receipts_immutable trigger in 0002_pos.sql).
```

## Online payments (`src/modules/payments`, `src/modules/guest/pay`, `/api/pay-*`)

Paymob / Kashier (Egypt) and Moyasar (KSA) behind one gateway layer: Vercel Edge functions in the repo root `api/`
(`pay-intent`, `pay-webhook-{paymob,kashier,moyasar}`, `pay-callback`, `pay-refund`, `pay-status`; shared code in
`api/_lib/pay-*.ts`, type-check with `sufra-os/node_modules/.bin/tsc -p api`). Pay at table with method choice, POS
**pay-by-link** (QR / WhatsApp / copy, the check closes itself when the verified payment lands), `/payments`
(transactions, refunds with manager PIN, settlements, reconciliation, CSV) and Settings → Payments. Locally the
DemoProvider simulates everything. Owner setup (env vars, webhook URLs, documents): `docs/PAYMENTS-SETUP.md`;
design + sources: `src/modules/guest/pay/DESIGN.md`; schema `supabase/migrations/0008_payments.sql`
(`supabase/tests/payments_run.sh`).

## WhatsApp & messaging (`src/modules/messaging`, `src/lib/notify`, `/api/whatsapp-*`)

- **Channels** (Settings → Messaging): off · **click-to-chat** (`wa.me/<E.164>?text=…`, works with no Meta account — staff tap send) ·
  **WhatsApp Cloud API** (through `api/whatsapp-send.ts`; token in Vercel env / Supabase Vault, never in the browser) · BSP (360dialog via the
  same API; Unifonic/Infobip/Twilio documented stubs). `notifierFor(settings)` picks the adapter; all share the `Notifier` interface.
- **Inbox** (`/messages`): conversations per customer, unread, assign, 24h-window badge, quick replies, attach a menu item / offer,
  send an order status or a template, record consent; **Templates** (AR/EN preview, Meta review status, copy the submission JSON);
  **Opt-in** register; **Message log** with delivery ticks and cost estimate. Nav badge = unread + click-to-chat messages waiting.
- **Rules** (`MessagingService`): STOP/إلغاء/وقف opts out (and confirms), marketing needs explicit opt-in, Utility allowed for the
  customer's own order, free text via the API only inside the 24h window, marketing postponed in quiet hours, dedupe per `orderId:stage`.
- **Automation**: delivery's `notifyOrderStage()` goes through it (`registerOrderNotifier()` at start-up); a feedback request is
  scheduled after delivery / a paid visit. Webhook `api/whatsapp-webhook.ts` (HMAC `X-Hub-Signature-256`) → `messaging_ingest_webhook()`.
- Schema `supabase/migrations/0007_messaging.sql` (+ `supabase/tests/messaging_test.sql`). Setup, env vars and Meta steps:
  [`docs/WHATSAPP-SETUP.md`](docs/WHATSAPP-SETUP.md). Screenshots: `node scripts/shots-messaging.mjs <base> <dir>`.

## CRM, loyalty, marketing & Sufra ads (`src/modules/customers`, `src/modules/marketing`, `src/modules/platform`, `src/lib/promo`)

- **Customers** (`/customers`): search + filters (tier, RFM, source, tag, leads), profile (contact, consent, birthday, tags,
  addresses, visits/orders, favourite items, LTV, points & tier history, stamps, coupons, feedback, notes, referrals), lead
  capture (QR join, online checkout, Wi-Fi/manual, reservations), duplicate merge, CSV import/export, rule-based
  **segments** with live counts and automatic **RFM** (champions, loyal, new, promising, at risk, lost).
- **Marketing** (`/marketing`): loyalty program (points per EGP, point value, tiers with multipliers/perks, stamp cards,
  rewards, expiry), offers & coupons (`src/lib/promo/engine.ts` — line discounts before tax, stacking, windows, limits,
  BOGO, combo, free delivery, first order, unique codes), gift cards (2204 liability), campaigns (segment → WhatsApp/SMS →
  personalised A/B text → offer with unique codes → schedule/send; results + ROI), automated journeys, the restaurant's
  own promos (QR-menu/online banners, receipt promo block + QR), reviews, customer reports, and **"اشتري إعلان"**.
- **POS**: key **C** / "كوبون / نقاط" → offers, coupons, loyalty rewards/points (phone or loyalty QR `SUFRA:<phone>`);
  gift card tender. Paid checks call `onCheckPaid` (points, stamps, tiers, redemptions, referral, attribution).
- **Guest**: banners on `/r/:slug` and the table menu, coupon box at online checkout, loyalty card `/r/:slug/me`, e-gift
  cards `/r/:slug/gift`.
- **Sufra platform** (`/platform`, role `platform_admin`): restaurants directory, sponsored slots & pricing, bookings
  calendar, approvals, performance. Public feed for the marketplace: `public_sponsored(city, cuisine)` (see
  `src/modules/marketing/DESIGN.md`).
- Schema: `supabase/migrations/0009_crm.sql`; SQL checks: `supabase/tests/crm_run.sh`; screenshots: `scripts/shots-crm.mjs`.

## Operations extras: cameras, walkie-talkie, support desk, alerts (`src/modules/ops`, Wave 3)

- **Cameras** (`/cameras`, owner/admin/manager): camera registry per branch (zone, NVR brand Hikvision/Dahua/Uniview/other,
  channel, stream HLS / WebRTC page / MJPEG / snapshot polling / demo placeholder, linked POS devices, drawers, tables),
  live wall 1/4/9/16 with fullscreen and status, **POS ↔ video exceptions** derived from `audit_log` (void, refund,
  discount above limit, no-sale drawer, cash over/short, manual 86) with device + staff + mapped cameras and “open clip”
  (per-brand playback URL templates, ± seconds), occupancy estimate per zone (**BETA**, manual + counter cameras).
  Browsers can't play RTSP: run go2rtc / MediaMTX on site (Setup generates the config). Demo cameras are an animated,
  labelled placeholder — never real footage.
- **Walkie-talkie** (`/radio`, every role; floating button on phones / top-bar pill on desktop for manager, waiter,
  kitchen, chef, delivery; dispatch card in the rider app): hold-to-talk (`MediaRecorder` Opus/WebM, AAC/MP4 on Safari),
  clips < 0.4 s discarded, 30 s cut, channels الكل/الصالة/المطبخ/الدليفري/الإدارة + 1:1, auto-play after the first tap
  (vibrate + toast when blocked), unread badges, who's on air, quick messages. Local = IndexedDB + BroadcastChannel (open
  two tabs as two people); cloud = Supabase Storage `radio` + Realtime. Live voice (LiveKit/Agora/Zello) = adapter interface.
- **Guest hotline** (`/support`): “كلّم المطعم” on the QR / online / tracking pages (call, WhatsApp, complaint) → tickets
  with the guest's orders/payments/calls/feedback, priority, SLA + escalation, assignee, internal notes, resolution,
  WhatsApp follow-up. **Help** (`/help`): 27 AR/EN articles with Arabic-normalised search, “اطلب دعم” with scrubbed
  diagnostics, my requests, live status. **Sufra desk** (`/sufra-desk`, `platform_admin`): every restaurant's tickets.
- **Alerts center** (`/alerts`): escalated calls, late deliveries, low stock (inventory plugs in with
  `registerLowStockSource`), cash over/short, camera exceptions, failed payments, tickets past SLA + rules (who is
  notified). Settings → Operations (`/settings/ops`): hotline numbers, SLAs, radio limits.
- Schema `supabase/migrations/0013_ops.sql` (`supabase/tests/ops_run.sh`); server `api/support-ticket.ts`
  (`SUPPORT_WEBHOOK_URL`, `SUPPORT_WEBHOOK_SECRET`, `RESEND_API_KEY` + `SUPPORT_EMAIL_TO`) and `api/radio-token.ts`
  (interface). Design, URL patterns and sources: `src/modules/ops/DESIGN.md`.

## Accounting, cash & reports (`src/modules/accounting`, `src/modules/reports`, `supabase/migrations/0011_accounting.sql`)

- **Posting API for every module** — `src/modules/accounting/api.ts`: `postJournal(db, { date, branchId, sourceType, sourceId, memo, lines })`
  (balanced Units lines, chart check, period lock, idempotent per source), `reverseJournal`, `closePeriod`, `ACC` account codes, `SOURCE` types,
  helpers `postPayroll` / `postPayrollPayment` / `postPurchaseInvoice` / `postSupplierPayment` / `postCogs` / `postWaste` / `postPayout`. Entries are
  append-only (a DB trigger rejects unbalanced lines, edits and postings on or before `accounting_settings.closed_through`).
- **Chart of accounts** (`chart.ts`, Egyptian numbering 1–6, Arabic names, built on sufra-finance `ACCOUNTS`), editable; cost centres per branch.
- **/accounting**: السيولة (cash on hand by till / safe / petty / bank / wallet / pending gateway & app settlements, 30-day forecast, alerts,
  daily cash-up) · journal (filters, drill-down, manual journals with maker/checker approval, reversals) · expenses (receipt photo, input VAT,
  paid from cash/bank or on credit, recurring) · safe & petty (transfers with counts → over/short) · bank reconciliation (CSV import, auto-match
  ±3 days, manual match, book unknown lines) · VAT return (file + lock) · chart · period close + settings · export (generic / Odoo / QuickBooks /
  Zoho CSV — design in `src/modules/accounting/INTEGRATIONS.md`).
- **/reports**: sales (item, category, hour, day, channel, order type, table, payment, discounts, voids, refunds, covers, avg check, table turns),
  menu engineering (stars / plowhorses / puzzles / dogs), staff, P&L (branch, compare), balance sheet, trial balance, cash flow, service/tips &
  liabilities. CSV + print/PDF. Tax and forecast figures are marked “تقديري — يراجعه المحاسب”.
- Owner overview shows today's profit estimate, cash on hand and upcoming obligations. Seed: ~3 months of books (`accounting/seed.ts`).
- SQL checks: `supabase/tests/accounting_run.sh`; screenshots: `node scripts/shots-accounting.mjs <base> <dir>`.

## Design system (`src/ui`)

Tokens in `src/styles/index.css` (same identity as sufra-web: sage-stone neutrals, deep teal, brass; Reem Kufi / IBM Plex Sans Arabic /
IBM Plex Mono). Components: Button/LinkButton/IconButton, Input/Textarea/Select/Switch/Field, Segmented, Tabs, Dialog/Sheet (bottom sheet
with drag-to-dismiss on phones), Toast, Badge/StatusDot, Avatar, Card/CardHeader, StatTile/Sparkline, BarChart/Meter, EmptyState,
Skeleton, Kbd/Combo, Money/AnimatedMoney/AnimatedNumber, Table, Popover/MenuItem, CommandPalette (⌘K, `/`), PinPad, hotkeys with
scopes (`useHotkeys`, `HotkeyScope`; dialogs open a new scope; Arabic keyboard layouts work). Touch targets are ≥44px (`sm` sizes are for
dense desktop toolbars only); motion uses shared springs and collapses to instant with `prefers-reduced-motion`.

## Deploying under the existing Vercel site at `/app/`

`vite.config.ts` sets `base: "/app/"` and the router uses that basename. To ship it with the site, the root build needs to
build this app and copy `sufra-os/dist` to `sufra-web/dist/app`, plus a rewrite placed **before** the site's catch-all:

```json
{ "source": "/app/((?!assets/).*)", "destination": "/app/index.html" }
```

(and `installCommand` should also `npm ci` in `sufra-os`). This wiring is not done yet — the root `vercel.json` still builds only sufra-web.
