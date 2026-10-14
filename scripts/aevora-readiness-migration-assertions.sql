\set ON_ERROR_STOP on

do $$
declare
  v_enabled boolean;
  v_auto_generate boolean;
  v_auto_publish boolean;
  v_ready timestamptz;
begin
  select enabled, auto_generate, auto_publish, automation_ready_at
    into v_enabled, v_auto_generate, v_auto_publish, v_ready
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000001';

  if v_enabled or v_auto_generate or v_auto_publish or v_ready is not null then
    raise exception 'ASSERTION_FAILED: legacy schedule was not safely disabled and left unready';
  end if;
end;
$$;

-- An old service-role runner cannot re-enable an unready interval schedule.
do $$
begin
  begin
    update public.release_schedules
    set enabled = true, auto_generate = true
    where series_id = '00000000-0000-0000-0000-000000000001';
    raise exception 'ASSERTION_FAILED: legacy runner unexpectedly re-enabled unready schedule';
  exception when others then
    if sqlerrm like 'ASSERTION_FAILED:%' then raise; end if;
    if sqlerrm not like 'automation readiness is required before enabling a release schedule%' then raise; end if;
  end;
end;
$$;

-- An enabled manual schedule with both automation flags false remains valid.
update public.release_schedules
set schedule_mode = 'manual', enabled = true, auto_generate = false, auto_publish = false
where series_id = '00000000-0000-0000-0000-000000000001';

-- Manual mode may remain enabled for human-controlled workflows, but cannot
-- accidentally retain automatic generation or publication flags.
do $manual_assert$
begin
  begin
    update public.release_schedules
    set auto_publish = true
    where series_id = '00000000-0000-0000-0000-000000000001';
    raise exception 'ASSERTION_FAILED: manual schedule accepted auto-publication';
  exception when others then
    if sqlerrm like 'ASSERTION_FAILED:%' then raise; end if;
    if sqlerrm not like 'manual schedules cannot enable automatic generation or publication%' then raise; end if;
  end;
end;
$manual_assert$;

-- Direct service-role writes cannot set the readiness marker outside the RPC.
select pg_catalog.set_config('request.jwt.claim.role', 'service_role', false);
do $$
begin
  begin
    update public.release_schedules
    set automation_ready_at = now()
    where series_id = '00000000-0000-0000-0000-000000000001';
    raise exception 'ASSERTION_FAILED: direct readiness marker write unexpectedly succeeded';
  exception when others then
    if sqlerrm like 'ASSERTION_FAILED:%' then raise; end if;
    if sqlerrm not like 'automation_ready_at can only be set by the readiness RPC%' then raise; end if;
  end;
end;
$$;

-- A new ongoing series is enrolled inertly, then activated only with audited evidence.
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000002', 'Autonomous fixture', 'ongoing', 'ai_original', 'pending');

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

select public.taleforge_mark_release_automation_ready(
  (select id from public.release_schedules where series_id='00000000-0000-0000-0000-000000000002')
);

do $$
declare
  v_enabled boolean;
  v_auto_generate boolean;
  v_auto_publish boolean;
  v_ready timestamptz;
begin
  select enabled, auto_generate, auto_publish, automation_ready_at
    into v_enabled, v_auto_generate, v_auto_publish, v_ready
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000002';

  if not v_enabled or not v_auto_generate or not v_auto_publish or v_ready is null then
    raise exception 'ASSERTION_FAILED: readiness RPC did not atomically enable the audited schedule';
  end if;
end;
$$;

-- A transition to any non-ongoing status revokes readiness, even if the
-- status is not one of the common terminal values.
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000003', 'Lifecycle transition fixture', 'ongoing', 'ai_original', 'pending');

update public.release_schedules
set schedule_mode = 'interval', interval_hours = 24, timezone = 'Asia/Kolkata',
    chapters_ahead = 3, next_release_at = now()
where series_id = '00000000-0000-0000-0000-000000000003';

insert into public.taleforge_autonomous_series_creation_runs(
  id, series_id, status, dry_run, pipeline_snapshot
) values (
  '00000000-0000-0000-0000-000000000023',
  '00000000-0000-0000-0000-000000000003',
  'created', false,
  jsonb_build_object(
    'series_id', '00000000-0000-0000-0000-000000000003',
    'lifecycle_initialized', true,
    'release_schedule_initialized', true
  )
);

select public.taleforge_mark_release_automation_ready(
  (select id from public.release_schedules where series_id='00000000-0000-0000-0000-000000000003')
);

update public.series set status = 'preparing'
where id = '00000000-0000-0000-0000-000000000003';

do $lifecycle_assert$
declare
  v_enabled_count bigint;
  v_generate_count bigint;
  v_publish_count bigint;
  v_ready_count bigint;
begin
  select count(*) filter (where enabled),
         count(*) filter (where auto_generate),
         count(*) filter (where auto_publish),
         count(*) filter (where automation_ready_at is not null)
    into v_enabled_count, v_generate_count, v_publish_count, v_ready_count
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000003';

  if v_enabled_count <> 0 or v_generate_count <> 0
     or v_publish_count <> 0 or v_ready_count <> 0 then
    raise exception 'ASSERTION_FAILED: non-ongoing status retained release automation';
  end if;
end;
$lifecycle_assert$;

-- Weekly cadence must already have a computed due time; readiness may not
-- silently convert an invalid weekly schedule into an immediate release.
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000005', 'Weekly schedule fixture', 'ongoing', 'ai_original', 'pending');

update public.release_schedules
set schedule_mode = 'weekly', interval_hours = null, timezone = 'Asia/Kolkata',
    preferred_weekday = 2, preferred_time = time '20:00', chapters_ahead = 3,
    next_release_at = null
where series_id = '00000000-0000-0000-0000-000000000005';

insert into public.taleforge_autonomous_series_creation_runs(
  id, series_id, status, dry_run, pipeline_snapshot
) values (
  '00000000-0000-0000-0000-000000000025',
  '00000000-0000-0000-0000-000000000005',
  'created', false,
  jsonb_build_object(
    'series_id', '00000000-0000-0000-0000-000000000005',
    'lifecycle_initialized', true,
    'release_schedule_initialized', true
  )
);

do $weekly_assert$
begin
  begin
    perform public.taleforge_mark_release_automation_ready(
      (select id from public.release_schedules
       where series_id='00000000-0000-0000-0000-000000000005')
    );
    raise exception 'ASSERTION_FAILED: weekly schedule without next_release_at was activated';
  exception when others then
    if sqlerrm like 'ASSERTION_FAILED:%' then raise; end if;
    if sqlerrm not like 'release schedule configuration is invalid%' then raise; end if;
  end;
end;
$weekly_assert$;

do $weekly_state_assert$
declare
  v_enabled boolean;
  v_generate boolean;
  v_publish boolean;
  v_ready timestamptz;
begin
  select enabled, auto_generate, auto_publish, automation_ready_at
    into v_enabled, v_generate, v_publish, v_ready
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000005';

  if v_enabled or v_generate or v_publish or v_ready is not null then
    raise exception 'ASSERTION_FAILED: invalid weekly schedule partially activated';
  end if;
end;
$weekly_state_assert$;

-- Fault-injection only: production has a UNIQUE(series_id) constraint. Drop it
-- after the faithful-schema assertions to prove defensive gates fail closed if
-- that invariant is ever lost in a future schema regression.
alter table public.release_schedules drop constraint release_schedules_series_id_key;

-- Readiness itself must refuse ambiguous duplicate schedules.
insert into public.series(id, title, status, origin_type, originality_status)
values ('00000000-0000-0000-0000-000000000004', 'Ambiguous schedule fixture', 'ongoing', 'ai_original', 'pending');

update public.release_schedules
set schedule_mode = 'interval', interval_hours = 24, timezone = 'Asia/Kolkata',
    chapters_ahead = 3, next_release_at = now()
where series_id = '00000000-0000-0000-0000-000000000004';

insert into public.release_schedules(
  series_id, enabled, schedule_mode, interval_hours, timezone,
  chapters_ahead, auto_generate, auto_publish, automation_ready_at
) values (
  '00000000-0000-0000-0000-000000000004',
  false, 'interval', 24, 'Asia/Kolkata', 3, false, false, null
);

insert into public.taleforge_autonomous_series_creation_runs(
  id, series_id, status, dry_run, pipeline_snapshot
) values (
  '00000000-0000-0000-0000-000000000024',
  '00000000-0000-0000-0000-000000000004',
  'created', false,
  jsonb_build_object(
    'series_id', '00000000-0000-0000-0000-000000000004',
    'lifecycle_initialized', true,
    'release_schedule_initialized', true
  )
);

do $ambiguous_assert$
begin
  begin
    perform public.taleforge_mark_release_automation_ready(
      (select id from public.release_schedules
       where series_id='00000000-0000-0000-0000-000000000004'
       order by id limit 1)
    );
    raise exception 'ASSERTION_FAILED: readiness RPC accepted duplicate schedules';
  exception when others then
    if sqlerrm like 'ASSERTION_FAILED:%' then raise; end if;
    if sqlerrm not like 'series must have exactly one release schedule before readiness%' then raise; end if;
  end;
end;
$ambiguous_assert$;

do $ambiguous_state_assert$
declare
  v_enabled_count bigint;
  v_generate_count bigint;
  v_publish_count bigint;
  v_ready_count bigint;
begin
  select count(*) filter (where enabled),
         count(*) filter (where auto_generate),
         count(*) filter (where auto_publish),
         count(*) filter (where automation_ready_at is not null)
    into v_enabled_count, v_generate_count, v_publish_count, v_ready_count
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000004';

  if v_enabled_count <> 0 or v_generate_count <> 0
     or v_publish_count <> 0 or v_ready_count <> 0 then
    raise exception 'ASSERTION_FAILED: ambiguous schedules were partially activated';
  end if;
end;
$ambiguous_state_assert$;

-- A ready schedule cannot be reassigned to a different series.
do $reassign_assert$
begin
  begin
    update public.release_schedules
    set series_id = '00000000-0000-0000-0000-000000000003'
    where series_id = '00000000-0000-0000-0000-000000000002'
      and automation_ready_at is not null;
    raise exception 'ASSERTION_FAILED: ready schedule reassignment unexpectedly succeeded';
  exception when others then
    if sqlerrm like 'ASSERTION_FAILED:%' then raise; end if;
    if sqlerrm not like 'ready or automatic release schedules cannot be reassigned to another series%' then raise; end if;
  end;
end;
$reassign_assert$;

-- Simulate a historical duplicate schedule. Terminal transitions must
-- disable and de-authorize every schedule for the series, not an arbitrary row.
insert into public.release_schedules(
  series_id, enabled, schedule_mode, interval_hours, timezone,
  chapters_ahead, auto_generate, auto_publish, automation_ready_at
) values (
  '00000000-0000-0000-0000-000000000002',
  false, 'interval', 24, 'Asia/Kolkata', 3, false, false, null
);

-- Inserting a duplicate immediately revokes the previously ready schedule.
do $duplicate_insert_assert$
declare
  v_count bigint;
  v_enabled_count bigint;
  v_generate_count bigint;
  v_publish_count bigint;
  v_ready_count bigint;
begin
  select count(*),
         count(*) filter (where enabled),
         count(*) filter (where auto_generate),
         count(*) filter (where auto_publish),
         count(*) filter (where automation_ready_at is not null)
    into v_count, v_enabled_count, v_generate_count, v_publish_count, v_ready_count
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000002';

  if v_count <> 2 or v_enabled_count <> 0 or v_generate_count <> 0
     or v_publish_count <> 0 or v_ready_count <> 0 then
    raise exception 'ASSERTION_FAILED: duplicate schedule insert did not revoke readiness';
  end if;
end;
$duplicate_insert_assert$;

-- Completed status revokes readiness and disables every automatic flag.
update public.series
set status = 'completed'
where id = '00000000-0000-0000-0000-000000000002';

do $terminal_assert$
declare
  v_count bigint;
  v_enabled_count bigint;
  v_generate_count bigint;
  v_publish_count bigint;
  v_ready_count bigint;
begin
  select count(*),
         count(*) filter (where enabled),
         count(*) filter (where auto_generate),
         count(*) filter (where auto_publish),
         count(*) filter (where automation_ready_at is not null)
    into v_count, v_enabled_count, v_generate_count, v_publish_count, v_ready_count
  from public.release_schedules
  where series_id = '00000000-0000-0000-0000-000000000002';

  if v_count <> 2 or v_enabled_count <> 0 or v_generate_count <> 0
     or v_publish_count <> 0 or v_ready_count <> 0 then
    raise exception 'ASSERTION_FAILED: completed series retained enabled or ready duplicate schedules';
  end if;
end;
$terminal_assert$;

select 'release readiness migration integration assertions passed' as result;
