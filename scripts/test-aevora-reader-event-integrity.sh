#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_READER_EVENT_REHEARSAL:?Set AEVORA_DISPOSABLE_READER_EVENT_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE to opt into fixture setup}"
if [[ "$AEVORA_DISPOSABLE_READER_EVENT_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing reader-event integrity rehearsal: explicit disposable-database confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing reader-event integrity rehearsal against a Supabase URL. Use CI's disposable PostgreSQL service only." >&2
  exit 2
fi
database_url_without_query="${DATABASE_URL%%\?*}"
database_name="${database_url_without_query##*/}"
if [[ "$database_name" != aevora_* ]]; then
  echo "Refusing reader-event integrity rehearsal: database URL must identify an explicitly named aevora_ disposable database." >&2
  exit 2
fi

# Fixture setup and migrations are destructive; explicit disposable-target opt-in is mandatory.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-reader-event-integrity-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014120000_lock_public_identity_sequence_grants.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014150000_reader_events_insert_only.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014200000_reader_event_relationship_integrity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014220000_reader_event_idempotency_key.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014230000_reader_event_server_timestamp.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261015120000_reader_event_intake_rpc.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-reader-event-integrity-assertions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014130000_public_trending_aggregate_rpc.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-trending-state-assertions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-reader-event-intake-rpc-assertions.sql

# Exercise the partial unique index across two independent database sessions.
# Session A holds the uncommitted UUID briefly; session B must wait and then
# fail with a unique violation instead of creating a second logical event.
concurrent_uuid="10000000-0000-0000-0000-000000000099"
tmp_a="$(mktemp)"
tmp_b="$(mktemp)"
cleanup_concurrent() { rm -f "$tmp_a" "$tmp_b"; }
trap cleanup_concurrent EXIT

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$tmp_a" 2>&1 <<SQL &
BEGIN;
SET ROLE anon;
INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id,event_uuid)
VALUES ('visitor-concurrent-0001','story_open',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000111',
        '$concurrent_uuid');
SELECT pg_sleep(1);
COMMIT;
SQL
first_pid=$!
sleep 0.2
set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 >"$tmp_b" 2>&1 <<SQL
SET ROLE anon;
INSERT INTO public.reader_events(visitor_id,event_type,series_id,chapter_id,event_uuid)
VALUES ('visitor-concurrent-0001','story_open',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000111',
        '$concurrent_uuid');
SQL
second_status=$?
set -e
wait "$first_pid"
if [[ "$second_status" -eq 0 ]] || ! grep -qi 'duplicate key value violates unique constraint.*reader_events_event_uuid_uidx' "$tmp_b"; then
  echo "Concurrent duplicate event UUID was not rejected by the idempotency index." >&2
  cat "$tmp_a" "$tmp_b" >&2
  exit 1
fi
echo "Concurrent reader-event idempotency assertion passed."

# Race the trusted intake RPC with the same UUID but different visitor hints.
# Event-UUID serialization must make the loser return duplicate before quota use.
rpc_race_uuid="50000000-0000-0000-0000-000000000099"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq >"$tmp_a" 2>&1 <<SQL &
BEGIN;
SET ROLE service_role;
SELECT public.aevora_ingest_reader_event(
  'visitor-rpc-race-first-0001',
  '$rpc_race_uuid',
  'story_open',
  '00000000-0000-0000-0000-000000000101',
  NULL,
  NULL
)->>'outcome';
SELECT pg_sleep(1);
COMMIT;
SQL
rpc_first_pid=$!
sleep 0.2
set +e
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq >"$tmp_b" 2>&1 <<SQL
SET ROLE service_role;
SELECT public.aevora_ingest_reader_event(
  'visitor-rpc-race-second-0001',
  '$rpc_race_uuid',
  'story_open',
  '00000000-0000-0000-0000-000000000101',
  NULL,
  NULL
)->>'outcome';
SQL
rpc_second_status=$?
set -e
if ! wait "$rpc_first_pid"; then
  echo "First trusted intake RPC session failed." >&2
  cat "$tmp_a" "$tmp_b" >&2
  exit 1
fi
if [[ "$rpc_second_status" -ne 0 ]] || ! grep -qx 'accepted' "$tmp_a" || ! grep -qx 'duplicate' "$tmp_b"; then
  echo "Concurrent RPC idempotency failed: expected accepted/duplicate across distinct visitor hints." >&2
  cat "$tmp_a" "$tmp_b" >&2
  exit 1
fi

echo "Concurrent trusted intake UUID idempotency assertion passed."

# Rehearse the mixed-writer race: pause the RPC at its BEFORE INSERT trigger
# after its initial idempotency check, let a direct compatibility INSERT claim
# the same UUID, then ensure the RPC returns duplicate without charging quota.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE OR REPLACE FUNCTION public.aevora_test_pause_rpc_reader_event_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $test$
BEGIN
  IF NEW.visitor_id = 'visitor-rpc-mixed-race-0001' THEN
    PERFORM pg_catalog.pg_sleep(1);
  END IF;
  RETURN NEW;
END;
$test$;
CREATE TRIGGER aevora_test_pause_rpc_reader_event_insert
BEFORE INSERT ON public.reader_events
FOR EACH ROW EXECUTE FUNCTION public.aevora_test_pause_rpc_reader_event_insert();
SQL
mixed_race_uuid="51000000-0000-0000-0000-000000000099"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq >"$tmp_a" 2>&1 <<SQL &
SET ROLE service_role;
SELECT public.aevora_ingest_reader_event(
  'visitor-rpc-mixed-race-0001',
  '$mixed_race_uuid',
  'story_open',
  '00000000-0000-0000-0000-000000000101',
  NULL,
  NULL
)->>'outcome';
SQL
mixed_rpc_pid=$!
sleep 0.2
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
SET ROLE anon;
INSERT INTO public.reader_events(visitor_id,event_type,series_id,event_uuid)
VALUES ('visitor-direct-mixed-race-0001','story_open',
        '00000000-0000-0000-0000-000000000101',
        '$mixed_race_uuid');
SQL
if ! wait "$mixed_rpc_pid"; then
  echo "Mixed-writer RPC session failed." >&2
  cat "$tmp_a" >&2
  exit 1
fi
if ! grep -qx 'duplicate' "$tmp_a"; then
  echo "Mixed-writer race expected the RPC to return duplicate." >&2
  cat "$tmp_a" >&2
  exit 1
fi
mixed_quota_hits="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -c "SELECT COALESCE(sum(hit_count),0) FROM aevora_private.reader_event_quota_buckets WHERE visitor_key_hash = md5('visitor-rpc-mixed-race-0001')")"
if [[ "$mixed_quota_hits" != "0" ]]; then
  echo "Mixed-writer duplicate incorrectly consumed quota: $mixed_quota_hits hits." >&2
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP TRIGGER aevora_test_pause_rpc_reader_event_insert ON public.reader_events; DROP FUNCTION public.aevora_test_pause_rpc_reader_event_insert()"
echo "Mixed direct-writer/RPC idempotency and no-quota-charge assertion passed."


# Race 31 independent sessions against one fresh anonymous quota key. The
# database advisory lock must make the 30/minute boundary exact under load.
# Align to seconds 5-15 of a DB minute so slow CI startup cannot split this
# one-window assertion across two legitimate fixed-minute quota buckets.
quota_wait_seconds=0
while true; do
  database_second="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -c "SELECT floor(EXTRACT(SECOND FROM clock_timestamp()))::integer")"
  if [[ "$database_second" -ge 5 && "$database_second" -le 15 ]]; then
    break
  fi
  sleep 1
  quota_wait_seconds=$((quota_wait_seconds + 1))
  if [[ "$quota_wait_seconds" -ge 75 ]]; then
    echo "Timed out waiting for a stable quota-test minute window." >&2
    exit 1
  fi
done
quota_dir="$(mktemp -d)"
cleanup_quota() { rm -rf "$quota_dir"; }
trap 'cleanup_concurrent; cleanup_quota' EXIT
quota_visitor="reader-rpc-concurrent-quota-0001"
quota_pids=()
quota_wait_failures=0
for i in $(seq 1 31); do
  suffix="$(printf '%012d' "$i")"
  # Keep this stress run's keys disjoint from the sequential quota fixture above.
  event_uuid="40000000-0000-0000-0000-$suffix"
  (
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq >"$quota_dir/$i" 2>&1 <<SQL
SET ROLE service_role;
SELECT public.aevora_ingest_reader_event(
  '$quota_visitor',
  '$event_uuid',
  'story_open',
  '00000000-0000-0000-0000-000000000101',
  NULL,
  NULL
)->>'outcome';
SQL
  ) &
  quota_pids+=("$!")
done
for quota_pid in "${quota_pids[@]}"; do
  if ! wait "$quota_pid"; then quota_wait_failures=$((quota_wait_failures + 1)); fi
done
accepted_count=0
limited_count=0
for result_file in "$quota_dir"/*; do
  while IFS= read -r outcome; do
    case "$outcome" in
      accepted) accepted_count=$((accepted_count + 1)) ;;
      limited) limited_count=$((limited_count + 1)) ;;
    esac
  done < "$result_file"
done
if [[ "$quota_wait_failures" -ne 0 || "$accepted_count" -ne 30 || "$limited_count" -ne 1 ]]; then
  echo "Concurrent quota boundary failed: expected 30 accepted and 1 limited with no SQL errors; got $accepted_count accepted, $limited_count limited, $quota_wait_failures failed sessions." >&2
  cat "$quota_dir"/* >&2
  exit 1
fi
echo "Concurrent reader-event quota assertion passed: 30 accepted, 1 limited."
