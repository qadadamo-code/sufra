-- ═══════════════════════════ 0009 — CRM, loyalty, promotions, gift cards, campaigns, own promos, Sufra ads ═══════════════════════════
-- Browser side: src/lib/promo (pure rules), src/modules/customers, src/modules/marketing, src/modules/platform.
-- Requires 0001 … 0008 (0005 guest_feedback, guest_normalize_phone).
--
--   tables     loyalty_programs · loyalty_ledger · promotions · coupon_codes · promo_redemptions · gift_cards · gift_card_txns
--              segments · campaigns · campaign_messages · journeys · referrals · promo_banners · market_profiles
--              ad_slots (global) · ad_bookings · platform_admins
--   altered    customers (+CRM columns) · guest_feedback (+reply, customer, waiter) · app_role (+platform_admin)
--   anon RPCs  public_sponsored(city, cuisine) · public_sponsored_track · guest_promos · guest_banner_track · guest_check_coupon
--              guest_apply_promos · guest_loyalty_card · guest_gift_card_status
--   auth RPCs  ad_slot_availability · is_platform_admin()
--
-- Money columns are bigint units (0.00001 EGP); rates are basis points. JSON keys are camelCase like the TS shapes.

-- Sufra staff: a platform role that is NOT a restaurant role. The enum value lets a demo membership carry it; platform-wide
-- access is decided by platform_admins (never by a membership), so restaurant RLS is unchanged.
alter type public.app_role add value if not exists 'platform_admin';

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon;
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
grant execute on function public.is_platform_admin() to authenticated;
create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

-- platform admins see every restaurant (directory)
create policy restaurants_platform_select on public.restaurants for select to authenticated using (public.is_platform_admin());

-- ───────────────────────────── customers: CRM columns ─────────────────────────────
alter table public.customers
  add column if not exists gender text check (gender in ('m','f')),
  add column if not exists consent jsonb,                          -- {whatsapp,sms,email,push,at,via} (PDPL 151/2020)
  add column if not exists source text,                            -- qr | online | pos | reservation | wifi | manual | import | referral
  add column if not exists tier_id text,
  add column if not exists lifetime_points int not null default 0,
  add column if not exists stamps jsonb not null default '{}',
  add column if not exists referral_code text,
  add column if not exists referred_by uuid references public.customers (id) on delete set null,
  add column if not exists merged_into uuid references public.customers (id) on delete set null,
  add column if not exists allergies text not null default '',
  add column if not exists no_shows int not null default 0;
create unique index if not exists customers_referral_code_idx on public.customers (restaurant_id, referral_code) where referral_code is not null;

-- ───────────────────────────── loyalty ─────────────────────────────
create table if not exists public.loyalty_programs (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null unique references public.restaurants (id) on delete cascade,
  name                  jsonb not null,
  enabled               boolean not null default true,
  earn_points           int not null default 1,
  earn_spend            bigint not null default 1000000 check (earn_spend > 0),   -- 10 EGP
  point_value           bigint not null default 25000,                           -- 0.25 EGP
  min_redeem            int not null default 100,
  expiry_days           int,
  tiers                 jsonb not null default '[]',
  stamp_cards           jsonb not null default '[]',
  rewards               jsonb not null default '[]',
  excluded_category_ids text[] not null default '{}',
  earn_channels         text[] not null default '{}',
  welcome_bonus         int not null default 0,
  birthday_bonus        int not null default 0,
  referrer_points       int not null default 0,
  referral_promotion_id uuid,
  referral_monthly_cap  int not null default 10,
  terms                 jsonb not null default '{"ar":"","en":""}',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- every points movement and every paid visit of a known customer (kind earn, points may be 0)
create table if not exists public.loyalty_ledger (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  customer_id   uuid not null references public.customers (id) on delete cascade,
  branch_id     uuid references public.branches (id) on delete set null,
  kind          text not null check (kind in ('earn','redeem','expire','adjust','bonus')),
  points        int not null,
  spend         bigint not null default 0,
  check_id      uuid references public.checks (id) on delete set null,
  channel       text,
  reward_id     text,
  stamps        jsonb not null default '{}',
  expires_at    timestamptz,
  note          text not null default '',
  actor_id      uuid references public.memberships (id) on delete set null,
  at            timestamptz not null default now(),
  items         jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists loyalty_ledger_customer_idx on public.loyalty_ledger (customer_id, at);
create unique index if not exists loyalty_ledger_earn_once on public.loyalty_ledger (check_id) where kind = 'earn' and check_id is not null;

-- ───────────────────────────── promotions ─────────────────────────────
create table if not exists public.promotions (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  name             jsonb not null,
  description      jsonb,
  kind             text not null check (kind in ('coupon','auto')),
  type             text not null check (type in ('percent','amount','bogo','combo','free_delivery','free_item')),
  code             text,
  value            bigint not null default 0,
  max_discount     bigint,
  min_spend        bigint,
  target           jsonb,
  bogo             jsonb,
  combo            jsonb,
  "window"         jsonb,
  channels         text[] not null default '{}',
  modes            text[] not null default '{}',
  first_order_only boolean not null default false,
  limits           jsonb,
  stackable        boolean not null default false,
  priority         int not null default 10,
  active           boolean not null default true,
  segment_ids      text[] not null default '{}',
  tier_ids         text[] not null default '{}',
  uses             int not null default 0,
  created_by       uuid references public.memberships (id) on delete set null,
  campaign_id      uuid,   -- campaign that issued it (no FK: campaigns also point here)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists promotions_code_idx on public.promotions (restaurant_id, upper(code)) where code is not null;

create table if not exists public.segments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          jsonb not null,
  color         text not null default '#0d5a53',
  match         text not null default 'all' check (match in ('all','any')),
  rules         jsonb not null default '[]',
  count         int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.campaigns (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  name             text not null,
  segment_id       uuid references public.segments (id) on delete set null,
  audience         text not null default 'all',
  channel          text not null check (channel in ('whatsapp','sms','push')),
  status           text not null default 'draft' check (status in ('draft','scheduled','sending','sent','cancelled')),
  variants         jsonb not null default '[]',
  promotion_id     uuid references public.promotions (id) on delete set null,
  scheduled_at     timestamptz,
  sent_at          timestamptz,
  cost_per_message bigint not null default 0,
  stats            jsonb not null default '{}',
  journey_id       uuid,
  created_by       uuid references public.memberships (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.coupon_codes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  promotion_id  uuid not null references public.promotions (id) on delete cascade,
  code          text not null,
  customer_id   uuid references public.customers (id) on delete set null,
  campaign_id   uuid references public.campaigns (id) on delete set null,
  used_at       timestamptz,
  check_id      uuid references public.checks (id) on delete set null,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, code)
);

create table if not exists public.promo_redemptions (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  promotion_id      uuid references public.promotions (id) on delete set null,
  reward_id         text,
  code              text,
  customer_id       uuid references public.customers (id) on delete set null,
  check_id          uuid references public.checks (id) on delete set null,
  order_id          uuid references public.orders (id) on delete set null,
  channel           text not null default 'pos',
  status            text not null default 'applied' check (status in ('applied','redeemed','voided')),
  discount          bigint not null default 0,
  delivery_discount bigint not null default 0,
  line_discounts    jsonb not null default '{}',
  revenue           bigint not null default 0,
  campaign_id       uuid references public.campaigns (id) on delete set null,
  points            int not null default 0,
  at                timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists promo_redemptions_check_idx on public.promo_redemptions (check_id);

-- promotion use counter: maintained here so cashiers never need write access to promotions
create or replace function public.promo_redemption_uses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.promotion_id is not null and new.status = 'redeemed' and (tg_op = 'INSERT' or old.status is distinct from 'redeemed') then
    update promotions set uses = uses + 1 where id = new.promotion_id;
    if new.code is not null then update coupon_codes set used_at = coalesce(used_at, now()), check_id = coalesce(check_id, new.check_id) where restaurant_id = new.restaurant_id and code = new.code; end if;
  end if;
  return new;
end $$;
drop trigger if exists promo_redemptions_uses on public.promo_redemptions;
create trigger promo_redemptions_uses after insert or update of status on public.promo_redemptions for each row execute function public.promo_redemption_uses();

-- ───────────────────────────── gift cards (liability: 2204) ─────────────────────────────
create table if not exists public.gift_cards (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  code          text not null,
  initial       bigint not null check (initial > 0),
  balance       bigint not null check (balance >= 0),
  status        text not null default 'active' check (status in ('active','redeemed','void','expired')),
  expires_at    timestamptz,
  purchaser     jsonb,
  recipient     jsonb,
  sold_via      text not null default 'pos' check (sold_via in ('pos','online')),
  sold_by       uuid references public.memberships (id) on delete set null,
  payment_ref   text,
  customer_id   uuid references public.customers (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, code)
);
create unique index if not exists gift_cards_payment_ref_idx on public.gift_cards (restaurant_id, payment_ref) where payment_ref is not null;

create table if not exists public.gift_card_txns (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  gift_card_id  uuid not null references public.gift_cards (id) on delete cascade,
  kind          text not null check (kind in ('issue','redeem','topup','refund','void','expire')),
  amount        bigint not null check (amount >= 0),
  balance_after bigint not null,
  check_id      uuid references public.checks (id) on delete set null,
  payment_id    uuid references public.payments (id) on delete set null,
  actor_id      uuid references public.memberships (id) on delete set null,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ───────────────────────────── campaigns: messages, journeys, referrals ─────────────────────────────
create table if not exists public.campaign_messages (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  campaign_id   uuid not null references public.campaigns (id) on delete cascade,
  variant_id    text not null default 'a',
  customer_id   uuid not null references public.customers (id) on delete cascade,
  phone         text not null,
  text          text not null,
  code          text,
  status        text not null default 'queued' check (status in ('queued','sent','delivered','read','failed')),
  link          text,
  sent_at       timestamptz,
  read_at       timestamptz,
  redeemed_at   timestamptz,
  revenue       bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists campaign_messages_campaign_idx on public.campaign_messages (campaign_id);

create table if not exists public.journeys (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  trigger       text not null check (trigger in ('welcome','birthday','winback','post_visit','referral','second_visit')),
  name          jsonb not null,
  enabled       boolean not null default true,
  channel       text not null default 'whatsapp',
  delay         int not null default 0,
  text          jsonb not null,
  promotion_id  uuid references public.promotions (id) on delete set null,
  stats         jsonb not null default '{}',
  last_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, trigger)
);

create table if not exists public.referrals (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  referrer_id   uuid not null references public.customers (id) on delete cascade,
  referee_id    uuid references public.customers (id) on delete set null,
  code          text not null,
  status        text not null default 'pending' check (status in ('pending','joined','qualified','rewarded','rejected')),
  referee_code  text,
  rewarded_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists referrals_referee_once on public.referrals (restaurant_id, referee_id) where referee_id is not null;

-- ───────────────────────────── own promos: menu banners ─────────────────────────────
create table if not exists public.promo_banners (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  title         jsonb not null,
  body          jsonb not null,
  badge         text not null default '',
  image_url     text,
  color         text not null default '#0d5a53',
  placements    text[] not null default '{}',
  promotion_id  uuid references public.promotions (id) on delete set null,
  item_id       uuid references public.menu_items (id) on delete set null,
  "window"      jsonb,
  modes         text[] not null default '{}',
  active        boolean not null default true,
  sort          int not null default 0,
  stats         jsonb not null default '{"impressions":0,"clicks":0}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ───────────────────────────── reviews: replies on guest_feedback ─────────────────────────────
alter table public.guest_feedback
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists customer_id uuid references public.customers (id) on delete set null,
  add column if not exists waiter_id uuid references public.memberships (id) on delete set null,
  add column if not exists reply text,
  add column if not exists replied_at timestamptz,
  add column if not exists replied_by uuid references public.memberships (id) on delete set null;
create policy guest_feedback_reply on public.guest_feedback for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager}')) with check (public.has_role(restaurant_id, '{owner,admin,manager}'));

-- ───────────────────────────── Sufra marketplace + sponsored placements ─────────────────────────────
create table if not exists public.market_profiles (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null unique references public.restaurants (id) on delete cascade,
  city          text not null,
  area          text not null default '',
  cuisines      text[] not null default '{}',
  price_level   int not null default 2 check (price_level between 1 and 4),
  rating        numeric(2,1) not null default 0,
  listed        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- global (not a tenant table): what Sufra sells
create table if not exists public.ad_slots (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('marketplace_top','cuisine_top','city_top','home_banner')),
  name        jsonb not null,
  description jsonb not null default '{"ar":"","en":""}',
  city        text,
  cuisine     text,
  capacity    int not null default 1 check (capacity > 0),
  pricing     jsonb not null,            -- {model: day|cpm|cpc, rate: units}
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.ad_bookings (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,   -- the advertiser
  slot_id       uuid not null references public.ad_slots (id) on delete restrict,
  starts_on     date not null,
  ends_on       date not null check (ends_on >= starts_on),
  status        text not null default 'requested' check (status in ('requested','pending_payment','approved','live','paused','rejected','cancelled','ended')),
  targeting     jsonb not null default '{"city":null,"cuisine":null}',
  pricing       jsonb not null,
  budget        bigint not null default 0,
  price         bigint not null default 0,
  creative      jsonb not null,
  payment       jsonb not null default '{}',
  stats         jsonb not null default '{"impressions":0,"clicks":0,"orders":0,"revenue":0}',
  daily         jsonb not null default '{}',
  requested_by  uuid references public.memberships (id) on delete set null,
  reviewed_by   uuid references public.memberships (id) on delete set null,
  review_note   text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ad_bookings_slot_idx on public.ad_bookings (slot_id, starts_on, ends_on);

-- ───────────────────────────── triggers + RLS ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['loyalty_programs','loyalty_ledger','promotions','segments','campaigns','coupon_codes','promo_redemptions','gift_cards','gift_card_txns',
                           'campaign_messages','journeys','referrals','promo_banners','market_profiles','ad_slots','ad_bookings','guest_feedback'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- (table, read roles, write roles) — the POS roles that need to write at the till are listed explicitly
do $$
declare r record;
begin
  for r in select * from (values
    ('loyalty_programs',  '{owner,admin,manager,cashier,waiter,accountant}', '{owner,admin,manager}'),
    ('loyalty_ledger',    '{owner,admin,manager,cashier,waiter,accountant}', '{owner,admin,manager,cashier,waiter}'),
    ('promotions',        '{owner,admin,manager,cashier,waiter,accountant}', '{owner,admin,manager}'),
    ('segments',          '{owner,admin,manager,accountant}',                '{owner,admin,manager}'),
    ('campaigns',         '{owner,admin,manager,accountant}',                '{owner,admin,manager}'),
    ('campaign_messages', '{owner,admin,manager,accountant}',                '{owner,admin,manager}'),
    ('journeys',          '{owner,admin,manager,accountant}',                '{owner,admin,manager}'),
    ('coupon_codes',      '{owner,admin,manager,cashier,waiter,accountant}', '{owner,admin,manager,cashier}'),
    ('promo_redemptions', '{owner,admin,manager,cashier,waiter,accountant}', '{owner,admin,manager,cashier,waiter}'),
    ('gift_cards',        '{owner,admin,manager,cashier,accountant}',        '{owner,admin,manager,cashier}'),
    ('gift_card_txns',    '{owner,admin,manager,cashier,accountant}',        '{owner,admin,manager,cashier}'),
    ('referrals',         '{owner,admin,manager,cashier,accountant}',        '{owner,admin,manager,cashier}'),
    ('promo_banners',     null,                                              '{owner,admin,manager}')
  ) as t(tbl, rd, wr)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(restaurant_id) and %s)', r.tbl || '_select', r.tbl,
      case when r.rd is null then 'true' else format('public.has_role(restaurant_id, %L)', r.rd) end);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, %L))', r.tbl || '_insert', r.tbl, r.wr);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, %L)) with check (public.has_role(restaurant_id, %L))', r.tbl || '_update', r.tbl, r.wr, r.wr);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_role(restaurant_id, %L))', r.tbl || '_delete', r.tbl, '{owner,admin}');
  end loop;
end $$;
-- the balance never goes negative and a gift-card row only changes balance/status (column guard)
revoke update on public.gift_cards from authenticated;
grant update (balance, status, updated_at) on public.gift_cards to authenticated;

create policy market_profiles_select on public.market_profiles for select to authenticated using (true);
create policy market_profiles_write on public.market_profiles for all to authenticated
  using (public.has_role(restaurant_id, '{owner,admin}') or public.is_platform_admin()) with check (public.has_role(restaurant_id, '{owner,admin}') or public.is_platform_admin());

create policy ad_slots_select on public.ad_slots for select to authenticated using (true);
create policy ad_slots_write on public.ad_slots for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- a restaurant reads its own bookings and files requests; only Sufra reviews / changes them
create policy ad_bookings_select on public.ad_bookings for select to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager,accountant}') or public.is_platform_admin());
create policy ad_bookings_request on public.ad_bookings for insert to authenticated with check (public.has_role(restaurant_id, '{owner,admin}') and status = 'requested');
create policy ad_bookings_platform on public.ad_bookings for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ───────────────────────────── sponsored feed (anon) ─────────────────────────────
create or replace function public.ad_booking_spend(b ad_bookings) returns bigint language sql immutable as $$
  select case b.pricing->>'model'
    when 'cpm' then least(b.budget, round(coalesce((b.stats->>'impressions')::bigint, 0) * (b.pricing->>'rate')::bigint / 1000.0 / 1000) * 1000)
    when 'cpc' then least(b.budget, coalesce((b.stats->>'clicks')::bigint, 0) * (b.pricing->>'rate')::bigint)
    else (b.pricing->>'rate')::bigint * greatest(0, least(current_date, b.ends_on) - b.starts_on + 1)
  end::bigint;
$$;

-- What the Sufra marketplace (sufra-web, apps) shows as "مُموَّل / Sponsored". Mirrors publicFeed() in src/lib/promo/sponsored.ts.
--   select public.public_sponsored('cairo', null);   → [{bookingId, slot, restaurantId, slug, name, brandColor, headline, imageUrl, city, cuisine, label}]
create or replace function public.public_sponsored(p_city text default null, p_cuisine text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (select nullif(lower(trim(p_city)), '') as city, nullif(lower(trim(p_cuisine)), '') as cuisine),
  live as (
    select b.*, s.type as slot_type, coalesce(b.targeting->>'city', s.city) as b_city, coalesce(b.targeting->>'cuisine', s.cuisine) as b_cuisine, r.slug, r.name as r_name, r.brand_color
    from ad_bookings b join ad_slots s on s.id = b.slot_id and s.active join restaurants r on r.id = b.restaurant_id and r.active, q
    where b.status in ('live','approved') and current_date between b.starts_on and b.ends_on
      and ((b.pricing->>'model') = 'day' or public.ad_booking_spend(b) < b.budget)
      and case s.type
            when 'city_top' then q.city is not null and lower(coalesce(b.targeting->>'city', s.city)) = q.city
            when 'cuisine_top' then q.cuisine is not null and lower(coalesce(b.targeting->>'cuisine', s.cuisine)) = q.cuisine
            else (q.city is null or coalesce(b.targeting->>'city', s.city) is null or lower(coalesce(b.targeting->>'city', s.city)) = q.city)
             and (q.cuisine is null or coalesce(b.targeting->>'cuisine', s.cuisine) is null or lower(coalesce(b.targeting->>'cuisine', s.cuisine)) = q.cuisine)
          end
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'bookingId', id, 'slot', slot_type, 'restaurantId', restaurant_id, 'slug', slug, 'name', r_name, 'brandColor', brand_color,
      'headline', creative->'headline', 'imageUrl', creative->>'imageUrl', 'city', b_city, 'cuisine', b_cuisine, 'label', '{"ar":"مُموَّل","en":"Sponsored"}'::jsonb)
    order by array_position(array['home_banner','marketplace_top','city_top','cuisine_top'], slot_type), md5(id::text || current_date::text)), '[]'::jsonb)
  from live;
$$;

-- impression / click / order beacon from the marketplace (counts per day; no PII)
create or replace function public.public_sponsored_track(p_booking_id uuid, p_event text)
returns void language plpgsql security definer set search_path = public as $$
declare k text := case p_event when 'impression' then 'impressions' when 'click' then 'clicks' when 'order' then 'orders' else null end; d text := current_date::text;
begin
  if k is null then raise exception 'bad_event'; end if;
  update ad_bookings set
    stats = jsonb_set(stats, array[k], to_jsonb(coalesce((stats->>k)::bigint, 0) + 1)),
    daily = jsonb_set(daily, array[d], coalesce(daily->d, '{"impressions":0,"clicks":0,"orders":0}'::jsonb) || jsonb_build_object(k, coalesce((daily->d->>k)::bigint, 0) + 1))
  where id = p_booking_id and status in ('live','approved');
end $$;

-- days in [start, end] where the slot is full for this targeting (restaurants can't read other restaurants' bookings)
create or replace function public.ad_slot_availability(p_slot_id uuid, p_start date, p_end date, p_city text default null, p_cuisine text default null)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d::date::text order by d), '{}')
  from ad_slots s, generate_series(p_start, p_end, interval '1 day') d
  where s.id = p_slot_id and (
    select count(*) from ad_bookings b
    where b.slot_id = s.id and b.status in ('pending_payment','approved','live','paused') and d::date between b.starts_on and b.ends_on
      and (s.type <> 'city_top' or coalesce(b.targeting->>'city', s.city) is not distinct from coalesce(p_city, s.city))
      and (s.type <> 'cuisine_top' or coalesce(b.targeting->>'cuisine', s.cuisine) is not distinct from coalesce(p_cuisine, s.cuisine))
  ) >= s.capacity;
$$;

-- ───────────────────────────── guest (anon) marketing RPCs ─────────────────────────────
-- menu banners + public promotions (hour windows are checked again in the browser)
create or replace function public.guest_promos(p_slug text, p_placement text, p_mode text default 'dine_in')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r restaurants;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'banners', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'body', b.body, 'badge', b.badge, 'imageUrl', b.image_url, 'color', b.color, 'placements', b.placements,
        'promotionId', b.promotion_id, 'itemId', b.item_id, 'window', b."window", 'modes', b.modes, 'active', b.active, 'sort', b.sort, 'stats', b.stats) order by b.sort)
      from promo_banners b where b.restaurant_id = r.id and b.active and p_placement = any (b.placements) and (cardinality(b.modes) = 0 or p_mode = any (b.modes))
        and coalesce((b."window"->>'startsAt')::timestamptz, '-infinity') <= now() and coalesce((b."window"->>'endsAt')::timestamptz, 'infinity') > now()), '[]'),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'type', p.type, 'code', case when p.kind = 'coupon' then p.code end))
      from promotions p where p.restaurant_id = r.id and p.active and (p.kind = 'auto' or p.code is not null)), '[]'),
    'promotions', '[]'::jsonb);
end $$;

create or replace function public.guest_banner_track(p_banner_id uuid, p_event text)
returns void language sql security definer set search_path = public as $$
  update promo_banners set stats = jsonb_set(stats, array[case when p_event = 'click' then 'clicks' else 'impressions' end],
    to_jsonb(coalesce((stats->>(case when p_event = 'click' then 'clicks' else 'impressions' end))::bigint, 0) + 1)) where id = p_banner_id;
$$;

-- coupon check at checkout: the promotions the typed codes + automatic offers involve, the unique codes, the customer's context.
-- The browser prices it with the same pure engine (src/lib/promo/engine.ts); the staff app applies it authoritatively.
create or replace function public.guest_check_coupon(p_slug text, p_codes text[], p_phone text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r restaurants; v_phone text := public.guest_normalize_phone(p_phone); cu customers; codes text[] := array(select upper(regexp_replace(x, '[\s\-_.]', '', 'g')) from unnest(coalesce(p_codes, '{}')) x);
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  if v_phone is not null then select * into cu from customers where restaurant_id = r.id and phone = v_phone; end if;
  return jsonb_build_object(
    'promotions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'kind', p.kind, 'type', p.type, 'code', p.code, 'value', p.value, 'maxDiscount', p.max_discount,
        'minSpend', p.min_spend, 'target', p.target, 'bogo', p.bogo, 'combo', p.combo, 'window', p."window", 'channels', p.channels, 'modes', p.modes, 'firstOrderOnly', p.first_order_only,
        'limits', p.limits, 'stackable', p.stackable, 'priority', p.priority, 'active', p.active, 'segmentIds', p.segment_ids, 'tierIds', p.tier_ids, 'uses', p.uses))
      from promotions p where p.restaurant_id = r.id and p.active and (p.kind = 'auto' or upper(p.code) = any (codes)
        or p.id in (select promotion_id from coupon_codes where restaurant_id = r.id and code = any (codes)))), '[]'),
    'uniqueCodes', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'promotionId', c.promotion_id, 'customerId', c.customer_id, 'usedAt', c.used_at))
      from coupon_codes c where c.restaurant_id = r.id and c.code = any (codes)), '[]'),
    'customer', case when v_phone is null then null when cu.id is null then jsonb_build_object('id', 'new:' || v_phone, 'orders', 0, 'usesByPromo', '{}'::jsonb, 'segmentIds', '[]'::jsonb, 'tierId', null)
      else jsonb_build_object('id', cu.id, 'orders', cu.visits, 'segmentIds', '[]'::jsonb, 'tierId', cu.tier_id,
        'usesByPromo', coalesce((select jsonb_object_agg(promotion_id, n) from (select promotion_id, count(*) n from promo_redemptions where customer_id = cu.id and status = 'redeemed' and promotion_id is not null group by 1) x), '{}'::jsonb)) end);
end $$;

-- after an online/QR order: the codes the guest typed are handed to the staff app, which applies them with the engine
-- (POS → offers dialog shows them) — recorded on the audit log; nothing is discounted server-side without the engine.
create or replace function public.guest_apply_promos(p_slug text, p_order_id uuid, p_codes text[], p_phone text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o orders; r restaurants;
begin
  select * into r from restaurants where slug = p_slug and active;
  select * into o from orders where id = p_order_id and restaurant_id = r.id;
  if not found then raise exception 'not_found'; end if;
  insert into audit_log (restaurant_id, branch_id, actor_id, action, entity, entity_id, data)
  values (r.id, o.branch_id, null, 'guest.promo_codes', 'orders', o.id, jsonb_build_object('codes', coalesce(p_codes, '{}'), 'phone', public.guest_normalize_phone(p_phone)));
end $$;

-- loyalty card (demo sign-in: phone + any past order number; production: WhatsApp OTP — marketing/DESIGN.md)
create or replace function public.guest_loyalty_card(p_slug text, p_phone text, p_order_no text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r restaurants; cu customers; lp loyalty_programs; v_phone text := public.guest_normalize_phone(p_phone); ok boolean; lifetime int; bal int;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  select * into cu from customers where restaurant_id = r.id and phone = v_phone;
  if not found then raise exception 'not_member'; end if;
  select exists (select 1 from orders where customer_id = cu.id and number::text = regexp_replace(coalesce(p_order_no, ''), '\D', '', 'g'))
      or (not exists (select 1 from orders where customer_id = cu.id) and right(v_phone, 4) = regexp_replace(coalesce(p_order_no, ''), '\D', '', 'g')) into ok;
  if not ok then raise exception 'bad_proof'; end if;
  select * into lp from loyalty_programs where restaurant_id = r.id;
  select coalesce(sum(points) filter (where points > 0 and kind <> 'adjust'), 0), coalesce(sum(points), 0) into lifetime, bal from loyalty_ledger where customer_id = cu.id;
  return jsonb_build_object(
    'customer', jsonb_build_object('id', cu.id, 'name', cu.name, 'phone', cu.phone, 'referralCode', cu.referral_code),
    'program', jsonb_build_object('name', coalesce(lp.name, '{"ar":"نادي الولاء","en":"Loyalty club"}'), 'terms', coalesce(lp.terms, '{"ar":"","en":""}'), 'pointValue', coalesce(lp.point_value, 25000),
      'earnPoints', coalesce(lp.earn_points, 1), 'earnSpend', coalesce(lp.earn_spend, 1000000), 'minRedeem', coalesce(lp.min_redeem, 100), 'rewards', coalesce(lp.rewards, '[]'), 'stampCards', coalesce(lp.stamp_cards, '[]'), 'tiers', coalesce(lp.tiers, '[]')),
    'points', bal, 'lifetime', lifetime,
    'tier', (select t from jsonb_array_elements(coalesce(lp.tiers, '[]')) t where (t->>'minPoints')::int <= lifetime order by (t->>'minPoints')::int desc limit 1),
    'next', (select jsonb_build_object('tier', t, 'missing', (t->>'minPoints')::int - lifetime) from jsonb_array_elements(coalesce(lp.tiers, '[]')) t where (t->>'minPoints')::int > lifetime order by (t->>'minPoints')::int limit 1),
    'expiringSoon', null, 'stamps', cu.stamps, 'visits', cu.visits,
    'history', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'kind', kind, 'points', points, 'spend', spend) order by at desc) from (select * from loyalty_ledger where customer_id = cu.id order by at desc limit 12) h), '[]'),
    'codes', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name', p.name, 'usedAt', c.used_at)) from coupon_codes c join promotions p on p.id = c.promotion_id where c.customer_id = cu.id), '[]'));
end $$;

-- online gift card: issued by the payment webhook handler (service role) with payment_ref = intent id; the page polls this
create or replace function public.guest_gift_card_status(p_slug text, p_intent_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(g) - 'sold_by' from gift_cards g join restaurants r on r.id = g.restaurant_id where r.slug = p_slug and g.payment_ref = p_intent_id;
$$;

revoke execute on function public.public_sponsored(text, text), public.public_sponsored_track(uuid, text), public.guest_promos(text, text, text), public.guest_banner_track(uuid, text),
  public.guest_check_coupon(text, text[], text), public.guest_apply_promos(text, uuid, text[], text), public.guest_loyalty_card(text, text, text), public.guest_gift_card_status(text, text),
  public.ad_slot_availability(uuid, date, date, text, text), public.ad_booking_spend(ad_bookings), public.promo_redemption_uses() from public;
grant execute on function public.public_sponsored(text, text), public.public_sponsored_track(uuid, text), public.guest_promos(text, text, text), public.guest_banner_track(uuid, text),
  public.guest_check_coupon(text, text[], text), public.guest_apply_promos(text, uuid, text[], text), public.guest_loyalty_card(text, text, text), public.guest_gift_card_status(text, text) to anon, authenticated;
grant execute on function public.ad_slot_availability(uuid, date, date, text, text), public.ad_booking_spend(ad_bookings) to authenticated;
