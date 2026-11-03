-- 0014_zatca checks on plain Postgres (after stubs + all migrations; self-contained fixture):
--   PGUSER=postgres supabase/tests/zatca_run.sh
\set ON_ERROR_STOP 1
insert into restaurants (id, slug, name) values ('bbbbbbbb-0000-4000-8000-000000000001', 'zatca-test', '{"ar":"تجربة","en":"Test"}');
insert into branches (id, restaurant_id, name, slug) values ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', '{"ar":"ف","en":"B"}', 'main');
insert into zatca_egs_units (id, restaurant_id, branch_id, device, name, serial) values
  ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'RUH1', 'Sufra-RUH1', '1-Sufra|2-OS|3-x');
do $$
declare
  first_pih text := 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
  r uuid := 'bbbbbbbb-0000-4000-8000-000000000001'; b uuid := 'bbbbbbbb-0000-4000-8000-000000000002'; e uuid := 'bbbbbbbb-0000-4000-8000-000000000003';
begin
  -- first document must carry the initial PIH
  begin
    insert into zatca_invoices (restaurant_id, branch_id, egs_id, device, kind, doc_type, invoice_no, uuid, icv, pih, hash, issued_at, xml, qr, total, vat, status)
    values (r, b, e, 'RUH1', 'simplified', 'invoice', 'RUH1-000001', gen_random_uuid(), 1, 'WRONG', 'H1', now(), '<x/>', 'qr', 100, 13, 'unsigned');
    raise exception 'expected chain violation (first PIH)';
  exception when check_violation then null;
  end;
  insert into zatca_invoices (restaurant_id, branch_id, egs_id, device, kind, doc_type, invoice_no, uuid, icv, pih, hash, issued_at, xml, qr, total, vat, status)
  values (r, b, e, 'RUH1', 'simplified', 'invoice', 'RUH1-000001', gen_random_uuid(), 1, first_pih, 'H1', now(), '<x/>', 'qr', 100, 13, 'unsigned');
  -- skipped ICV / wrong PIH rejected
  begin
    insert into zatca_invoices (restaurant_id, branch_id, egs_id, device, kind, doc_type, invoice_no, uuid, icv, pih, hash, issued_at, xml, qr, total, vat, status)
    values (r, b, e, 'RUH1', 'simplified', 'invoice', 'RUH1-000003', gen_random_uuid(), 3, 'H1', 'H3', now(), '<x/>', 'qr', 100, 13, 'unsigned');
    raise exception 'expected chain violation (gap)';
  exception when check_violation then null;
  end;
  begin
    insert into zatca_invoices (restaurant_id, branch_id, egs_id, device, kind, doc_type, invoice_no, uuid, icv, pih, hash, issued_at, xml, qr, total, vat, status)
    values (r, b, e, 'RUH1', 'simplified', 'invoice', 'RUH1-000002', gen_random_uuid(), 2, 'NOT-H1', 'H2', now(), '<x/>', 'qr', 100, 13, 'unsigned');
    raise exception 'expected chain violation (pih)';
  exception when check_violation then null;
  end;
  insert into zatca_invoices (restaurant_id, branch_id, egs_id, device, kind, doc_type, invoice_no, uuid, icv, pih, hash, issued_at, xml, qr, total, vat, status)
  values (r, b, e, 'RUH1', 'simplified', 'credit', 'RUH1-000002', gen_random_uuid(), 2, 'H1', 'H2', now(), '<x/>', 'qr', 50, 6, 'unsigned');
  -- server stamps an unsigned document (same hash) and reports it
  update zatca_invoices set xml = '<signed/>', qr = 'qr2', signed_by = 'server', status = 'reported', attempts = 1, submitted_at = now() where icv = 1 and egs_id = e;
  -- business content is immutable
  begin
    update zatca_invoices set total = 1 where icv = 1 and egs_id = e;
    raise exception 'expected immutability';
  exception when insufficient_privilege then null;
  end;
  begin
    update zatca_invoices set xml = '<again/>' where icv = 1 and egs_id = e;
    raise exception 'expected immutability (re-sign)';
  exception when insufficient_privilege then null;
  end;
  -- vault helper degrades without Vault
  assert zatca_egs_secret(e) = '{}'::jsonb, 'no vault → empty';
end $$;
\echo zatca: ok
