#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_PROVIDER_THROTTLE_REHEARSAL:?Set explicit disposable rehearsal confirmation}"
if [[ "$AEVORA_DISPOSABLE_PROVIDER_THROTTLE_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing provider-throttle rehearsal: explicit confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing provider-throttle rehearsal against a Supabase URL." >&2
  exit 2
fi
database_url_without_query="${DATABASE_URL%%\?*}"
database_name="${database_url_without_query##*/}"
if [[ "$database_name" != aevora_* ]]; then
  echo "Refusing provider-throttle rehearsal: database name must start with aevora_." >&2
  exit 2
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-provider-throttle-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016180000_atomic_gemini_provider_throttle.sql
pids=()
for i in $(seq 1 20); do
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT recorded FROM public.aevora_record_gemini_throttle('quota')" >/dev/null &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-provider-throttle-assertions.sql
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT * FROM public.aevora_record_gemini_throttle('invalid')" >/dev/null 2>&1; then
  echo "Expected invalid event class to fail but RPC succeeded." >&2
  exit 1
fi
if psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT * FROM public.aevora_record_gemini_throttle('quota')" >/dev/null 2>&1; then
  echo "Expected malformed negative counter to fail but RPC succeeded." >&2
  exit 1
fi
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'DO $verify$ BEGIN IF (SELECT consecutive_throttle_count FROM public.taleforge_ai_provider_state WHERE provider=''gemini'') <> -1 THEN RAISE EXCEPTION ''ASSERTION_FAILED: malformed counter was modified''; END IF; END $verify$;'
echo "Atomic Gemini provider-throttle concurrency and safety rehearsal passed."
