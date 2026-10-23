-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 · Floor & tables, reservations, online booking
--
--  - zones.background            the architect's drawing traced under an area (jsonb: src, pxW, pxH, cmPerPx, x, y, opacity, visible, locked, fileName)
--  - reservations: status 'waiting' (walk-in waitlist), deposit / deposit_paid, quoted_wait_min, arrived_at, seated_at
--  - table_seats()               seats a table gets from its size (SQL mirror of src/modules/floor/core/seats.ts autoSeatCount)
--  - guest_booking_info / guest_booking_slots / guest_book
--                                public "book from home" page (/r/:slug/book). Anonymous visitors never read tables or
--                                bookings; they only learn which start times are open. Bookings land as status 'pending',
--                                source 'online', and staff confirm them.
--  - Realtime for zones / floor_decor / table_links, so a layout edited on one device moves on every other.
-- Idempotent where Postgres allows it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── floor ──
alter table public.zones add column if not exists background jsonb;
-- rotations are multiples of 45° (the editor snaps), already enforced on dining_tables
alter table public.floor_decor drop constraint if exists floor_decor_rotation_check;
alter table public.floor_decor add constraint floor_decor_rotation_check check (rotation % 45 = 0);

-- ── reservations ──
alter table public.reservations drop constraint if exists reservations_status_check;
alter table public.reservations add constraint reservations_status_check
  check (status in ('pending','confirmed','seated','done','no_show','cancelled','waiting'));
alter table public.reservations add column if not exists deposit bigint not null default 0 check (deposit >= 0);   -- units
alter table public.reservations add column if not exists deposit_paid boolean not null default false;
alter table public.reservations add column if not exists quoted_wait_min int check (quoted_wait_min is null or quoted_wait_min >= 0);
alter table public.reservations add column if not exists arrived_at timestamptz;
alter table public.reservations add column if not exists seated_at timestamptz;
create index if not exists reservations_waitlist_idx on public.reservations (restaurant_id, branch_id, status) where status = 'waiting';
create index if not exists reservations_phone_idx on public.reservations (restaurant_id, phone, starts_at);

-- ── seats from size (mirror of autoSeatCount: 60 cm per diner, 55 at a bar, booths seat the long sides) ──
create or replace function public.table_seats(p_shape text, p_w numeric, p_h numeric, p_override int)
returns int language sql immutable as $$
  select case
    when p_override is not null then p_override
    when p_shape in ('round','oval') then greatest(2, floor(pi() * (3 * (p_w + p_h) / 2 - sqrt((3 * p_w / 2 + p_h / 2) * (p_w / 2 + 3 * p_h / 2))) / 60)::int)
    when p_shape = 'bar' then case when p_w < 45 then 0 else greatest(1, floor(p_w / 55)::int) end
    when p_shape = 'booth' then 2 * (case when greatest(p_w, p_h) < 45 then 0 else greatest(1, floor(greatest(p_w, p_h) / 60)::int) end)
    else 2 * (case when p_w < 45 then 0 else greatest(1, floor(p_w / 60)::int) end)
       + 2 * (case when p_h < 45 then 0 else greatest(1, floor(p_h / 60)::int) end)
  end;
$$;

-- ═══════════════════════════ guest booking (anon) ═══════════════════════════
-- JSON keys are camelCase to match src/modules/reservations/booking.ts GuestBookingApi.

create or replace function public.guest_booking_info(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r restaurants; b branches;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then return null; end if;
  select * into b from branches where restaurant_id = r.id order by is_default desc, created_at limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'restaurant', jsonb_build_object('id', r.id, 'slug', r.slug, 'name', r.name, 'brandColor', r.brand_color, 'phone', coalesce(b.phone, r.phone)),
    'branch', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address,
                                 'hours', coalesce(b.opening_hours, '{"open":"12:00","close":"00:00"}'::jsonb)),
    'maxParty', 8,
    'days', 30
  );
end $$;

-- Open start times for a party on a date (restaurant time zone). Conservative mirror of the client engine
-- (src/modules/floor/core/availability.ts): single tables only, 10-minute turnover buffer, 60-minute notice,
-- last seating an hour before closing, pacing of 30 arriving covers per 15 minutes.
create or replace function public.guest_booking_slots(p_slug text, p_date date, p_party int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r restaurants; b branches; tz text; o_min int; c_min int; dur int; m int; slot_start timestamptz; slot_end timestamptz;
  ok boolean; reason text; arriving int; out jsonb := '[]'::jsonb;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  select * into b from branches where restaurant_id = r.id order by is_default desc, created_at limit 1;
  tz := coalesce(r.timezone, 'Africa/Cairo');
  o_min := split_part(coalesce(b.opening_hours->>'open', '12:00'), ':', 1)::int * 60 + split_part(coalesce(b.opening_hours->>'open', '12:00'), ':', 2)::int;
  c_min := split_part(coalesce(b.opening_hours->>'close', '00:00'), ':', 1)::int * 60 + split_part(coalesce(b.opening_hours->>'close', '00:00'), ':', 2)::int;
  if c_min <= o_min then c_min := c_min + 1440; end if;
  dur := case when p_party <= 2 then 75 when p_party <= 4 then 90 when p_party <= 6 then 105 else 120 end;
  m := o_min;
  while m <= c_min - 60 loop
    slot_start := ((p_date::timestamp + make_interval(mins => m)) at time zone tz);
    slot_end := slot_start + make_interval(mins => dur);
    ok := true; reason := null;
    if p_party < 1 or p_party > 8 then ok := false; reason := 'too_big';
    elsif slot_start < now() + interval '60 minutes' then ok := false; reason := 'past';
    else
      select coalesce(sum(party), 0) into arriving from reservations
       where branch_id = b.id and status in ('pending','confirmed','seated')
         and starts_at >= slot_start and starts_at < slot_start + interval '15 minutes';
      if arriving + p_party > 30 then ok := false; reason := 'pacing';
      elsif not exists (
        select 1 from dining_tables t
         where t.branch_id = b.id and t.active and t.status <> 'blocked'
           and public.table_seats(t.shape, t.w, t.h, t.seats_override) between p_party and p_party + greatest(4, p_party)
           and not exists (
             select 1 from reservations x
              where x.branch_id = b.id and x.status in ('pending','confirmed') and t.id = any (x.table_ids)
                and x.starts_at < slot_end + interval '10 minutes'
                and slot_start < x.starts_at + make_interval(mins => x.duration_min) + interval '10 minutes')
           and not exists (
             select 1 from checks k
              where k.branch_id = b.id and k.status in ('open','bill_requested') and t.id = any (k.table_ids)
                and greatest(now() + interval '10 minutes', k.opened_at + make_interval(mins => case when k.guests <= 2 then 75 when k.guests <= 4 then 90 when k.guests <= 6 then 105 else 120 end))
                    + interval '10 minutes' > slot_start)
      ) then ok := false; reason := 'full';
      end if;
    end if;
    out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('startsAt', slot_start, 'ok', ok, 'reason', reason)));
    m := m + 15;
  end loop;
  return out;
end $$;

create or replace function public.guest_book(p_slug text, p_starts_at timestamptz, p_party int, p_name text, p_phone text, p_note text default '', p_tags text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r restaurants; b branches; tz text; s jsonb; t_id uuid; cust uuid; new_id uuid; dur int; v_phone text;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  select * into b from branches where restaurant_id = r.id order by is_default desc, created_at limit 1;
  tz := coalesce(r.timezone, 'Africa/Cairo');
  if coalesce(btrim(p_name), '') = '' then raise exception 'name_required'; end if;
  v_phone := regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g');
  if v_phone !~ '^(01[0125][0-9]{8}|\+?[0-9]{8,15})$' then raise exception 'bad_phone'; end if;
  if p_party < 1 or p_party > 8 then raise exception 'bad_party'; end if;
  -- the slot must still be open
  select x into s from jsonb_array_elements(public.guest_booking_slots(p_slug, (p_starts_at at time zone tz)::date, p_party)) x
   where (x->>'startsAt')::timestamptz = p_starts_at;
  if s is null or not (s->>'ok')::boolean then raise exception 'taken'; end if;
  -- spam guard: three pending online requests per phone per day
  if (select count(*) from reservations where restaurant_id = r.id and reservations.phone = v_phone and status = 'pending' and source = 'online'
        and (starts_at at time zone tz)::date = (p_starts_at at time zone tz)::date) >= 3 then
    raise exception 'too_many';
  end if;
  dur := case when p_party <= 2 then 75 when p_party <= 4 then 90 when p_party <= 6 then 105 else 120 end;
  -- pre-assign the snuggest free table (staff can change it)
  select t.id into t_id from dining_tables t
   where t.branch_id = b.id and t.active and t.status <> 'blocked'
     and public.table_seats(t.shape, t.w, t.h, t.seats_override) between p_party and p_party + greatest(4, p_party)
     and not exists (select 1 from reservations x where x.branch_id = b.id and x.status in ('pending','confirmed') and t.id = any (x.table_ids)
                       and x.starts_at < p_starts_at + make_interval(mins => dur) + interval '10 minutes'
                       and p_starts_at < x.starts_at + make_interval(mins => x.duration_min) + interval '10 minutes')
   order by public.table_seats(t.shape, t.w, t.h, t.seats_override), t.label
   limit 1;
  select id into cust from customers where restaurant_id = r.id and customers.phone = v_phone limit 1;
  insert into reservations (restaurant_id, branch_id, customer_id, name, phone, party, starts_at, duration_min, table_ids, status, note, tags, source)
  values (r.id, b.id, cust, left(btrim(p_name), 80), v_phone, p_party, p_starts_at, dur, case when t_id is null then '{}' else array[t_id] end,
          'pending', left(coalesce(p_note, ''), 300),
          array(select unnest(coalesce(p_tags, '{}')) intersect select unnest(array['birthday','vip','kids','smoking','quiet'])), 'online')
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

grant execute on function public.table_seats(text, numeric, numeric, int) to anon, authenticated;
grant execute on function public.guest_booking_info(text) to anon, authenticated;
grant execute on function public.guest_booking_slots(text, date, int) to anon, authenticated;
grant execute on function public.guest_book(text, timestamptz, int, text, text, text, text[]) to anon, authenticated;

-- ═══════════════════════════ Realtime for layout edits ═══════════════════════════
alter table public.zones replica identity full;
alter table public.floor_decor replica identity full;
alter table public.table_links replica identity full;
do $$
declare t text;
begin
  foreach t in array array['zones','floor_decor','table_links'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
