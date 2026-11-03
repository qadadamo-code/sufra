-- HR / attendance / payroll checks (0010_hr.sql). Run by supabase/tests/hr_run.sh after all migrations + seed.sql.
create or replace function pg_temp.act(uid uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false) $$;

-- the waiter أحمد سمير gets a phone login for the self-service checks
insert into auth.users (id, email) values ('33333333-3333-4333-8333-333333333333', 'waiter1@test');
update public.memberships set user_id = '33333333-3333-4333-8333-333333333333' where name = 'أحمد سمير';

-- anon: nothing
select pg_temp.act(null) \g /dev/null
set role anon;
do $$ begin
  begin perform 1 from public.attendance_punches limit 1; raise exception 'anon read punches!'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.payslips limit 1; raise exception 'anon read payslips!'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- floor manager: runs attendance & rota, never sees pay
select pg_temp.act((select user_id from public.memberships where email = 'manager@sufra.demo')) \g /dev/null
set role authenticated;
do $$ declare rid uuid := (select id from public.restaurants where slug = 'sufra-zamalek'); p uuid; begin
  assert (select count(*) from public.attendance_punches) > 100, 'manager sees punches';
  assert (select count(*) from public.staff_profiles) >= 13, 'manager sees staff files';
  assert (select count(*) from public.payslips) = 1, 'manager sees only his own payslip';
  assert (select count(*) from public.payslips p join public.memberships m on m.id = p.membership_id where m.email <> 'manager@sufra.demo' or m.email is null) = 0, 'manager cannot see colleagues payslips';
  assert (select count(*) from public.payroll_runs) = 0, 'manager cannot see payroll runs';
  assert (select count(*) from public.staff_compensation) = 0, 'manager cannot see salaries';
  assert (select count(*) from public.rota_shifts where not published) > 0, 'manager sees draft shifts';
  -- correction: void is fine, moving the time is not
  select id into p from public.attendance_punches where membership_id is not null and not voided limit 1;
  update public.attendance_punches set voided = true, note = 'test' where id = p;
  assert (select voided from public.attendance_punches where id = p), 'manager voids a punch';
  begin update public.attendance_punches set at = at + interval '1 hour' where id = p; raise exception 'punch time changed!'; exception when insufficient_privilege then null; end;
  begin delete from public.attendance_punches where id = p; exception when insufficient_privilege then null; end;
  assert exists (select 1 from public.attendance_punches where id = p), 'punches are never deleted';
end $$;
reset role;

-- accountant: payroll yes; a paid run is locked
select pg_temp.act((select user_id from public.memberships where email = 'accountant@sufra.demo')) \g /dev/null
set role authenticated;
do $$ declare s uuid; begin
  assert (select count(*) from public.payslips) = 13, 'accountant sees the payslips';
  assert (select count(*) from public.payroll_runs where status = 'paid') = 1, 'last month paid';
  assert (select sum(net) from public.payslips) = (select (totals->>'net')::bigint from public.payroll_runs where status = 'paid'), 'run totals = payslips';
  select id into s from public.payslips limit 1;
  begin update public.payslips set net = net + 100000, gross = gross + 100000 where id = s; raise exception 'locked payslip edited!'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- waiter on his phone: own rows only, requests start pending, cannot approve
select pg_temp.act('33333333-3333-4333-8333-333333333333') \g /dev/null
set role authenticated;
do $$ declare rid uuid := (select id from public.restaurants where slug = 'sufra-zamalek'); me uuid; other uuid; begin
  select id into me from public.memberships where name = 'أحمد سمير';
  select id into other from public.memberships where name = 'سارة حسني';
  assert (select count(*) from public.attendance_punches where membership_id <> me) = 0, 'waiter sees only own punches';
  assert (select count(*) from public.attendance_punches) > 0, 'waiter sees own punches';
  assert (select count(*) from public.payslips) = 1, 'waiter sees own paid payslip';
  assert (select count(*) from public.staff_compensation) = 0, 'waiter cannot see salaries';
  assert (select count(*) from public.rota_shifts where not published) = 0, 'waiter sees only published shifts';
  insert into public.attendance_punches (restaurant_id, membership_id, at, kind, source, lat, lng) values (rid, me, now(), 'in', 'mobile', 30.0626, 31.2179);
  begin insert into public.attendance_punches (restaurant_id, membership_id, at, kind, source) values (rid, me, now(), 'out', 'manual'); raise exception 'self manual punch!'; exception when insufficient_privilege then null; end;
  begin insert into public.attendance_punches (restaurant_id, membership_id, at, kind, source) values (rid, other, now(), 'in', 'mobile'); raise exception 'punched for a colleague!'; exception when insufficient_privilege then null; end;
  insert into public.leave_requests (restaurant_id, membership_id, type, "from", "to", days) values (rid, me, 'casual', current_date + 3, current_date + 3, 1);
  begin insert into public.leave_requests (restaurant_id, membership_id, type, "from", "to", days, status) values (rid, me, 'annual', current_date + 9, current_date + 9, 1, 'approved'); raise exception 'self-approved leave!'; exception when insufficient_privilege then null; end;
  insert into public.staff_advances (restaurant_id, membership_id, amount, installments, start_period) values (rid, me, 100000000, 2, to_char(current_date, 'YYYY-MM'));
  begin update public.staff_advances set status = 'approved' where membership_id = me; exception when insufficient_privilege then null; end;
  assert (select count(*) from public.staff_advances where membership_id = me and status = 'approved') = 0, 'waiter cannot approve own advance';
  update public.leave_requests set status = 'cancelled' where membership_id = me and status = 'pending' and type = 'casual';
  assert (select count(*) from public.leave_requests where membership_id = me and status = 'cancelled') = 1, 'waiter cancels own pending leave';
end $$;
reset role;

-- device push (service role): idempotent by external_id
select pg_temp.act(null) \g /dev/null
do $$ declare rid uuid := (select id from public.restaurants where slug = 'sufra-zamalek'); begin
  insert into public.attendance_punches (restaurant_id, at, kind, source, device_sn, device_user_id, external_id) values (rid, now(), 'in', 'device', 'CQZ7231460021', '77', 'zk:CQZ7231460021:77:x:0')
    on conflict (restaurant_id, external_id) do nothing;
  insert into public.attendance_punches (restaurant_id, at, kind, source, device_sn, device_user_id, external_id) values (rid, now(), 'in', 'device', 'CQZ7231460021', '77', 'zk:CQZ7231460021:77:x:0')
    on conflict (restaurant_id, external_id) do nothing;
  assert (select count(*) from public.attendance_punches where external_id = 'zk:CQZ7231460021:77:x:0') = 1, 'device punches are idempotent';
end $$;

\echo HR_TESTS_PASSED
