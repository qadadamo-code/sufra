-- ═══════════════════════════ 0014 — Saudi ZATCA (FATOORA) Phase 2 e-invoicing (Wave 3) ═══════════════════════════
-- Browser side: src/lib/zatca (UBL 2.1 builder, C14N, hash chain, QR, demo signing) + src/modules/settings/zatca + /pos/zatca.
-- Server side: /api/zatca-onboard · /api/zatca-report · /api/zatca-clear (SERVICE ROLE; keys + CSID secrets in Vault).
--
--   alters   settings.zatca (seller + mode, never secrets) · checks.tax_buyer (B2B buyer → standard invoice)
--   tables   zatca_egs_units (one per POS device: chain owner, CSR, CSID metadata) · zatca_invoices (every document)
--   guards   ICV/PIH chain enforced on insert · issued documents immutable except submission fields
--   server   zatca_egs_secret / zatca_store_egs_secret (Vault; service_role only)
--
-- Secrets: the EGS private key (SEC1 PEM) and the CSID secret/binarySecurityToken are ONE Vault secret per unit named
-- 'zatca:egs:<unit id>' whose value is JSON {"privateKeyPem": "…", "compliance": {"token","secret"}, "production": {…}}.

alter table public.settings add column if not exists zatca jsonb;
alter table public.checks add column if not exists tax_buyer jsonb;

-- ───────────────────────────── EGS units ─────────────────────────────
create table if not exists public.zatca_egs_units (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  branch_id        uuid not null references public.branches (id) on delete cascade,
  device           text not null,
  name             text not null,
  serial           text not null,
  invoice_types    text not null default '1100' check (invoice_types ~ '^[01]{4}$'),
  key_custody      text not null default 'server' check (key_custody in ('server','demo_browser')),
  environment      text not null default 'sandbox' check (environment in ('sandbox','simulation','production')),
  public_key       text,
  csr_pem          text,
  status           text not null default 'new' check (status in ('new','compliance','checks_passed','production','expired','revoked')),
  compliance       jsonb,   -- {certificate, requestId, issuedAt, expiresAt, serial} — public data only
  production       jsonb,
  demo_certificate text,    -- DEMO self-signed certificate (not a CSID)
  checks           jsonb not null default '{}',
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (restaurant_id, branch_id, device)
);

-- ───────────────────────────── documents ─────────────────────────────
create table if not exists public.zatca_invoices (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants (id) on delete cascade,
  branch_id        uuid not null references public.branches (id) on delete cascade,
  egs_id           uuid not null references public.zatca_egs_units (id) on delete restrict,
  device           text not null,
  receipt_id       uuid references public.receipts (id) on delete restrict,
  check_id         uuid references public.checks (id) on delete set null,
  kind             text not null check (kind in ('simplified','standard')),
  doc_type         text not null check (doc_type in ('invoice','credit','debit')),
  invoice_no       text not null,
  uuid             uuid not null unique,
  icv              bigint not null check (icv >= 1),
  pih              text not null,
  hash             text not null,
  issued_at        timestamptz not null,
  xml              text not null,
  qr               text not null,
  total            bigint not null,
  vat              bigint not null,
  status           text not null check (status in ('pending','unsigned','reported','cleared','warning','rejected','demo')),
  warnings         text[] not null default '{}',
  errors           text[] not null default '{}',
  attempts         int not null default 0,
  last_attempt_at  timestamptz,
  next_attempt_at  timestamptz,
  submitted_at     timestamptz,
  cleared_xml      text,
  ref_invoice_no   text,
  signed_by        text check (signed_by in ('demo_browser','server')),
  environment      text not null default 'sandbox',
  buyer            jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (egs_id, icv)
);
create index if not exists zatca_invoices_queue_idx on public.zatca_invoices (restaurant_id, status, issued_at) where status in ('pending','unsigned','warning','rejected');
create index if not exists zatca_invoices_receipt_idx on public.zatca_invoices (receipt_id);

do $$
declare t text;
begin
  foreach t in array array['zatca_egs_units','zatca_invoices'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ICV/PIH chain (KSA-16 / KSA-13): the first document of a unit carries the base64(hex(sha256('0'))) PIH; every next
-- one is ICV+1 and points at the previous document's hash. Offline outbox replays in order, so this holds.
create or replace function public.zatca_guard_chain() returns trigger
language plpgsql as $$
declare prev public.zatca_invoices;
begin
  if new.icv = 1 then
    if new.pih <> 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==' then
      raise exception 'ZATCA chain: first document of an EGS unit must carry the initial PIH' using errcode = '23514';
    end if;
    return new;
  end if;
  select * into prev from public.zatca_invoices where egs_id = new.egs_id and icv = new.icv - 1;
  if not found then raise exception 'ZATCA chain: ICV % has no predecessor', new.icv using errcode = '23514'; end if;
  if prev.hash <> new.pih then raise exception 'ZATCA chain: PIH does not match the hash of ICV %', prev.icv using errcode = '23514'; end if;
  return new;
end $$;
drop trigger if exists zatca_invoices_chain on public.zatca_invoices;
create trigger zatca_invoices_chain before insert on public.zatca_invoices for each row execute function public.zatca_guard_chain();

-- Issued documents are legal records: only submission fields change; xml/qr/signed_by only when the server stamps an
-- unsigned document (the hash — and so the chain — stays the same).
create or replace function public.zatca_guard_update() returns trigger
language plpgsql as $$
declare keep text[] := array['status','warnings','errors','attempts','last_attempt_at','next_attempt_at','submitted_at','cleared_xml','updated_at'];
begin
  if old.signed_by is null and new.signed_by = 'server' and new.hash = old.hash then
    keep := keep || array['xml','qr','signed_by'];
  end if;
  if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception 'issued ZATCA documents are immutable (issue a credit/debit note instead)' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists zatca_invoices_immutable on public.zatca_invoices;
create trigger zatca_invoices_immutable before update on public.zatca_invoices for each row execute function public.zatca_guard_update();

-- ── RLS ──
drop policy if exists zatca_egs_select on public.zatca_egs_units;
drop policy if exists zatca_egs_insert on public.zatca_egs_units;
drop policy if exists zatca_egs_update on public.zatca_egs_units;
create policy zatca_egs_select on public.zatca_egs_units for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier,accountant}') and public.in_branch(restaurant_id, branch_id));
-- the POS registers its own unit on first sale; owners/admins run the onboarding wizard
create policy zatca_egs_insert on public.zatca_egs_units for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') and public.in_branch(restaurant_id, branch_id));
create policy zatca_egs_update on public.zatca_egs_units for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin}')) with check (public.has_role(restaurant_id, '{owner,admin}'));

drop policy if exists zatca_invoices_select on public.zatca_invoices;
drop policy if exists zatca_invoices_insert on public.zatca_invoices;
create policy zatca_invoices_select on public.zatca_invoices for select to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier,accountant}') and public.in_branch(restaurant_id, branch_id));
create policy zatca_invoices_insert on public.zatca_invoices for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier}') and public.in_branch(restaurant_id, branch_id)
              and status in ('pending','unsigned','demo') and attempts = 0);
-- no update/delete for staff: status changes come from the server functions (service role)

-- ───────────────────────────── Vault (service role only) ─────────────────────────────
create or replace function public.zatca_egs_secret(p_egs uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sec text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into sec using 'zatca:egs:' || p_egs::text;
  exception when others then sec := null;  -- Vault not installed (local Postgres tests)
  end;
  return coalesce(sec::jsonb, '{}'::jsonb);
end $$;

create or replace function public.zatca_store_egs_secret(p_egs uuid, p_secret jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  execute 'select id from vault.secrets where name = $1' into sid using 'zatca:egs:' || p_egs::text;
  if sid is null then
    execute 'select vault.create_secret($1, $2, $3)' using p_secret::text, 'zatca:egs:' || p_egs::text, 'ZATCA EGS key + CSID secrets';
  else
    execute 'select vault.update_secret($1, $2)' using sid, p_secret::text;
  end if;
end $$;

revoke all on public.zatca_egs_units, public.zatca_invoices from anon;
revoke execute on function public.zatca_egs_secret(uuid), public.zatca_store_egs_secret(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.zatca_egs_secret(uuid), public.zatca_store_egs_secret(uuid, jsonb) to service_role;
