-- ═══════════════════════════ 0010 — HR: staff files, rota, attendance, leave, advances, payroll ═══════════════════════════
-- Browser side: src/modules/hr (rules in lib/, ops.ts, /me, /timeclock) and src/modules/staff (manager screens).
-- Server side: /api/attendance-push (ZKTeco ADMS, service role) writes attendance_punches idempotently by external_id.
-- Requires 0001 … 0009.
--
--   tables   staff_profiles · shift_templates · rota_shifts · shift_swaps · attendance_devices · attendance_punches
--            leave_requests · leave_balances · staff_advances · payroll_adjustments · payroll_runs · payslips
--   altered  staff_compensation (+pay type, allowances, insurance, pools, payout) · settings (+hr jsonb)
--
-- Who sees what (RLS):
--   managers (owner/admin/manager) run HR; the accountant reads attendance and runs payroll;
--   salary data (staff_compensation, payroll_*) stays owner/admin/accountant (0001 policy on staff_compensation is unchanged);
--   every member reads and creates their OWN rows (punches, leave, advances, swaps) and reads their own approved/paid payslips.
-- Money columns are bigint units (0.00001 EGP); dates are business days (date); shift times are 'HH:MM' text (may cross midnight).

-- ───────────────────────────── helpers ─────────────────────────────
-- membership ids of the signed-in user in a restaurant (self-service policies)
create or replace function public.my_membership_ids(rid uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.id from memberships m where m.restaurant_id = rid and m.user_id = auth.uid() and m.active;
$$;
grant execute on function public.my_membership_ids(uuid) to authenticated;

-- ───────────────────────────── altered tables ─────────────────────────────
alter table public.staff_compensation
  add column if not exists salary_type    text not null default 'monthly' check (salary_type in ('monthly','daily','hourly')),
  add column if not exists daily_rate     bigint,
  add column if not exists allowances     jsonb not null default '{"housing":0,"transport":0,"meal":0,"other":0}',
  add column if not exists insurable_wage bigint,                       -- declared أجر الاشتراك; null = fixed pay clamped to the year's bounds
  add column if not exists insured        boolean not null default true,
  add column if not exists gosi_scheme    text not null default 'legacy' check (gosi_scheme in ('legacy','new')),
  add column if not exists service_points numeric(5,2) not null default 0,
  add column if not exists tips_eligible  boolean not null default false,
  add column if not exists pay_method     text not null default 'cash' check (pay_method in ('cash','bank','wallet','instapay')),
  add column if not exists bank_name      text,
  add column if not exists iban           text,
  add column if not exists wallet_number  text;

alter table public.settings add column if not exists hr jsonb;   -- HrSettings (src/modules/hr/lib/settings.ts)

-- ───────────────────────────── staff file ─────────────────────────────
create table if not exists public.staff_profiles (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  membership_id      uuid not null unique references public.memberships (id) on delete cascade,
  photo_url          text,
  national_id        text,
  nationality        text not null default 'EG',
  birth_date         date,
  hire_date          date not null default current_date,
  contract_type      text not null default 'permanent' check (contract_type in ('permanent','fixed_term','part_time','probation','daily')),
  contract_end       date,
  position           jsonb not null default '{"ar":"","en":""}',
  station            text,
  food_handler       boolean not null default false,
  emergency_contact  jsonb,
  address            text,
  documents          jsonb not null default '[]',                   -- [{id,kind,number,issuedAt,expiresAt,fileUrl,note}]
  device_user_id     text,                                          -- ZKTeco enrolment number
  weekly_off         int[] not null default '{5}',
  terminated_at      date,
  termination_reason text,
  notes              text not null default '',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (restaurant_id, device_user_id)
);

-- ───────────────────────────── rota ─────────────────────────────
create table if not exists public.shift_templates (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid references public.branches (id) on delete cascade,
  name          jsonb not null,
  start         text not null check (start ~ '^\d{2}:\d{2}$'),
  "end"         text not null check ("end" ~ '^\d{2}:\d{2}$'),
  break_min     int not null default 30 check (break_min >= 0),
  station       text,
  color         text not null default '#0d5a53',
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.rota_shifts (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  membership_id uuid references public.memberships (id) on delete cascade,   -- null = open shift
  date          date not null,
  start         text not null check (start ~ '^\d{2}:\d{2}$'),
  "end"         text not null check ("end" ~ '^\d{2}:\d{2}$'),
  break_min     int not null default 30 check (break_min >= 0),
  station       text,
  template_id   uuid references public.shift_templates (id) on delete set null,
  published     boolean not null default false,
  published_at  timestamptz,
  note          text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists rota_shifts_day_idx on public.rota_shifts (restaurant_id, branch_id, date);
create index if not exists rota_shifts_member_idx on public.rota_shifts (membership_id, date);

create table if not exists public.shift_swaps (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  shift_id      uuid not null references public.rota_shifts (id) on delete cascade,
  from_id       uuid not null references public.memberships (id) on delete cascade,
  to_id         uuid references public.memberships (id) on delete cascade,
  reason        text not null default '',
  status        text not null default 'pending' check (status in ('pending','accepted','approved','rejected','cancelled')),
  decided_by    uuid references public.memberships (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ───────────────────────────── attendance ─────────────────────────────
create table if not exists public.attendance_devices (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  branch_id     uuid not null references public.branches (id) on delete cascade,
  name          text not null,
  serial        text not null unique,                              -- the SN= a terminal sends (global: the push endpoint looks it up)
  model         text not null default 'ZKTeco',
  secret_hash   text not null,                                     -- sha256 hex of the shared secret (shown once)
  timezone      text not null default 'Africa/Cairo',
  active        boolean not null default true,
  allowed_ips   text[] not null default '{}',
  last_seen_at  timestamptz,
  last_stamp    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.attendance_punches (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  branch_id      uuid references public.branches (id) on delete set null,
  membership_id  uuid references public.memberships (id) on delete cascade,  -- null: device user not linked yet
  at             timestamptz not null,
  kind           text not null check (kind in ('in','out','break_start','break_end')),
  source         text not null check (source in ('pin','selfie','mobile','device','csv','manual')),
  lat            double precision,
  lng            double precision,
  accuracy_m     int,
  distance_m     int,
  photo_url      text,
  device_sn      text,
  device_user_id text,
  external_id    text,
  voided         boolean not null default false,
  corrected_by   uuid references public.memberships (id) on delete set null,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint attendance_punches_external_uniq unique (restaurant_id, external_id)   -- idempotent device / CSV imports
);
create index if not exists attendance_punches_member_idx on public.attendance_punches (membership_id, at);
create index if not exists attendance_punches_day_idx on public.attendance_punches (restaurant_id, at);

-- punches are evidence: only the correction columns change, and nobody deletes them (void instead)
create or replace function public.attendance_punch_guard() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - array['voided','corrected_by','note','membership_id','updated_at']) is distinct from
     (to_jsonb(old) - array['voided','corrected_by','note','membership_id','updated_at']) then
    raise exception 'punches are immutable — void and add a correction' using errcode = '42501';
  end if;
  if old.membership_id is not null and new.membership_id is distinct from old.membership_id then
    raise exception 'a linked punch cannot move to someone else' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists attendance_punches_guard on public.attendance_punches;
create trigger attendance_punches_guard before update on public.attendance_punches for each row execute function public.attendance_punch_guard();

-- ───────────────────────────── leave ─────────────────────────────
create table if not exists public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  type          text not null check (type in ('annual','casual','sick','unpaid','hajj','maternity','other')),
  "from"        date not null,
  "to"          date not null,
  days          numeric(5,1) not null check (days > 0),
  reason        text not null default '',
  status        text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by    uuid references public.memberships (id) on delete set null,
  decided_at    timestamptz,
  decision_note text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ("to" >= "from")
);
create index if not exists leave_requests_member_idx on public.leave_requests (membership_id, "from");

create table if not exists public.leave_balances (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  year          int not null,
  type          text not null,
  carried       numeric(5,1) not null default 0,
  adjustment    numeric(5,1) not null default 0,
  entitlement   numeric(5,1),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (membership_id, year, type)
);

-- ───────────────────────────── advances ─────────────────────────────
create table if not exists public.staff_advances (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  membership_id    uuid not null references public.memberships (id) on delete cascade,
  branch_id        uuid references public.branches (id) on delete set null,
  kind             text not null default 'advance' check (kind in ('advance','loan')),
  amount           bigint not null check (amount > 0),
  installments     int not null default 1 check (installments between 1 and 60),
  start_period     text not null check (start_period ~ '^\d{4}-\d{2}$'),
  reason           text not null default '',
  status           text not null default 'requested' check (status in ('requested','approved','rejected','paid','settled')),
  requested_at     timestamptz not null default now(),
  approved_by      uuid references public.memberships (id) on delete set null,
  approved_at      timestamptz,
  paid_via         text check (paid_via in ('cash','bank','wallet')),
  paid_at          timestamptz,
  paid_by          uuid references public.memberships (id) on delete set null,
  cash_movement_id uuid references public.cash_movements (id) on delete set null,
  recovered        bigint not null default 0 check (recovered >= 0 and recovered <= amount),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ───────────────────────────── payroll ─────────────────────────────
create table if not exists public.payroll_adjustments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  membership_id uuid not null references public.memberships (id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-\d{2}$'),
  kind          text not null check (kind in ('bonus','penalty','deduction','allowance')),
  amount        bigint not null check (amount > 0),
  reason        text not null default '',
  created_by    uuid references public.memberships (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.payroll_runs (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  branch_id        uuid references public.branches (id) on delete set null,   -- null = all branches
  period           text not null check (period ~ '^\d{4}-\d{2}$'),
  country          text not null default 'EG' check (country in ('EG','SA')),
  status           text not null default 'draft' check (status in ('draft','approved','paid')),
  totals           jsonb not null default '{}',
  created_by       uuid references public.memberships (id) on delete set null,
  approved_by      uuid references public.memberships (id) on delete set null,
  approved_at      timestamptz,
  paid_at          timestamptz,
  paid_by          uuid references public.memberships (id) on delete set null,
  ledger_entry_ids uuid[] not null default '{}',
  snapshot         jsonb not null default '{}',
  note             text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists payroll_runs_period_idx on public.payroll_runs (restaurant_id, period, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.payslips (
  id                 uuid primary key default gen_random_uuid(),
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  run_id             uuid not null references public.payroll_runs (id) on delete cascade,
  membership_id      uuid not null references public.memberships (id) on delete cascade,
  branch_id          uuid references public.branches (id) on delete set null,
  period             text not null,
  name               text not null,
  position           text not null default '',
  earnings           jsonb not null default '[]',
  deductions         jsonb not null default '[]',
  employer           jsonb not null default '[]',
  gross              bigint not null default 0,
  total_deductions   bigint not null default 0,
  net                bigint not null default 0,
  insurable_wage     bigint not null default 0,
  employee_insurance bigint not null default 0,
  employer_insurance bigint not null default 0,
  income_tax         bigint not null default 0,
  advance_recovered  bigint not null default 0,
  worked_days        int not null default 0,
  absent_days        int not null default 0,
  late_minutes       int not null default 0,
  overtime_minutes   int not null default 0,
  pay_method         text not null default 'cash',
  status             text not null default 'draft' check (status in ('draft','approved','paid')),
  paid_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (run_id, membership_id),
  check (net = gross - total_deductions)
);

-- an approved run is locked: its payslips only move to paid
create or replace function public.payslip_lock() returns trigger
language plpgsql as $$
declare st text;
begin
  select status into st from payroll_runs where id = coalesce(new.run_id, old.run_id);
  if st is distinct from 'draft' then
    if tg_op = 'DELETE' then raise exception 'payroll run is locked' using errcode = '42501'; end if;
    if (to_jsonb(new) - array['status','paid_at','pay_method','updated_at']) is distinct from (to_jsonb(old) - array['status','paid_at','pay_method','updated_at']) then
      raise exception 'payroll run is locked — only status / paid_at / pay_method may change' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists payslips_lock on public.payslips;
create trigger payslips_lock before update or delete on public.payslips for each row execute function public.payslip_lock();

-- leave: a member may only cancel their own pending request; decisions are for managers
create or replace function public.leave_request_guard() returns trigger
language plpgsql as $$
begin
  if auth.uid() is null or public.has_role(new.restaurant_id, '{owner,admin,manager}') then return new; end if;
  if old.status = 'pending' and new.status = 'cancelled' and (to_jsonb(new) - array['status','updated_at']) = (to_jsonb(old) - array['status','updated_at']) then return new; end if;
  raise exception 'only a manager decides leave' using errcode = '42501';
end $$;
drop trigger if exists leave_requests_guard on public.leave_requests;
create trigger leave_requests_guard before update on public.leave_requests for each row execute function public.leave_request_guard();

-- ───────────────────────────── triggers + RLS ─────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['staff_profiles','shift_templates','rota_shifts','shift_swaps','attendance_devices','attendance_punches','leave_requests',
                           'leave_balances','staff_advances','payroll_adjustments','payroll_runs','payslips'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- managers' tables: (table, read roles or null = any member, write roles)
do $$
declare r record;
begin
  for r in select * from (values
    ('shift_templates',     null,                                    '{owner,admin,manager}'),
    ('attendance_devices',  '{owner,admin,manager}',                 '{owner,admin,manager}'),
    ('payroll_adjustments', '{owner,admin,accountant}',              '{owner,admin,accountant}'),
    ('payroll_runs',        '{owner,admin,accountant}',              '{owner,admin,accountant}')
  ) as t(tbl, rd, wr)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(restaurant_id) and %s)', r.tbl || '_select', r.tbl,
      case when r.rd is null then 'true' else format('public.has_role(restaurant_id, %L)', r.rd) end);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, %L))', r.tbl || '_insert', r.tbl, r.wr);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, %L)) with check (public.has_role(restaurant_id, %L))', r.tbl || '_update', r.tbl, r.wr, r.wr);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_role(restaurant_id, %L))', r.tbl || '_delete', r.tbl, '{owner,admin}');
  end loop;
end $$;

-- self-service tables: managers (+ the accountant reading) see all; everyone sees and files their own
do $$
declare r record;
begin
  for r in select * from (values
    -- table,              owner column,     readers (all rows),                   writers (all rows)
    ('staff_profiles',     'membership_id',  '{owner,admin,manager,accountant}',   '{owner,admin,manager}'),
    ('attendance_punches', 'membership_id',  '{owner,admin,manager,accountant}',   '{owner,admin,manager}'),
    ('leave_requests',     'membership_id',  '{owner,admin,manager,accountant}',   '{owner,admin,manager}'),
    ('leave_balances',     'membership_id',  '{owner,admin,manager,accountant}',   '{owner,admin,manager}'),
    ('staff_advances',     'membership_id',  '{owner,admin,manager,accountant}',   '{owner,admin,manager,accountant}'),
    ('shift_swaps',        'from_id',        '{owner,admin,manager}',              '{owner,admin,manager}')
  ) as t(tbl, col, rd, wr)
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_member(restaurant_id) and (public.has_role(restaurant_id, %L) or %I in (select public.my_membership_ids(restaurant_id))))',
      r.tbl || '_select', r.tbl, r.rd, r.col);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_role(restaurant_id, %L) or %I in (select public.my_membership_ids(restaurant_id)))',
      r.tbl || '_insert', r.tbl, r.wr, r.col);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_role(restaurant_id, %L)) with check (public.has_role(restaurant_id, %L))',
      r.tbl || '_update', r.tbl, r.wr, r.wr);
  end loop;
end $$;
-- own pending leave can be cancelled by the member (the guard trigger allows nothing else)
create policy leave_requests_cancel_own on public.leave_requests for update to authenticated
  using (membership_id in (select public.my_membership_ids(restaurant_id)) and status = 'pending')
  with check (membership_id in (select public.my_membership_ids(restaurant_id)));
-- a member may only file requests, never approve them: self-inserted rows start pending / requested
create or replace function public.self_request_guard() returns trigger
language plpgsql as $$
declare j jsonb := to_jsonb(new);
begin
  if auth.uid() is null or public.has_role(new.restaurant_id, '{owner,admin,manager}') then return new; end if;
  if tg_table_name in ('leave_requests', 'shift_swaps') and j->>'status' <> 'pending' then raise exception 'new requests start pending' using errcode = '42501'; end if;
  if tg_table_name = 'staff_advances' and (j->>'status' <> 'requested' or (j->>'recovered')::bigint <> 0) and not public.has_role(new.restaurant_id, '{accountant}') then
    raise exception 'new requests start requested' using errcode = '42501';
  end if;
  if tg_table_name = 'attendance_punches' and (j->>'source' not in ('pin','selfie','mobile') or (j->>'voided')::boolean or j->>'corrected_by' is not null) then
    raise exception 'members punch for themselves only' using errcode = '42501';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['leave_requests','staff_advances','shift_swaps','attendance_punches'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_self_guard', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.self_request_guard()', t || '_self_guard', t);
  end loop;
end $$;
-- the colleague named in a swap sees it too
create policy shift_swaps_select_to on public.shift_swaps for select to authenticated using (to_id in (select public.my_membership_ids(restaurant_id)));

-- rota: managers see drafts; everyone sees what is published
create policy rota_shifts_select on public.rota_shifts for select to authenticated
  using (public.is_member(restaurant_id) and (published or public.has_role(restaurant_id, '{owner,admin,manager,accountant}')));
create policy rota_shifts_insert on public.rota_shifts for insert to authenticated with check (public.has_role(restaurant_id, '{owner,admin,manager}'));
create policy rota_shifts_update on public.rota_shifts for update to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager}')) with check (public.has_role(restaurant_id, '{owner,admin,manager}'));
create policy rota_shifts_delete on public.rota_shifts for delete to authenticated using (public.has_role(restaurant_id, '{owner,admin,manager}'));

-- payslips: payroll roles see all; staff see their own once approved
create policy payslips_select on public.payslips for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,accountant}') or (status in ('approved','paid') and membership_id in (select public.my_membership_ids(restaurant_id))));
create policy payslips_insert on public.payslips for insert to authenticated with check (public.has_role(restaurant_id, '{owner,admin,accountant}'));
create policy payslips_update on public.payslips for update to authenticated using (public.has_role(restaurant_id, '{owner,admin,accountant}')) with check (public.has_role(restaurant_id, '{owner,admin,accountant}'));
create policy payslips_delete on public.payslips for delete to authenticated using (public.has_role(restaurant_id, '{owner,admin,accountant}'));

-- attendance_devices.secret_hash is sha256 of a 96-bit random secret (shown once); readable by managers only via RLS above

grant select, insert, update, delete on public.staff_profiles, public.shift_templates, public.rota_shifts, public.shift_swaps, public.attendance_devices,
  public.attendance_punches, public.leave_requests, public.leave_balances, public.staff_advances, public.payroll_adjustments, public.payroll_runs, public.payslips to authenticated;

-- realtime (who's in now, leave/advance requests)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.attendance_punches, public.rota_shifts, public.leave_requests, public.staff_advances, public.shift_swaps;
  end if;
exception when duplicate_object then null; end $$;
