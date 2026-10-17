#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_LEASE_REHEARSAL:?Explicit disposable rehearsal opt-in is required}"
if [[ "$AEVORA_DISPOSABLE_LEASE_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing lease rehearsal: explicit opt-in did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing lease rehearsal against a Supabase URL." >&2
  exit 2
fi
database_url_without_query="${DATABASE_URL%%\?*}"
database_name="${database_url_without_query##*/}"
if [[ "$database_name" != aevora_lease_test* ]]; then
  echo "Refusing lease rehearsal: database name must start with aevora_lease_test." >&2
  exit 2
fi

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/aevora-lease-migration-fixture.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261012183000_aevora_release_scheduler_lease_foundation.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f supabase/migrations/20261012190000_aevora_atomic_scheduler_lease_fencing.sql
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f scripts/aevora-lease-migration-assertions.sql
