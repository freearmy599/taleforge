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
