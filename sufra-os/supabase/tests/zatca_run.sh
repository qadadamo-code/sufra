#!/usr/bin/env bash
# 0014_zatca on a throwaway local Postgres: stubs + all migrations + zatca_test.sql (own fixture)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="sufra_zatca_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
q() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
q -f supabase/tests/supabase_stubs.sql
for f in supabase/migrations/*.sql; do q -f "$f"; done
q -f supabase/tests/zatca_test.sql
echo "zatca: ok"
