-- ═══════════════════════════ 0012 — Inventory, recipes & purchasing (+ menu manager columns) ═══════════════════════════
-- Browser side: src/modules/inventory (costing, stock, deduct, purchasing, reports), src/modules/menu (menu manager).
-- Requires 0001 … 0009 (0011 accounting is independent: journals still land in ledger_entries).
--
--   tables   storage_locations · stock_items · stock_levels · stock_moves · recipes · stock_batches
--            suppliers · supplier_items · purchase_orders · goods_receipts · supplier_invoices · supplier_payments
--            stock_counts · stock_transfers
--   altered  menu_items (+channel_prices, branch_prices, schedule, allergens, calories, combo_of, hidden_on)
--            settings (+inventory)
--   RPC      inventory_on_hand(branch) — on hand + value per item for dashboards
--
-- Quantities are numeric(14,3) in the item's BASE unit (g, ml, pc). Money columns are bigint units (0.00001 EGP);
-- unit costs are per ONE base unit. Rates are basis points. JSON keys are camelCase like the TS shapes.
-- Stock is valued at moving weighted average (EAS 2 / IAS 2): stock_levels.value / stock_levels.qty.
--
-- Write model: stock_moves is APPEND-ONLY (no update/delete for anyone) and stock_levels holds the running position.
-- Sale deductions are written by the device that fires the order line (POS/waiter tablets), so POS roles may insert
-- moves and update levels. Hardening for production (not done yet): move the deduction into a SECURITY DEFINER
-- function called by an order_items trigger (status new → sent), so tablets never write stock directly.

-- ───────────────────────────── menu manager columns ─────────────────────────────
alter table public.menu_items
  add column if not exists channel_prices jsonb not null default '{}',   -- {dine_in,takeaway,delivery,qr,online,aggregator: units}
  add column if not exists branch_prices  jsonb not null default '{}',   -- {branchId: units}
  add column if not exists schedule       jsonb not null default '[]',   -- [{days:[0..6], from:"07:00", to:"12:00"}]
  add column if not exists allergens      text[] not null default '{}',
  add column if not exists calories       int check (calories is null or calories >= 0),
  add column if not exists combo_of       jsonb not null default '[]',   -- [{itemId, qty}]
  add column if not exists hidden_on      text[] not null default '{}';

alter table public.settings add column if not exists inventory jsonb;  -- {deductAt, varianceAlertBp, priceAlertBp, expiryWarnDays, …}

-- ───────────────────────────── locations & items ─────────────────────────────
create table if not exists public.storage_locations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          jsonb not null,
  kind          text not null default 'store' check (kind in ('store','kitchen','bar','fridge','freezer','central')),
  sort          int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists storage_locations_branch_idx on public.storage_locations (restaurant_id, branch_id);

create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  name           jsonb not null,
  contact_name   text not null default '',
  phone          text not null default '',
  whatsapp       text,
  email          text,
  tax_id         text not null default '',
  categories     text[] not null default '{}',
  area           jsonb not null default '{"ar":"","en":""}',
  terms_days     int not null default 0 check (terms_days >= 0),
  lead_days      int not null default 1 check (lead_days >= 0),
  days           int[] not null default '{0,1,2,3,4,5,6}',
  min_order      bigint not null default 0,
  delivery_fee   bigint not null default 0,
  marketplace_id text,                                   -- Sufra supplier marketplace id (s01 …)
  e_invoice      boolean not null default false,
  rating         numeric(3,2) not null default 0,
  active         boolean not null default true,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.stock_items (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants (id) on delete cascade,
  name                  jsonb not null,
  sku                   text not null default '',
  category              text not null default 'dry',
  kind                  text not null default 'raw' check (kind in ('raw','prep')),
  base_unit             text not null check (base_unit in ('g','ml','pc')),
  packs                 jsonb not null default '[]',       -- [{id, name, factor}] carton = 24 pc, sack = 25000 g
  count_unit            text not null default 'g',
  account               text not null default 'food' check (account in ('food','beverage','packaging')),
  levels                jsonb not null default '{"min":0,"par":0,"max":0}',
  branch_levels         jsonb not null default '{}',
  supplier_ids          uuid[] not null default '{}',
  preferred_supplier_id uuid references public.suppliers (id) on delete set null,
  last_cost             bigint not null default 0 check (last_cost >= 0),   -- per base unit
  default_location_ids  uuid[] not null default '{}',
  track_batches         boolean not null default false,
  shelf_life_days       int,
  vat_bp                int not null default 0,
  yield_bp              int not null default 10000 check (yield_bp > 0 and yield_bp <= 10000),
  allergens             text[] not null default '{}',
  active                boolean not null default true,
  note                  text not null default '',
  market_key            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists stock_items_restaurant_idx on public.stock_items (restaurant_id, category);

create table if not exists public.stock_levels (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  location_id    uuid not null references public.storage_locations (id) on delete cascade,
  item_id        uuid not null references public.stock_items (id) on delete cascade,
  qty            numeric(14,3) not null default 0,     -- may go negative (sold before the delivery was booked)
  value          bigint not null default 0,
  last_count_at  timestamptz,
  last_move_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, location_id, item_id)
);
create index if not exists stock_levels_branch_idx on public.stock_levels (restaurant_id, branch_id);

create table if not exists public.stock_batches (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  location_id    uuid not null references public.storage_locations (id) on delete cascade,
  item_id        uuid not null references public.stock_items (id) on delete cascade,
  lot            text not null,
  received_at    timestamptz not null default now(),
  expires_on     date,
  qty            numeric(14,3) not null check (qty >= 0),
  remaining      numeric(14,3) not null check (remaining >= 0),
  po_id          uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists stock_batches_expiry_idx on public.stock_batches (restaurant_id, expires_on);

create table if not exists public.stock_moves (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  location_id    uuid not null references public.storage_locations (id) on delete cascade,
  item_id        uuid not null references public.stock_items (id) on delete cascade,
  kind           text not null check (kind in ('opening','receive','sale','waste','staff_meal','transfer_out','transfer_in','production_in','production_out',
                                               'count_adjust','supplier_return','sale_reversal')),
  qty            numeric(14,3) not null,               -- signed: + in, − out
  value          bigint not null,                      -- signed
  unit_cost      bigint not null default 0,
  ref_type       text,                                 -- order_item · purchase_order · transfer · count · production · waste · daily_sales
  ref_id         text,
  group_id       uuid,
  reason         text check (reason is null or reason in ('expired','spoiled','burnt','dropped','overproduction','returned_by_guest','void_after_send','staff_meal','other')),
  note           text not null default '',
  photo          text,                                 -- waste photo (small data: URL or storage URL)
  batch_id       uuid references public.stock_batches (id) on delete set null,
  at             timestamptz not null default now(),
  by             uuid references public.memberships (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists stock_moves_item_idx on public.stock_moves (restaurant_id, item_id, at);
create index if not exists stock_moves_ref_idx on public.stock_moves (restaurant_id, ref_type, ref_id);
-- a sale line is deducted once (idempotent hook): one row per (line, item, kind)
create unique index if not exists stock_moves_sale_once on public.stock_moves (restaurant_id, ref_id, item_id) where ref_type = 'order_item' and kind = 'sale';

create table if not exists public.recipes (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  owner_type     text not null check (owner_type in ('menu_item','modifier','prep')),
  owner_id       uuid not null,
  scope_item_id  uuid references public.menu_items (id) on delete cascade,   -- modifier recipe for one menu item only
  lines          jsonb not null default '[]',            -- [{itemId, qty, lossBp?, note?}]
  yield_qty      numeric(14,3) not null default 1 check (yield_qty > 0),
  method         text not null default '',
  updated_by     uuid references public.memberships (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists recipes_owner_idx on public.recipes (restaurant_id, owner_type, owner_id, coalesce(scope_item_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ───────────────────────────── purchasing ─────────────────────────────
create table if not exists public.supplier_items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  supplier_id    uuid not null references public.suppliers (id) on delete cascade,
  item_id        uuid not null references public.stock_items (id) on delete cascade,
  pack_name      jsonb not null,
  pack_factor    numeric(14,3) not null check (pack_factor > 0),
  price          bigint not null check (price >= 0),        -- per pack, net
  vat_bp         int not null default 0,
  code           text,
  history        jsonb not null default '[]',               -- [{price, at}] → price-increase alerts
  preferred      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, supplier_id, item_id)
);

create table if not exists public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  location_id    uuid not null references public.storage_locations (id) on delete restrict,
  supplier_id    uuid not null references public.suppliers (id) on delete restrict,
  number         text not null,
  status         text not null default 'draft' check (status in ('draft','sent','partial','received','invoiced','paid','cancelled')),
  channel        text not null default 'direct' check (channel in ('direct','marketplace')),
  lines          jsonb not null default '[]',
  net            bigint not null default 0,
  vat            bigint not null default 0,
  total          bigint not null default 0,
  delivery_fee   bigint not null default 0,
  expected_at    timestamptz,
  sent_at        timestamptz,
  received_at    timestamptz,
  invoice_id     uuid,
  note           text not null default '',
  created_by     uuid references public.memberships (id) on delete set null,
  approved_by    uuid references public.memberships (id) on delete set null,
  sent_via       text check (sent_via is null or sent_via in ('whatsapp','phone','email','marketplace')),
  marketplace    jsonb,                                     -- {supplierRef, plan, commissionPct, commission, base, collectedBySufra}
  suggested      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, number)
);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (restaurant_id, supplier_id, status);

-- PO state machine (same rules as src/modules/inventory/purchasing.ts)
create or replace function public.purchase_order_transition() returns trigger
language plpgsql as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'draft'    and new.status in ('sent','cancelled')) or
    (old.status = 'sent'     and new.status in ('partial','received','cancelled')) or
    (old.status = 'partial'  and new.status in ('received')) or
    (old.status = 'received' and new.status in ('invoiced')) or
    (old.status = 'invoiced' and new.status in ('paid'))
  ) then
    raise exception 'purchase order cannot go from % to %', old.status, new.status using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists purchase_orders_transition on public.purchase_orders;
create trigger purchase_orders_transition before update of status on public.purchase_orders for each row execute function public.purchase_order_transition();

create table if not exists public.goods_receipts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  location_id    uuid not null references public.storage_locations (id) on delete restrict,
  po_id          uuid not null references public.purchase_orders (id) on delete cascade,
  supplier_id    uuid not null references public.suppliers (id) on delete restrict,
  lines          jsonb not null default '[]',
  value          bigint not null default 0,
  received_at    timestamptz not null default now(),
  received_by    uuid references public.memberships (id) on delete set null,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.supplier_invoices (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  branch_id        uuid not null references public.branches (id) on delete cascade,
  supplier_id      uuid not null references public.suppliers (id) on delete restrict,
  po_id            uuid references public.purchase_orders (id) on delete set null,
  number           text not null,
  date             date not null,
  due_date         date not null,
  lines            jsonb not null default '[]',            -- [{account: food|beverage|packaging|expense, net, vat}]
  net              bigint not null default 0,
  vat              bigint not null default 0,              -- input VAT (1401)
  total            bigint not null default 0,
  paid             bigint not null default 0 check (paid >= 0),
  status           text not null default 'open' check (status in ('open','partial','paid')),
  eta_uuid         text,
  ledger_entry_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (paid <= total)
);
create index if not exists supplier_invoices_supplier_idx on public.supplier_invoices (restaurant_id, supplier_id, status);

create table if not exists public.supplier_payments (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  supplier_id    uuid not null references public.suppliers (id) on delete restrict,
  invoice_id     uuid references public.supplier_invoices (id) on delete set null,
  amount         bigint not null check (amount > 0),
  method         text not null check (method in ('cash','bank','instapay','cheque')),
  reference      text not null default '',
  paid_at        timestamptz not null default now(),
  by             uuid references public.memberships (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ───────────────────────────── counts & transfers ─────────────────────────────
create table if not exists public.stock_counts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  branch_id       uuid not null references public.branches (id) on delete cascade,
  location_id     uuid references public.storage_locations (id) on delete set null,
  kind            text not null default 'full' check (kind in ('full','partial')),
  blind           boolean not null default true,
  status          text not null default 'open' check (status in ('open','submitted','approved','cancelled')),
  lines           jsonb not null default '[]',             -- [{itemId, locationId, expected, counted, unitCost}]
  started_by      uuid references public.memberships (id) on delete set null,
  started_at      timestamptz not null default now(),
  submitted_at    timestamptz,
  approved_by     uuid references public.memberships (id) on delete set null,
  approved_at     timestamptz,
  variance_value  bigint not null default 0,
  note            text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  from_branch_id    uuid not null references public.branches (id) on delete cascade,
  from_location_id  uuid not null references public.storage_locations (id) on delete restrict,
  to_branch_id      uuid not null references public.branches (id) on delete cascade,
  to_location_id    uuid not null references public.storage_locations (id) on delete restrict,
  status            text not null default 'requested' check (status in ('requested','sent','received','cancelled')),
  lines             jsonb not null default '[]',           -- [{itemId, qty, unitCost}]
  requested_by      uuid references public.memberships (id) on delete set null,
  sent_at           timestamptz,
  received_at       timestamptz,
  note              text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (from_location_id <> to_location_id)
);

-- ───────────────────────────── triggers + RLS ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['storage_locations','suppliers','stock_items','stock_levels','stock_batches','stock_moves','recipes','supplier_items','purchase_orders',
                           'goods_receipts','supplier_invoices','supplier_payments','stock_counts','stock_transfers'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- (table, read roles, insert roles, update roles, delete roles) — POS roles write sale deductions (stock_moves + stock_levels)
do $$
declare r record;
begin
  for r in select * from (values
    ('storage_locations', '{owner,admin,manager,chef,kitchen,accountant,cashier,waiter}', '{owner,admin,manager}',                     '{owner,admin,manager}',                     '{owner,admin}'),
    ('suppliers',         '{owner,admin,manager,chef,accountant}',                        '{owner,admin,manager,chef,accountant}',     '{owner,admin,manager,chef,accountant}',     '{owner,admin}'),
    ('stock_items',       '{owner,admin,manager,chef,kitchen,accountant,cashier,waiter}', '{owner,admin,manager,chef}',                '{owner,admin,manager,chef,accountant}',     '{owner,admin}'),
    ('stock_levels',      '{owner,admin,manager,chef,kitchen,accountant,cashier,waiter}', '{owner,admin,manager,chef,kitchen,cashier,waiter}', '{owner,admin,manager,chef,kitchen,cashier,waiter}', null),
    ('stock_moves',       '{owner,admin,manager,chef,kitchen,accountant}',                '{owner,admin,manager,chef,kitchen,cashier,waiter}', null,                                null),
    ('stock_batches',     '{owner,admin,manager,chef,kitchen,accountant}',                '{owner,admin,manager,chef}',                '{owner,admin,manager,chef}',                '{owner,admin}'),
    ('recipes',           '{owner,admin,manager,chef,kitchen,accountant,cashier,waiter}', '{owner,admin,manager,chef}',                '{owner,admin,manager,chef}',                '{owner,admin,manager,chef}'),
    ('supplier_items',    '{owner,admin,manager,chef,accountant}',                        '{owner,admin,manager,chef}',                '{owner,admin,manager,chef}',                '{owner,admin,manager}'),
    ('purchase_orders',   '{owner,admin,manager,chef,accountant}',                        '{owner,admin,manager,chef}',                '{owner,admin,manager,chef,accountant}',     '{owner,admin}'),
    ('goods_receipts',    '{owner,admin,manager,chef,kitchen,accountant}',                '{owner,admin,manager,chef,kitchen}',        null,                                        null),
    ('supplier_invoices', '{owner,admin,manager,accountant}',                             '{owner,admin,manager,accountant}',          '{owner,admin,manager,accountant}',          null),
    ('supplier_payments', '{owner,admin,manager,accountant}',                             '{owner,admin,accountant}',                  null,                                        null),
    ('stock_counts',      '{owner,admin,manager,chef,kitchen,accountant}',                '{owner,admin,manager,chef,kitchen}',        '{owner,admin,manager,chef,kitchen}',        '{owner,admin}'),
    ('stock_transfers',   '{owner,admin,manager,chef,kitchen,accountant}',                '{owner,admin,manager,chef}',                '{owner,admin,manager,chef,kitchen}',        '{owner,admin}')
  ) as t(tbl, rd, ins, upd, del)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_role(restaurant_id, %L))', r.tbl || '_select', r.tbl, r.rd);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, %L))', r.tbl || '_insert', r.tbl, r.ins);
    if r.upd is not null then
      execute format('create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, %L)) with check (public.has_role(restaurant_id, %L))', r.tbl || '_update', r.tbl, r.upd, r.upd);
    end if;
    if r.del is not null then
      execute format('create policy %I on public.%I for delete to authenticated using (public.has_role(restaurant_id, %L))', r.tbl || '_delete', r.tbl, r.del);
    end if;
  end loop;
end $$;

-- stock_moves is append-only; an approved count / received GRN is history
revoke update, delete on public.stock_moves from authenticated;
revoke update, delete on public.goods_receipts from authenticated;
-- a submitted count's expected figures are frozen: only status / counted lines / approval fields change, never back to open
create or replace function public.stock_count_guard() returns trigger
language plpgsql as $$
begin
  if old.status in ('approved','cancelled') then
    raise exception 'count % is closed', old.id using errcode = '23514';
  end if;
  if old.status = 'submitted' and new.status = 'open' then
    raise exception 'a submitted count cannot be reopened' using errcode = '23514';
  end if;
  if new.status = 'approved' and not public.has_role(new.restaurant_id, '{owner,admin,manager,chef}') then
    raise exception 'only a manager or the chef approves a count' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists stock_counts_guard on public.stock_counts;
create trigger stock_counts_guard before update on public.stock_counts for each row execute function public.stock_count_guard();

-- ───────────────────────────── read helper ─────────────────────────────
create or replace function public.inventory_on_hand(p_branch uuid)
returns table (item_id uuid, qty numeric, value bigint)
language sql stable security invoker set search_path = public as $$
  select l.item_id, sum(l.qty), sum(l.value)::bigint
  from stock_levels l
  where l.branch_id = p_branch
  group by l.item_id;
$$;
grant execute on function public.inventory_on_hand(uuid) to authenticated;

-- ───────────────────────────── realtime ─────────────────────────────
alter table public.stock_levels replica identity full;
alter table public.stock_moves replica identity full;
alter table public.purchase_orders replica identity full;
alter table public.stock_counts replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table public.stock_levels, public.stock_moves, public.purchase_orders, public.stock_counts;
