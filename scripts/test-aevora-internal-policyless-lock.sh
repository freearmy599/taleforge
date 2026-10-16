#!/usr/bin/env bash
set -euo pipefail
: "\${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "\${AEVORA_DISPOSABLE_INTERNAL_LOCK_REHEARSAL:?Set AEVORA_DISPOSABLE_INTERNAL_LOCK_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE to opt into fixture setup}"
if [[ "$AEVORA_DISPOSABLE_INTERNAL_LOCK_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing internal-table lock rehearsal: explicit disposable-database confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing internal-table lock rehearsal against a Supabase URL. Use CI's disposable PostgreSQL service only." >&2
  exit 2
fi
database_url_without_query="\${DATABASE_URL%%\?*}"
database_name="\${database_url_without_query##*/}"
if [[ "$database_name" != aevora_* ]]; then
  echo "Refusing internal-table lock rehearsal: database URL must identify an explicitly named aevora_ disposable database." >&2
  exit 2
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-policyless-lock-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261013130000_lock_internal_policyless_tables.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-policyless-lock-assertions.sql
