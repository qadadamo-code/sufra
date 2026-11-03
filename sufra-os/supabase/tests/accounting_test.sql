-- 0011_accounting checks on the seeded demo (run by accounting_run.sh as the table owner)
\set ON_ERROR_STOP on
do $$
declare
  rid uuid := (select id from public.restaurants where slug = 'sufra-zamalek');
  dr numeric; cr numeric; n int; locked date; ok boolean;
begin
  -- the journal balances: every entry and the whole trial balance
  select sum((l->>'debit')::numeric), sum((l->>'credit')::numeric) into dr, cr from public.ledger_entries e, jsonb_array_elements(e.lines) l where e.restaurant_id = rid;
  if dr is null or dr <> cr then raise exception 'trial balance does not sum to zero: % / %', dr, cr; end if;
  select count(*) into n from public.ledger_entries where restaurant_id = rid;
  if n < 300 then raise exception 'expected the 3-month history, got % entries', n; end if;
  select closed_through into locked from public.accounting_settings where restaurant_id = rid;
  if locked is null then raise exception 'seed should have a closed period'; end if;

  -- unbalanced entry is rejected
  ok := false;
  begin
    insert into public.ledger_entries (restaurant_id, date, source_type, source_id, lines) values (rid, current_date, 'test', 't1', '[{"account":"6401","debit":100,"credit":0},{"account":"1105","debit":0,"credit":99}]');
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'unbalanced entry was accepted'; end if;

  -- a posting inside the closed period is rejected
  ok := false;
  begin
    insert into public.ledger_entries (restaurant_id, date, source_type, source_id, lines) values (rid, locked, 'test', 't2', '[{"account":"6401","debit":100,"credit":0},{"account":"1105","debit":0,"credit":100}]');
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'posting in a closed period was accepted'; end if;

  -- a balanced entry after the lock is fine; entries are append-only
  insert into public.ledger_entries (restaurant_id, date, source_type, source_id, lines) values (rid, current_date, 'test', 't3', '[{"account":"6401","debit":100,"credit":0},{"account":"1105","debit":0,"credit":100}]');
  ok := false;
  begin
    update public.ledger_entries set memo = 'edited' where restaurant_id = rid and source_id = 't3';
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'journal entry was editable'; end if;

  -- periods are never reopened
  ok := false;
  begin
    update public.accounting_settings set closed_through = locked - 1 where restaurant_id = rid;
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'closed period was reopened'; end if;

  -- imported bank lines are evidence: only the match fields change
  update public.bank_statement_lines set status = 'ignored' where id = (select id from public.bank_statement_lines where restaurant_id = rid limit 1);
  ok := false;
  begin
    update public.bank_statement_lines set amount = amount + 1 where id = (select id from public.bank_statement_lines where restaurant_id = rid limit 1);
  exception when insufficient_privilege then ok := true; end;
  if not ok then raise exception 'bank line amount was editable'; end if;

  -- expense totals add up
  select count(*) into n from public.expenses where total <> net + vat;
  if n > 0 then raise exception 'expense total mismatch'; end if;
end $$;
