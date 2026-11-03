-- ═══════════════════════════ 0013 — Operations extras: cameras, walkie-talkie, support desk, alerts ═══════════════════════════
-- Browser side: src/modules/ops (cameras/, radio/, support/, alerts/). Requires 0001 … 0009 (is_platform_admin from 0009,
-- guest_normalize_phone from 0005).
--
--   tables     cameras · people_counts · radio_clips · support_tickets · ops_settings · ops_acks
--   view       ops_video_events (audit_log rows that are POS ↔ video exceptions; mapping to cameras is in the app)
--   storage    bucket "radio" (voice clips: radio/<restaurant_id>/<clip_id>.<ext>), members of that restaurant only
--   anon RPCs  guest_complaint_submit · guest_contact
--   helpers    radio_can_hear(restaurant, channel) · my_membership_id(restaurant)
--
-- Stream URLs in `cameras` never carry credentials (the app says so; the gateway/NVR holds them). Camera rows are
-- readable by owner/admin/manager only. JSON keys are camelCase like the TS shapes.

-- ───────────────────────────── helpers ─────────────────────────────
create or replace function public.my_membership_id(rid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.id from memberships m where m.restaurant_id = rid and m.user_id = auth.uid() and m.active limit 1;
$$;
grant execute on function public.my_membership_id(uuid) to authenticated;

-- mirrors src/modules/ops/radio/channels.ts (CHANNELS[].members; dm:<a>:<b> = exactly those two memberships)
create or replace function public.radio_can_hear(rid uuid, ch text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.my_membership_id(rid); r public.app_role := public.my_role(rid);
begin
  if me is null or r is null or r::text = 'platform_admin' then return false; end if;
  if ch like 'dm:%' then return split_part(ch, ':', 2) = me::text or split_part(ch, ':', 3) = me::text; end if;
  return case ch
    when 'all'      then true
    when 'floor'    then r::text in ('owner','admin','manager','cashier','waiter','chef')
    when 'kitchen'  then r::text in ('owner','admin','manager','chef','kitchen','waiter','cashier')
    when 'delivery' then r::text in ('owner','admin','manager','cashier','delivery')
    when 'managers' then r::text in ('owner','admin','manager','chef')
    else false end;
end $$;
grant execute on function public.radio_can_hear(uuid, text) to authenticated;

-- ───────────────────────────── cameras ─────────────────────────────
create table if not exists public.cameras (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          jsonb not null,
  area          text not null default '',
  zone_id       uuid references public.zones (id) on delete set null,
  brand         text not null default 'other' check (brand in ('hikvision','dahua','uniview','other')),
  channel       int not null default 1 check (channel >= 1),
  stream        text not null default 'demo' check (stream in ('hls','webrtc','mjpeg','snapshot','demo')),
  url           text not null default '' check (url !~* '^rtsps?://' and url !~ '://[^/@]+:[^/@]+@'),  -- browser URLs only, no user:pass@
  snapshot_sec  int not null default 2 check (snapshot_sec between 1 and 300),
  pos_devices   text[] not null default '{}',
  table_ids     uuid[] not null default '{}',
  drawers       text[] not null default '{}',
  counter       boolean not null default false,
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists cameras_branch_idx on public.cameras (restaurant_id, branch_id, sort);

create table if not exists public.people_counts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  zone_id       uuid references public.zones (id) on delete cascade,
  camera_id     uuid references public.cameras (id) on delete set null,
  source        text not null check (source in ('manual','camera')),
  in_count      int not null default 0 check (in_count >= 0),
  out_count     int not null default 0 check (out_count >= 0),
  occupancy     int check (occupancy >= 0),
  at            timestamptz not null default now(),
  actor_id      uuid references public.memberships (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists people_counts_idx on public.people_counts (restaurant_id, zone_id, at desc);

-- ───────────────────────────── walkie-talkie ─────────────────────────────
create table if not exists public.radio_clips (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid references public.branches (id) on delete set null,
  channel       text not null check (channel in ('all','floor','kitchen','delivery','managers') or channel ~ '^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$'),
  from_id       uuid not null references public.memberships (id) on delete cascade,
  from_name     text not null default '',
  mime          text not null default '',
  duration_ms   int not null default 0 check (duration_ms between 0 and 120000),
  bytes         int not null default 0 check (bytes between 0 and 5000000),
  storage_path  text not null default '',
  text          text check (char_length(text) <= 280),
  at            timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists radio_clips_idx on public.radio_clips (restaurant_id, channel, at desc);

-- ───────────────────────────── support desk ─────────────────────────────
create table if not exists public.support_tickets (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  branch_id         uuid references public.branches (id) on delete set null,
  kind              text not null check (kind in ('guest','sufra')),
  number            text not null,
  subject           text not null default '',
  body              text not null default '' check (char_length(body) <= 4000),
  category          text not null default 'other',
  channel           text not null default 'qr' check (channel in ('qr','online','phone','whatsapp','walk_in','app')),
  priority          text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  status            text not null default 'new' check (status in ('new','open','pending','resolved','closed')),
  customer_id       uuid references public.customers (id) on delete set null,
  contact_name      text not null default '',
  contact_phone     text not null default '',
  order_id          uuid references public.orders (id) on delete set null,
  check_id          uuid references public.checks (id) on delete set null,
  table_id          uuid references public.dining_tables (id) on delete set null,
  raised_by         uuid references public.memberships (id) on delete set null,
  assignee_id       uuid references public.memberships (id) on delete set null,
  notes             jsonb not null default '[]',      -- [{id,at,by,byName,kind:internal|reply|system,text}]
  resolution        text not null default '',
  follow_up         text,
  follow_up_at      timestamptz,
  first_response_at timestamptz,
  resolved_at       timestamptz,
  escalated_at      timestamptz,
  diagnostics       jsonb,                             -- sufra tickets: app version, device, sync, last errors (scrubbed)
  forwarded_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (restaurant_id, number)
);
create index if not exists support_tickets_idx on public.support_tickets (restaurant_id, kind, status, created_at desc);
create index if not exists support_tickets_sufra_idx on public.support_tickets (kind, status, created_at desc) where kind = 'sufra';

-- ───────────────────────────── settings & acks ─────────────────────────────
create table if not exists public.ops_settings (
  id                     uuid primary key references public.restaurants (id) on delete cascade,  -- = restaurant_id
  restaurant_id          uuid not null unique references public.restaurants (id) on delete cascade check (id = restaurant_id),
  hotline_phone          text not null default '',
  whatsapp_phone         text not null default '',
  sufra_support_phone    text not null default '',
  sufra_support_whatsapp text not null default '',
  gateway_url            text not null default '' check (gateway_url = '' or gateway_url ~* '^https?://'),
  playback_templates     jsonb not null default '{}',
  nvr_host               text not null default '',
  clip_pad_sec           int not null default 30 check (clip_pad_sec between 5 and 600),
  zone_capacity          jsonb not null default '{}',
  sla                    jsonb not null default '{}',
  alert_rules            jsonb not null default '[]',
  radio                  jsonb not null default '{"maxClipSec":30,"minClipMs":400,"autoplay":true}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
-- Sufra's own support numbers are set by Sufra, not by the restaurant
create or replace function public.ops_settings_guard() returns trigger language plpgsql as $$
begin
  if not public.is_platform_admin() and current_user <> 'service_role' then
    if tg_op = 'INSERT' then new.sufra_support_phone := ''; new.sufra_support_whatsapp := '';
    else new.sufra_support_phone := old.sufra_support_phone; new.sufra_support_whatsapp := old.sufra_support_whatsapp; end if;
  end if;
  return new;
end $$;
drop trigger if exists ops_settings_guard on public.ops_settings;
create trigger ops_settings_guard before insert or update on public.ops_settings for each row execute function public.ops_settings_guard();

-- review markers for camera events (id = audit_log id) and alert acknowledgements (id = "call:<uuid>", "late:<uuid>" …)
create table if not exists public.ops_acks (
  id            text primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind          text not null check (kind in ('event','alert')),
  by            uuid references public.memberships (id) on delete set null,
  note          text not null default '',
  verdict       text check (verdict in ('ok','suspicious','action')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ───────────────────────────── triggers + RLS ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['cameras','people_counts','radio_clips','support_tickets','ops_settings','ops_acks'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- cameras: managers and above (stream URLs are sensitive)
create policy cameras_select on public.cameras for select to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager}') and public.in_branch(restaurant_id, branch_id));
create policy cameras_write on public.cameras for all to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager}')) with check (public.has_role(restaurant_id, '{owner,admin,manager}'));

-- people counts: managers read; the host (manager / cashier) records manual counts; camera rows come from the service role
create policy people_counts_select on public.people_counts for select to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
create policy people_counts_insert on public.people_counts for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') and source = 'manual' and actor_id = public.my_membership_id(restaurant_id));

-- radio: hear = channel member; talk = as yourself, on a channel you can hear; clips are immutable (no update/delete by staff)
create policy radio_clips_select on public.radio_clips for select to authenticated using (public.radio_can_hear(restaurant_id, channel));
create policy radio_clips_insert on public.radio_clips for insert to authenticated
  with check (from_id = public.my_membership_id(restaurant_id) and public.radio_can_hear(restaurant_id, channel));
create policy radio_clips_delete on public.radio_clips for delete to authenticated using (public.has_role(restaurant_id, '{owner,admin}'));

-- support tickets
--   guest complaints: managers (and cashiers who log phone complaints) — read/write
--   sufra tickets:    the person who raised it + managers of that restaurant; Sufra platform admins see/answer all
create policy support_tickets_select on public.support_tickets for select to authenticated using (
  (kind = 'guest' and public.has_role(restaurant_id, '{owner,admin,manager,cashier}'))
  or (kind = 'sufra' and (raised_by = public.my_membership_id(restaurant_id) or public.has_role(restaurant_id, '{owner,admin,manager}')))
  or (kind = 'sufra' and public.is_platform_admin()));
create policy support_tickets_insert on public.support_tickets for insert to authenticated with check (
  (kind = 'guest' and public.has_role(restaurant_id, '{owner,admin,manager,cashier}'))
  or (kind = 'sufra' and public.is_member(restaurant_id) and raised_by = public.my_membership_id(restaurant_id)));
create policy support_tickets_update on public.support_tickets for update to authenticated using (
  (kind = 'guest' and public.has_role(restaurant_id, '{owner,admin,manager}'))
  or (kind = 'sufra' and (raised_by = public.my_membership_id(restaurant_id) or public.has_role(restaurant_id, '{owner,admin,manager}') or public.is_platform_admin())))
  with check (kind in ('guest','sufra'));
create policy restaurants_support_platform on public.restaurants for select to authenticated using (public.is_platform_admin());

-- ops settings: every member reads (radio limits, hotline); managers write
create policy ops_settings_select on public.ops_settings for select to authenticated using (public.is_member(restaurant_id));
create policy ops_settings_write on public.ops_settings for all to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager}')) with check (public.has_role(restaurant_id, '{owner,admin,manager}'));

create policy ops_acks_all on public.ops_acks for all to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager}')) with check (public.has_role(restaurant_id, '{owner,admin,manager}'));

-- ───────────────────────────── POS ↔ video exceptions ─────────────────────────────
-- Same rules as src/modules/ops/cameras/events.ts; the app maps device/table → cameras. security_invoker → audit_log RLS applies.
create or replace view public.ops_video_events with (security_invoker = true) as
select a.id, a.restaurant_id, a.branch_id, a.actor_id, a.approved_by, a.created_at as at, a.entity, a.entity_id, a.data,
  case a.action
    when 'order.void' then 'void' when 'payment.void' then 'void'
    when 'payment.refund' then 'refund'
    when 'check.discount' then 'discount' when 'item.discount' then 'discount'
    when 'drawer.open' then 'no_sale'
    when 'shift.close' then 'cash_variance' when 'delivery.settle' then 'cash_variance'
    when 'menu.86' then 'item_86' end as kind,
  a.data ->> 'device' as device
from public.audit_log a
where a.action in ('order.void','payment.void','payment.refund','drawer.open','menu.86')
   or (a.action in ('check.discount','item.discount') and (a.approved_by is not null or coalesce((a.data ->> 'pct')::numeric, (a.data -> 'discount' ->> 'rate')::numeric / 100, 0) > 10))
   or (a.action in ('shift.close','delivery.settle') and coalesce((a.data ->> 'difference')::numeric, 0) <> 0);
grant select on public.ops_video_events to authenticated;

-- ───────────────────────────── anon RPCs (guest pages) ─────────────────────────────
create or replace function public.guest_contact(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'phone', coalesce(nullif(s.hotline_phone, ''), b.phone, r.phone, ''),
    'whatsapp', coalesce(s.whatsapp_phone, ''))
  from restaurants r
  left join ops_settings s on s.restaurant_id = r.id
  left join lateral (select phone from branches where restaurant_id = r.id order by is_default desc limit 1) b on true
  where r.slug = p_slug and r.active;
$$;

create or replace function public.guest_complaint_submit(p_slug text, p_name text, p_phone text, p_category text, p_body text,
  p_table_code text default null, p_order_id uuid default null, p_channel text default 'qr')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r restaurants; t dining_tables; c checks; o orders; cu customers; ph text; n int; num text; prio text; body text := left(trim(coalesce(p_body, '')), 2000);
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  if char_length(body) < 5 then raise exception 'too_short'; end if;
  ph := case when coalesce(trim(p_phone), '') = '' then null else public.guest_normalize_phone(p_phone) end;
  if coalesce(trim(p_phone), '') <> '' and ph is null then raise exception 'bad_phone'; end if;
  -- flood guard: ≤ 5 complaints per phone (or per table) per hour per restaurant
  if (select count(*) from support_tickets s where s.restaurant_id = r.id and s.kind = 'guest' and s.created_at > now() - interval '1 hour'
        and ((ph is not null and s.contact_phone = ph) or (ph is null and s.contact_phone = '' ))) >= 5 then
    raise exception 'rate_limited';
  end if;
  if p_table_code is not null then select * into t from dining_tables where restaurant_id = r.id and code = upper(p_table_code); end if;
  if t.id is not null then select * into c from checks where restaurant_id = r.id and status in ('open','bill_requested') and t.id = any (table_ids) limit 1; end if;
  if p_order_id is not null then select * into o from orders where id = p_order_id and restaurant_id = r.id; end if;
  if ph is not null then select * into cu from customers where restaurant_id = r.id and phone = ph limit 1; end if;
  perform pg_advisory_xact_lock(hashtext('support_tickets:' || r.id::text));
  select coalesce(max(nullif(split_part(number, '-', 2), '')::int), 1000) + 1 into n from support_tickets where restaurant_id = r.id and kind = 'guest';
  num := 'G-' || lpad(n::text, 4, '0');
  prio := case
    when (p_category || ' ' || body) ~* '(allerg|حساسي|تسمم|poison|صرصار|حشر|insect|hair|شعر|glass|زجاج)' then 'urgent'
    when p_category = 'billing' or body ~* '(overcharg|اتحاسب|refund|فلوس)' then 'high'
    when p_category in ('suggestion','praise') then 'low' else 'normal' end;
  insert into support_tickets (restaurant_id, branch_id, kind, number, subject, body, category, channel, priority, customer_id, contact_name, contact_phone, order_id, check_id, table_id)
  values (r.id, coalesce(t.branch_id, o.branch_id, (select id from branches where restaurant_id = r.id order by is_default desc limit 1)), 'guest', num,
    left(split_part(body, E'\n', 1), 70), body,
    case when p_category in ('food','service','billing','delivery','cleanliness','suggestion','praise','other') then p_category else 'other' end,
    case when p_channel in ('qr','online') then p_channel else 'qr' end, prio,
    coalesce(cu.id, o.customer_id, c.customer_id), left(coalesce(trim(p_name), cu.name, ''), 80), coalesce(ph, ''), o.id, coalesce(c.id, o.check_id), t.id);
  return jsonb_build_object('number', num);
end $$;
revoke all on function public.guest_complaint_submit(text, text, text, text, text, text, uuid, text) from public;
grant execute on function public.guest_complaint_submit(text, text, text, text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.guest_contact(text) to anon, authenticated;

-- ───────────────────────────── storage: radio clips ─────────────────────────────
-- Supabase only (plain-Postgres test runs have no storage schema). Path: <restaurant_id>/<clip_id>.<ext>.
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('radio', 'radio', false, 5242880, array['audio/webm','audio/ogg','audio/mp4','audio/aac','audio/mpeg'])
      on conflict (id) do nothing;
    execute $p$create policy radio_read on storage.objects for select to authenticated
      using (bucket_id = 'radio' and public.is_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy radio_write on storage.objects for insert to authenticated
      with check (bucket_id = 'radio' and public.is_member(((storage.foldername(name))[1])::uuid))$p$;
  end if;
exception when duplicate_object then null;
end $$;

-- ───────────────────────────── realtime ─────────────────────────────
alter table public.radio_clips replica identity full;
alter table public.support_tickets replica identity full;
do $$ begin
  begin
    alter publication supabase_realtime add table public.radio_clips, public.support_tickets, public.ops_acks, public.cameras, public.people_counts, public.ops_settings;
  exception when duplicate_object then null;
  end;
end $$;
