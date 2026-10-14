#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_MIGRATION_REHEARSAL:?Set AEVORA_DISPOSABLE_MIGRATION_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE to opt into fixture setup}"
if [[ "$AEVORA_DISPOSABLE_MIGRATION_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing migration rehearsal: explicit disposable-database confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing migration rehearsal against a Supabase URL. Use CI's disposable PostgreSQL service only." >&2
  exit 2
fi
if [[ "$DATABASE_URL" != *"aevora_readiness"* ]]; then
  echo "Refusing migration rehearsal: database URL must identify an explicitly named aevora_readiness disposable database." >&2
  exit 2
fi

# This harness creates/replaces fixture objects and runs both migration and rollback.
# It requires an explicit opt-in and rejects Supabase-hosted targets.

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-migration-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014210000_release_automation_readiness_gate.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-migration-assertions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-rollback.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-rollback-assertions.sql
