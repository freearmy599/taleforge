#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-migration-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014210000_release_automation_readiness_gate.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000002', 'Concurrent fixture', 'ongoing', 'ai_original', 'pending');

update public.release_schedules
set schedule_mode = 'interval', interval_hours = 24, timezone = 'Asia/Kolkata',
    chapters_ahead = 3, next_release_at = now(),
    enabled = false, auto_generate = false, auto_publish = false
where series_id = '00000000-0000-0000-0000-000000000002';

insert into public.taleforge_autonomous_series_creation_runs(
  id, series_id, status, dry_run, pipeline_snapshot
) values (
  '00000000-0000-0000-0000-000000000022',
  '00000000-0000-0000-0000-000000000002',
  'created', false,
  jsonb_build_object(
    'series_id', '00000000-0000-0000-0000-000000000002',
    'lifecycle_initialized', true,
    'release_schedule_initialized', true
  )
);

insert into public.taleforge_autonomous_creation_policy(policy_key, enabled)
values ('production', true);
SQL

# Hold the parent-series lock, then complete the series while the readiness RPC
# waits for that same lock. The RPC must re-read status and reject activation.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-readiness-lock-holder.log 2>&1 <<'SQL' &
begin;
select id from public.series
where id = '00000000-0000-0000-0000-000000000002'
for update;
select pg_sleep(1);
update public.series set status = 'completed'
where id = '00000000-0000-0000-0000-000000000002';
commit;
SQL
lock_pid=$!
sleep 0.2

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-readiness-rpc.log 2>&1 <<'SQL'
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
select public.taleforge_mark_release_automation_ready(
  (select id from public.release_schedules
   where series_id = '00000000-0000-0000-0000-000000000002')
);
SQL
then
  echo "ASSERTION_FAILED: readiness RPC activated a series concurrently completed by another transaction" >&2
  wait "$lock_pid"
  exit 1
fi

wait "$lock_pid"
if ! grep -q "series must exist and be ongoing" /tmp/aevora-readiness-rpc.log; then
  cat /tmp/aevora-readiness-rpc.log >&2
  echo "ASSERTION_FAILED: readiness RPC failed for an unexpected reason" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $assert$
declare
  v_status text;
  v_enabled boolean;
  v_generate boolean;
  v_publish boolean;
  v_ready timestamptz;
begin
  select s.status, rs.enabled, rs.auto_generate, rs.auto_publish, rs.automation_ready_at
    into v_status, v_enabled, v_generate, v_publish, v_ready
  from public.series s
  join public.release_schedules rs on rs.series_id = s.id
  where s.id = '00000000-0000-0000-0000-000000000002';

  if v_status <> 'completed' or v_enabled or v_generate or v_publish or v_ready is not null then
    raise exception 'ASSERTION_FAILED: concurrent completion left automation ready';
  end if;
end;
$assert$;
select 'release readiness concurrency assertion passed' as result;
SQL


# Publication must serialize against a concurrent transition to completed.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000003', 'Concurrent publication fixture', 'ongoing', 'ai_original', 'pending');
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-publication-lock-holder.log 2>&1 <<'SQL' &
begin;
select id from public.series
where id = '00000000-0000-0000-0000-000000000003'
for update;
select pg_sleep(1);
update public.series set status = 'completed'
where id = '00000000-0000-0000-0000-000000000003';
commit;
SQL
publication_lock_pid=$!
sleep 0.2

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-publication-race.log 2>&1 <<'SQL'
insert into public.chapters(series_id, status)
values ('00000000-0000-0000-0000-000000000003', 'published');
SQL
then
  echo "ASSERTION_FAILED: publication succeeded after a concurrent completion transaction acquired the series lock" >&2
  wait "$publication_lock_pid"
  exit 1
fi

wait "$publication_lock_pid"
if ! grep -q "series must be ongoing before chapter publication" /tmp/aevora-publication-race.log; then
  cat /tmp/aevora-publication-race.log >&2
  echo "ASSERTION_FAILED: chapter publication failed for an unexpected reason" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $assert$
begin
  if exists (
    select 1 from public.chapters
    where series_id = '00000000-0000-0000-0000-000000000003'
      and status = 'published'
  ) then
    raise exception 'ASSERTION_FAILED: published chapter persisted after series completion';
  end if;
end;
$assert$;
select 'chapter publication/completion concurrency assertion passed' as result;
SQL
