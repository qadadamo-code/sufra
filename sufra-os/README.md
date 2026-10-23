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
| إسلام جمال | delivery (دليفري) | 8000 | /delivery |
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

`@finance/*` resolves to `../sufra-finance/src/*` (tsconfig `paths` + Vite alias). Note: `eta-receipt.ts` imports `node:crypto`,
so it must run server-side (or get a WebCrypto port) — the browser app imports `money`, `tax`, `ledger`, `posting`, `shift` freely.

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
