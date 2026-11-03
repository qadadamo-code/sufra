-- CRM / loyalty / ads checks (0009_crm.sql). Run by supabase/tests/crm_run.sh after all migrations + seed.sql.
create or replace function pg_temp.act(uid uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false) $$;

-- anon: public feed + guest RPCs only
select pg_temp.act(null) \g /dev/null
set role anon;
do $$ begin
  begin perform 1 from public.customers limit 1; raise exception 'anon read customers!'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.ad_bookings limit 1; raise exception 'anon read bookings!'; exception when insufficient_privilege then null; end;
  assert jsonb_array_length(public.public_sponsored('cairo', null)) >= 2, 'sponsored feed for cairo';
  assert jsonb_array_length(public.public_sponsored('alexandria', null)) = 1, 'only the city-wide home banner for alexandria';
  assert jsonb_array_length(public.guest_promos('sufra-zamalek', 'table', 'dine_in')->'banners') >= 2, 'table banners';
  assert jsonb_array_length(public.guest_check_coupon('sufra-zamalek', array['sufra-15'], null)->'promotions') >= 1, 'coupon lookup normalises the code';
  begin perform public.guest_loyalty_card('sufra-zamalek', '01005551201', '9999'); raise exception 'card without proof'; exception when raise_exception then
    if sqlerrm <> 'bad_proof' then raise; end if; end;
end $$;
reset role;

-- owner: own bookings only, can request, cannot approve; sees CRM tables
select pg_temp.act((select user_id from public.memberships where email = 'owner@sufra.demo')) \g /dev/null
set role authenticated;
do $$ declare rid uuid := (select id from public.restaurants where slug = 'sufra-zamalek'); b uuid; begin
  assert (select count(*) from public.ad_bookings where restaurant_id <> rid) = 0, 'owner sees only own bookings';
  assert (select count(*) from public.ad_bookings) = 2, 'owner sees own 2 bookings';
  assert (select count(*) from public.customers) >= 60, 'owner sees customers';
  assert (select count(*) from public.loyalty_ledger) > 100, 'owner sees ledger';
  assert (select count(*) from public.restaurants) = 1, 'owner sees one restaurant';
  assert array_length(public.ad_slot_availability((select id from public.ad_slots where type = 'home_banner'), current_date, current_date + 2), 1) = 3, 'home banner full today';
  select id into b from public.ad_bookings where status = 'requested' limit 1;
  update public.ad_bookings set status = 'live' where id = b;
  assert (select status from public.ad_bookings where id = b) = 'requested', 'owner cannot approve';
end $$;
reset role;

-- cashier at the till: redemption → promotion use counted by the trigger
select pg_temp.act((select user_id from public.memberships where email = 'owner@sufra.demo')) \g /dev/null
do $$ declare rid uuid := (select id from public.restaurants where slug = 'sufra-zamalek'); p uuid; n int; begin
  select id, uses into p, n from public.promotions where code = 'SUFRA15';
  insert into public.promo_redemptions (restaurant_id, promotion_id, code, status, discount) values (rid, p, 'SUFRA15', 'redeemed', 5000000);
  assert (select uses from public.promotions where id = p) = n + 1, 'uses trigger';
end $$;

-- Sufra platform admin: every restaurant + booking, approves
select pg_temp.act((select user_id from public.memberships where email = 'platform@sufra.demo')) \g /dev/null
set role authenticated;
do $$ declare b uuid; begin
  assert public.is_platform_admin(), 'platform admin';
  assert (select count(*) from public.restaurants) >= 4, 'platform sees all restaurants';
  assert (select count(*) from public.ad_bookings) = 3, 'platform sees all bookings';
  select id into b from public.ad_bookings where status = 'requested' limit 1;
  update public.ad_bookings set status = 'approved' where id = b;
  assert (select status from public.ad_bookings where id = b) = 'approved', 'platform approves';
  assert (select count(*) from public.staff_compensation) = 0, 'platform admin sees no payroll';
end $$;
reset role;
select 'CRM_TESTS_PASSED';
