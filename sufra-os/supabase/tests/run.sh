#!/usr/bin/env bash
# Applies the migration + seed to a throwaway database on a local Postgres (with Supabase stand-ins)
# and runs the RLS/RPC checks.  Usage: PGHOST=… PGPORT=… PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="sufra_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/supabase_stubs.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/migrations/0001_init.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/seed.sql
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f supabase/tests/rls_test.sql
