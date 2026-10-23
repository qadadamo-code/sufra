# Sufra OS on Supabase

`migrations/0001_init.sql` creates the whole schema; `seed.sql` loads the demo restaurant (same UUIDs as the in-browser seed).

## Apply

**Dashboard (no tools):** Project → SQL Editor → paste `migrations/0001_init.sql` → Run. Then (optional demo data) paste `seed.sql` → Run.
Then Project Settings → API: copy the URL and the `anon` key into `sufra-os/.env.local`:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

**CLI:**

```bash
supabase link --project-ref <ref>
supabase db push                     # runs migrations/
psql "$DATABASE_URL" -f supabase/seed.sql      # or: supabase db reset (local) which also runs seed.sql
```

The seed creates four email users (`owner@ / admin@ / manager@ / accountant@sufra.demo`, password `sufra2026`) directly in
`auth.users`, plus PIN hashes (bcrypt) for all twelve staff — PINs in `../README.md`. Don't load it into a production project.

## Model

- **Money** — every money column is `bigint` in units of **0.00001 of the currency** (EGP: 1 EGP = 100 000 units, 1 piastre = 1 000).
  Same unit as sufra-finance's `Amount`. Rates are basis points. Floor geometry is centimetres.
- **Tenancy** — every row has `restaurant_id`. `memberships(user_id, restaurant_id, role, pin_hash, branch_ids)` says who belongs where;
  `user_id` is null for PIN-only staff. `branch_ids = '{}'` means all branches.
- **Helpers** — `is_member(rid)`, `has_role(rid, roles[])`, `my_role(rid)`, `in_branch(rid, branch_id)` (SECURITY DEFINER, used by policies).
- **RLS** — members read their restaurant's rows; writes are by role (e.g. menu: owner/admin/manager/chef; payments: cashier and up;
  settings: owner/admin). Payroll (`staff_compensation`) is readable by owner/admin/accountant only; payments by cashier/manager/accountant
  and up; checks and customers are hidden from kitchen roles; orders/checks/payments/service calls/reservations are also limited to the
  member's branches. `audit_log` is append-only.
- **Column guards** — kitchen roles may only change an item's status/timestamps, `menu_items.available` (86) and nothing else;
  kitchen and delivery roles may only change an order's status and delivery fields; waiters/cashiers may only change a table's status. Only owners manage owners.
- **PINs** — `pin_hash` is bcrypt and has no client privileges at all (column grants). A shared device signs in once with a
  manager's email account, then staff switch with `pin_roster(rid)` + `verify_staff_pin(rid, membership, pin)` (5 misses → 30 s lockout);
  `set_staff_pin(...)` for managers or the person themselves. The PIN user is the app-level actor (audit `actor_id`); database access
  stays that of the device account.
- **Guests (anon)** — no table grants. Only `guest_menu(slug, table_code)`, `guest_place_order(...)` (prices looked up server-side,
  orders arrive as `open` for the waiter to confirm; check totals are recomputed by the staff app with @finance/tax),
  `guest_call_waiter(...)` (2-minute de-duplication, 10 calls / 10 min per table) and `guest_order_status(...)`.
- **Other functions** — `create_restaurant(slug, name, owner_name)` (restaurant + main branch + default settings + caller as owner),
  `next_order_number(rid, branch)` (daily counter, Cairo day).
- **Realtime** — `orders, order_items, service_calls, dining_tables, checks, payments, reservations, menu_items` are in the
  `supabase_realtime` publication with `replica identity full` (deletes keep `restaurant_id` for the channel filter).
- `updated_at` is maintained by triggers on every table.

## Tests

`tests/run.sh` applies the migration and seed to a throwaway database on any local Postgres 15+ (with small Supabase stand-ins:
roles, `auth.users`, `auth.uid()`) and runs `tests/rls_test.sql` — anon access, guest RPCs, PIN checks and lockout, payroll visibility,
kitchen column guard, and tenant isolation:

```bash
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh     # → RLS_TESTS_PASSED
```
