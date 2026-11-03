-- ═══════════════════════════ 0007 — WhatsApp & customer messaging ═══════════════════════════
-- Shared inbox, message log with delivery statuses + cost estimate, consent (opt-in / opt-out), per-tenant
-- WhatsApp Business accounts (token in Supabase Vault), webhook ingest, cross-instance rate limit.
-- Browser side: src/modules/messaging + src/lib/notify. Server side: api/whatsapp-send.ts, api/whatsapp-webhook.ts.
--
-- Requires 0001_init. Independent of 0002–0006/0008.
--
--   tables       wa_conversations · wa_messages · messaging_consents · whatsapp_accounts
--                whatsapp_webhook_events (raw, service role only) · messaging_rate_counters (service role only)
--   columns      settings.messaging (jsonb, null = defaults in src/lib/notify/settings.ts)
--   anon RPC     guest_messaging_consent(slug, phone, name, source, granted, wording)
--   server RPCs  messaging_wa_credentials · messaging_ingest_webhook · messaging_rate_take   (service_role only)
--
-- Top-level columns are snake_case (the app maps camelCase ⇄ snake_case); jsonb contents stay camelCase.

alter table public.settings add column if not exists messaging jsonb;

-- E.164 for Egyptian / Saudi mobiles (and +/00-prefixed international numbers); null when not a mobile.
create or replace function public.messaging_e164(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^01[0125][0-9]{8}$'      then '+2' || d
    when d ~ '^201[0125][0-9]{8}$'     then '+' || d
    when d ~ '^05[0-9]{8}$'            then '+966' || substr(d, 2)
    when d ~ '^9665[0-9]{8}$'          then '+' || d
    when intl and d ~ '^[1-9][0-9]{7,14}$' then '+' || d
    else null end
  from (
    select regexp_replace(case when s like '00%' then substr(s, 3) else s end, '[^0-9]', '', 'g') as d, (s like '+%' or s like '00%') as intl
    from (select btrim(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789')) as s) a
  ) x
$$;

-- +201005551201 → 01005551201 (how customers.phone is stored)
create or replace function public.messaging_national(p text)
returns text language sql immutable as $$
  select case when p ~ '^\+201[0-9]{9}$' then '0' || substr(p, 4) when p ~ '^\+9665[0-9]{8}$' then '0' || substr(p, 5) else p end
$$;

-- ───────────────────────────── per-tenant WhatsApp Business account ─────────────────────────────
-- Filled by the onboarding server (Embedded Signup) with the service role. The access token is a Vault secret.
create table if not exists public.whatsapp_accounts (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null unique references public.restaurants (id) on delete cascade,
  provider         text not null default 'cloud' check (provider in ('cloud','360dialog','unifonic','infobip','twilio')),
  waba_id          text,
  phone_number_id  text unique,
  display_phone    text,
  display_name     text,
  quality_rating   text,
  token_secret_id  uuid,                     -- vault.secrets.id — never readable by app users
  status           text not null default 'pending' check (status in ('pending','connected','disconnected','banned')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.whatsapp_accounts enable row level security;
create policy whatsapp_accounts_select on public.whatsapp_accounts for select to authenticated using (public.has_role(restaurant_id, '{owner,admin}'));
create trigger whatsapp_accounts_updated before update on public.whatsapp_accounts for each row execute function public.set_updated_at();

-- ───────────────────────────── conversations ─────────────────────────────
create table if not exists public.wa_conversations (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  phone              text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  name               text not null default '',
  customer_id        uuid references public.customers (id) on delete set null,
  status             text not null default 'open' check (status in ('open','closed')),
  assigned_to        uuid references public.memberships (id) on delete set null,
  unread             int not null default 0 check (unread >= 0),
  last_message_at    timestamptz,
  last_inbound_at    timestamptz,                -- opens the 24h customer-service window
  last_preview       text not null default '',
  last_auto_reply_at timestamptz,
  tags               text[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (restaurant_id, phone)
);
create index if not exists wa_conversations_recent on public.wa_conversations (restaurant_id, last_message_at desc);

-- ───────────────────────────── messages (the log) ─────────────────────────────
create table if not exists public.wa_messages (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  conversation_id uuid not null references public.wa_conversations (id) on delete cascade,
  direction       text not null check (direction in ('in','out')),
  channel         text not null check (channel in ('whatsapp','click_to_chat','sms','log')),
  kind            text not null default 'text' check (kind in ('text','template','media','interactive','system')),
  template        text,
  lang            text not null default 'ar' check (lang in ('ar','en')),
  category        text check (category in ('utility','marketing','authentication','service')),
  body            text not null default '',
  params          jsonb not null default '{}',
  media           jsonb,
  status          text not null check (status in ('scheduled','queued','pending_tap','opened','sent','delivered','read','failed','received','skipped')),
  provider_id     text unique,                   -- wamid…
  error           text,
  sent_by         uuid references public.memberships (id) on delete set null,
  send_at         timestamptz,
  sent_at         timestamptz,
  delivered_at    timestamptz,
  read_at         timestamptz,
  order_id        uuid references public.orders (id) on delete set null,
  dedupe_key      text,
  cost_micros     bigint not null default 0,      -- estimated Meta charge, micro-USD
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (restaurant_id, dedupe_key)
);
create index if not exists wa_messages_conv on public.wa_messages (conversation_id, created_at);
create index if not exists wa_messages_due on public.wa_messages (restaurant_id, send_at) where status = 'scheduled';

-- ───────────────────────────── consent ─────────────────────────────
-- Current state per phone/channel + its history (proof of consent: wording, source, time).
create table if not exists public.messaging_consents (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  phone         text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  customer_id   uuid references public.customers (id) on delete set null,
  channel       text not null default 'whatsapp' check (channel in ('whatsapp','sms')),
  status        text not null check (status in ('opted_in','opted_out')),
  source        text not null check (source in ('online_checkout','qr_loyalty','reservation','staff','inbound_keyword','import')),
  wording       text not null default '',
  captured_at   timestamptz not null default now(),
  captured_by   uuid references public.memberships (id) on delete set null,
  history       jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, phone, channel)
);

-- ───────────────────────────── server-only tables ─────────────────────────────
create table if not exists public.whatsapp_webhook_events (
  id              bigserial primary key,
  received_at     timestamptz not null default now(),
  restaurant_id   uuid references public.restaurants (id) on delete cascade,
  phone_number_id text,
  events          jsonb not null                 -- parsed events (keep 30 days: delete where received_at < now() - interval '30 days')
);
create table if not exists public.messaging_rate_counters (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  window_start  timestamptz not null,
  count         int not null default 0,
  primary key (restaurant_id, window_start)
);

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.wa_conversations enable row level security;
alter table public.wa_messages enable row level security;
alter table public.messaging_consents enable row level security;
alter table public.whatsapp_webhook_events enable row level security;
alter table public.messaging_rate_counters enable row level security;

-- the inbox: owner / admin / manager / cashier (same as the app's "messages.use")
create policy wa_conversations_rw on public.wa_conversations for all to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}')) with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
create policy wa_messages_select on public.wa_messages for select to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
create policy wa_messages_insert on public.wa_messages for insert to authenticated with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
create policy wa_messages_update on public.wa_messages for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}')) with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
create policy messaging_consents_select on public.messaging_consents for select to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
create policy messaging_consents_insert on public.messaging_consents for insert to authenticated with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
create policy messaging_consents_update on public.messaging_consents for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}')) with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));
-- no delete policy on consents: the history is the proof (PDPL 151/2020, KSA PDPL)

create trigger wa_conversations_updated before update on public.wa_conversations for each row execute function public.set_updated_at();
create trigger wa_messages_updated before update on public.wa_messages for each row execute function public.set_updated_at();
create trigger messaging_consents_updated before update on public.messaging_consents for each row execute function public.set_updated_at();

-- ═══════════════════════════ anon RPC ═══════════════════════════
-- Guest checkout / QR "join the club" records consent. Opt-in only for a phone the restaurant already knows
-- (the order / loyalty RPC just created the customer) — an anonymous caller can't subscribe strangers.
create or replace function public.guest_messaging_consent(p_slug text, p_phone text, p_name text default '', p_source text default 'online_checkout', p_granted boolean default true, p_wording text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r restaurants; v_phone text; cu customers; cur messaging_consents; v_status text;
begin
  select * into r from restaurants where slug = p_slug and active;
  if not found then raise exception 'not_found'; end if;
  if p_source not in ('online_checkout','qr_loyalty','reservation') then raise exception 'bad_source'; end if;
  v_phone := public.messaging_e164(p_phone);
  if v_phone is null then raise exception 'bad_phone'; end if;
  select * into cu from customers where restaurant_id = r.id and phone in (public.messaging_national(v_phone), v_phone) limit 1;
  v_status := case when p_granted then 'opted_in' else 'opted_out' end;
  if p_granted and cu.id is null then raise exception 'unknown_customer'; end if;
  select * into cur from messaging_consents where restaurant_id = r.id and phone = v_phone and channel = 'whatsapp';
  if cur.id is not null and cur.status = v_status then return jsonb_build_object('status', v_status); end if;
  insert into messaging_consents (restaurant_id, phone, customer_id, channel, status, source, wording, history)
  values (r.id, v_phone, cu.id, 'whatsapp', v_status, p_source, left(coalesce(p_wording, ''), 300),
          jsonb_build_array(jsonb_build_object('status', v_status, 'source', p_source, 'at', now())))
  on conflict (restaurant_id, phone, channel) do update
    set status = excluded.status, source = excluded.source, wording = excluded.wording, captured_at = now(), captured_by = null,
        customer_id = coalesce(messaging_consents.customer_id, excluded.customer_id),
        history = messaging_consents.history || excluded.history;
  return jsonb_build_object('status', v_status);
end $$;

-- ═══════════════════════════ server RPCs (service_role) ═══════════════════════════

-- Per-tenant sender + decrypted token from Vault. plpgsql: resolved at call time, so the migration also loads
-- on a Postgres without the vault extension (tests); there it simply returns nothing.
create or replace function public.messaging_wa_credentials(p_restaurant_id uuid)
returns table (phone_number_id text, token text, provider text) language plpgsql stable security definer set search_path = public as $$
begin
  return query
    select a.phone_number_id, s.decrypted_secret::text, a.provider
    from whatsapp_accounts a join vault.decrypted_secrets s on s.id = a.token_secret_id
    where a.restaurant_id = p_restaurant_id and a.status = 'connected' and a.phone_number_id is not null;
exception when undefined_table or invalid_schema_name then
  return;
end $$;

-- Fixed-window counter across serverless instances. true = allowed.
create or replace function public.messaging_rate_take(p_restaurant_id uuid, p_limit int, p_window_sec int)
returns boolean language plpgsql security definer set search_path = public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec); n int;
begin
  insert into messaging_rate_counters (restaurant_id, window_start, count) values (p_restaurant_id, w, 1)
  on conflict (restaurant_id, window_start) do update set count = messaging_rate_counters.count + 1
  returning count into n;
  delete from messaging_rate_counters where restaurant_id = p_restaurant_id and window_start < w - make_interval(secs => p_window_sec * 2);
  return n <= p_limit;
end $$;

-- Applies parsed webhook events (src/lib/notify/core.ts parseWebhook → camelCase JSON). Idempotent on provider ids.
-- Mirrors MessagingService.ingest(): inbound → conversation (24h window, unread), STOP/START → consent + reply,
-- closed hours → one auto-reply per 12h (Cloud API / BSP mode only); statuses → sent/delivered/read/failed.
-- Returns { stored, replies: [{ restaurant_id, to, text, message_id }] } for the function to send.
create or replace function public.messaging_ingest_webhook(p_events jsonb, p_default_restaurant uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e jsonb; rid uuid; conv wa_conversations; r restaurants; s settings; b branches; msg_id uuid;
  replies jsonb := '[]'; stored int := 0; v_from text; v_text text; m jsonb; bh jsonb; hours jsonb;
  t time; o time; c time; inside boolean; rank_new int; rank_old int; old_status text; reply text;
begin
  for e in select * from jsonb_array_elements(coalesce(p_events, '[]')) loop
    select a.restaurant_id into rid from whatsapp_accounts a where a.phone_number_id = e->>'phoneNumberId';
    rid := coalesce(rid, p_default_restaurant);
    if rid is null then continue; end if;

    if e->>'kind' = 'status' then
      select status into old_status from wa_messages where provider_id = e->>'id' and restaurant_id = rid;
      if old_status is null then continue; end if;
      rank_new := case e->>'status' when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end;
      rank_old := case old_status when 'sent' then 1 when 'opened' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 4 else 0 end;
      if e->>'status' <> 'failed' and rank_new <= rank_old then continue; end if;
      update wa_messages set
        status = e->>'status',
        sent_at = case when e->>'status' = 'sent' then coalesce(sent_at, (e->>'at')::timestamptz) else sent_at end,
        delivered_at = case when e->>'status' in ('delivered','read') then coalesce(delivered_at, (e->>'at')::timestamptz) else delivered_at end,
        read_at = case when e->>'status' = 'read' then (e->>'at')::timestamptz else read_at end,
        error = case when e->>'status' = 'failed' then left(coalesce(e->>'errorCode', '') || ' ' || coalesce(e->>'errorTitle', 'failed'), 500) else error end
      where provider_id = e->>'id' and restaurant_id = rid;
      stored := stored + 1;
      continue;
    end if;

    if e->>'kind' <> 'message' then continue; end if;
    if exists (select 1 from wa_messages where provider_id = e->>'id') then continue; end if;   -- Meta retry
    v_from := public.messaging_e164(e->>'from');
    if v_from is null then continue; end if;
    v_text := coalesce(nullif(e->>'text', ''), '[' || coalesce(e->>'type', 'message') || ']');

    insert into wa_conversations (restaurant_id, phone, name, customer_id)
    values (rid, v_from, coalesce(nullif(e->>'name', ''), v_from),
            (select id from customers where restaurant_id = rid and phone in (public.messaging_national(v_from), v_from) limit 1))
    on conflict (restaurant_id, phone) do nothing;
    select * into conv from wa_conversations where restaurant_id = rid and phone = v_from;

    insert into wa_messages (restaurant_id, conversation_id, direction, channel, kind, lang, body, status, provider_id, sent_at, created_at,
                             media)
    values (rid, conv.id, 'in', 'whatsapp',
            case when e->>'type' = 'text' then 'text' when e->>'type' in ('button','interactive') then 'interactive' else 'media' end,
            case when v_text ~ '[؀-ۿ]' then 'ar' else 'en' end, v_text, 'received', e->>'id', (e->>'at')::timestamptz, (e->>'at')::timestamptz,
            case when e->>'mediaId' is not null then jsonb_build_object('kind', e->>'type', 'mediaId', e->>'mediaId', 'mimeType', e->>'mimeType') end);
    update wa_conversations set unread = unread + 1, last_inbound_at = (e->>'at')::timestamptz, last_message_at = (e->>'at')::timestamptz,
           last_preview = left(v_text, 120), status = 'open',
           name = case when name = phone and coalesce(e->>'name', '') <> '' then e->>'name' else name end
    where id = conv.id;
    stored := stored + 1;

    reply := null;
    if (e->>'optOut')::boolean or (e->>'optIn')::boolean then
      insert into messaging_consents (restaurant_id, phone, customer_id, channel, status, source, wording, history)
      values (rid, v_from, conv.customer_id, 'whatsapp', case when (e->>'optOut')::boolean then 'opted_out' else 'opted_in' end, 'inbound_keyword', left(v_text, 300),
              jsonb_build_array(jsonb_build_object('status', case when (e->>'optOut')::boolean then 'opted_out' else 'opted_in' end, 'source', 'inbound_keyword', 'at', now())))
      on conflict (restaurant_id, phone, channel) do update
        set status = excluded.status, source = excluded.source, wording = excluded.wording, captured_at = now(), history = messaging_consents.history || excluded.history;
      reply := case when (e->>'optOut')::boolean
        then E'تم إلغاء اشتراكك في رسايلنا ✅ ابعت «اشتراك» لو حبيت ترجع.\nYou''re unsubscribed. Reply START to opt back in.'
        else E'أهلاً بيك تاني 💚 هتوصلك رسايلنا من جديد.\nWelcome back — you''re subscribed again.' end;
    else
      select * into s from settings where restaurant_id = rid;
      m := coalesce(s.messaging, '{}'::jsonb);
      bh := coalesce(m->'businessHours', '{}'::jsonb);
      if coalesce(m->>'mode', 'click_to_chat') in ('cloud','bsp') and coalesce((bh->>'enabled')::boolean, true)
         and (conv.last_auto_reply_at is null or conv.last_auto_reply_at < now() - interval '12 hours') then
        select * into r from restaurants where id = rid;
        select * into b from branches where restaurant_id = rid order by is_default desc, created_at limit 1;
        hours := case when coalesce((bh->>'useBranchHours')::boolean, true) and b.opening_hours is not null then b.opening_hours
                      else jsonb_build_object('open', coalesce(bh->>'open', '12:00'), 'close', coalesce(bh->>'close', '01:00')) end;
        t := (now() at time zone coalesce(r.timezone, 'Africa/Cairo'))::time;
        o := (hours->>'open')::time;
        c := (hours->>'close')::time;
        inside := case when o = c then true when o < c then t >= o and t < c else t >= o or t < c end;
        if not inside then
          reply := coalesce(bh->'reply'->>(case when v_text ~ '[؀-ۿ]' then 'ar' else 'en' end),
                            'أهلاً بيك 👋 إحنا قافلين دلوقتي وهنرد عليك أول ما نفتح.');
          update wa_conversations set last_auto_reply_at = now() where id = conv.id;
        end if;
      end if;
    end if;

    if reply is not null then
      insert into wa_messages (restaurant_id, conversation_id, direction, channel, kind, lang, category, body, status)
      values (rid, conv.id, 'out', 'whatsapp', 'system', 'ar', 'service', reply, 'queued') returning id into msg_id;
      replies := replies || jsonb_build_object('restaurant_id', rid, 'to', v_from, 'text', reply, 'message_id', msg_id);
    end if;
  end loop;

  if jsonb_array_length(coalesce(p_events, '[]')) > 0 then
    insert into whatsapp_webhook_events (restaurant_id, phone_number_id, events)
    values (coalesce(rid, p_default_restaurant), p_events->0->>'phoneNumberId', p_events);
  end if;
  return jsonb_build_object('stored', stored, 'replies', replies);
end $$;

-- ═══════════════════════════ grants ═══════════════════════════
revoke all on public.wa_conversations, public.wa_messages, public.messaging_consents, public.whatsapp_accounts,
              public.whatsapp_webhook_events, public.messaging_rate_counters from anon;
revoke all on public.whatsapp_webhook_events, public.messaging_rate_counters from authenticated;
revoke insert, update, delete on public.whatsapp_accounts from authenticated;
revoke select on public.whatsapp_accounts from authenticated;
grant select (id, restaurant_id, provider, waba_id, phone_number_id, display_phone, display_name, quality_rating, status, created_at, updated_at)
  on public.whatsapp_accounts to authenticated;   -- token_secret_id stays hidden
revoke execute on function public.messaging_wa_credentials(uuid), public.messaging_rate_take(uuid, int, int),
                           public.messaging_ingest_webhook(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.messaging_wa_credentials(uuid), public.messaging_rate_take(uuid, int, int),
                          public.messaging_ingest_webhook(jsonb, uuid) to service_role;
grant execute on function public.guest_messaging_consent(text, text, text, text, boolean, text), public.messaging_e164(text), public.messaging_national(text)
  to anon, authenticated;

-- live inbox
alter table public.wa_conversations replica identity full;
alter table public.wa_messages replica identity full;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.wa_conversations, public.wa_messages;
  end if;
exception when duplicate_object then null;
end $$;
