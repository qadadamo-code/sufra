#!/usr/bin/env bash
# 0013_ops on a throwaway local Postgres: stubs + all migrations + ops_test.sql (own fixture)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="sufra_ops_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
q() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
q -f supabase/tests/supabase_stubs.sql
for f in supabase/migrations/*.sql; do q -f "$f"; done
q -f supabase/tests/ops_test.sql
echo "ops: ok"
