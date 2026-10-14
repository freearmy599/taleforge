-- Aevora autonomous release readiness gate.
-- Branch-only migration. Existing rows remain unready until reviewed and explicitly activated.
begin;

alter table public.release_schedules
  add column if not exists automation_ready_at timestamptz;

create index if not exists release_schedules_ready_due_idx
  on public.release_schedules (next_release_at, id)
  where enabled = true and auto_publish = true and automation_ready_at is not null;

-- Stop legacy Edge Function versions from continuing scheduled generation
-- during the migration-first rollout window. Rows remain unready; no backfill.
update public.release_schedules
set enabled = false,
    auto_generate = false,
    auto_publish = false,
    updated_at = now()
where automation_ready_at is null
  and (auto_generate = true or auto_publish = true);

create or replace function public.taleforge_protect_release_automation_readiness()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  -- Manual schedules must never carry automatic generation/publication flags.
  if new.schedule_mode = 'manual'
     and (new.auto_generate = true or new.auto_publish = true) then
    raise exception 'manual schedules cannot enable automatic generation or publication';
  end if;

  -- A NULL marker means the schedule is not authorized for autonomous work.
  -- Reject legacy service-role writes too, so an old runner cannot re-enable it.
  if new.automation_ready_at is null
     and (new.auto_generate = true or new.auto_publish = true
          or (new.enabled = true and new.schedule_mode <> 'manual')) then
    raise exception 'automation readiness is required before enabling a release schedule';
  end if;

  if new.automation_ready_at is distinct from old.automation_ready_at
     and new.automation_ready_at is not null
     and coalesce(pg_catalog.current_setting('aevora.release_readiness_rpc', true), '') <> 'on' then
    raise exception 'automation_ready_at can only be set by the readiness RPC';
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_protect_release_automation_readiness on public.release_schedules;
create trigger trg_protect_release_automation_readiness
before insert or update of automation_ready_at, enabled, auto_generate, auto_publish, schedule_mode on public.release_schedules
for each row
execute function public.taleforge_protect_release_automation_readiness();

create or replace function public.taleforge_enroll_series_in_production()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  schedule_id uuid;
  ready_at timestamptz;
begin
  insert into public.story_lifecycle(series_id, lifecycle_status)
  values (new.id, 'preparing')
  on conflict (series_id) do nothing;

  select rs.id, rs.automation_ready_at
    into schedule_id, ready_at
  from public.release_schedules rs
  where rs.series_id = new.id
  order by rs.created_at
  limit 1;

  if schedule_id is null then
    insert into public.release_schedules(
      series_id, enabled, schedule_mode, interval_hours, timezone,
      chapters_ahead, auto_generate, auto_publish, automation_ready_at
    )
    values (
      new.id, false, 'interval', 8, 'UTC',
      12, false, false, null
    );
  elsif new.status in ('completed', 'hiatus', 'cancelled') then
    update public.release_schedules
    set enabled = false,
        auto_generate = false,
        auto_publish = false,
        automation_ready_at = null,
        updated_at = now()
    where id = schedule_id;
  elsif new.status = 'ongoing' and ready_at is null then
    update public.release_schedules
    set enabled = false,
        auto_generate = false,
        auto_publish = false,
        updated_at = now()
    where id = schedule_id;
  end if;

  return new;
end;
$function$;

create or replace function public.taleforge_mark_release_automation_ready(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_schedule public.release_schedules%rowtype;
  v_series public.series%rowtype;
  v_series_id uuid;
  v_run_id uuid;
  v_snapshot jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  -- Lock order matches the enrollment trigger: series first, schedule second.
  -- Read the parent ID without locking, then lock and revalidate both rows.
  select rs.series_id into v_series_id
  from public.release_schedules rs
  where rs.id = p_schedule_id;

  if not found then
    raise exception 'release schedule not found';
  end if;

  select s.* into v_series
  from public.series s
  where s.id = v_series_id
  for update;

  if not found or v_series.status <> 'ongoing' then
    raise exception 'series must exist and be ongoing';
  end if;

  -- Match enrollment's remaining lock order: lifecycle before schedule.
  perform 1
  from public.story_lifecycle sl
  where sl.series_id = v_series.id
  for update;

  if not found then
    raise exception 'story lifecycle must exist before readiness';
  end if;

  select rs.* into v_schedule
  from public.release_schedules rs
  where rs.id = p_schedule_id
    and rs.series_id = v_series.id
  for update;

  if not found then
    raise exception 'release schedule changed during readiness verification';
  end if;

  if (select count(*) from public.release_schedules rs where rs.series_id = v_series.id) <> 1 then
    raise exception 'series must have exactly one release schedule before readiness';
  end if;

  if v_schedule.schedule_mode = 'manual'
     or (v_schedule.schedule_mode = 'interval'
         and (v_schedule.interval_hours is null or v_schedule.interval_hours <= 0))
     or (v_schedule.schedule_mode = 'weekly'
         and (v_schedule.preferred_weekday is null
              or v_schedule.preferred_weekday < 0
              or v_schedule.preferred_weekday > 6
              or v_schedule.preferred_time is null
              or nullif(btrim(v_schedule.timezone), '') is null
              or not exists (
                select 1 from pg_catalog.pg_timezone_names tz
                where tz.name = v_schedule.timezone
              )))
     or v_schedule.schedule_mode not in ('interval', 'weekly') then
    raise exception 'release schedule configuration is invalid';
  end if;

  select r.id, r.pipeline_snapshot
    into v_run_id, v_snapshot
  from public.taleforge_autonomous_series_creation_runs r
  where r.series_id = v_schedule.series_id
    and r.status = 'created'
    and r.dry_run = false
  order by r.created_at desc
  limit 1
  for update;

  if v_run_id is null
     or coalesce(v_snapshot->>'series_id', '') <> v_schedule.series_id::text
     or coalesce(v_snapshot->>'lifecycle_initialized', 'false') <> 'true'
     or coalesce(v_snapshot->>'release_schedule_initialized', 'false') <> 'true' then
    raise exception 'autonomous bootstrap audit evidence is incomplete';
  end if;

  if not exists (
    select 1
    from public.taleforge_autonomous_creation_policy p
    where p.policy_key = 'production'
      and p.enabled = true
  ) then
    raise exception 'autonomous creation policy is disabled or missing';
  end if;

  perform pg_catalog.set_config('aevora.release_readiness_rpc', 'on', true);
  update public.release_schedules
  set automation_ready_at = coalesce(automation_ready_at, now()),
      enabled = true,
      auto_generate = true,
      auto_publish = true,
      next_release_at = coalesce(next_release_at, now()),
      updated_at = now()
  where id = v_schedule.id;
  perform pg_catalog.set_config('aevora.release_readiness_rpc', 'off', true);

  update public.taleforge_autonomous_series_creation_runs
  set pipeline_snapshot = coalesce(pipeline_snapshot, '{}'::jsonb) || jsonb_build_object(
        'automation_ready', true,
        'automation_ready_at', now(),
        'automation_ready_schedule_id', v_schedule.id,
        'auto_generation_enabled', true,
        'auto_publication_enabled', true,
        'readiness_pending', false
      ),
      updated_at = now()
  where id = v_run_id;

  return jsonb_build_object(
    'ready', true,
    'schedule_id', v_schedule.id,
    'series_id', v_schedule.series_id,
    'automation_ready_at', (select rs.automation_ready_at from public.release_schedules rs where rs.id = v_schedule.id)
  );
end;
$function$;

revoke all on function public.taleforge_mark_release_automation_ready(uuid) from public, anon, authenticated;
grant execute on function public.taleforge_mark_release_automation_ready(uuid) to service_role;

commit;
