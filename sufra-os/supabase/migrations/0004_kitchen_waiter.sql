-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 · Kitchen display + waiter app + service calls
--
--  - service_calls: new types (waiter, item, complaint, pickup), source 'kitchen' (expo "ping waiter"),
--    item_id (guest asked for a menu item), order_id (pickup ping), escalated_at (SLA breach, written once)
--  - orders.priority      rush / VIP flag shown on the KDS
--  - dining_tables.waiter_id  the waiter whose section the table is in (calls route there first)
--  - settings.service_calls / settings.kitchen   SLA + aging thresholds (defaults mirror src/lib/service-calls + kitchen/kds.ts)
--  - column guards: kitchen may set orders.priority; waiters may claim a table (waiter_id)
--  - RLS: kitchen roles may insert service calls (pickup pings) and update them
-- Idempotent where Postgres allows it, so it can be re-run on a dev database.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── service calls ──
alter table public.service_calls drop constraint if exists service_calls_type_check;
alter table public.service_calls add constraint service_calls_type_check
  check (type in ('napkins','water','coffee','tea','clean_table','bill','help','other','waiter','item','complaint','pickup'));
alter table public.service_calls drop constraint if exists service_calls_source_check;
alter table public.service_calls add constraint service_calls_source_check
  check (source in ('qr','waiter','pos','kitchen'));
alter table public.service_calls add column if not exists item_id uuid references public.menu_items (id) on delete set null;
alter table public.service_calls add column if not exists order_id uuid references public.orders (id) on delete cascade;
alter table public.service_calls add column if not exists escalated_at timestamptz;
create index if not exists service_calls_table_idx on public.service_calls (table_id, created_at desc);
create index if not exists service_calls_kpi_idx on public.service_calls (restaurant_id, ack_by, created_at desc);

-- ── orders / tables ──
alter table public.orders add column if not exists priority text not null default 'normal';
alter table public.orders drop constraint if exists orders_priority_check;
alter table public.orders add constraint orders_priority_check check (priority in ('normal','rush','vip'));

alter table public.dining_tables add column if not exists waiter_id uuid references public.memberships (id) on delete set null;

-- ── settings ──
alter table public.settings add column if not exists service_calls jsonb not null default '{"warnSec":60,"escalateSec":120,"criticalSec":300}';
alter table public.settings add column if not exists kitchen jsonb not null default '{"amberMin":10,"redMin":18,"sound":true}';

-- ── column guards (replace the 0001 versions with the new columns allowed) ──
drop trigger if exists orders_limited_guard on public.orders;
create trigger orders_limited_guard before update on public.orders
  for each row execute function public.guard_limited_update('{owner,admin,manager,cashier,waiter}', '{status,delivery_status,driver_id,priority}');
drop trigger if exists tables_status_guard on public.dining_tables;
create trigger tables_status_guard before update on public.dining_tables
  for each row execute function public.guard_limited_update('{owner,admin,manager}', '{status,status_since,waiter_id}');

-- ── RLS: the pass (chef/kitchen) pings waiters with a 'pickup' call and can close it ──
drop policy if exists service_calls_insert on public.service_calls;
create policy service_calls_insert on public.service_calls for insert to authenticated
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier,waiter,chef,kitchen}') and public.in_branch(restaurant_id, branch_id)
              and (source <> 'kitchen' or type = 'pickup'));
drop policy if exists service_calls_update on public.service_calls;
create policy service_calls_update on public.service_calls for update to authenticated
  using (public.has_role(restaurant_id, '{owner,admin,manager,cashier,waiter,chef,kitchen}'))
  with check (public.has_role(restaurant_id, '{owner,admin,manager,cashier,waiter,chef,kitchen}'));

-- ── guest RPC: accept an optional menu item for type 'item' ──
create or replace function public.guest_call_waiter_item(p_slug text, p_table_code text, p_item_id uuid, p_text text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb; it_ok boolean;
begin
  res := public.guest_call_waiter(p_slug, p_table_code, 'item', p_text);
  select exists (select 1 from menu_items m join restaurants r on r.id = m.restaurant_id where r.slug = p_slug and m.id = p_item_id and m.active)
    into it_ok;
  if it_ok then update service_calls set item_id = p_item_id where id = (res->>'id')::uuid and item_id is null; end if;
  return res;
end $$;
grant execute on function public.guest_call_waiter_item(text, text, uuid, text) to anon, authenticated;

-- ── KPI view: response time per call (seconds), for reports ──
create or replace view public.service_call_response with (security_invoker = true) as
select c.id, c.restaurant_id, c.branch_id, c.table_id, c.type, c.source, c.ack_by, c.created_at,
       extract(epoch from (coalesce(c.ack_at, c.done_at) - c.created_at))::int as response_sec,
       c.escalated_at is not null as escalated
from public.service_calls c
where c.type <> 'pickup';
