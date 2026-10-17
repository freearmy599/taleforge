#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_ATOMIC_REVIEW_REHEARSAL:?Set AEVORA_DISPOSABLE_ATOMIC_REVIEW_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE}"
if [[ "$AEVORA_DISPOSABLE_ATOMIC_REVIEW_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing atomic quality-review rehearsal: explicit disposable-database confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing atomic quality-review rehearsal against a Supabase URL." >&2
  exit 2
fi
database_url_without_query="${DATABASE_URL%%\?*}"
database_name="${database_url_without_query##*/}"
if [[ "$database_name" != aevora_* ]]; then
  echo "Refusing rehearsal: database name must begin with aevora_." >&2
  exit 2
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-atomic-quality-review-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261017150000_aevora_atomic_quality_review_commit.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-atomic-quality-review-assertions.sql
