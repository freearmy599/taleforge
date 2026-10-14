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

-- Simulate a historical duplicate schedule. Terminal transitions must
-- disable and de-authorize every schedule for the series, not an arbitrary row.
insert into public.release_schedules(
  series_id, enabled, schedule_mode, interval_hours, timezone,
  chapters_ahead, auto_generate, auto_publish, automation_ready_at
) values (
  '00000000-0000-0000-0000-000000000002',
  false, 'interval', 24, 'Asia/Kolkata', 3, false, false, null
);

-- Completed status revokes readiness and disables every automatic flag.
update public.series
set status = 'completed'
where id = '00000000-0000-0000-0000-000000000002';

do $
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
$;

select 'release readiness migration integration assertions passed' as result;
