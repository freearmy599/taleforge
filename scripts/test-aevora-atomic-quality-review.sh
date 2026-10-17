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

# Exercise true overlapping transactions: the first reviewer holds the output
# row while saving its review; the second request carries the same old snapshot.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE FUNCTION public.aevora_fixture_delay_quality_review_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reviewer_version = 'slow-first' THEN
    PERFORM pg_catalog.pg_sleep(3);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER aevora_fixture_delay_quality_review_write
BEFORE INSERT OR UPDATE ON public.chapter_reviews
FOR EACH ROW EXECUTE FUNCTION public.aevora_fixture_delay_quality_review_write();
SQL
first_result="$(mktemp)"
second_result="$(mktemp)"
trap 'rm -f "$first_result" "$second_result"' EXIT
psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT public.aevora_commit_quality_review(
  '00000000-0000-0000-0000-000000000004','passed',91,
  '{\"concurrent\":\"first\"}'::jsonb,'gemini-test','slow-first',
  'quality_check','{\"quality_version\":\"concurrency-v1\"}'::jsonb,
  '2000-01-01T00:00:00Z'::timestamptz
)" >"$first_result" &
first_pid=$!
sleep 0.25
psql "$DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "SELECT public.aevora_commit_quality_review(
  '00000000-0000-0000-0000-000000000004','needs_revision',10,
  '{\"concurrent\":\"stale-second\"}'::jsonb,'gemini-test','stale-second',
  'needs_revision','{\"quality_version\":\"stale-v2\"}'::jsonb,
  '2000-01-01T00:00:00Z'::timestamptz
)" >"$second_result"
wait "$first_pid"
if ! grep -q '"committed": true' "$first_result"; then
  echo "ASSERTION_FAILED: first concurrent review did not commit: $(cat "$first_result")" >&2
  exit 1
fi
if ! grep -q '"committed": false' "$second_result" || ! grep -q '"output_state_changed"' "$second_result"; then
  echo "ASSERTION_FAILED: overlapping stale review was not fenced: $(cat "$second_result")" >&2
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $concurrency$
BEGIN
  IF (SELECT generation_status FROM public.chapter_generation_outputs WHERE id='00000000-0000-0000-0000-000000000004') <> 'quality_check' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: stale concurrent review changed output state';
  END IF;
  IF (SELECT count(*) FROM public.chapter_reviews WHERE generation_output_id='00000000-0000-0000-0000-000000000004' AND review_type='quality') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.chapter_reviews WHERE generation_output_id='00000000-0000-0000-0000-000000000004' AND review_type='quality' AND status='passed' AND score=91 AND reviewer_version='slow-first') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: stale concurrent review overwrote the winning review';
  END IF;
END
$concurrency$;
SELECT 'atomic quality-review concurrent stale-writer rehearsal passed' AS result;
SQL
