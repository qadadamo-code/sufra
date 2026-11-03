-- 0008_payments checks on plain Postgres (after stubs + all migrations; self-contained fixture, no seed needed):
--   PGUSER=postgres supabase/tests/payments_run.sh
\set ON_ERROR_STOP 1
insert into restaurants (id, slug, name) values ('aaaaaaaa-0000-4000-8000-000000000001', 'pay-test', '{"ar":"تجربة","en":"Test"}');
insert into branches (id, restaurant_id, name, slug) values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', '{"ar":"ف","en":"B"}', 'main');
insert into settings (restaurant_id, tax, invoice) values ('aaaaaaaa-0000-4000-8000-000000000001', '{}', '{}');
insert into checks (id, restaurant_id, branch_id, total) values ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 500000);
do $$
declare ck checks; r jsonb; n int; rid uuid;
begin
  select * into ck from checks where id = 'aaaaaaaa-0000-4000-8000-000000000003';
  rid := ck.restaurant_id;
  insert into payment_intents (id, restaurant_id, branch_id, check_id, kind, provider, amount, tip, currency, request)
  values ('pi_test_idem', rid, ck.branch_id, ck.id, 'link', 'paymob', 100000, 0, 'EGP', '{}');

  -- webhook delivered twice (+ a late "failed") → one payment, check.paid bumped once
  r := guest_record_payment('pi_test_idem', 'succeeded', 'TXN-1', null);
  assert r->>'status' = 'succeeded' and (r->>'duplicate')::boolean = false, 'first record';
  r := guest_record_payment('pi_test_idem', 'succeeded', 'TXN-1', null);
  assert (r->>'duplicate')::boolean, 'second is a duplicate';
  r := guest_record_payment('pi_test_idem', 'failed', 'TXN-1', 'late');
  assert r->>'status' = 'succeeded', 'final status never changes';
  select count(*) into n from payments where reference = 'pi_test_idem';
  assert n = 1, format('one payment row, got %s', n);
  assert (select paid from checks where id = ck.id) = ck.paid + 100000, 'paid bumped once';

  -- check-less gift card: no payments row
  insert into payment_intents (id, restaurant_id, kind, provider, amount, currency, purpose_ref, request)
  values ('pi_test_gift', rid, 'gift_card', 'moyasar', 5000000, 'SAR', 'GC-1', '{}');
  r := guest_record_payment('pi_test_gift', 'succeeded', 'pay_1', null);
  assert r->>'paymentId' is null, 'gift card: no POS payment';

  -- a guest/link intent must have a check
  begin
    insert into payment_intents (id, restaurant_id, kind, provider, amount, request) values ('pi_test_bad', rid, 'link', 'paymob', 1000, '{}');
    raise exception 'expected check_required';
  exception when check_violation then null;
  end;
  -- refunds can't exceed the charge
  begin
    update payment_intents set refunded = 200000 where id = 'pi_test_idem';
    raise exception 'expected refund_le_charge';
  exception when check_violation then null;
  end;

  -- expired links read as expired through the public RPC
  insert into payment_intents (id, restaurant_id, branch_id, check_id, kind, provider, amount, request, expires_at, redirect_url)
  values ('pi_test_exp', rid, ck.branch_id, ck.id, 'link', 'kashier', 1000, '{}', now() - interval '1 minute', 'https://x');
  r := guest_payment_status('pi_test_exp');
  assert r->>'status' = 'expired' and r->>'redirectUrl' is null, 'expired link';
  assert (guest_pay_config('pay-test')->>'currency') = 'EGP', 'pay config';
  raise notice 'payments_test: ok';
end $$;

-- anon can't record payments or read secrets
set role anon;
do $$ begin
  perform guest_record_payment('pi_test_idem', 'succeeded');
  raise exception 'anon must not record';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform pay_account_config(gen_random_uuid(), 'paymob');
  raise exception 'anon must not read secrets';
exception when insufficient_privilege then null;
end $$;
reset role;
