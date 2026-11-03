#!/usr/bin/env bash
# 0010_hr on a throwaway local Postgres: stubs + all migrations + seed.sql + hr_test.sql
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="sufra_hr_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
q() { psql -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
q -f supabase/tests/supabase_stubs.sql
for f in supabase/migrations/*.sql; do q -f "$f"; done
q -f supabase/seed.sql
q -f supabase/tests/hr_test.sql
echo "hr: ok"
