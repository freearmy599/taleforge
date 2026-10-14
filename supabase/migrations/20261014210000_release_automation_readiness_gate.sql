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
  and (auto_generate = true
       or auto_publish = true
       or (enabled = true and schedule_mode <> 'manual'));

create table if not exists public.taleforge_release_readiness_authorizations (
  transaction_id xid8 not null,
  schedule_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (transaction_id, schedule_id)
);
alter table public.taleforge_release_readiness_authorizations enable row level security;
revoke all on table public.taleforge_release_readiness_authorizations from public, anon, authenticated, service_role;

create or replace function public.taleforge_revoke_ambiguous_release_schedules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select count(*) from public.release_schedules rs where rs.series_id = new.series_id) > 1 then
    update public.release_schedules
    set enabled = false,
        auto_generate = false,
        auto_publish = false,
        automation_ready_at = null,
        updated_at = now()
    where series_id = new.series_id;
  end if;
  return new;
end;
$function$;

revoke all on function public.taleforge_revoke_ambiguous_release_schedules() from public, anon, authenticated, service_role;

drop trigger if exists trg_revoke_ambiguous_release_schedules on public.release_schedules;
create trigger trg_revoke_ambiguous_release_schedules
after insert or update of series_id on public.release_schedules
for each row
execute function public.taleforge_revoke_ambiguous_release_schedules();

create or replace function public.taleforge_protect_release_automation_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and new.series_id is distinct from old.series_id
     and (old.automation_ready_at is not null
          or old.auto_generate = true
          or old.auto_publish = true) then
    raise exception 'ready or automatic release schedules cannot be reassigned to another series';
  end if;

  -- A ready schedule's cadence/configuration is part of the approved
  -- readiness decision. Changes to those fields revoke readiness atomically;
  -- next_release_at is deliberately excluded because the scheduler advances it.
  if tg_op = 'UPDATE'
     and old.automation_ready_at is not null
     and (
       new.schedule_mode is distinct from old.schedule_mode
       or new.interval_hours is distinct from old.interval_hours
       or new.timezone is distinct from old.timezone
       or new.chapters_ahead is distinct from old.chapters_ahead
       or new.preferred_weekday is distinct from old.preferred_weekday
       or new.preferred_time is distinct from old.preferred_time
     ) then
    new.automation_ready_at := null;
    new.enabled := false;
    new.auto_generate := false;
    new.auto_publish := false;
    new.updated_at := now();
  end if;

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
     and not exists (
       select 1
       from public.taleforge_release_readiness_authorizations a
       where a.transaction_id = pg_catalog.pg_current_xact_id()
         and a.schedule_id = new.id
     ) then
    raise exception 'automation_ready_at can only be set by the readiness RPC';
  end if;
  return new;
end;
$function$;

revoke all on function public.taleforge_protect_release_automation_readiness() from public, anon, authenticated, service_role;

drop trigger if exists trg_protect_release_automation_readiness on public.release_schedules;
create trigger trg_protect_release_automation_readiness
before insert or update of series_id, automation_ready_at, enabled, auto_generate, auto_publish, schedule_mode, interval_hours, timezone, chapters_ahead, preferred_weekday, preferred_time on public.release_schedules
for each row
execute function public.taleforge_protect_release_automation_readiness();

create or replace function public.taleforge_enroll_series_in_production()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  schedule_count bigint;
  ready_count bigint;
begin
  insert into public.story_lifecycle(series_id, lifecycle_status)
  values (new.id, 'preparing')
  on conflict (series_id) do nothing;

  select count(*), count(*) filter (where rs.automation_ready_at is not null)
    into schedule_count, ready_count
  from public.release_schedules rs
  where rs.series_id = new.id;

  if schedule_count = 0 then
    insert into public.release_schedules(
      series_id, enabled, schedule_mode, interval_hours, timezone,
      chapters_ahead, auto_generate, auto_publish, automation_ready_at
    )
    values (
      new.id, false, 'interval', 8, 'UTC',
      12, false, false, null
    );
    schedule_count := 1;
    ready_count := 0;
  end if;

  -- Terminal/ineligible lifecycle states must disable every schedule, not
  -- only an arbitrary first row if historical duplicate schedules exist.
  if new.status <> 'ongoing' or schedule_count <> 1 then
    update public.release_schedules
    set enabled = false,
        auto_generate = false,
        auto_publish = false,
        automation_ready_at = null,
        updated_at = now()
    where series_id = new.id;
  elsif new.status = 'ongoing' and ready_count = 0 then
    update public.release_schedules
    set enabled = false,
        auto_generate = false,
        auto_publish = false,
        updated_at = now()
    where series_id = new.id;
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
     or v_schedule.chapters_ahead is null
     or v_schedule.chapters_ahead < 1
     or v_schedule.chapters_ahead > 12
     or (v_schedule.schedule_mode = 'interval'
         and (v_schedule.interval_hours is null
              or v_schedule.interval_hours < 1
              or v_schedule.interval_hours > 168))
     or (v_schedule.schedule_mode = 'weekly'
         and (v_schedule.preferred_weekday is null
              or v_schedule.preferred_weekday < 0
              or v_schedule.preferred_weekday > 6
              or v_schedule.preferred_time is null
              or v_schedule.next_release_at is null
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

  -- A series that was previously marked ready must not be silently revived
  -- by reusing its original creation-run evidence after a lifecycle reset.
  if coalesce(v_snapshot->>'automation_ready', 'false') = 'true' then
    raise exception 'fresh audited approval is required to reactivate a previously ready series';
  end if;

  if not exists (
    select 1
    from public.taleforge_autonomous_creation_policy p
    where p.policy_key = 'production'
      and p.enabled = true
  ) then
    raise exception 'autonomous creation policy is disabled or missing';
  end if;

  insert into public.taleforge_release_readiness_authorizations(transaction_id, schedule_id)
  values (pg_catalog.pg_current_xact_id(), v_schedule.id)
  on conflict (transaction_id, schedule_id) do nothing;

  update public.release_schedules
  set automation_ready_at = coalesce(automation_ready_at, now()),
      enabled = true,
      auto_generate = true,
      auto_publish = true,
      next_release_at = coalesce(next_release_at, now()),
      updated_at = now()
  where id = v_schedule.id;
  delete from public.taleforge_release_readiness_authorizations
  where transaction_id = pg_catalog.pg_current_xact_id()
    and schedule_id = v_schedule.id;

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
