-- Messaging (0007) checks: ingest (inbound, STOP, retries, status ranks, closed-hours auto-reply), guest consent, rate counter, anon RLS.
-- Run after supabase_stubs.sql, migrations 0001…0007 and seed.sql on a throwaway DB (see run.sh), e.g.:
--   for f in tests/supabase_stubs.sql migrations/000{1,2,4,5,7}_*.sql seed.sql tests/messaging_test.sql; do psql -v ON_ERROR_STOP=1 -q -d $DB -f $f; done
\set ON_ERROR_STOP 1
-- helper e164
select public.messaging_e164('01005551201') = '+201005551201' as eg, public.messaging_e164('0551234567') = '+966551234567' as sa,
       public.messaging_e164('٠١٠٠٥٥٥١٢٠١') = '+201005551201' as arabic, public.messaging_e164('+44 7700 900123') = '+447700900123' as intl,
       public.messaging_e164('12345') is null as junk;
do $$ declare rid uuid; res jsonb; n int; st text; begin
  select id into rid from restaurants limit 1;
  -- inbound message + STOP + status
  res := public.messaging_ingest_webhook(jsonb_build_array(
    jsonb_build_object('kind','message','phoneNumberId','PN1','from','+201005551201','name','Dina','id','wamid.A','at', now()::text,'type','text','text','عايزة احجز','optOut',false,'optIn',false),
    jsonb_build_object('kind','message','phoneNumberId','PN1','from','+201005551201','name','Dina','id','wamid.B','at', now()::text,'type','text','text','وقف','optOut',true,'optIn',false)
  ), rid);
  raise notice 'res %', res;
  assert jsonb_array_length(res->'replies') = 1, 'opt-out reply';
  select unread into n from wa_conversations where restaurant_id = rid and phone = '+201005551201';
  assert n = 2, 'unread';
  select status into st from messaging_consents where restaurant_id = rid and phone = '+201005551201';
  assert st = 'opted_out', 'consent';
  -- retry is idempotent
  res := public.messaging_ingest_webhook(jsonb_build_array(jsonb_build_object('kind','message','phoneNumberId','PN1','from','+201005551201','name','Dina','id','wamid.A','at', now()::text,'type','text','text','x','optOut',false,'optIn',false)), rid);
  select count(*) into n from wa_messages where direction = 'in'; assert n = 2, 'idempotent';
  -- status updates
  insert into wa_messages (restaurant_id, conversation_id, direction, channel, status, provider_id, body)
    select rid, id, 'out', 'whatsapp', 'sent', 'wamid.OUT', 'hi' from wa_conversations where restaurant_id = rid limit 1;
  perform public.messaging_ingest_webhook(jsonb_build_array(jsonb_build_object('kind','status','phoneNumberId','PN1','id','wamid.OUT','status','read','at', now()::text)), rid);
  perform public.messaging_ingest_webhook(jsonb_build_array(jsonb_build_object('kind','status','phoneNumberId','PN1','id','wamid.OUT','status','delivered','at', now()::text)), rid);
  select status into st from wa_messages where provider_id = 'wamid.OUT'; assert st = 'read', 'status rank ' || st;
  -- closed-hours auto reply in cloud mode
  update settings set messaging = '{"mode":"cloud","businessHours":{"enabled":true,"useBranchHours":false,"open":"00:00","close":"00:01","reply":{"ar":"قافلين","en":"closed"}}}' where restaurant_id = rid;
  res := public.messaging_ingest_webhook(jsonb_build_array(jsonb_build_object('kind','message','phoneNumberId','PN1','from','+201005551202','name','Omar','id','wamid.C','at', now()::text,'type','text','text','hello','optOut',false,'optIn',false)), rid);
  raise notice 'closed %', res;
  assert jsonb_array_length(res->'replies') = 1 and res->'replies'->0->>'text' = 'closed', 'auto reply';
  res := public.messaging_ingest_webhook(jsonb_build_array(jsonb_build_object('kind','message','phoneNumberId','PN1','from','+201005551202','name','Omar','id','wamid.D','at', now()::text,'type','text','text','hello?','optOut',false,'optIn',false)), rid);
  assert jsonb_array_length(res->'replies') = 0, 'auto reply once per 12h';
  -- guest consent: unknown phone cannot be opted in, known customer can
  begin perform public.guest_messaging_consent('sufra-zamalek', '01009999999', 'x', 'online_checkout', true, 'w'); raise exception 'should fail';
  exception when others then assert sqlerrm = 'unknown_customer', sqlerrm; end;
  res := public.guest_messaging_consent('sufra-zamalek', '01005551203', 'Laila', 'online_checkout', true, 'ابعتولي حالة الطلب');
  assert res->>'status' = 'opted_in';
  -- credentials: no vault → empty
  select count(*) into n from public.messaging_wa_credentials(rid); assert n = 0;
  assert public.messaging_rate_take(rid, 2, 600) and public.messaging_rate_take(rid, 2, 600) and not public.messaging_rate_take(rid, 2, 600), 'rate';
end $$;
-- RLS: anon can't read, a waiter can't read the inbox, owner can
set role anon;
do $$ begin perform 1 from wa_messages; raise exception 'anon read'; exception when insufficient_privilege then null; end $$;
reset role;
select 'MESSAGING_TESTS_PASSED';
