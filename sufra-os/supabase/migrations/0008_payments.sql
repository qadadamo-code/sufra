-- ═══════════════════════════ 0008 — online payments (Wave 2) ═══════════════════════════
-- Gateways (Paymob, Kashier — Egypt; Moyasar — KSA), pay-by-link, refunds, settlements, settings → payments.
-- Server side: /api/pay-intent · /api/pay-webhook-{paymob,kashier,moyasar} · /api/pay-callback · /api/pay-refund · /api/pay-status
-- (Vercel functions with the SERVICE ROLE key). Browser side: src/modules/payments + src/modules/guest/pay.
--
-- Requires 0005_guest (payment_accounts, payment_intents, guest_record_payment).
--
--   alters     payment_accounts (more providers) · payment_intents (kinds, method, fee, refunds, check-less intents)
--              settings.payments
--   tables     payment_refunds · payment_payouts
--   anon RPCs  guest_pay_config · guest_payment_status (re-created with kind/note/restaurant)
--   staff RPC  pay_my_membership
--   server     guest_record_payment (re-created: check-less kinds) · pay_account_config (Vault secrets; service_role only)
--
-- Money columns are bigint units (0.00001 of the currency) like everywhere else. No secret is ever stored in a table:
-- payment_accounts.vault_secret_id points at a Vault secret whose value is a JSON object of env-style names, e.g.
--   select vault.create_secret('{"PAYMOB_SECRET_KEY":"…","PAYMOB_HMAC":"…"}', 'pay:<restaurant id>:paymob');

-- ───────────────────────────── providers ─────────────────────────────
alter table public.payment_accounts drop constraint if exists payment_accounts_provider_check;
alter table public.payment_accounts add constraint payment_accounts_provider_check
  check (provider in ('paymob','kashier','moyasar','fawry','geidea','hyperpay','tap'));

alter table public.payment_intents drop constraint if exists payment_intents_provider_check;
alter table public.payment_intents add constraint payment_intents_provider_check
  check (provider in ('demo','paymob','kashier','moyasar','fawry','geidea','hyperpay','tap'));

-- ───────────────────────────── intents ─────────────────────────────
-- gift cards / wallet top-ups / deposits have no check (CRM & reservations own them; purpose_ref points at their row)
alter table public.payment_intents alter column check_id drop not null;
alter table public.payment_intents alter column branch_id drop not null;
alter table public.payment_intents
  add column if not exists kind              text not null default 'guest',
  add column if not exists mode              text not null default 'test',
  add column if not exists method            text,
  add column if not exists fee               bigint check (fee is null or fee >= 0),
  add column if not exists refunded          bigint not null default 0 check (refunded >= 0),
  add column if not exists provider_order_id text,
  add column if not exists purpose_ref       text,
  add column if not exists note              text not null default '',
  add column if not exists customer          jsonb,
  add column if not exists created_by        uuid references public.memberships (id) on delete set null,
  add column if not exists payout_id         uuid;
alter table public.payment_intents drop constraint if exists payment_intents_kind_check;
alter table public.payment_intents add constraint payment_intents_kind_check
  check (kind in ('guest','link','online_order','gift_card','wallet_topup','deposit'));
alter table public.payment_intents drop constraint if exists payment_intents_mode_check;
alter table public.payment_intents add constraint payment_intents_mode_check check (mode in ('test','live'));
alter table public.payment_intents drop constraint if exists payment_intents_method_check;
alter table public.payment_intents add constraint payment_intents_method_check
  check (method is null or method in ('card','wallet','kiosk','applepay','mada','stcpay','meeza','valu'));
alter table public.payment_intents drop constraint if exists payment_intents_check_required;
alter table public.payment_intents add constraint payment_intents_check_required
  check (check_id is not null or kind in ('gift_card','wallet_topup','deposit'));
alter table public.payment_intents drop constraint if exists payment_intents_refund_le_charge;
alter table public.payment_intents add constraint payment_intents_refund_le_charge check (refunded <= amount + tip);
create index if not exists payment_intents_day_idx on public.payment_intents (restaurant_id, created_at desc);
create index if not exists payment_intents_provider_order_idx on public.payment_intents (provider, provider_order_id) where provider_order_id is not null;

-- ───────────────────────────── refunds ─────────────────────────────
create table if not exists public.payment_refunds (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  intent_id     text not null references public.payment_intents (id) on delete restrict,
  payment_id    uuid references public.payments (id) on delete set null,
  amount        bigint not null check (amount > 0),
  reason        text not null default '',
  status        text not null default 'pending' check (status in ('pending','succeeded','failed')),
  provider_ref  text,
  error         text,
  requested_by  uuid references public.memberships (id) on delete set null,
  approved_by   uuid references public.memberships (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists payment_refunds_intent_idx on public.payment_refunds (intent_id);
alter table public.payment_refunds enable row level security;
create policy payment_refunds_select on public.payment_refunds for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,accountant}'));
create trigger payment_refunds_updated before update on public.payment_refunds for each row execute function public.set_updated_at();
-- written by /api/pay-refund (service role) only

-- ───────────────────────────── payouts (settlements) ─────────────────────────────
create table if not exists public.payment_payouts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  provider      text not null,
  period_start  date not null,
  period_end    date not null,
  gross         bigint not null default 0,
  fees          bigint not null default 0,
  net           bigint not null default 0,
  reference     text not null default '',
  paid_at       timestamptz,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end >= period_start)
);
alter table public.payment_payouts enable row level security;
create policy payment_payouts_select on public.payment_payouts for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,accountant}'));
create policy payment_payouts_write on public.payment_payouts for all to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,accountant}')) with check (public.has_role(restaurant_id, '{owner,admin,accountant}'));
create trigger payment_payouts_updated before update on public.payment_payouts for each row execute function public.set_updated_at();
alter table public.payment_intents drop constraint if exists payment_intents_payout_fk;
alter table public.payment_intents add constraint payment_intents_payout_fk foreign key (payout_id) references public.payment_payouts (id) on delete set null;

-- the accountant ties intents to a payout: only payout_id may change from the client
create or replace function public.pay_assign_payout(p_payout_id uuid, p_intent_ids text[])
returns int language plpgsql security definer set search_path = public as $$
declare rid uuid; n int;
begin
  select restaurant_id into rid from payment_payouts where id = p_payout_id;
  if rid is null or not public.has_role(rid, '{owner,admin,accountant}') then raise exception 'forbidden'; end if;
  update payment_intents set payout_id = p_payout_id where restaurant_id = rid and id = any (p_intent_ids) and status = 'succeeded';
  get diagnostics n = row_count;
  return n;
end $$;

-- ───────────────────────────── settings ─────────────────────────────
-- {"country":"EG","provider":"paymob","mode":"test","methods":["card","wallet"],"absorbFees":true,"surchargeBp":0,
--  "linkExpiryMin":60,"feeBp":275,"feeFixed":300000,"payoutDays":2}   — never secrets
alter table public.settings add column if not exists payments jsonb;

-- ═══════════════════════════ RPCs ═══════════════════════════

-- public: what the guest page may offer (no secrets, no keys)
create or replace function public.guest_pay_config(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'provider', coalesce(s.payments->>'provider', null), 'mode', coalesce(s.payments->>'mode', 'test'),
    'methods', coalesce(s.payments->'methods', '["card","wallet"]'::jsonb), 'absorbFees', coalesce((s.payments->>'absorbFees')::boolean, true),
    'surchargeBp', coalesce((s.payments->>'surchargeBp')::int, 0), 'currency', coalesce(s.locale->>'currency', 'EGP'))
  from restaurants r join settings s on s.restaurant_id = r.id where r.slug = p_slug;
$$;

create or replace function public.guest_payment_status(p_intent_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pi.id, 'provider', pi.provider, 'kind', pi.kind, 'status',
                              case when pi.status = 'requires_action' and pi.expires_at < now() then 'expired' else pi.status end,
                            'charge', pi.amount + pi.tip + coalesce((pi.request->>'surcharge')::bigint, 0), 'amount', pi.amount, 'tip', pi.tip,
                            'currency', pi.currency, 'method', pi.method,
                            'redirectUrl', case when pi.status = 'requires_action' and pi.expires_at >= now() then pi.redirect_url end,
                            'reference', pi.provider_ref, 'failureReason', pi.failure_reason, 'note', pi.note, 'checkId', pi.check_id,
                            'createdAt', pi.created_at, 'expiresAt', pi.expires_at, 'request', pi.request,
                            'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug))
  from payment_intents pi join restaurants r on r.id = pi.restaurant_id where pi.id = p_intent_id;
$$;

create or replace function public.pay_my_membership(p_restaurant_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select m.id from memberships m where m.restaurant_id = p_restaurant_id and m.user_id = auth.uid() and m.active limit 1;
$$;

-- Called by the payment functions AFTER verifying the provider signature (or a server-side status lookup). Idempotent:
-- the intent row is locked and a final status is never changed again, so a webhook retried 5× records one payment.
create or replace function public.guest_record_payment(p_intent_id text, p_status text, p_provider_ref text default null, p_failure text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pi payment_intents; pay_id uuid; t dining_tables;
begin
  select * into pi from payment_intents where id = p_intent_id for update;
  if not found then raise exception 'not_found'; end if;
  if pi.status in ('succeeded','failed','cancelled','expired') then return jsonb_build_object('status', pi.status, 'paymentId', pi.payment_id, 'duplicate', true); end if;
  if p_status not in ('processing','succeeded','failed','cancelled','expired') then raise exception 'bad_status'; end if;
  if p_status = 'succeeded' and pi.check_id is not null then
    insert into payments (restaurant_id, branch_id, check_id, method, amount, tip, reference, split_label, status)
    values (pi.restaurant_id, pi.branch_id, pi.check_id, 'online', pi.amount, pi.tip, pi.id, pi.split_label, 'captured')
    returning id into pay_id;
    update checks set paid = paid + pi.amount where id = pi.check_id;
    select dt.* into t from dining_tables dt join checks c on dt.id = c.table_ids[1] where c.id = pi.check_id;
    if t.id is not null then
      insert into service_calls (restaurant_id, branch_id, table_id, type, text, source)
      values (pi.restaurant_id, t.branch_id, t.id, 'bill', left(format('✓ دفع أونلاين %s · %s', round(pi.amount / 100000.0, 2), coalesce(pi.split_label, '')), 200), 'qr');
    end if;
  end if;
  update payment_intents set status = p_status, provider_ref = coalesce(p_provider_ref, provider_ref), failure_reason = p_failure, payment_id = coalesce(pay_id, payment_id),
    redirect_url = case when p_status = 'processing' then redirect_url else null end
  where id = pi.id;
  return jsonb_build_object('status', p_status, 'paymentId', pay_id, 'duplicate', false);
end $$;

-- Per-tenant merchant config: public_config + the Vault secret (JSON of env-style names). Service role only.
create or replace function public.pay_account_config(p_restaurant_id uuid, p_provider text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a payment_accounts; sec text;
begin
  select * into a from payment_accounts where restaurant_id = p_restaurant_id and provider = p_provider and active;
  if not found then return null; end if;
  if a.vault_secret_id is not null then
    begin
      execute 'select decrypted_secret from vault.decrypted_secrets where id = $1' into sec using a.vault_secret_id;
    exception when others then sec := null;  -- Vault not installed (local Postgres tests)
    end;
  end if;
  return jsonb_build_object('mode', a.mode, 'public_config', a.public_config, 'secrets', coalesce(sec::jsonb, '{}'::jsonb));
end $$;

-- ═══════════════════════════ grants ═══════════════════════════
revoke all on public.payment_refunds, public.payment_payouts from anon;
revoke execute on function public.guest_record_payment(text, text, text, text), public.pay_account_config(uuid, text) from public, anon, authenticated;
grant execute on function public.guest_record_payment(text, text, text, text), public.pay_account_config(uuid, text) to service_role;
grant execute on function public.guest_pay_config(text), public.guest_payment_status(text) to anon, authenticated;
grant execute on function public.pay_my_membership(uuid), public.pay_assign_payout(uuid, text[]) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.payment_refunds, public.payment_payouts;
  end if;
end $$;
alter table public.payment_refunds replica identity full;
alter table public.payment_payouts replica identity full;
