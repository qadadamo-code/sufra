-- ════════════════════════════════════════════════════════════════════════════
-- Sufra OS — initial schema
--
-- Multi-tenant: every row carries restaurant_id; Row Level Security limits each
-- signed-in user to the restaurants they are a member of, and by role.
--
-- MONEY: every money column is BIGINT in units of 0.00001 of the currency
-- (EGP: 1 EGP = 100 000 units, 1 piastre = 1 000 units). This is exactly the
-- unit of sufra-finance's bigint `Amount`, so values pass between the database,
-- the app (src/lib/money.ts) and the tax/ledger code without conversion.
-- RATES are basis points (14% = 1400).
-- FLOOR geometry is centimetres (sufra-floor).
--
-- Anonymous guests (QR table menu, online ordering) never touch tables directly:
-- they call the SECURITY DEFINER functions guest_* at the bottom of this file.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────────── types ─────────────────────────────
do $$ begin
  create type public.app_role as enum ('owner','admin','manager','cashier','waiter','chef','kitchen','delivery','accountant');
exception when duplicate_object then null; end $$;

-- ───────────────────────────── helpers ─────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ───────────────────────────── tenancy ─────────────────────────────
create table public.restaurants (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name          jsonb not null,                         -- {"ar": "...", "en": "..."}
  owner_user_id uuid references auth.users (id) on delete set null,
  country       text not null default 'EG' check (country in ('EG','SA')),
  currency      text not null default 'EGP' check (currency in ('EGP','SAR')),
  timezone      text not null default 'Africa/Cairo',
  brand_color   text not null default '#0d5a53',
  phone         text,
  plan          text not null default 'trial' check (plan in ('trial','starter','pro','chain')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.branches (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  name            jsonb not null,
  slug            text not null,
  address         jsonb not null default '{"ar":"","en":""}',
  phone           text,
  is_default      boolean not null default false,
  eta_branch_code text not null default '0',
  opening_hours   jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, slug)
);

-- A person's role in a restaurant. user_id is null for PIN-only staff (shared devices).
create table public.memberships (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  name             text not null,
  role             public.app_role not null,
  pin_hash         text,                                -- bcrypt (pgcrypto); never readable by clients
  has_pin          boolean generated always as (pin_hash is not null) stored,
  pin_failed_count int not null default 0,
  pin_locked_until timestamptz,
  branch_ids       uuid[] not null default '{}',        -- empty = all branches
  phone            text,
  email            text,
  color            text not null default '#0d5a53',
  active           boolean not null default true,
  last_seen_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (restaurant_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where user_id is not null;
create index memberships_restaurant_idx on public.memberships (restaurant_id);

-- Role-limited example: payroll is visible to owner/admin/accountant only.
create table public.staff_compensation (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  membership_id  uuid not null references public.memberships (id) on delete cascade,
  monthly_salary bigint not null default 0,             -- units (0.00001 EGP)
  hourly_rate    bigint not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (membership_id)
);

-- ───────────────────────────── membership helpers (used by RLS) ─────────────────────────────
-- SECURITY DEFINER so policies on memberships itself do not recurse.
create or replace function public.is_member(rid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.restaurant_id = rid and m.user_id = auth.uid() and m.active);
$$;

create or replace function public.has_role(rid uuid, roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.restaurant_id = rid and m.user_id = auth.uid() and m.active and m.role = any (roles));
$$;

create or replace function public.my_role(rid uuid) returns public.app_role
language sql stable security definer set search_path = public as $$
  select m.role from memberships m where m.restaurant_id = rid and m.user_id = auth.uid() and m.active limit 1;
$$;

-- Branch restriction: membership.branch_ids empty = every branch.
create or replace function public.in_branch(rid uuid, bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.restaurant_id = rid and m.user_id = auth.uid() and m.active
      and (cardinality(m.branch_ids) = 0 or bid is null or bid = any (m.branch_ids))
  );
$$;

-- ───────────────────────────── floor ─────────────────────────────
create table public.zones (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          jsonb not null,
  width         int not null check (width > 0),         -- cm
  height        int not null check (height > 0),
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.dining_tables (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  branch_id       uuid not null references public.branches (id) on delete cascade,
  zone_id         uuid not null references public.zones (id) on delete cascade,
  label           text not null,
  code            text not null,                        -- printed in the QR: /r/:slug/t/:code
  shape           text not null check (shape in ('square','rect','round','oval','booth','bar')),
  x               numeric not null,                     -- centre, cm
  y               numeric not null,
  w               numeric not null check (w > 0),
  h               numeric not null check (h > 0),
  rotation        int not null default 0 check (rotation % 45 = 0),
  seats_override  int check (seats_override is null or seats_override > 0),
  status          text not null default 'free' check (status in ('free','seated','ordered','bill','dirty','reserved','blocked')),
  status_since    timestamptz,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, code)
);
create index dining_tables_restaurant_idx on public.dining_tables (restaurant_id, branch_id);

create table public.floor_decor (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  zone_id       uuid not null references public.zones (id) on delete cascade,
  kind          text not null check (kind in ('wall','pillar','door','counter','plant','window')),
  x numeric not null, y numeric not null, w numeric not null, h numeric not null,
  rotation      int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.table_links (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_ids     uuid[] not null check (cardinality(table_ids) >= 2),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ───────────────────────────── kitchen & printers ─────────────────────────────
create table public.printers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          text not null,
  kind          text not null check (kind in ('receipt','kitchen','label')),
  connection    text not null check (connection in ('network','usb','bluetooth','cloud')),
  address       text,
  paper_width   int not null default 80 check (paper_width in (58, 80)),
  station_id    uuid,                                   -- fk added below
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.kitchen_stations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          jsonb not null,
  color         text not null default '#0d5a53',
  printer_id    uuid references public.printers (id) on delete set null,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.printers add constraint printers_station_fk foreign key (station_id) references public.kitchen_stations (id) on delete set null;

-- ───────────────────────────── menu ─────────────────────────────
create table public.menu_categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          jsonb not null,
  sort          int not null default 0,
  color         text not null default '#0d5a53',
  icon          text not null default 'utensils',
  station_id    uuid references public.kitchen_stations (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.modifier_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          jsonb not null,
  min           int not null default 0 check (min >= 0),
  max           int not null default 1 check (max >= 1 and max >= min),
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.modifiers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  group_id      uuid not null references public.modifier_groups (id) on delete cascade,
  name          jsonb not null,
  price         bigint not null default 0,              -- units
  is_default    boolean not null default false,
  available     boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.menu_items (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  category_id        uuid not null references public.menu_categories (id) on delete restrict,
  name               jsonb not null,
  description        jsonb not null default '{"ar":"","en":""}',
  price              bigint not null check (price >= 0),  -- units
  cost               bigint,
  sku                text,
  station_id         uuid references public.kitchen_stations (id) on delete set null,
  modifier_group_ids uuid[] not null default '{}',
  tags               text[] not null default '{}',
  prep_minutes       int not null default 10,
  available          boolean not null default true,     -- false = 86'd today
  vat_exempt         boolean not null default false,
  image_url          text,
  sort               int not null default 0,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index menu_items_restaurant_idx on public.menu_items (restaurant_id, category_id);

-- ───────────────────────────── customers & reservations ─────────────────────────────
create table public.customers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  phone          text not null,
  name           text not null,
  email          text,
  visits         int not null default 0,
  last_visit_at  timestamptz,
  total_spent    bigint not null default 0,             -- units
  loyalty_points int not null default 0,
  tags           text[] not null default '{}',
  notes          text not null default '',
  birthday       date,
  addresses      jsonb not null default '[]',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, phone)
);

create table public.reservations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  customer_id   uuid references public.customers (id) on delete set null,
  name          text not null,
  phone         text not null,
  party         int not null check (party > 0),
  starts_at     timestamptz not null,
  duration_min  int not null default 90,
  table_ids     uuid[] not null default '{}',
  status        text not null default 'confirmed' check (status in ('pending','confirmed','seated','done','no_show','cancelled')),
  note          text not null default '',
  tags          text[] not null default '{}',
  source        text not null default 'phone' check (source in ('phone','walk_in','online','app')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index reservations_time_idx on public.reservations (restaurant_id, branch_id, starts_at);

-- ───────────────────────────── checks, orders, items, payments ─────────────────────────────
create table public.checks (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references public.restaurants (id) on delete cascade,
  branch_id            uuid not null references public.branches (id) on delete cascade,
  table_ids            uuid[] not null default '{}',     -- first = primary table
  status               text not null default 'open' check (status in ('open','bill_requested','paid','void')),
  guests               int not null default 1,
  reservation_id       uuid references public.reservations (id) on delete set null,
  customer_id          uuid references public.customers (id) on delete set null,
  discount             jsonb,                            -- {"kind":"percent","rate":1000} | {"kind":"amount","value":units}
  discount_approved_by uuid references public.memberships (id) on delete set null,
  -- cached totals, recomputed by the app with @finance/tax (units)
  subtotal             bigint not null default 0,
  discount_total       bigint not null default 0,
  service              bigint not null default 0,
  vat                  bigint not null default 0,
  total                bigint not null default 0,
  paid                 bigint not null default 0,
  receipt_no           text,
  eta_uuid             text,
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index checks_open_idx on public.checks (restaurant_id, branch_id, status);
create index checks_tables_idx on public.checks using gin (table_ids);

create table public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  branch_id       uuid not null references public.branches (id) on delete cascade,
  number          int not null,                         -- daily sequence per branch (next_order_number)
  mode            text not null check (mode in ('dine_in','takeaway','delivery')),
  source          text not null check (source in ('pos','waiter','qr','online','phone','aggregator')),
  status          text not null default 'open' check (status in ('open','sent','ready','served','closed','void')),
  table_ids       uuid[] not null default '{}',
  check_id        uuid references public.checks (id) on delete set null,
  customer_id     uuid references public.customers (id) on delete set null,
  guests          int not null default 1,
  opened_by       uuid references public.memberships (id) on delete set null,
  waiter_id       uuid references public.memberships (id) on delete set null,
  note            text not null default '',
  delivery        jsonb,                                -- {"address","area","notes","lat","lng"}
  delivery_status text check (delivery_status in ('pending','assigned','picked_up','delivered','failed')),
  driver_id       uuid references public.memberships (id) on delete set null,
  delivery_fee    bigint not null default 0,            -- units
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index orders_day_idx on public.orders (restaurant_id, branch_id, opened_at desc);
create index orders_status_idx on public.orders (restaurant_id, status);
create index orders_check_idx on public.orders (check_id);

create table public.order_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  order_id        uuid not null references public.orders (id) on delete cascade,
  item_id         uuid not null references public.menu_items (id) on delete restrict,
  name            jsonb not null,                       -- snapshot
  qty             numeric(10,3) not null check (qty > 0),
  unit_price      bigint not null,                      -- units, snapshot
  modifiers       jsonb not null default '[]',          -- [{groupId, modifierId, name, price}]
  notes           text not null default '',
  seat            int,
  course          int not null default 1,
  status          text not null default 'new' check (status in ('new','sent','preparing','ready','served','void')),
  station_id      uuid references public.kitchen_stations (id) on delete set null,
  origin_table_id uuid references public.dining_tables (id) on delete set null,
  discount        bigint not null default 0,
  fired_at        timestamptz,
  ready_at        timestamptz,
  served_at       timestamptz,
  void_reason     text,
  voided_by       uuid references public.memberships (id) on delete set null,
  created_by      uuid references public.memberships (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index order_items_order_idx on public.order_items (order_id);
create index order_items_kitchen_idx on public.order_items (restaurant_id, status) where status in ('sent','preparing','ready');

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  check_id      uuid not null references public.checks (id) on delete restrict,
  method        text not null check (method in ('cash','card','wallet','instapay','online')),
  amount        bigint not null,                        -- units
  tip           bigint not null default 0,
  tendered      bigint,
  change        bigint,
  reference     text,
  split_label   text,
  status        text not null default 'captured' check (status in ('captured','refunded','void')),
  taken_by      uuid references public.memberships (id) on delete set null,
  refund_of     uuid references public.payments (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index payments_check_idx on public.payments (check_id);
create index payments_day_idx on public.payments (restaurant_id, branch_id, created_at desc);

create table public.service_calls (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  table_id      uuid not null references public.dining_tables (id) on delete cascade,
  type          text not null check (type in ('napkins','water','coffee','tea','clean_table','bill','help','other')),
  text          text not null default '' check (length(text) <= 200),
  status        text not null default 'open' check (status in ('open','ack','done','cancelled')),
  source        text not null default 'qr' check (source in ('qr','waiter','pos')),
  ack_by        uuid references public.memberships (id) on delete set null,
  ack_at        timestamptz,
  done_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index service_calls_open_idx on public.service_calls (restaurant_id, status, created_at desc);

-- ───────────────────────────── settings & audit ─────────────────────────────
create table public.settings (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null unique references public.restaurants (id) on delete cascade,
  tax                   jsonb not null,                 -- mirrors @finance/tax TaxProfile + registration numbers
  invoice               jsonb not null,
  discount_approval_pct numeric not null default 10,
  auto_lock_minutes     int not null default 5,
  tips_enabled          boolean not null default true,
  qr_ordering           jsonb not null default '{"enabled":true,"requireWaiterConfirm":true,"allowServiceCalls":true}',
  locale                jsonb not null default '{"defaultLang":"ar","currency":"EGP","timezone":"Africa/Cairo"}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid references public.branches (id) on delete set null,
  actor_id      uuid references public.memberships (id) on delete set null,
  action        text not null,                          -- "order.void", "check.discount", "approval.refund" …
  entity        text not null,
  entity_id     text,
  data          jsonb not null default '{}',
  approved_by   uuid references public.memberships (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index audit_log_idx on public.audit_log (restaurant_id, created_at desc);

create table public.order_counters (
  branch_id uuid not null references public.branches (id) on delete cascade,
  day       date not null,
  last      int not null default 0,
  primary key (branch_id, day)
);

-- ───────────────────────────── updated_at triggers ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['restaurants','branches','memberships','staff_compensation','zones','dining_tables','floor_decor','table_links',
    'printers','kitchen_stations','menu_categories','modifier_groups','modifiers','menu_items','customers','reservations','checks','orders',
    'order_items','payments','service_calls','settings','audit_log'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

-- ───────────────────────────── column guards ─────────────────────────────
-- Roles outside TG_ARGV[0] may only change the columns in TG_ARGV[1]
-- (e.g. the kitchen can bump an item's status but not its price).
create or replace function public.guard_limited_update() returns trigger
language plpgsql as $$
declare
  full_roles public.app_role[] := TG_ARGV[0]::public.app_role[];
  allowed    text[] := TG_ARGV[1]::text[] || array['updated_at'];
begin
  if auth.uid() is null or public.has_role(new.restaurant_id, full_roles) then
    return new;  -- service role / SECURITY DEFINER functions / full-access roles
  end if;
  if (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'your role may only change: %', array_to_string(TG_ARGV[1]::text[], ', ') using errcode = '42501';
  end if;
  return new;
end $$;

create trigger order_items_kitchen_guard before update on public.order_items
  for each row execute function public.guard_limited_update('{owner,admin,manager,cashier,waiter}', '{status,fired_at,ready_at,served_at}');
create trigger menu_items_availability_guard before update on public.menu_items
  for each row execute function public.guard_limited_update('{owner,admin,manager,chef}', '{available}');
create trigger orders_limited_guard before update on public.orders
  for each row execute function public.guard_limited_update('{owner,admin,manager,cashier,waiter}', '{status,delivery_status,driver_id}');
create trigger tables_status_guard before update on public.dining_tables
  for each row execute function public.guard_limited_update('{owner,admin,manager}', '{status,status_since}');

-- Only an owner may create/remove/alter owners.
create or replace function public.guard_owner_rows() returns trigger
language plpgsql as $$
declare rid uuid := coalesce(new.restaurant_id, old.restaurant_id);
begin
  if auth.uid() is null or current_setting('sufra.bootstrap', true) = 'on' then return coalesce(new, old); end if;
  if ((tg_op <> 'INSERT' and old.role = 'owner') or (tg_op <> 'DELETE' and new.role = 'owner'))
     and not public.has_role(rid, '{owner}') then
    raise exception 'only an owner can manage owners' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger memberships_owner_guard before insert or update or delete on public.memberships
  for each row execute function public.guard_owner_rows();

-- ═══════════════════════════ Row Level Security ═══════════════════════════
alter table public.restaurants enable row level security;
alter table public.memberships enable row level security;
alter table public.order_counters enable row level security;  -- no policies: functions only

create policy restaurants_select on public.restaurants for select to authenticated using (public.is_member(id));
create policy restaurants_update on public.restaurants for update to authenticated
  using (public.has_role(id, '{owner,admin}')) with check (public.has_role(id, '{owner,admin}'));
-- inserts go through create_restaurant(); no deletes from clients

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_role(restaurant_id, '{owner,admin,manager,accountant}'));
create policy memberships_insert on public.memberships for insert to authenticated with check (public.has_role(restaurant_id, '{owner,admin}'));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin}')) with check (public.has_role(restaurant_id, '{owner,admin}'));
create policy memberships_delete on public.memberships for delete to authenticated using (public.has_role(restaurant_id, '{owner,admin}'));

-- Generic policies: (table, read roles or null = any member, insert roles, update roles, delete roles; null = nobody)
do $$
declare
  r record;
  branchy boolean;
begin
  for r in select * from (values
    ('branches',          null,                                                          '{owner,admin}',                              '{owner,admin}',                                                       '{owner,admin}'),
    ('staff_compensation','{owner,admin,accountant}',                                    '{owner,admin}',                              '{owner,admin}',                                                       '{owner,admin}'),
    ('zones',             null,                                                          '{owner,admin,manager}',                      '{owner,admin,manager}',                                               '{owner,admin,manager}'),
    ('dining_tables',     null,                                                          '{owner,admin,manager}',                      '{owner,admin,manager,cashier,waiter}',                                '{owner,admin,manager}'),
    ('floor_decor',       null,                                                          '{owner,admin,manager}',                      '{owner,admin,manager}',                                               '{owner,admin,manager}'),
    ('table_links',       null,                                                          '{owner,admin,manager,cashier,waiter}',       '{owner,admin,manager,cashier,waiter}',                                '{owner,admin,manager,cashier,waiter}'),
    ('printers',          null,                                                          '{owner,admin,manager}',                      '{owner,admin,manager}',                                               '{owner,admin,manager}'),
    ('kitchen_stations',  null,                                                          '{owner,admin,manager}',                      '{owner,admin,manager}',                                               '{owner,admin,manager}'),
    ('menu_categories',   null,                                                          '{owner,admin,manager,chef}',                 '{owner,admin,manager,chef}',                                          '{owner,admin,manager,chef}'),
    ('modifier_groups',   null,                                                          '{owner,admin,manager,chef}',                 '{owner,admin,manager,chef}',                                          '{owner,admin,manager,chef}'),
    ('modifiers',         null,                                                          '{owner,admin,manager,chef}',                 '{owner,admin,manager,chef,kitchen}',                                  '{owner,admin,manager,chef}'),
    ('menu_items',        null,                                                          '{owner,admin,manager,chef}',                 '{owner,admin,manager,chef,kitchen}',                                  '{owner,admin,manager,chef}'),
    ('customers',         '{owner,admin,manager,cashier,waiter,delivery,accountant}',    '{owner,admin,manager,cashier,waiter}',       '{owner,admin,manager,cashier,waiter}',                                '{owner,admin}'),
    ('reservations',      null,                                                          '{owner,admin,manager,cashier,waiter}',       '{owner,admin,manager,cashier,waiter}',                                '{owner,admin,manager}'),
    ('checks',            '{owner,admin,manager,cashier,waiter,delivery,accountant}',    '{owner,admin,manager,cashier,waiter}',       '{owner,admin,manager,cashier,waiter}',                                '{owner,admin}'),
    ('orders',            null,                                                          '{owner,admin,manager,cashier,waiter}',       '{owner,admin,manager,cashier,waiter,chef,kitchen,delivery}',          '{owner,admin,manager}'),
    ('order_items',       null,                                                          '{owner,admin,manager,cashier,waiter}',       '{owner,admin,manager,cashier,waiter,chef,kitchen}',                   '{owner,admin,manager}'),
    ('payments',          '{owner,admin,manager,cashier,accountant}',                    '{owner,admin,manager,cashier}',              '{owner,admin,manager}',                                               null),
    ('service_calls',     null,                                                          '{owner,admin,manager,cashier,waiter}',       '{owner,admin,manager,cashier,waiter}',                                '{owner,admin,manager}'),
    ('settings',          null,                                                          '{owner,admin}',                              '{owner,admin}',                                                       null),
    ('audit_log',         '{owner,admin,manager,accountant}',                            '{owner,admin,manager,cashier,waiter,chef,kitchen,delivery,accountant}', null,                                                  null)
  ) as t(tbl, rd, ins, upd, del)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    -- operational tables are additionally limited to the member's branches
    branchy := r.tbl in ('checks','orders','payments','service_calls','reservations');
    execute format('create policy %I on public.%I for select to authenticated using (%s and %s %s)',
      r.tbl || '_select', r.tbl,
      'public.is_member(restaurant_id)',
      case when r.rd is null then 'true' else format('public.has_role(restaurant_id, %L)', r.rd) end,
      case when branchy then 'and public.in_branch(restaurant_id, branch_id)' else '' end);
    if r.ins is not null then
      execute format('create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, %L) %s)',
        r.tbl || '_insert', r.tbl, r.ins, case when branchy then 'and public.in_branch(restaurant_id, branch_id)' else '' end);
    end if;
    if r.upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, %L)) with check (public.has_role(restaurant_id, %L))',
        r.tbl || '_update', r.tbl, r.upd, r.upd);
    end if;
    if r.del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (public.has_role(restaurant_id, %L))',
        r.tbl || '_delete', r.tbl, r.del);
    end if;
  end loop;
end $$;

-- Anonymous visitors get nothing directly; authenticated users go through RLS.
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from public, anon;

-- PIN hashes and lockout counters are never readable or writable by clients (only via the functions below).
revoke select, insert, update on public.memberships from authenticated;
grant select (id, restaurant_id, user_id, name, role, has_pin, branch_ids, phone, email, color, active, last_seen_at, created_at, updated_at) on public.memberships to authenticated;
grant insert (id, restaurant_id, user_id, name, role, branch_ids, phone, email, color, active, created_at, updated_at) on public.memberships to authenticated;
grant update (user_id, name, role, branch_ids, phone, email, color, active, last_seen_at, updated_at) on public.memberships to authenticated;

-- ═══════════════════════════ staff functions ═══════════════════════════

-- New restaurant + default branch + settings + the caller as owner.
create or replace function public.create_restaurant(p_slug text, p_name jsonb, p_owner_name text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare rid uuid; bid uuid;
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  insert into restaurants (slug, name, owner_user_id) values (p_slug, p_name, auth.uid()) returning id into rid;
  insert into branches (restaurant_id, name, slug, is_default) values (rid, p_name, 'main', true) returning id into bid;
  perform set_config('sufra.bootstrap', 'on', true);   -- lets the owner guard accept the very first owner
  insert into memberships (restaurant_id, user_id, name, role) values (rid, auth.uid(), p_owner_name, 'owner');
  perform set_config('sufra.bootstrap', 'off', true);
  insert into settings (restaurant_id, tax, invoice) values (rid,
    '{"vatRegistered":true,"vatRate":1400,"vatCode":{"type":"T1","subType":"V009"},"serviceRate":1200,"serviceModes":["dine_in"],"vatOnService":true,"serviceCode":{"type":"T9","subType":"SC01"},"priceMode":"exclusive","vatOnDelivery":true,"taxDecimals":2,"taxId":"","commercialRegister":"","activityCode":"5610"}',
    jsonb_build_object('header', p_name, 'footer', '{"ar":"شكرًا لزيارتكم","en":"Thank you"}'::jsonb, 'showLogo', true, 'showQr', true, 'showTaxBreakdown', true, 'showWaiter', true, 'language', 'both', 'paperWidth', 80));
  return rid;
end $$;

-- Staff picker for a shared device (no secrets).
create or replace function public.pin_roster(p_restaurant_id uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', m.id, 'restaurant_id', m.restaurant_id, 'user_id', m.user_id, 'name', m.name, 'role', m.role,
                            'branch_ids', m.branch_ids, 'phone', null, 'email', null, 'color', m.color, 'has_pin', m.has_pin,
                            'active', m.active, 'last_seen_at', m.last_seen_at, 'created_at', m.created_at, 'updated_at', m.updated_at)
  from memberships m
  where m.restaurant_id = p_restaurant_id and m.active and m.has_pin and public.is_member(p_restaurant_id)
  order by m.name;
$$;

-- Checks a PIN on a device signed in to the same restaurant. 5 misses → 30 s lockout.
create or replace function public.verify_staff_pin(p_restaurant_id uuid, p_membership_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare m memberships;
begin
  if not public.is_member(p_restaurant_id) then raise exception 'device not signed in to this restaurant' using errcode = '42501'; end if;
  select * into m from memberships where id = p_membership_id and restaurant_id = p_restaurant_id and active for update;
  if not found or m.pin_hash is null then return null; end if;
  if m.pin_locked_until is not null and m.pin_locked_until > now() then return null; end if;
  if m.pin_hash <> extensions.crypt(p_pin, m.pin_hash) then
    update memberships set pin_failed_count = pin_failed_count + 1,
      pin_locked_until = case when pin_failed_count + 1 >= 5 then now() + interval '30 seconds' else null end
    where id = m.id;
    return null;
  end if;
  update memberships set pin_failed_count = 0, pin_locked_until = null, last_seen_at = now() where id = m.id;
  return jsonb_build_object('id', m.id, 'restaurant_id', m.restaurant_id, 'user_id', m.user_id, 'name', m.name, 'role', m.role,
    'branch_ids', m.branch_ids, 'phone', m.phone, 'email', m.email, 'color', m.color, 'has_pin', true, 'active', m.active,
    'last_seen_at', now(), 'created_at', m.created_at, 'updated_at', m.updated_at);
end $$;

-- Sets a PIN: managers and above for anyone (owners only by owners), or a person for themselves.
create or replace function public.set_staff_pin(p_restaurant_id uuid, p_membership_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m memberships;
begin
  if p_pin !~ '^\d{4,6}$' then raise exception 'PIN must be 4–6 digits' using errcode = '22023'; end if;
  select * into m from memberships where id = p_membership_id and restaurant_id = p_restaurant_id;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if not (m.user_id = auth.uid()
          or (public.has_role(p_restaurant_id, '{owner,admin,manager}') and m.role <> 'owner')
          or public.has_role(p_restaurant_id, '{owner}')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update memberships set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), pin_failed_count = 0, pin_locked_until = null where id = m.id;
end $$;

-- Daily order number per branch (Cairo day).
create or replace function public.next_order_number(p_restaurant_id uuid, p_branch_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int; d date := (now() at time zone 'Africa/Cairo')::date;
begin
  if auth.uid() is not null and not public.is_member(p_restaurant_id) then raise exception 'not a member' using errcode = '42501'; end if;
  if not exists (select 1 from branches where id = p_branch_id and restaurant_id = p_restaurant_id) then raise exception 'bad branch'; end if;
  insert into order_counters (branch_id, day, last) values (p_branch_id, d, 1)
  on conflict (branch_id, day) do update set last = order_counters.last + 1
  returning last into n;
  return n;
end $$;

-- ═══════════════════════════ guest (anon) functions ═══════════════════════════
-- JSON keys are camelCase to match src/data/repo.ts GuestApi.

create or replace function public.guest_menu(p_slug text, p_table_code text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r restaurants; t dining_tables; b branches; s settings;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then return null; end if;
  if p_table_code is not null then
    select * into t from dining_tables where restaurant_id = r.id and code = upper(p_table_code) and active;
    if not found then return null; end if;
    select * into b from branches where id = t.branch_id;
  else
    select * into b from branches where restaurant_id = r.id order by is_default desc, created_at limit 1;
  end if;
  select * into s from settings where restaurant_id = r.id;
  return jsonb_build_object(
    'restaurant', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'currency', r.currency, 'brandColor', r.brand_color),
    'branch', case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.name) end,
    'table', case when t.id is null then null else jsonb_build_object('id', t.id, 'label', t.label, 'code', t.code) end,
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'sort', c.sort, 'icon', c.icon) order by c.sort)
                            from menu_categories c where c.restaurant_id = r.id and c.active), '[]'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'categoryId', i.category_id, 'name', i.name, 'description', i.description,
                              'price', i.price, 'tags', to_jsonb(i.tags), 'available', i.available, 'modifierGroupIds', to_jsonb(i.modifier_group_ids),
                              'imageUrl', i.image_url) order by i.sort)
                       from menu_items i where i.restaurant_id = r.id and i.active), '[]'),
    'modifierGroups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'min', g.min, 'max', g.max) order by g.sort)
                                from modifier_groups g where g.restaurant_id = r.id), '[]'),
    'modifiers', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'groupId', m.group_id, 'name', m.name, 'price', m.price, 'isDefault', m.is_default) order by m.sort)
                           from modifiers m where m.restaurant_id = r.id and m.available), '[]'),
    'qrOrdering', jsonb_build_object('enabled', coalesce((s.qr_ordering->>'enabled')::boolean, false),
                                     'allowServiceCalls', coalesce((s.qr_ordering->>'allowServiceCalls')::boolean, false)),
    'pricing', jsonb_build_object('priceMode', coalesce(s.tax->>'priceMode', 'exclusive'), 'serviceRate', coalesce((s.tax->>'serviceRate')::int, 0),
                                  'vatRate', coalesce((s.tax->>'vatRate')::int, 0), 'vatRegistered', coalesce((s.tax->>'vatRegistered')::boolean, false))
  );
end $$;

-- Guest order: prices come from the menu, never from the client. The order arrives as status "open"
-- (waiter confirms when settings.qr_ordering.requireWaiterConfirm). Check totals are recomputed by
-- the staff app with @finance/tax; here we only keep the subtotal current.
create or replace function public.guest_place_order(p_slug text, p_table_code text, p_mode text, p_lines jsonb, p_customer jsonb default null, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r restaurants; t dining_tables; b uuid; s settings; o_id uuid := gen_random_uuid(); c_id uuid; n int;
  l jsonb; it menu_items; mods jsonb; m modifiers; mid text; sub bigint := 0; q int; cnt int := 0;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  select * into s from settings where restaurant_id = r.id;
  if not coalesce((s.qr_ordering->>'enabled')::boolean, false) then raise exception 'ordering_disabled'; end if;
  if p_mode not in ('dine_in','takeaway','delivery') then raise exception 'bad_mode'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 or jsonb_array_length(p_lines) > 60 then raise exception 'empty_order'; end if;
  if p_table_code is not null then
    select * into t from dining_tables where restaurant_id = r.id and code = upper(p_table_code) and active;
    if not found then raise exception 'not_found'; end if;
    b := t.branch_id;
    select id into c_id from checks where restaurant_id = r.id and status in ('open','bill_requested') and t.id = any (table_ids) order by opened_at desc limit 1;
  else
    select id into b from branches where restaurant_id = r.id order by is_default desc, created_at limit 1;
  end if;
  if c_id is null then
    insert into checks (restaurant_id, branch_id, table_ids) values (r.id, b, case when t.id is null then '{}' else array[t.id] end) returning id into c_id;
  end if;
  n := public.next_order_number(r.id, b);
  insert into orders (id, restaurant_id, branch_id, number, mode, source, status, table_ids, check_id, note)
  values (o_id, r.id, b, n, p_mode, case when t.id is null then 'online' else 'qr' end, 'open',
          case when t.id is null then '{}' else array[t.id] end, c_id, left(coalesce(p_note, ''), 300));
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from menu_items where id = (l->>'itemId')::uuid and restaurant_id = r.id and active and available;
    if not found then raise exception 'item_unavailable'; end if;
    q := (l->>'qty')::int;
    if q is null or q < 1 or q > 50 then raise exception 'bad_qty'; end if;
    mods := '[]';
    for mid in select * from jsonb_array_elements_text(coalesce(l->'modifierIds', '[]')) loop
      select * into m from modifiers where id = mid::uuid and restaurant_id = r.id and available and group_id = any (it.modifier_group_ids);
      if not found then raise exception 'bad_modifier'; end if;
      mods := mods || jsonb_build_object('groupId', m.group_id, 'modifierId', m.id, 'name', m.name, 'price', m.price);
      sub := sub + m.price * q;
    end loop;
    insert into order_items (restaurant_id, order_id, item_id, name, qty, unit_price, modifiers, notes, station_id, origin_table_id)
    values (r.id, o_id, it.id, it.name, q, it.price, mods, left(coalesce(l->>'notes', ''), 200),
            coalesce(it.station_id, (select station_id from menu_categories where id = it.category_id)), t.id);
    sub := sub + it.price * q;
    cnt := cnt + 1;
  end loop;
  update checks set subtotal = subtotal + sub where id = c_id;
  if t.id is not null then update dining_tables set status = 'ordered', status_since = now() where id = t.id; end if;
  return jsonb_build_object('orderId', o_id, 'number', n);
end $$;

create or replace function public.guest_call_waiter(p_slug text, p_table_code text, p_type text, p_text text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r restaurants; t dining_tables; s settings; existing uuid; new_id uuid;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  select * into t from dining_tables where restaurant_id = r.id and code = upper(p_table_code) and active;
  if not found then raise exception 'not_found'; end if;
  select * into s from settings where restaurant_id = r.id;
  if not coalesce((s.qr_ordering->>'allowServiceCalls')::boolean, false) then raise exception 'calls_disabled'; end if;
  -- the same request from the same table within 2 minutes is one call
  if p_type <> 'other' then
    select id into existing from service_calls
    where table_id = t.id and type = p_type and status in ('open','ack') and created_at > now() - interval '2 minutes' limit 1;
    if existing is not null then return jsonb_build_object('id', existing); end if;
  end if;
  -- crude flood control: at most 10 calls per table per 10 minutes
  if (select count(*) from service_calls where table_id = t.id and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'too_many_calls';
  end if;
  insert into service_calls (restaurant_id, branch_id, table_id, type, text, source)
  values (r.id, t.branch_id, t.id, p_type, left(coalesce(p_text, ''), 200), 'qr') returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

create or replace function public.guest_order_status(p_slug text, p_order_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('orderId', o.id, 'number', o.number, 'status', o.status,
           'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'status', i.status) order by i.created_at)
                              from order_items i where i.order_id = o.id), '[]'))
  from orders o join restaurants r on r.id = o.restaurant_id
  where r.slug = p_slug and o.id = p_order_id;
$$;

grant execute on function public.guest_menu(text, text) to anon, authenticated;
grant execute on function public.guest_place_order(text, text, text, jsonb, jsonb, text) to anon, authenticated;
grant execute on function public.guest_call_waiter(text, text, text, text) to anon, authenticated;
grant execute on function public.guest_order_status(text, uuid) to anon, authenticated;
grant execute on function public.pin_roster(uuid), public.verify_staff_pin(uuid, uuid, text), public.set_staff_pin(uuid, uuid, text),
  public.next_order_number(uuid, uuid), public.create_restaurant(text, jsonb, text),
  public.is_member(uuid), public.has_role(uuid, public.app_role[]), public.my_role(uuid), public.in_branch(uuid, uuid) to authenticated;

-- ═══════════════════════════ Realtime ═══════════════════════════
-- Full row images so deletes still carry restaurant_id for the channel filter.
alter table public.orders replica identity full;
alter table public.order_items replica identity full;
alter table public.service_calls replica identity full;
alter table public.dining_tables replica identity full;
alter table public.checks replica identity full;
alter table public.payments replica identity full;
alter table public.reservations replica identity full;
alter table public.menu_items replica identity full;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table
  public.orders, public.order_items, public.service_calls, public.dining_tables, public.checks,
  public.payments, public.reservations, public.menu_items;
