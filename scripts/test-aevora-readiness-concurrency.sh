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


# Two concurrent autonomous-creation gate calls must serialize on the policy row.
# The first transaction holds the policy lock through its simulated creation;
# the second must re-evaluate weekly caps after the first commits.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
update public.taleforge_autonomous_creation_policy
set enabled = true,
    max_total_production_series = 12,
    max_unpublished_autonomous_series = 2,
    max_autonomous_creations_per_7d = 1,
    min_opportunity_score = 75,
    min_concept_overall_score = 75,
    exclude_internal_test_series = true
where policy_key = 'production';

update public.taleforge_autonomous_series_creation_runs
set status = 'blocked'
where status = 'created' and created_at >= now() - interval '7 days';

insert into public.taleforge_story_opportunities(id, opportunity_score, title)
values
  ('00000000-0000-0000-0000-000000000201', 90, 'Concurrent opportunity A'),
  ('00000000-0000-0000-0000-000000000202', 90, 'Concurrent opportunity B');
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-creation-gate-lock-holder.log 2>&1 <<'SQL' &
begin;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
do $first_gate$
declare
  v_gate jsonb;
begin
  v_gate := public.taleforge_check_autonomous_creation_gate(
    '00000000-0000-0000-0000-000000000201', 90
  );
  if coalesce((v_gate->>'allowed')::boolean, false) is not true then
    raise exception 'ASSERTION_FAILED: first autonomous creation gate was unexpectedly blocked: %', v_gate;
  end if;
end;
$first_gate$;
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000004', 'Concurrent created series A', 'ongoing', 'ai_original', 'pending');
insert into public.taleforge_autonomous_series_creation_runs(
  id, series_id, opportunity_id, status, dry_run
) values (
  '00000000-0000-0000-0000-000000000030',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000201',
  'created', false
);
select pg_sleep(1);
commit;
SQL
creation_gate_lock_pid=$!
sleep 0.2

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-creation-gate-second.log 2>&1 <<'SQL'
begin;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
select public.taleforge_check_autonomous_creation_gate(
  '00000000-0000-0000-0000-000000000202', 90
);
commit;
SQL
wait "$creation_gate_lock_pid"

if ! grep -q "weekly_autonomous_creation_cap_reached" /tmp/aevora-creation-gate-second.log; then
  cat /tmp/aevora-creation-gate-lock-holder.log /tmp/aevora-creation-gate-second.log >&2
  echo "ASSERTION_FAILED: concurrent autonomous creation bypassed the weekly policy cap" >&2
  exit 1
fi
echo "autonomous creation policy concurrency assertion passed"


# Concurrent schedule writers must serialize on the parent series row. The
# schema's unique series_id constraint must reject the second insert after it
# waits for the first writer; no duplicate/ambiguous schedule may persist.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000005', 'Concurrent schedule fixture', 'draft', 'ai_original', 'pending');
delete from public.release_schedules
where series_id = '00000000-0000-0000-0000-000000000005';
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-schedule-writer-a.log 2>&1 <<'SQL' &
begin;
insert into public.release_schedules(
  id, series_id, enabled, auto_generate, auto_publish, schedule_mode,
  interval_hours, timezone, chapters_ahead, automation_ready_at
) values (
  '00000000-0000-0000-0000-000000000501',
  '00000000-0000-0000-0000-000000000005',
  false, false, false, 'interval', 24, 'Asia/Kolkata', 3, null
);
select pg_sleep(1);
commit;
SQL
schedule_writer_a_pid=$!
sleep 0.2

if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-schedule-writer-b.log 2>&1 <<'SQL'
insert into public.release_schedules(
  id, series_id, enabled, auto_generate, auto_publish, schedule_mode,
  interval_hours, timezone, chapters_ahead, automation_ready_at
) values (
  '00000000-0000-0000-0000-000000000502',
  '00000000-0000-0000-0000-000000000005',
  false, false, false, 'interval', 24, 'Asia/Kolkata', 3, null
);
SQL
then
  echo "ASSERTION_FAILED: concurrent second schedule insert bypassed the unique series_id constraint" >&2
  wait "$schedule_writer_a_pid"
  exit 1
fi
wait "$schedule_writer_a_pid"

if ! grep -q "duplicate key value violates unique constraint" /tmp/aevora-schedule-writer-b.log; then
  cat /tmp/aevora-schedule-writer-a.log /tmp/aevora-schedule-writer-b.log >&2
  echo "ASSERTION_FAILED: second schedule writer failed for an unexpected reason" >&2
  exit 1
fi

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $assert$
declare
  v_count integer;
  v_unsafe integer;
begin
  select count(*), count(*) filter (
    where enabled or auto_generate or auto_publish or automation_ready_at is not null
  )
  into v_count, v_unsafe
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000005';

  if v_count <> 1 or v_unsafe <> 0 then
    raise exception 'ASSERTION_FAILED: concurrent schedule insert left unexpected or active rows (count %, unsafe %)', v_count, v_unsafe;
  end if;
end;
$assert$;
select 'release schedule writer concurrency assertion passed' as result;
SQL


# A stale service-role worker that updates automation flags after a readiness
# transaction commits must revoke readiness. This exercises the real row-lock
# interleaving rather than only a sequential trigger assertion.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000009', 'Concurrent stale-worker fixture', 'ongoing', 'ai_original', 'pending')
on conflict (id) do nothing;

update public.release_schedules
set schedule_mode = 'interval', interval_hours = 24, timezone = 'Asia/Kolkata',
    chapters_ahead = 3, next_release_at = now(), enabled = false,
    auto_generate = false, auto_publish = false, automation_ready_at = null
where series_id = '00000000-0000-0000-0000-000000000009';

insert into public.taleforge_autonomous_series_creation_runs(
  id, series_id, status, dry_run, pipeline_snapshot
) values (
  '00000000-0000-0000-0000-000000000031',
  '00000000-0000-0000-0000-000000000009',
  'created', false,
  jsonb_build_object(
    'series_id', '00000000-0000-0000-0000-000000000009',
    'lifecycle_initialized', true,
    'release_schedule_initialized', true
  )
) on conflict (id) do nothing;

update public.story_lifecycle
set metadata = jsonb_build_object('autonomous_creation_run_id', '00000000-0000-0000-0000-000000000031')
where series_id = '00000000-0000-0000-0000-000000000009';
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-readiness-writer-a.log 2>&1 <<'SQL' &
begin;
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
select public.taleforge_mark_release_automation_ready(
  (select id from public.release_schedules
   where series_id = '00000000-0000-0000-0000-000000000009')
);
select pg_sleep(1);
commit;
SQL
readiness_writer_pid=$!
sleep 0.2

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 > /tmp/aevora-readiness-writer-b.log 2>&1 <<'SQL'
begin;
set role service_role;
update public.release_schedules
set auto_publish = false
where series_id = '00000000-0000-0000-0000-000000000009';
commit;
SQL
wait "$readiness_writer_pid"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
do $stale_worker_interleave_assert$
begin
  if exists (
    select 1 from public.release_schedules
    where series_id = '00000000-0000-0000-0000-000000000009'
      and (automation_ready_at is not null or enabled or auto_generate or auto_publish)
  ) then
    raise exception 'ASSERTION_FAILED: stale worker retained readiness after concurrent automation-flag mutation';
  end if;
end;
$stale_worker_interleave_assert$;
select 'concurrent stale-worker readiness revocation assertion passed' as result;
SQL
