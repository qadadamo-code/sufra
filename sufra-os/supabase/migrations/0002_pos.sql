-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 · POS: shifts & drawer, receipts (+ ETA e-receipts), ledger, small column additions
--
--  - shifts           a cashier's till session per POS device (opening float, blind count, Z report snapshot)
--  - cash_movements   paid-in / paid-out / no-sale opens, with reason and approver
--  - receipts         every issued sale (SC) / return (RC) document, continuous `seq` per device, with the exact
--                     ETA JSON + uuid + previous uuid chain + submission status. Append-only for clients.
--  - ledger_entries   journal entries posted by sufra-finance rules (postSale / postReturn / postCashMove / postDrawerCount)
--  - orders.pickup_at, checks.discount_reason, checks.split_from, settings.eta
--
-- ETA client id / secret are NOT stored here: they live in the server function's environment (see README → ETA).
-- Idempotent where Postgres allows it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.orders   add column if not exists pickup_at timestamptz;
alter table public.checks   add column if not exists discount_reason text;
alter table public.checks   add column if not exists split_from uuid references public.checks (id) on delete set null;
alter table public.settings add column if not exists eta jsonb not null default
  '{"enabled":true,"environment":"preprod","posSerial":"","tradeName":"","branchAddress":{"governate":"","regionCity":"","street":"","buildingNumber":"","postalCode":""},"splitTender":"dominant","itemCodePrefix":"","credentialsConfigured":false}';

create table if not exists public.shifts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  device         text not null,
  opened_by      uuid references public.memberships (id) on delete set null,
  closed_by      uuid references public.memberships (id) on delete set null,
  status         text not null default 'open' check (status in ('open','closed')),
  opening_float  bigint not null default 0,
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz,
  counted_cash   bigint,
  expected_cash  bigint,
  difference     bigint,
  z_number       int,
  z_report       jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- one open shift per device
create unique index if not exists shifts_one_open_idx on public.shifts (restaurant_id, branch_id, device) where status = 'open';
create unique index if not exists shifts_z_idx on public.shifts (restaurant_id, branch_id, device, z_number) where z_number is not null;

create table if not exists public.cash_movements (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid not null references public.branches (id) on delete cascade,
  shift_id       uuid not null references public.shifts (id) on delete cascade,
  kind           text not null check (kind in ('in','out','no_sale')),
  amount         bigint not null default 0 check (amount >= 0),
  reason         text not null check (length(trim(reason)) > 0),
  actor_id       uuid references public.memberships (id) on delete set null,
  approved_by    uuid references public.memberships (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists cash_movements_shift_idx on public.cash_movements (shift_id);

create table if not exists public.receipts (
  id                   uuid primary key default gen_random_uuid(),
  restaurant_id        uuid not null references public.restaurants (id) on delete cascade,
  branch_id            uuid not null references public.branches (id) on delete cascade,
  check_id             uuid not null references public.checks (id) on delete restrict,
  shift_id             uuid references public.shifts (id) on delete set null,
  device               text not null,
  kind                 text not null check (kind in ('SC','RC')),
  seq                  int not null,
  receipt_no           text not null,
  issued_at            timestamptz not null,
  issued_by            uuid references public.memberships (id) on delete set null,
  bill                 jsonb not null,
  payments             jsonb not null default '[]',
  refund_of            uuid references public.receipts (id) on delete restrict,
  eta_uuid             text,
  eta_previous_uuid    text,
  eta_json             text,
  eta_qr               text,
  eta_status           text not null default 'pending' check (eta_status in ('not_required','pending','submitted','valid','invalid','late')),
  eta_submission_uuid  text,
  eta_errors           text[] not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (restaurant_id, branch_id, device, seq)
);
create index if not exists receipts_check_idx on public.receipts (check_id);
create index if not exists receipts_eta_idx on public.receipts (restaurant_id, eta_status, issued_at);

create table if not exists public.ledger_entries (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid references public.branches (id) on delete set null,
  date           date not null,
  source_type    text not null,
  source_id      text not null,
  memo           text not null default '',
  lines          jsonb not null,           -- [{account, debit, credit, dims}] in units; balanced (validated by sufra-finance)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ledger_entries_date_idx on public.ledger_entries (restaurant_id, date);

do $$
declare t text;
begin
  foreach t in array array['shifts','cash_movements','receipts','ledger_entries'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Receipts are legal documents: once issued only the ETA submission fields may change.
create or replace function public.guard_receipt_update() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['eta_status','eta_submission_uuid','eta_errors','updated_at'])
     is distinct from (to_jsonb(old) - array['eta_status','eta_submission_uuid','eta_errors','updated_at']) then
    raise exception 'issued receipts are immutable (issue a return instead)' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists receipts_immutable on public.receipts;
create trigger receipts_immutable before update on public.receipts for each row execute function public.guard_receipt_update();

-- ── RLS (same shape as 0001's generic policies; all four are branch-scoped) ──
drop policy if exists shifts_select on public.shifts;
drop policy if exists shifts_insert on public.shifts;
drop policy if exists shifts_update on public.shifts;
create policy shifts_select on public.shifts for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier,accountant}') and public.in_branch(restaurant_id, branch_id));
create policy shifts_insert on public.shifts for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') and public.in_branch(restaurant_id, branch_id));
create policy shifts_update on public.shifts for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}')) with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));

drop policy if exists cash_movements_select on public.cash_movements;
drop policy if exists cash_movements_insert on public.cash_movements;
create policy cash_movements_select on public.cash_movements for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier,accountant}') and public.in_branch(restaurant_id, branch_id));
create policy cash_movements_insert on public.cash_movements for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') and public.in_branch(restaurant_id, branch_id));
-- no update/delete: corrections are new movements

drop policy if exists receipts_select on public.receipts;
drop policy if exists receipts_insert on public.receipts;
drop policy if exists receipts_update on public.receipts;
create policy receipts_select on public.receipts for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier,waiter,accountant}') and public.in_branch(restaurant_id, branch_id));
create policy receipts_insert on public.receipts for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') and public.in_branch(restaurant_id, branch_id));
create policy receipts_update on public.receipts for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier}')) with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}'));

drop policy if exists ledger_entries_select on public.ledger_entries;
drop policy if exists ledger_entries_insert on public.ledger_entries;
create policy ledger_entries_select on public.ledger_entries for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,accountant}'));
create policy ledger_entries_insert on public.ledger_entries for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier,accountant}'));
-- append-only: reversals are new entries

-- ── realtime ──
alter table public.shifts replica identity full;
alter table public.receipts replica identity full;
alter table public.cash_movements replica identity full;
do $$ begin
  begin
    alter publication supabase_realtime add table public.shifts, public.receipts, public.cash_movements;
  exception when duplicate_object then null;
  end;
end $$;
