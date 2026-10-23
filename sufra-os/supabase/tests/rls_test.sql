-- RLS + RPC checks against migrations/0001_init.sql + seed.sql (run by supabase/tests/run.sh on plain Postgres).
\set ON_ERROR_STOP 1

-- helpers: act as a user
create or replace function pg_temp.act(uid uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false) $$;

-- ─── anon ───
select pg_temp.act(null) \g /dev/null
set role anon;
do $$ begin
  begin perform 1 from public.orders limit 1; raise exception 'anon read orders!';
  exception when insufficient_privilege then null; end;
  assert (public.guest_menu('sufra-zamalek', 'ZM05')->'table'->>'label') = '5', 'guest menu table';
  assert jsonb_array_length(public.guest_menu('sufra-zamalek', null)->'items') = 47, 'guest items';
  assert public.guest_menu('sufra-zamalek', 'NOPE') is null, 'bad code';
  assert (public.guest_call_waiter('sufra-zamalek', 'zm13', 'water')->>'id') = (public.guest_call_waiter('sufra-zamalek', 'ZM13', 'water')->>'id'), 'dedupe';
end $$;
select public.guest_place_order('sufra-zamalek', 'ZM13', 'dine_in',
  (select jsonb_build_array(jsonb_build_object('itemId', x->>'id', 'qty', 2, 'modifierIds', '[]'::jsonb))
   from jsonb_array_elements(public.guest_menu('sufra-zamalek', null)->'items') x where x->'name'->>'en' = 'Grilled kofta')) is not null as placed \gset
reset role;
do $$ declare o record; begin
  select o2.*, (select sum(unit_price * qty) from public.order_items i where i.order_id = o2.id) as sub into o
  from public.orders o2 where source = 'qr' order by created_at desc limit 1;
  assert o.sub = 69000000, 'server-side price: 2 × 345 EGP';
end $$;
set role anon;
do $$ begin
  begin perform public.guest_place_order('sufra-zamalek', 'ZM13', 'dine_in', (select jsonb_build_array(jsonb_build_object('itemId', '00000000-0000-4000-8000-000000000000', 'qty', 1)))); raise exception 'unknown item accepted';
  exception when others then if sqlerrm not like '%item_unavailable%' then raise; end if; end;
  begin perform public.verify_staff_pin((select '00000000-0000-4000-8000-000000000000'::uuid), '00000000-0000-4000-8000-000000000000', '1000'); raise exception 'anon can verify pins';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ─── manager (email) ───
select pg_temp.act((select user_id from public.memberships where email = 'manager@sufra.demo')) \g /dev/null
set role authenticated;
do $$ declare rid uuid := (select id from public.restaurants where slug = 'sufra-zamalek'); cashier uuid; begin
  assert (select count(*) from public.orders) = 22, 'manager sees orders';
  assert (select count(*) from public.staff_compensation) = 0, 'manager cannot see payroll';
  begin perform pin_hash from public.memberships limit 1; raise exception 'pin_hash readable';
  exception when insufficient_privilege then null; end;
  select id into cashier from public.memberships where restaurant_id = rid and name = 'سارة حسني';
  assert public.verify_staff_pin(rid, cashier, '4000') ->> 'role' = 'cashier', 'right pin';
  assert public.verify_staff_pin(rid, cashier, '0000') is null, 'wrong pin';
  perform public.verify_staff_pin(rid, cashier, '0000') from generate_series(1, 4);
  assert public.verify_staff_pin(rid, cashier, '4000') is null, 'locked out after 5 misses';
  assert (select count(*) from public.pin_roster(rid)) = 12, 'roster';
  update public.service_calls set status = 'ack' where status = 'open';
  begin update public.settings set auto_lock_minutes = 1; 
    if found then raise exception 'manager edited settings'; end if;
  end;
end $$;
reset role;

-- ─── accountant ───
select pg_temp.act((select user_id from public.memberships where email = 'accountant@sufra.demo')) \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from public.staff_compensation) = 11, 'accountant sees payroll';
  assert (select count(*) from public.payments) > 0, 'accountant sees payments';
  begin insert into public.service_calls (restaurant_id, branch_id, table_id, type) select restaurant_id, branch_id, id, 'water' from public.dining_tables limit 1;
    raise exception 'accountant created a service call';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ─── a kitchen user (column guard) ───
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'kitchen@test');
insert into public.memberships (restaurant_id, user_id, name, role) select id, '11111111-1111-4111-8111-111111111111', 'Test kitchen', 'kitchen' from public.restaurants where slug = 'sufra-zamalek';
select pg_temp.act('11111111-1111-4111-8111-111111111111') \g /dev/null
set role authenticated;
do $$ declare i uuid; begin
  assert (select count(*) from public.payments) = 0, 'kitchen sees no payments';
  assert (select count(*) from public.checks) = 0, 'kitchen sees no checks';
  select id into i from public.order_items where status = 'preparing' limit 1;
  update public.order_items set status = 'ready', ready_at = now() where id = i;
  begin update public.order_items set unit_price = 1 where id = i; raise exception 'kitchen changed a price';
  exception when insufficient_privilege then null; end;
  update public.menu_items set available = false where sku = 'TEA';
  begin update public.menu_items set price = 1 where sku = 'TEA'; raise exception 'kitchen changed menu price';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ─── another tenant sees nothing of ours ───
insert into auth.users (id, email) values ('22222222-2222-4222-8222-222222222222', 'other@test');
select pg_temp.act('22222222-2222-4222-8222-222222222222') \g /dev/null
set role authenticated;
do $$ declare r uuid; begin
  r := public.create_restaurant('koshary-corner', '{"ar":"كشري الركن","en":"Koshary Corner"}', 'Owner');
  assert (select count(*) from public.restaurants) = 1, 'only own restaurant';
  assert (select count(*) from public.orders) = 0, 'no foreign orders';
  assert (select count(*) from public.menu_items) = 0, 'no foreign menu';
  assert public.next_order_number(r, (select id from public.branches where restaurant_id = r)) = 1, 'order counter';
  begin perform public.next_order_number((select id from public.restaurants where slug = 'sufra-zamalek'), '00000000-0000-4000-8000-000000000000'); raise exception 'counter for foreign restaurant';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'RLS_TESTS_PASSED' as result;
