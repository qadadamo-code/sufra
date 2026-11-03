-- ═══════════════════════════ 0006 — delivery & online-order operations ═══════════════════════════
-- Incoming-orders inbox (accept with prep ETA / reject with reason / auto-accept per channel / auto-reject),
-- dispatch (riders, batching, ETAs), rider app (shifts, live location, proof of delivery, cash collected),
-- rider cash settlement, delivery zones drawn on a map, aggregator orders (manual, with commission).
-- Browser side: src/modules/delivery (stage machine in stages.ts, intake.ts mirrors guest_place_order_v2 below).
--
-- Requires 0001_init, 0002_pos and 0005_guest (delivery_zones, guest_place_order_v2, guest_venue).
--
--   columns    orders.dispatch (jsonb) · settings.delivery (jsonb) · delivery_zones.free_over / geometry / hours / color
--   tables     driver_shifts · driver_locations (one row per rider: unique driver_id)
--   anon RPCs  guest_venue (zones now carry shape/threshold/hours) · guest_place_order_v2 (respects auto-accept)
--              guest_driver_view (rider position + ETA + door code while out for delivery)
--   server     delivery_expire_unanswered() — auto-reject sweep (service_role; schedule every minute with pg_cron
--              or a Vercel cron: select public.delivery_expire_unanswered();). Staff tabs also sweep while open.
--
-- jsonb contents are camelCase (DispatchInfo / DeliverySettings / ZoneGeometry in src/data/types.ts).

alter table public.orders add column if not exists dispatch jsonb;
alter table public.settings add column if not exists delivery jsonb;
create index if not exists orders_dispatch_stage_idx on public.orders (restaurant_id, ((dispatch->>'stage'))) where dispatch is not null;

alter table public.delivery_zones add column if not exists free_over bigint check (free_over is null or free_over >= 0);   -- units; null = never free
alter table public.delivery_zones add column if not exists geometry jsonb;  -- {"kind":"polygon","points":[{lat,lng}…]} | {"kind":"ring","center":{lat,lng},"radiusKm":1.2}
alter table public.delivery_zones add column if not exists hours jsonb;     -- {"open":"12:00","close":"23:00"} | null = branch hours
alter table public.delivery_zones add column if not exists color text not null default '#0d5a53';

-- ───────────────────────────── helpers ─────────────────────────────
create or replace function public.my_membership_id(rid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.id from memberships m where m.restaurant_id = rid and m.user_id = auth.uid() and m.active limit 1;
$$;

-- ISO-8601 UTC with milliseconds, like the browser's toISOString()
create or replace function public.delivery_iso(t timestamptz) returns text
language sql immutable as $$ select to_char(t at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- centre of a zone shape (door pin when the guest shared no GPS)
create or replace function public.delivery_zone_center(g jsonb) returns jsonb
language sql immutable as $$
  select case
    when g is null then null
    when g->>'kind' = 'ring' then g->'center'
    else (select jsonb_build_object('lat', avg((p->>'lat')::float8), 'lng', avg((p->>'lng')::float8)) from jsonb_array_elements(g->'points') p)
  end
$$;

-- haversine km
create or replace function public.delivery_km(a_lat float8, a_lng float8, b_lat float8, b_lng float8) returns float8
language sql immutable as $$
  select 2 * 6371.0088 * asin(least(1, sqrt(power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))))
$$;

-- ───────────────────────────── rider shifts & positions ─────────────────────────────
create table if not exists public.driver_shifts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  driver_id     uuid not null references public.memberships (id) on delete cascade,
  status        text not null default 'on' check (status in ('on', 'off', 'settled')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  settlement    jsonb,                                  -- {expected, handedIn, difference, orders, settledBy, settledAt, posShiftId, note} (units)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists driver_shifts_driver_idx on public.driver_shifts (restaurant_id, driver_id, started_at desc);
create unique index if not exists driver_shifts_one_open on public.driver_shifts (driver_id) where status = 'on';

create table if not exists public.driver_locations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  driver_id     uuid not null unique references public.memberships (id) on delete cascade,
  lat           float8 not null check (lat between -90 and 90),
  lng           float8 not null check (lng between -180 and 180),
  accuracy      float8,
  heading       float8,
  speed         float8,
  at            timestamptz not null default now(),
  on_shift      boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.driver_shifts enable row level security;
alter table public.driver_locations enable row level security;
create policy driver_shifts_select on public.driver_shifts for select to authenticated using (public.is_member(restaurant_id));
create policy driver_shifts_insert on public.driver_shifts for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') or driver_id = public.my_membership_id(restaurant_id));
create policy driver_shifts_update on public.driver_shifts for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') or driver_id = public.my_membership_id(restaurant_id))
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') or driver_id = public.my_membership_id(restaurant_id));
create policy driver_locations_select on public.driver_locations for select to authenticated using (public.is_member(restaurant_id));
-- a rider writes only their own position
create policy driver_locations_insert on public.driver_locations for insert to authenticated
  with check (driver_id = public.my_membership_id(restaurant_id) or public.has_role(restaurant_id, '{owner,admin,manager}'));
create policy driver_locations_update on public.driver_locations for update to authenticated
  using (driver_id = public.my_membership_id(restaurant_id) or public.has_role(restaurant_id, '{owner,admin,manager}'))
  with check (driver_id = public.my_membership_id(restaurant_id) or public.has_role(restaurant_id, '{owner,admin,manager}'));

-- riders can open/close their own shift but only the till settles it
create or replace function public.driver_shifts_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_role(new.restaurant_id, '{owner,admin,manager,cashier}')
     and (new.status = 'settled' or new.settlement is distinct from (case when tg_op = 'UPDATE' then old.settlement else null end)) then
    raise exception 'only the till settles a rider shift';
  end if;
  return new;
end $$;
create trigger driver_shifts_guard before insert or update on public.driver_shifts for each row execute function public.driver_shifts_guard();
create trigger driver_shifts_updated before update on public.driver_shifts for each row execute function public.set_updated_at();
create trigger driver_locations_updated before update on public.driver_locations for each row execute function public.set_updated_at();

-- ───────────────────────────── guest RPCs (replace 0005 versions) ─────────────────────────────

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
    'tax', (s.tax - 'taxId' - 'commercialRegister') || jsonb_build_object('taxId', '', 'commercialRegister', ''),
    'qr', jsonb_build_object('enabled', coalesce((s.qr_ordering->>'enabled')::boolean, false),
                             'requireWaiterConfirm', coalesce((s.qr_ordering->>'requireWaiterConfirm')::boolean, true),
                             'allowServiceCalls', coalesce((s.qr_ordering->>'allowServiceCalls')::boolean, false)),
    'tipsEnabled', coalesce(s.tips_enabled, false),
    'zones', coalesce((select jsonb_agg(jsonb_build_object('id', z.slug, 'name', z.name, 'fee', z.fee, 'minOrder', z.min_order, 'etaMin', z.eta_min, 'etaMax', z.eta_max,
                                                          'freeOver', z.free_over, 'geometry', z.geometry, 'hours', z.hours) order by z.sort)
                       from delivery_zones z where z.restaurant_id = r.id and z.active), '[]')
  );
end $$;

-- Same contract as 0005, plus: auto-accept per channel (settings.delivery.autoAccept; QR keeps waiter-confirm),
-- otherwise the order waits in the staff inbox with an auto-reject deadline; free-delivery threshold; door pin
-- (guest GPS when sent, else the zone centre); rider door code.
create or replace function public.guest_place_order_v2(
  p_slug text, p_table_code text, p_mode text, p_lines jsonb, p_customer jsonb default null, p_note text default '',
  p_delivery jsonb default null, p_pickup_at timestamptz default null, p_payment text default 'cash')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r restaurants; s settings; z delivery_zones; res jsonb; o orders; v_phone text; cname text; cust uuid; pay text; auto_fire boolean;
  channel text; dcfg jsonb; prep int; reject_min int; v_lat float8; v_lng float8; center jsonb; sub bigint; v_fee bigint := 0; v_dispatch jsonb; addr jsonb;
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

  -- door pin: guest GPS (validated), else the zone centre
  if p_mode = 'delivery' then
    begin
      v_lat := (p_delivery->>'lat')::float8;
      v_lng := (p_delivery->>'lng')::float8;
    exception when others then v_lat := null; v_lng := null;
    end;
    if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      center := public.delivery_zone_center(z.geometry);
      v_lat := (center->>'lat')::float8;
      v_lng := (center->>'lng')::float8;
    end if;
    addr := jsonb_build_object('address', left(p_delivery->>'address', 200), 'area', z.name->>'ar', 'notes', left(coalesce(p_delivery->>'notes', ''), 200), 'lat', v_lat, 'lng', v_lng);
  end if;

  if v_phone is not null then
    insert into customers (restaurant_id, phone, name, tags, addresses)
    values (r.id, v_phone, cname, '{online}', case when p_mode = 'delivery' then jsonb_build_array(addr) else '[]' end)
    on conflict (restaurant_id, phone) do update set name = coalesce(nullif(customers.name, ''), excluded.name)
    returning id into cust;
    update checks set customer_id = cust where id = o.check_id;
  end if;

  dcfg := coalesce(s.delivery, '{}'::jsonb);
  prep := coalesce((dcfg->>'defaultPrepMin')::int, 20);
  reject_min := coalesce((dcfg->>'autoRejectMin')::int, 8);
  if p_table_code is not null then
    channel := 'qr';
    auto_fire := not coalesce((s.qr_ordering->>'requireWaiterConfirm')::boolean, true);
  else
    channel := case when p_mode = 'delivery' then 'online_delivery' else 'online_takeaway' end;
    auto_fire := coalesce((dcfg->'autoAccept'->>channel)::boolean, false);
    v_dispatch := jsonb_build_object(
      'stage', case when auto_fire then 'accepted' else 'received' end, 'channel', channel, 'receivedAt', public.delivery_iso(now()),
      'expiresAt', case when not auto_fire and reject_min > 0 then public.delivery_iso(now() + make_interval(mins => reject_min)) end,
      'acceptedAt', case when auto_fire then public.delivery_iso(now()) end, 'acceptedBy', null,
      'prepMin', case when auto_fire then prep end,
      'promisedAt', case when auto_fire then public.delivery_iso(now() + make_interval(mins => case when p_mode = 'delivery' then greatest(prep, coalesce(z.eta_max, prep)) else prep end)) end,
      'readyAt', null, 'assignedAt', null, 'pickedUpAt', null, 'arrivedAt', null, 'deliveredAt', null, 'failedAt', null, 'failReason', null, 'rejectReason', null,
      'otp', case when p_mode = 'delivery' then (floor(random() * 9000) + 1000)::int::text end, 'proof', null, 'collected', null, 'driverShiftId', null,
      'batchId', null, 'zone', z.slug, 'aggregator', null, 'delayedAt', null);
  end if;

  if auto_fire then
    update order_items set status = 'sent', fired_at = now() where order_id = o.id and status = 'new';
  end if;
  update orders set
    customer_id = coalesce(cust, customer_id),
    pickup_at = p_pickup_at,
    status = case when auto_fire then 'sent' else status end,
    delivery = case when p_mode = 'delivery' then addr else delivery end,
    delivery_status = case when p_mode = 'delivery' then 'pending' else delivery_status end,
    delivery_fee = 0,
    dispatch = coalesce(v_dispatch, orders.dispatch)
  where id = o.id;
  -- price first, then the fee (free above the zone threshold), then price again
  perform public.guest_reprice_check(o.check_id);
  if p_mode = 'delivery' then
    select subtotal into sub from checks where id = o.check_id;
    v_fee := case when z.free_over is not null and z.free_over > 0 and coalesce(sub, 0) >= z.free_over then 0 else z.fee end;
    update orders set delivery_fee = v_fee where id = o.id;
    perform public.guest_reprice_check(o.check_id);
  end if;
  return res;
end $$;

-- Rider on the tracking map: position (fresh fixes only), ETA, door code — only while the order is on its way.
create or replace function public.guest_driver_view(p_slug text, p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o orders; s settings; d memberships; l driver_locations; stage text; on_way boolean; olat float8; olng float8; dlat float8; dlng float8; speed float8; fresh boolean; km float8;
begin
  select o2.* into o from orders o2 join restaurants r on r.id = o2.restaurant_id where r.slug = p_slug and o2.id = p_order_id and o2.mode = 'delivery';
  if not found then return null; end if;
  select * into s from settings where restaurant_id = o.restaurant_id;
  stage := coalesce(o.dispatch->>'stage', case o.delivery_status when 'picked_up' then 'picked_up' when 'delivered' then 'delivered' else 'accepted' end);
  on_way := stage in ('picked_up', 'arrived');
  select * into d from memberships where id = o.driver_id;
  if on_way then select * into l from driver_locations where driver_id = o.driver_id; end if;
  fresh := l.id is not null and l.at > now() - interval '15 minutes';
  olat := coalesce((s.delivery->'origin'->>'lat')::float8, 30.0626);
  olng := coalesce((s.delivery->'origin'->>'lng')::float8, 31.2179);
  speed := greatest(5, coalesce((s.delivery->>'speedKmh')::float8, 22));
  dlat := (o.delivery->>'lat')::float8;
  dlng := (o.delivery->>'lng')::float8;
  if on_way and dlat is not null then
    km := public.delivery_km(case when fresh then l.lat else olat end, case when fresh then l.lng else olng end, dlat, dlng) * 1.35;  -- road factor, as geo.ts
  end if;
  return jsonb_build_object(
    'stage', stage,
    'driver', case when d.id is null then null else jsonb_build_object('name', split_part(d.name, ' ', 1), 'phone', d.phone) end,
    'position', case when fresh then jsonb_build_object('lat', l.lat, 'lng', l.lng, 'at', public.delivery_iso(l.at), 'heading', l.heading) end,
    'door', case when dlat is null then null else jsonb_build_object('lat', dlat, 'lng', dlng) end,
    'origin', jsonb_build_object('lat', olat, 'lng', olng),
    'promisedAt', o.dispatch->>'promisedAt',
    'etaMin', case when not on_way or km is null then null when stage = 'arrived' then 0 else ceil(km / speed * 60) + 3 end,
    'otp', case when on_way then o.dispatch->>'otp' end
  );
end $$;

-- ───────────────────────────── server: auto-reject sweep ─────────────────────────────
create or replace function public.delivery_expire_unanswered() returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; o record;
begin
  for o in select id, check_id from orders
           where dispatch->>'stage' = 'received' and status <> 'void' and (dispatch->>'expiresAt')::timestamptz <= now()
           for update skip locked loop
    update orders set status = 'void', closed_at = now(),
      dispatch = dispatch || jsonb_build_object('stage', 'rejected', 'rejectReason', 'لم يتم الرد في الوقت / not answered in time', 'expiresAt', null)
    where id = o.id;
    update order_items set status = 'void', void_reason = 'auto-reject' where order_id = o.id and status <> 'void';
    update checks set status = 'void', closed_at = now() where id = o.check_id and paid <= 0
      and not exists (select 1 from orders x where x.check_id = o.check_id and x.id <> o.id and x.status <> 'void');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ───────────────────────────── grants & realtime ─────────────────────────────
revoke all on public.driver_shifts, public.driver_locations from anon;
revoke execute on function public.delivery_expire_unanswered() from public, anon, authenticated;
grant execute on function public.delivery_expire_unanswered() to service_role;
grant execute on function public.my_membership_id(uuid) to authenticated;
grant execute on function public.guest_driver_view(text, uuid), public.guest_venue(text, text),
  public.guest_place_order_v2(text, text, text, jsonb, jsonb, text, jsonb, timestamptz, text) to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.driver_shifts, public.driver_locations, public.delivery_zones;
  end if;
end $$;
alter table public.driver_locations replica identity full;
