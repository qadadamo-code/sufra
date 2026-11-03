-- 0013_ops checks on plain Postgres (after stubs + all migrations; self-contained fixture, no seed needed):
--   PGUSER=postgres supabase/tests/ops_run.sh
\set ON_ERROR_STOP 1
create or replace function pg_temp.act(uid uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false) $$;

insert into auth.users (id, email) values
  ('bbbbbbbb-0000-4000-8000-0000000000a1', 'mgr@ops.test'), ('bbbbbbbb-0000-4000-8000-0000000000a2', 'rider@ops.test'),
  ('bbbbbbbb-0000-4000-8000-0000000000a3', 'cook@ops.test'), ('bbbbbbbb-0000-4000-8000-0000000000a4', 'sufra@ops.test');
insert into restaurants (id, slug, name, phone) values ('bbbbbbbb-0000-4000-8000-000000000001', 'ops-test', '{"ar":"تجربة","en":"Test"}', '0222222222');
insert into branches (id, restaurant_id, name, slug, phone, is_default) values ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', '{"ar":"ف","en":"B"}', 'main', '0233333333', true);
insert into zones (id, restaurant_id, branch_id, name, width, height) values ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', '{"ar":"ص","en":"H"}', 100, 100);
insert into dining_tables (id, restaurant_id, branch_id, zone_id, label, code, shape, x, y, w, h) values
  ('bbbbbbbb-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000003', '5', 'OT05', 'square', 1, 1, 1, 1);
insert into memberships (id, restaurant_id, user_id, name, role) values
  ('bbbbbbbb-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-0000000000a1', 'Manager', 'manager'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-0000000000a2', 'Rider', 'delivery'),
  ('bbbbbbbb-0000-4000-8000-0000000000b3', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-0000000000a3', 'Cook', 'kitchen');
insert into platform_admins (user_id) values ('bbbbbbbb-0000-4000-8000-0000000000a4');
insert into ops_settings (restaurant_id, whatsapp_phone, sufra_support_phone) values ('bbbbbbbb-0000-4000-8000-000000000001', '01000000000', 'hacked');
do $$ begin
  assert (select sufra_support_phone from ops_settings where restaurant_id = 'bbbbbbbb-0000-4000-8000-000000000001') = '', 'restaurant cannot set Sufra numbers';
end $$;

-- ─── anon: contact + complaint ───
select pg_temp.act(null) \g /dev/null
set role anon;
do $$ declare r jsonb; begin
  r := public.guest_contact('ops-test');
  assert r->>'phone' = '0233333333' and r->>'whatsapp' = '01000000000', format('contact %s', r);
  r := public.guest_complaint_submit('ops-test', 'Dina', '010 0555 1201', 'food', 'لقيت شعر في الطبق', 'ot05');
  assert r->>'number' = 'G-1001', format('number %s', r);
  r := public.guest_complaint_submit('ops-test', '', '', 'billing', 'اتحاسبت على صنف زيادة');
  assert r->>'number' = 'G-1002', 'second number';
  begin perform public.guest_complaint_submit('ops-test', '', '123', 'food', 'cold food here'); raise exception 'bad phone accepted';
  exception when others then if sqlerrm not like '%bad_phone%' then raise; end if; end;
  begin perform public.guest_complaint_submit('ops-test', '', '', 'food', 'hm'); raise exception 'short accepted';
  exception when others then if sqlerrm not like '%too_short%' then raise; end if; end;
  begin perform 1 from public.support_tickets; raise exception 'anon read tickets!';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare t support_tickets; begin
  select * into t from support_tickets where number = 'G-1001';
  assert t.priority = 'urgent' and t.contact_phone = '01005551201' and t.table_id = 'bbbbbbbb-0000-4000-8000-000000000004' and t.channel = 'qr', 'complaint row';
  assert (select priority from support_tickets where number = 'G-1002') = 'high', 'billing → high';
end $$;

-- ─── radio: channel membership ───
select pg_temp.act('bbbbbbbb-0000-4000-8000-0000000000a2') \g /dev/null
set role authenticated;
insert into radio_clips (restaurant_id, channel, from_id, from_name, text) values ('bbbbbbbb-0000-4000-8000-000000000001', 'delivery', 'bbbbbbbb-0000-4000-8000-0000000000b2', 'Rider', 'وصلت');
do $$ begin
  begin insert into radio_clips (restaurant_id, channel, from_id, text) values ('bbbbbbbb-0000-4000-8000-000000000001', 'managers', 'bbbbbbbb-0000-4000-8000-0000000000b2', 'x'); raise exception 'rider talked on managers';
  exception when insufficient_privilege then null; end;
  begin insert into radio_clips (restaurant_id, channel, from_id, text) values ('bbbbbbbb-0000-4000-8000-000000000001', 'all', 'bbbbbbbb-0000-4000-8000-0000000000b1', 'x'); raise exception 'spoofed sender';
  exception when insufficient_privilege then null; end;
  begin perform 1 from support_tickets where kind = 'guest'; assert not found, 'rider sees guest tickets';
  end;
end $$;
insert into radio_clips (restaurant_id, channel, from_id, text) values ('bbbbbbbb-0000-4000-8000-000000000001', 'dm:bbbbbbbb-0000-4000-8000-0000000000b1:bbbbbbbb-0000-4000-8000-0000000000b2', 'bbbbbbbb-0000-4000-8000-0000000000b2', 'dm');
insert into support_tickets (restaurant_id, kind, number, subject, raised_by) values ('bbbbbbbb-0000-4000-8000-000000000001', 'sufra', 'S-0001', 'printer', 'bbbbbbbb-0000-4000-8000-0000000000b2');
reset role;
select pg_temp.act('bbbbbbbb-0000-4000-8000-0000000000a3') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from radio_clips) = 0, 'cook hears neither delivery nor the dm';
  assert (select count(*) from support_tickets) = 0, 'cook sees no tickets';
end $$;
reset role;
select pg_temp.act('bbbbbbbb-0000-4000-8000-0000000000a1') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from radio_clips) = 2, 'manager hears delivery + own dm';
  assert (select count(*) from support_tickets) = 3, 'manager sees guest + sufra tickets';
  update support_tickets set status = 'open' where number = 'G-1001';
  assert found, 'manager updates a complaint';
end $$;
reset role;
select pg_temp.act('bbbbbbbb-0000-4000-8000-0000000000a4') \g /dev/null
set role authenticated;
do $$ begin
  assert (select count(*) from support_tickets) = 1 and (select kind from support_tickets limit 1) = 'sufra', 'platform admin sees sufra tickets only';
  update support_tickets set status = 'pending' where number = 'S-0001';
  assert found, 'platform admin answers';
end $$;
reset role;

-- ─── POS ↔ video exceptions view ───
insert into audit_log (restaurant_id, action, entity, data, approved_by) values
  ('bbbbbbbb-0000-4000-8000-000000000001', 'order.void', 'orderItems', '{"device":"POS1"}', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'check.discount', 'checks', '{"pct":10}', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'check.discount', 'checks', '{"discount":{"kind":"percent","rate":2500}}', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'shift.close', 'shifts', '{"difference":0}', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'shift.close', 'shifts', '{"difference":-500000}', null),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'check.open', 'checks', '{}', null);
do $$ begin
  assert (select count(*) from ops_video_events) = 3, format('3 exceptions, got %s', (select count(*) from ops_video_events));
  assert (select device from ops_video_events where kind = 'void') = 'POS1', 'device';
end $$;
\echo 'ops_test: all assertions passed'
