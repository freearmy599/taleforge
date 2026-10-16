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

# Exercise mixed event classes racing on the same initially absent provider row.
# The counter is shared by design today, so this verifies atomicity and fixed
# diagnostics under contention; it does not settle whether overloads should
# contribute to quota escalation semantics.
pids=()
for i in $(seq 1 20); do
  if (( i % 2 == 0 )); then
    event_class=quota
  else
    event_class=overload
  fi
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc "SELECT recorded FROM public.aevora_record_gemini_throttle('$event_class')" >/dev/null &
  pids+=("$!")
done
for pid in "${pids[@]}"; do
  wait "$pid"
done
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "DO \$mixed\$ DECLARE v_count integer; v_until timestamptz; v_error text; BEGIN SELECT consecutive_throttle_count, cooldown_until, last_error INTO v_count, v_until, v_error FROM public.taleforge_ai_provider_state WHERE provider='gemini'; IF v_count <> 20 THEN RAISE EXCEPTION 'ASSERTION_FAILED: mixed concurrent throttle events expected count 20, got %', v_count; END IF; IF v_until IS NULL OR v_until <= clock_timestamp() THEN RAISE EXCEPTION 'ASSERTION_FAILED: mixed concurrent events did not persist a future cooldown'; END IF; IF v_error NOT IN ('Gemini quota or rate-limit response', 'Gemini temporary overload response') THEN RAISE EXCEPTION 'ASSERTION_FAILED: mixed event left an unapproved diagnostic'; END IF; END \$mixed\$;"

# Reset only the disposable fixture, then independently retain the original
# all-quota 20-session test and its exact expected count.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "UPDATE public.taleforge_ai_provider_state SET cooldown_until=NULL, consecutive_throttle_count=0, last_error=NULL, last_error_at=NULL, updated_at=clock_timestamp() WHERE provider='gemini'"
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
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c 'DO $verify$ BEGIN IF (SELECT consecutive_throttle_count FROM public.taleforge_ai_provider_state WHERE provider=$q$gemini$q$) <> -1 THEN RAISE EXCEPTION USING MESSAGE = $m$ASSERTION_FAILED: malformed counter was modified$m$; END IF; END $verify$;'
echo "Atomic Gemini provider-throttle concurrency and safety rehearsal passed."
