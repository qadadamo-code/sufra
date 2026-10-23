-- ═══════════════════════════ 0005 — guest experience ═══════════════════════════
-- QR table ordering, call-the-waiter status, pay at table (split / tip / online), online ordering
-- (delivery / takeaway / pickup at a time), order tracking, feedback and loyalty capture.
-- Browser side: src/modules/guest (GuestService in api/service.ts calls these RPCs in cloud mode).
--
-- Requires 0001_init (base), 0002_pos (orders.pickup_at) and 0004_kitchen_waiter (call types waiter/item/complaint).
--
--   tables     delivery_zones · payment_accounts · payment_intents · guest_feedback
--   anon RPCs  guest_venue · guest_place_order_v2 · guest_order_track · guest_table_bill · guest_call_status
--              guest_feedback_submit · guest_join_loyalty · guest_payment_status
--   server     guest_record_payment (service_role only — called by the verified payment webhook)
--
-- JSON keys are camelCase to match the TypeScript shapes. Anonymous callers never touch tables directly.

alter table public.orders add column if not exists pickup_at timestamptz;  -- (0002 adds it too; harmless twice)

-- ───────────────────────────── delivery zones ─────────────────────────────
create table if not exists public.delivery_zones (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid references public.branches (id) on delete cascade,     -- branch that serves it (null = default)
  slug          text not null,
  name          jsonb not null,                                            -- {"ar","en"}
  fee           bigint not null default 0 check (fee >= 0),                -- units
  min_order     bigint not null default 0 check (min_order >= 0),          -- units
  eta_min       int not null default 30,
  eta_max       int not null default 45,
  polygon       jsonb,                                                     -- GeoJSON polygon (map editor, Wave 2)
  sort          int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, slug)
);
alter table public.delivery_zones enable row level security;
create policy delivery_zones_select on public.delivery_zones for select to authenticated using (public.is_member(restaurant_id));
create policy delivery_zones_write on public.delivery_zones for all to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager}')) with check (public.has_role(restaurant_id, '{owner,admin,manager}'));
create trigger delivery_zones_updated before update on public.delivery_zones for each row execute function public.set_updated_at();

-- ───────────────────────────── payments (gateway side) ─────────────────────────────
-- Per-tenant merchant account. Secrets live in Supabase Vault; this row only references them.
create table if not exists public.payment_accounts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  provider        text not null check (provider in ('paymob','kashier')),
  mode            text not null default 'test' check (mode in ('test','live')),
  public_config   jsonb not null default '{}',     -- e.g. {"publicKey": "...", "merchantId": "MID-..."} — never secrets
  vault_secret_id uuid,                            -- vault.secrets id holding secret key / HMAC / API key
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, provider)
);
alter table public.payment_accounts enable row level security;
create policy payment_accounts_select on public.payment_accounts for select to authenticated using (public.has_role(restaurant_id, '{owner,admin}'));
create policy payment_accounts_write on public.payment_accounts for all to authenticated
  using (public.has_role(restaurant_id, '{owner}')) with check (public.has_role(restaurant_id, '{owner}'));

-- One guest payment attempt. Written only by the payment server function (service role).
create table if not exists public.payment_intents (
  id             text primary key,                                          -- "pi_…", our id (provider special_reference / orderId)
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  check_id       uuid not null references public.checks (id) on delete restrict,
  order_id       uuid references public.orders (id) on delete set null,
  provider       text not null check (provider in ('demo','paymob','kashier')),
  status         text not null default 'requires_action' check (status in ('requires_action','processing','succeeded','failed','cancelled','expired')),
  amount         bigint not null check (amount > 0),                       -- units, bill share
  tip            bigint not null default 0 check (tip >= 0),
  currency       text not null default 'EGP',
  split_label    text,
  redirect_url   text,
  provider_ref   text,                                                      -- provider transaction id
  failure_reason text,
  request        jsonb not null default '{}',
  payment_id     uuid references public.payments (id) on delete set null,  -- set once recorded
  expires_at     timestamptz not null default now() + interval '15 minutes',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists payment_intents_check_idx on public.payment_intents (check_id);
create unique index if not exists payment_intents_provider_ref_idx on public.payment_intents (provider, provider_ref) where provider_ref is not null;
alter table public.payment_intents enable row level security;
create policy payment_intents_select on public.payment_intents for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier,accountant}'));
create trigger payment_intents_updated before update on public.payment_intents for each row execute function public.set_updated_at();

-- ───────────────────────────── feedback ─────────────────────────────
create table if not exists public.guest_feedback (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid references public.branches (id) on delete set null,
  check_id      uuid references public.checks (id) on delete set null,
  order_id      uuid references public.orders (id) on delete set null,
  table_id      uuid references public.dining_tables (id) on delete set null,
  stars         int not null check (stars between 1 and 5),
  tags          text[] not null default '{}',
  comment       text not null default '' check (length(comment) <= 500),
  created_at    timestamptz not null default now()
);
create index if not exists guest_feedback_day_idx on public.guest_feedback (restaurant_id, created_at desc);
alter table public.guest_feedback enable row level security;
create policy guest_feedback_select on public.guest_feedback for select to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager}'));

-- ═══════════════════════════ helpers ═══════════════════════════

-- Simple server-side pricing so guests see real totals before the staff app recomputes with @finance/tax
-- (exclusive prices, service on configured modes, VAT on net + service (+ delivery), rounded to piastres = 1000 units).
-- The staff app's recomputeCheck() remains authoritative (line VAT exemptions, discounts).
create or replace function public.guest_reprice_check(p_check_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c checks; s settings; sub bigint; fee bigint; m text; v_svc bigint := 0; v_vat bigint := 0; base bigint;
begin
  select * into c from checks where id = p_check_id;
  if not found or c.discount is not null then return; end if;   -- discounted checks: leave it to the staff app
  select * into s from settings where restaurant_id = c.restaurant_id;
  select coalesce(sum((i.unit_price + coalesce((select sum((x->>'price')::bigint) from jsonb_array_elements(i.modifiers) x), 0)) * i.qty - i.discount), 0)::bigint
    into sub from order_items i join orders o on o.id = i.order_id where o.check_id = c.id and i.status <> 'void';
  select coalesce(max(o.delivery_fee), 0), coalesce(min(o.mode), 'dine_in') into fee, m from orders o where o.check_id = c.id;
  if coalesce(s.tax->>'priceMode', 'exclusive') = 'exclusive' then
    if s.tax->'serviceModes' ? m then v_svc := round(sub * coalesce((s.tax->>'serviceRate')::int, 0) / 10000.0 / 1000) * 1000; end if;
    if coalesce((s.tax->>'vatRegistered')::boolean, false) then
      base := sub + case when coalesce((s.tax->>'vatOnService')::boolean, true) then v_svc else 0 end
                  + case when coalesce((s.tax->>'vatOnDelivery')::boolean, true) then fee else 0 end;
      v_vat := round(base * coalesce((s.tax->>'vatRate')::int, 0) / 10000.0 / 1000) * 1000;
    end if;
  end if;
  update checks set subtotal = sub, service = v_svc, vat = v_vat, total = sub - discount_total + v_svc + v_vat + fee where id = c.id;
end $$;

create or replace function public.guest_normalize_phone(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^01[0125][0-9]{8}$' then d
    when d ~ '^201[0125][0-9]{8}$' then '0' || substr(d, 3)
    when d ~ '^00201[0125][0-9]{8}$' then '0' || substr(d, 5)
    else null end
  from (select translate(regexp_replace(coalesce(p, ''), '[^0-9٠-٩]', '', 'g'), '٠١٢٣٤٥٦٧٨٩', '0123456789') as d) x
$$;

-- ═══════════════════════════ anon RPCs ═══════════════════════════

create or replace function public.guest_venue(p_slug text, p_table_code text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r restaurants; t dining_tables; b branches; s settings;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then return null; end if;
  if p_table_code is not null then
    select * into t from dining_tables where restaurant_id = r.id and code = upper(p_table_code) and active;
    if found then select * into b from branches where id = t.branch_id; end if;
  end if;
  if b.id is null then select * into b from branches where restaurant_id = r.id order by is_default desc, created_at limit 1; end if;
  select * into s from settings where restaurant_id = r.id;
  return jsonb_build_object(
    'restaurantId', r.id, 'slug', r.slug, 'name', r.name, 'currency', r.currency, 'brandColor', r.brand_color, 'phone', r.phone, 'timezone', r.timezone,
    'branch', case when b.id is null then null else jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone, 'hours', b.opening_hours) end,
    -- registration numbers are not needed by guests
    'tax', (s.tax - 'taxId' - 'commercialRegister') || jsonb_build_object('taxId', '', 'commercialRegister', ''),
    'qr', jsonb_build_object('enabled', coalesce((s.qr_ordering->>'enabled')::boolean, false),
                             'requireWaiterConfirm', coalesce((s.qr_ordering->>'requireWaiterConfirm')::boolean, true),
                             'allowServiceCalls', coalesce((s.qr_ordering->>'allowServiceCalls')::boolean, false)),
    'tipsEnabled', coalesce(s.tips_enabled, false),
    'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.slug, 'name', z.name, 'fee', z.fee, 'minOrder', z.min_order, 'etaMin', z.eta_min, 'etaMax', z.eta_max) order by z.sort)
                       from delivery_zones z where z.restaurant_id = r.id and z.active), '[]')
  );
end $$;

-- Online / QR order with customer, delivery zone, pickup time and payment preference.
-- Reuses guest_place_order (server-side pricing from the menu), then fills the rest.
create or replace function public.guest_place_order_v2(
  p_slug text, p_table_code text, p_mode text, p_lines jsonb, p_customer jsonb default null, p_note text default '',
  p_delivery jsonb default null, p_pickup_at timestamptz default null, p_payment text default 'cash')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r restaurants; s settings; z delivery_zones; res jsonb; o orders; v_phone text; cname text; cust uuid; pay text; auto_fire boolean;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  select * into s from settings where restaurant_id = r.id;
  if p_payment not in ('cash','card','online') then raise exception 'bad_payment'; end if;
  if p_customer is not null then
    v_phone := public.guest_normalize_phone(p_customer->>'phone');
    cname := left(trim(coalesce(p_customer->>'name', '')), 80);
    if v_phone is null or cname = '' then raise exception 'bad_customer'; end if;
  end if;
  if p_table_code is null and v_phone is null then raise exception 'bad_customer'; end if;
  if p_mode = 'delivery' then
    select * into z from delivery_zones where restaurant_id = r.id and slug = p_delivery->>'zoneId' and active;
    if not found or coalesce(trim(p_delivery->>'address'), '') = '' then raise exception 'bad_address'; end if;
  end if;
  if p_pickup_at is not null and (p_pickup_at < now() or p_pickup_at > now() + interval '2 days') then raise exception 'bad_pickup_time'; end if;

  pay := case p_payment when 'online' then '💳 مدفوع أونلاين / paid online' when 'card' then '💳 كارت عند الاستلام / card on delivery' else '💵 كاش عند الاستلام / cash on delivery' end;
  res := public.guest_place_order(p_slug, p_table_code, p_mode, p_lines, null,
           left(concat_ws(' · ', case when p_table_code is null then pay end, nullif(trim(coalesce(p_note, '')), '')), 300));
  select * into o from orders where id = (res->>'orderId')::uuid;

  if v_phone is not null then
    insert into customers (restaurant_id, phone, name, tags, addresses)
    values (r.id, v_phone, cname, '{online}', case when p_mode = 'delivery' then jsonb_build_array(jsonb_build_object('address', left(p_delivery->>'address', 200), 'area', z.name->>'ar', 'notes', left(coalesce(p_delivery->>'notes', ''), 200), 'lat', null, 'lng', null)) else '[]' end)
    on conflict (restaurant_id, phone) do update set name = coalesce(nullif(customers.name, ''), excluded.name)
    returning id into cust;
    update checks set customer_id = cust where id = o.check_id;
  end if;

  auto_fire := p_table_code is null or not coalesce((s.qr_ordering->>'requireWaiterConfirm')::boolean, true);
  if auto_fire then
    update order_items set status = 'sent', fired_at = now() where order_id = o.id and status = 'new';
  end if;
  update orders set
    customer_id = coalesce(cust, customer_id),
    pickup_at = p_pickup_at,
    status = case when auto_fire then 'sent' else status end,
    delivery = case when p_mode = 'delivery' then jsonb_build_object('address', left(p_delivery->>'address', 200), 'area', z.name->>'ar', 'notes', left(coalesce(p_delivery->>'notes', ''), 200), 'lat', null, 'lng', null) else delivery end,
    delivery_status = case when p_mode = 'delivery' then 'pending' else delivery_status end,
    delivery_fee = case when p_mode = 'delivery' then z.fee else delivery_fee end
  where id = o.id;
  perform public.guest_reprice_check(o.check_id);
  return res;
end $$;

-- Live status for the tracking page. The order id is an unguessable uuid (the tracking link).
create or replace function public.guest_order_track(p_slug text, p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; c checks; cu customers; d memberships; t dining_tables; live int; stage text;
  n_new int; n_sent int; n_prep int; n_ready int; n_served int;
begin
  select o2.* into o from orders o2 join restaurants r on r.id = o2.restaurant_id where r.slug = p_slug and o2.id = p_order_id;
  if not found then return null; end if;
  select * into c from checks where id = o.check_id;
  select * into cu from customers where id = o.customer_id;
  select * into d from memberships where id = o.driver_id;
  select * into t from dining_tables where id = o.table_ids[1];
  select count(*) filter (where status <> 'void'), count(*) filter (where status = 'new'), count(*) filter (where status = 'sent'),
         count(*) filter (where status = 'preparing'), count(*) filter (where status = 'ready'), count(*) filter (where status = 'served')
    into live, n_new, n_sent, n_prep, n_ready, n_served from order_items where order_id = o.id;
  -- mirrors src/modules/guest/stages.ts
  stage := case
    when o.status = 'void' or live = 0 and exists (select 1 from order_items where order_id = o.id) then 'cancelled'
    when live = 0 then 'received'
    when o.mode = 'delivery' and (o.delivery_status = 'delivered' or o.status = 'closed') then 'delivered'
    when o.mode = 'delivery' and o.delivery_status = 'picked_up' then 'out_for_delivery'
    when o.mode = 'takeaway' and o.source <> 'qr' and (o.status in ('closed','served') or n_served = live) then 'picked_up'
    when (o.source = 'qr' or o.mode = 'dine_in') and n_served = live then 'served'
    when n_ready + n_served = live then 'ready'
    when n_prep + n_ready + n_served > 0 then 'preparing'
    when n_sent > 0 then case when o.source = 'qr' or o.mode = 'dine_in' then 'preparing' else 'accepted' end
    else 'received' end;
  return jsonb_build_object(
    'orderId', o.id, 'number', o.number, 'mode', o.mode, 'qr', o.source = 'qr', 'stage', stage, 'status', o.status,
    'createdAt', o.opened_at, 'pickupAt', o.pickup_at, 'note', o.note, 'checkId', o.check_id,
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'qty', i.qty, 'status', i.status,
                         'unit', i.unit_price + coalesce((select sum((x->>'price')::bigint) from jsonb_array_elements(i.modifiers) x), 0),
                         'modifiers', coalesce((select jsonb_agg(x->'name') from jsonb_array_elements(i.modifiers) x), '[]')) order by i.created_at)
                       from order_items i where i.order_id = o.id), '[]'),
    'totals', jsonb_build_object('subtotal', coalesce(c.subtotal, 0), 'service', coalesce(c.service, 0), 'vat', coalesce(c.vat, 0),
                                 'deliveryFee', o.delivery_fee, 'total', coalesce(c.total, 0), 'paid', coalesce(c.paid, 0)),
    'customer', case when cu.id is null then null else jsonb_build_object('name', cu.name, 'phone', cu.phone) end,
    'delivery', o.delivery,
    'driver', case when d.id is null then null else jsonb_build_object('name', split_part(d.name, ' ', 1), 'phone', d.phone) end,
    'table', t.label
  );
end $$;

-- The running bill of a table (anyone holding the table's QR can see it — same as the printed bill on the table).
create or replace function public.guest_table_bill(p_slug text, p_table_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r restaurants; t dining_tables; c checks;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then return null; end if;
  select * into t from dining_tables where restaurant_id = r.id and code = upper(p_table_code) and active;
  if not found then return null; end if;
  select * into c from checks where restaurant_id = r.id and status in ('open','bill_requested') and t.id = any (table_ids) order by opened_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'checkId', c.id, 'status', c.status,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
                'id', i.id, 'orderId', i.order_id, 'name', i.name, 'qty', i.qty, 'notes', i.notes, 'status', i.status,
                'unit', u.unit, 'gross', u.unit * i.qty - i.discount,
                'modifiers', coalesce((select jsonb_agg(x->'name') from jsonb_array_elements(i.modifiers) x), '[]')) order by i.created_at)
              from order_items i join orders o on o.id = i.order_id
              cross join lateral (select i.unit_price + coalesce((select sum((x->>'price')::bigint) from jsonb_array_elements(i.modifiers) x), 0) as unit) u
              where o.check_id = c.id and i.status <> 'void'), '[]'),
    'totals', jsonb_build_object('subtotal', c.subtotal, 'discountTotal', c.discount_total, 'service', c.service, 'vat', c.vat, 'total', c.total, 'paid', c.paid),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'method', p.method, 'amount', p.amount, 'tip', p.tip, 'splitLabel', p.split_label, 'at', p.created_at) order by p.created_at)
                          from payments p where p.check_id = c.id and p.status = 'captured'), '[]'),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'at', o.opened_at,
                          'stage', (public.guest_order_track(p_slug, o.id))->>'stage',
                          'items', (select coalesce(sum(qty), 0) from order_items where order_id = o.id and status <> 'void')) order by o.opened_at)
                        from orders o where o.check_id = c.id), '[]')
  );
end $$;

-- Status of the calls this phone sent (only calls of that table).
create or replace function public.guest_call_status(p_slug text, p_table_code text, p_ids uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', sc.id, 'type', sc.type, 'status', sc.status, 'createdAt', sc.created_at, 'ackAt', sc.ack_at, 'doneAt', sc.done_at)), '[]')
  from service_calls sc
  join dining_tables t on t.id = sc.table_id
  join restaurants r on r.id = t.restaurant_id
  where r.slug = p_slug and t.code = upper(p_table_code) and sc.id = any (p_ids[1:20]);
$$;

create or replace function public.guest_feedback_submit(p_slug text, p_check_id uuid, p_order_id uuid, p_stars int, p_comment text default '', p_tags text[] default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare r restaurants; c checks; o orders;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  if p_check_id is not null then select * into c from checks where id = p_check_id and restaurant_id = r.id; end if;
  if p_order_id is not null then select * into o from orders where id = p_order_id and restaurant_id = r.id; end if;
  if c.id is null and o.id is null then raise exception 'not_found'; end if;
  -- one rating per check/order
  if exists (select 1 from guest_feedback where (check_id = c.id and c.id is not null) or (order_id = o.id and o.id is not null)) then return; end if;
  insert into guest_feedback (restaurant_id, branch_id, check_id, order_id, table_id, stars, tags, comment)
  values (r.id, coalesce(c.branch_id, o.branch_id), coalesce(c.id, o.check_id), o.id, coalesce(c.table_ids[1], o.table_ids[1]),
          greatest(1, least(5, p_stars)), coalesce(p_tags[1:6], '{}'), left(coalesce(p_comment, ''), 500));
end $$;

create or replace function public.guest_join_loyalty(p_slug text, p_name text, p_phone text, p_check_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r restaurants; v_phone text; cu customers; c checks; pts int;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  v_phone := public.guest_normalize_phone(p_phone);
  if v_phone is null then raise exception 'bad_phone'; end if;
  insert into customers (restaurant_id, phone, name, tags) values (r.id, v_phone, coalesce(nullif(left(trim(p_name), 80), ''), v_phone), '{loyalty}')
  on conflict (restaurant_id, phone) do update set tags = (select array_agg(distinct x) from unnest(customers.tags || '{loyalty}'::text[]) x)
  returning * into cu;
  pts := cu.loyalty_points;
  if p_check_id is not null then
    select * into c from checks where id = p_check_id and restaurant_id = r.id and customer_id is null;
    if found then
      update checks set customer_id = cu.id where id = c.id;
      pts := pts + (c.total / 1000000)::int;   -- 1 point per 10 EGP (CRM module owns the real rules)
      update customers set loyalty_points = pts where id = cu.id;
    end if;
  end if;
  return jsonb_build_object('points', pts);
end $$;

create or replace function public.guest_payment_status(p_intent_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pi.id, 'provider', pi.provider, 'status', pi.status, 'charge', pi.amount + pi.tip, 'amount', pi.amount, 'tip', pi.tip,
                            'currency', pi.currency, 'redirectUrl', case when pi.status = 'requires_action' then pi.redirect_url end,
                            'reference', pi.provider_ref, 'failureReason', pi.failure_reason, 'createdAt', pi.created_at, 'expiresAt', pi.expires_at,
                            'request', pi.request)
  from payment_intents pi where pi.id = p_intent_id;
$$;

-- ═══════════════════════════ server only ═══════════════════════════
-- Called by /api/pay/:provider/webhook AFTER verifying the provider signature. Idempotent.
create or replace function public.guest_record_payment(p_intent_id text, p_status text, p_provider_ref text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pi payment_intents; pay_id uuid; t dining_tables;
begin
  select * into pi from payment_intents where id = p_intent_id for update;
  if not found then raise exception 'not_found'; end if;
  if pi.status in ('succeeded','failed','cancelled','expired') then return jsonb_build_object('status', pi.status, 'paymentId', pi.payment_id); end if;
  if p_status not in ('processing','succeeded','failed','cancelled','expired') then raise exception 'bad_status'; end if;
  if p_status = 'succeeded' then
    insert into payments (restaurant_id, branch_id, check_id, method, amount, tip, reference, split_label, status)
    values (pi.restaurant_id, pi.branch_id, pi.check_id, 'online', pi.amount, pi.tip, coalesce(p_provider_ref, pi.id), pi.split_label, 'captured')
    returning id into pay_id;
    update checks set paid = paid + pi.amount where id = pi.check_id;
    -- tell the waiter (close the table / print the receipt)
    select dt.* into t from dining_tables dt join checks c on dt.id = c.table_ids[1] where c.id = pi.check_id;
    if t.id is not null then
      insert into service_calls (restaurant_id, branch_id, table_id, type, text, source)
      values (pi.restaurant_id, t.branch_id, t.id, 'bill', left(format('✓ دفع أونلاين %s · %s', round(pi.amount / 100000.0, 2), coalesce(pi.split_label, '')), 200), 'qr');
    end if;
  end if;
  update payment_intents set status = p_status, provider_ref = coalesce(p_provider_ref, provider_ref), failure_reason = p_failure, payment_id = coalesce(pay_id, payment_id)
  where id = pi.id;
  return jsonb_build_object('status', p_status, 'paymentId', pay_id);
end $$;

-- ═══════════════════════════ grants ═══════════════════════════
revoke all on public.delivery_zones, public.payment_accounts, public.payment_intents, public.guest_feedback from anon;
revoke execute on function public.guest_reprice_check(uuid), public.guest_record_payment(text, text, text, text) from public, anon, authenticated;
grant execute on function public.guest_record_payment(text, text, text, text) to service_role;
grant execute on function
  public.guest_venue(text, text),
  public.guest_place_order_v2(text, text, text, jsonb, jsonb, text, jsonb, timestamptz, text),
  public.guest_order_track(text, uuid),
  public.guest_table_bill(text, text),
  public.guest_call_status(text, text, uuid[]),
  public.guest_feedback_submit(text, uuid, uuid, int, text, text[]),
  public.guest_join_loyalty(text, text, text, uuid),
  public.guest_payment_status(text),
  public.guest_normalize_phone(text)
to anon, authenticated;

-- staff screens see new payments/intents live
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payment_intents;
  end if;
end $$;
alter table public.payment_intents replica identity full;

-- Demo zones for the seed restaurant (same as src/modules/guest/data/venue.ts DEMO_ZONES)
insert into public.delivery_zones (restaurant_id, slug, name, fee, min_order, eta_min, eta_max, sort)
select r.id, z.slug, z.name::jsonb, z.fee, z.min_order, z.eta_min, z.eta_max, z.sort
from public.restaurants r, (values
  ('zamalek',     '{"ar":"الزمالك","en":"Zamalek"}',        2500000, 15000000, 25, 35, 1),
  ('garden-city', '{"ar":"جاردن سيتي","en":"Garden City"}', 3500000, 20000000, 30, 45, 2),
  ('downtown',    '{"ar":"وسط البلد","en":"Downtown"}',     3500000, 20000000, 30, 45, 3),
  ('mohandessin', '{"ar":"المهندسين","en":"Mohandessin"}',  4000000, 25000000, 35, 50, 4),
  ('dokki',       '{"ar":"الدقي","en":"Dokki"}',            4000000, 25000000, 35, 50, 5),
  ('agouza',      '{"ar":"العجوزة","en":"Agouza"}',         4000000, 25000000, 35, 50, 6)
) as z(slug, name, fee, min_order, eta_min, eta_max, sort)
where r.slug = 'sufra-zamalek'
on conflict (restaurant_id, slug) do nothing;
