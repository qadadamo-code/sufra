-- ═══════════════════════════ 0011 — Accounting, cash & liquidity, expenses, bank reconciliation ═══════════════════════════
-- Browser side: src/modules/accounting (api.ts = postJournal for every module, core.ts = statements), src/modules/reports.
-- Requires 0001 … 0009 (0002 ledger_entries).
--
--   tables   gl_accounts · cost_centres · journal_drafts · accounting_settings · cash_accounts · cash_transfers
--            expenses · recurring_expenses · bank_statement_lines
--   altered  ledger_entries: balance + period-lock trigger (append-only already: no update/delete policy)
--
-- Money columns are bigint units (0.00001 EGP); rates are basis points; dates are business days.
-- Idempotent where Postgres allows it.

-- ───────────────────────────── chart of accounts ─────────────────────────────
create table if not exists public.gl_accounts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  code          text not null check (code ~ '^[0-9]{1,8}$'),
  name          jsonb not null,
  type          text not null check (type in ('asset','liability','equity','revenue','expense')),
  "group"       text not null,
  parent_code   text,
  system        boolean not null default false,
  active        boolean not null default true,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, code)
);

create table if not exists public.cost_centres (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  code          text not null,
  name          jsonb not null,
  branch_id     uuid references public.branches (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (restaurant_id, code)
);

-- ───────────────────────────── settings & period lock ─────────────────────────────
create table if not exists public.accounting_settings (
  id                     uuid primary key default gen_random_uuid(),
  restaurant_id          uuid not null unique references public.restaurants (id) on delete cascade,
  closed_through         date,
  close_history          jsonb not null default '[]',   -- [{through, by, at, note}]
  payroll_day            int not null default 28 check (payroll_day between 1 and 31),
  payroll_estimate       bigint not null default 0,
  vat_due_day            int not null default 31 check (vat_due_day between 1 and 31),
  low_cash_threshold     bigint not null default 5000000000,
  over_short_alert       bigint not null default 20000000,
  journal_approval_limit bigint not null default 500000000,
  default_food_cost_bp   int not null default 3200,
  supplier_terms_days    int not null default 30,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- periods are never reopened
create or replace function public.guard_period_close() returns trigger
language plpgsql as $$
begin
  if old.closed_through is not null and (new.closed_through is null or new.closed_through < old.closed_through) then
    raise exception 'a closed period cannot be reopened' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists accounting_settings_close on public.accounting_settings;
create trigger accounting_settings_close before update on public.accounting_settings for each row execute function public.guard_period_close();

-- every journal entry: balanced, positive one-sided lines, outside the closed period
create or replace function public.guard_ledger_entry() returns trigger
language plpgsql as $$
declare
  l jsonb;
  dr numeric := 0;
  cr numeric := 0;
  locked date;
begin
  if jsonb_typeof(new.lines) <> 'array' or jsonb_array_length(new.lines) < 2 then
    raise exception 'a journal entry needs at least two lines' using errcode = '23514';
  end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    if coalesce((l->>'debit')::numeric, 0) < 0 or coalesce((l->>'credit')::numeric, 0) < 0
       or ((coalesce((l->>'debit')::numeric, 0) = 0) = (coalesce((l->>'credit')::numeric, 0) = 0)) then
      raise exception 'each line is either a positive debit or a positive credit' using errcode = '23514';
    end if;
    dr := dr + coalesce((l->>'debit')::numeric, 0);
    cr := cr + coalesce((l->>'credit')::numeric, 0);
  end loop;
  if dr <> cr then
    raise exception 'journal entry does not balance (% <> %)', dr, cr using errcode = '23514';
  end if;
  select closed_through into locked from public.accounting_settings where restaurant_id = new.restaurant_id;
  if locked is not null and new.date <= locked then
    raise exception 'period closed through %', locked using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists ledger_entries_guard on public.ledger_entries;
create trigger ledger_entries_guard before insert on public.ledger_entries for each row execute function public.guard_ledger_entry();
-- entries are immutable once posted
create or replace function public.guard_ledger_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'journal entries are append-only (post a reversal)' using errcode = '42501';
end $$;
drop trigger if exists ledger_entries_immutable on public.ledger_entries;
create trigger ledger_entries_immutable before update or delete on public.ledger_entries for each row execute function public.guard_ledger_immutable();
create index if not exists ledger_entries_source_idx on public.ledger_entries (restaurant_id, source_type, source_id);

-- inventory / purchasing (chef) and HR may post too
drop policy if exists ledger_entries_insert on public.ledger_entries;
create policy ledger_entries_insert on public.ledger_entries for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier,chef,accountant}'));

-- ───────────────────────────── manual journals (maker / checker) ─────────────────────────────
create table if not exists public.journal_drafts (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  branch_id       uuid references public.branches (id) on delete set null,
  date            date not null,
  memo            text not null default '',
  lines           jsonb not null,
  status          text not null default 'pending' check (status in ('pending','posted','rejected')),
  kind            text not null default 'manual' check (kind in ('manual','reversal')),
  reverses        uuid references public.ledger_entries (id) on delete set null,
  requested_by    uuid references public.memberships (id) on delete set null,
  approved_by     uuid references public.memberships (id) on delete set null,
  decided_at      timestamptz,
  reason          text not null default '',
  ledger_entry_id uuid references public.ledger_entries (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- the person who asked cannot approve their own journal
create or replace function public.guard_journal_draft() returns trigger
language plpgsql as $$
begin
  if new.status <> old.status and new.status = 'posted' and new.approved_by is not distinct from new.requested_by and new.requested_by is not null then
    if not public.has_role(new.restaurant_id, '{owner}') then
      raise exception 'a second person must approve this journal' using errcode = '42501';
    end if;
  end if;
  if old.status <> 'pending' and (to_jsonb(new) - array['updated_at']) is distinct from (to_jsonb(old) - array['updated_at']) then
    raise exception 'decided journals are immutable' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists journal_drafts_guard on public.journal_drafts;
create trigger journal_drafts_guard before update on public.journal_drafts for each row execute function public.guard_journal_draft();

-- ───────────────────────────── treasury ─────────────────────────────
create table if not exists public.cash_accounts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind          text not null check (kind in ('drawer','safe','petty','bank','wallet','provider')),
  name          jsonb not null,
  gl_code       text not null,
  branch_id     uuid references public.branches (id) on delete set null,
  institution   text not null default '',
  last4         text check (last4 is null or last4 ~ '^[0-9]{4}$'),   -- never store full account numbers
  "limit"       bigint,
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.cash_transfers (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  branch_id       uuid references public.branches (id) on delete set null,
  date            date not null,
  from_id         uuid not null references public.cash_accounts (id),
  to_id           uuid not null references public.cash_accounts (id),
  amount          bigint not null check (amount > 0),
  counted         bigint,
  denominations   jsonb,
  status          text not null default 'pending' check (status in ('pending','posted','rejected')),
  requested_by    uuid references public.memberships (id) on delete set null,
  approved_by     uuid references public.memberships (id) on delete set null,
  reference       text not null default '',
  note            text not null default '',
  ledger_entry_id uuid references public.ledger_entries (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (from_id <> to_id)
);

-- ───────────────────────────── expenses ─────────────────────────────
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  branch_id       uuid references public.branches (id) on delete set null,
  date            date not null,
  category        text not null,
  gl_code         text not null,
  vendor          text not null default '',
  description     text not null default '',
  invoice_no      text not null default '',
  net             bigint not null check (net >= 0),
  vat             bigint not null default 0 check (vat >= 0),
  total           bigint not null check (total = net + vat),
  paid_from_id    uuid references public.cash_accounts (id),
  due_date        date,
  status          text not null default 'pending' check (status in ('pending','posted','rejected')),
  receipt_photo   text,                                    -- storage path (cloud) / small data URL (local demo)
  recurring_id    uuid,
  created_by      uuid references public.memberships (id) on delete set null,
  approved_by     uuid references public.memberships (id) on delete set null,
  ledger_entry_id uuid references public.ledger_entries (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists expenses_date_idx on public.expenses (restaurant_id, date);

create table if not exists public.recurring_expenses (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  branch_id       uuid references public.branches (id) on delete set null,
  category        text not null,
  gl_code         text not null,
  vendor          text not null default '',
  description     text not null default '',
  net             bigint not null check (net >= 0),
  vat             bigint not null default 0,
  day_of_month    int not null check (day_of_month between 1 and 31),
  paid_from_id    uuid references public.cash_accounts (id),
  active          boolean not null default true,
  last_raised_for text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ───────────────────────────── bank reconciliation ─────────────────────────────
create table if not exists public.bank_statement_lines (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  cash_account_id  uuid not null references public.cash_accounts (id) on delete cascade,
  date             date not null,
  description      text not null default '',
  reference        text not null default '',
  amount           bigint not null,                      -- + in, − out
  balance          bigint,
  batch_id         text not null default '',
  status           text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  match_kind       text check (match_kind in ('auto','manual','created')),
  matched_entry_id uuid references public.ledger_entries (id) on delete set null,
  matched_by       uuid references public.memberships (id) on delete set null,
  matched_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists bank_lines_account_idx on public.bank_statement_lines (restaurant_id, cash_account_id, date);
-- an imported statement line is evidence: only its match fields change
create or replace function public.guard_bank_line() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['status','match_kind','matched_entry_id','matched_by','matched_at','updated_at'])
     is distinct from (to_jsonb(old) - array['status','match_kind','matched_entry_id','matched_by','matched_at','updated_at']) then
    raise exception 'bank statement lines are immutable (re-import instead)' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists bank_lines_immutable on public.bank_statement_lines;
create trigger bank_lines_immutable before update on public.bank_statement_lines for each row execute function public.guard_bank_line();

-- ───────────────────────────── triggers + RLS ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['gl_accounts','cost_centres','journal_drafts','accounting_settings','cash_accounts','cash_transfers','expenses','recurring_expenses','bank_statement_lines'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
  end loop;
  -- books: owner / admin / accountant read & write
  foreach t in array array['gl_accounts','cost_centres','journal_drafts','accounting_settings','bank_statement_lines','recurring_expenses'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_role(restaurant_id, ''{owner,admin,accountant,manager}''))', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_role(restaurant_id, ''{owner,admin,accountant}'')) with check (public.has_role(restaurant_id, ''{owner,admin,accountant}''))', t || '_write', t);
  end loop;
  -- money handling: managers record transfers & expenses (approval is a separate status change), cashiers read the safe
  foreach t in array array['cash_accounts','cash_transfers','expenses'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_role(restaurant_id, ''{owner,admin,accountant,manager,cashier}''))', t || '_select', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_role(restaurant_id, ''{owner,admin,accountant,manager}'')) with check (public.has_role(restaurant_id, ''{owner,admin,accountant,manager}''))', t || '_write', t);
  end loop;
end $$;

-- deleting rows that carry money is not allowed once posted
create or replace function public.guard_posted_delete() returns trigger
language plpgsql as $$
begin
  if old.status = 'posted' then
    raise exception 'posted rows cannot be deleted (reverse the journal)' using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists expenses_no_delete on public.expenses;
create trigger expenses_no_delete before delete on public.expenses for each row execute function public.guard_posted_delete();
drop trigger if exists cash_transfers_no_delete on public.cash_transfers;
create trigger cash_transfers_no_delete before delete on public.cash_transfers for each row execute function public.guard_posted_delete();

alter table public.ledger_entries replica identity full;
alter table public.cash_transfers replica identity full;
alter table public.expenses replica identity full;
alter table public.bank_statement_lines replica identity full;
do $$
begin
  begin
    alter publication supabase_realtime add table public.ledger_entries, public.cash_transfers, public.expenses, public.bank_statement_lines, public.journal_drafts;
  exception when others then null;   -- already added / publication missing on plain Postgres
  end;
end $$;
