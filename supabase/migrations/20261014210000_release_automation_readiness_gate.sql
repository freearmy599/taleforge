-- Aevora autonomous release readiness gate.
-- Branch-only migration. Existing rows remain unready until reviewed and explicitly activated.
begin;

alter table public.release_schedules
  add column if not exists automation_ready_at timestamptz;

-- Release schedules are internal control-plane state. Existing RLS has no
-- client policies for this table, so remove unnecessary API-role table grants
-- rather than relying on RLS alone to block direct schedule manipulation.
revoke all privileges on table public.release_schedules from public, anon, authenticated;
revoke all privileges (id, series_id, enabled, schedule_mode, interval_hours, preferred_weekday, preferred_time, timezone, next_release_at, chapters_ahead, auto_generate, auto_publish, last_release_at, created_at, updated_at, automation_ready_at) on table public.release_schedules from public, anon, authenticated;

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

-- Serialize schedule creation against readiness activation and other schedule
-- writers by taking the parent series row lock before the schedule row exists.
-- Schedule reassignment is not a supported operation; create a new reviewed
-- schedule instead, so lock ordering remains series -> lifecycle -> schedule.
create or replace function public.taleforge_lock_release_schedule_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE' and new.series_id is distinct from old.series_id then
    raise exception 'release schedules cannot be reassigned to another series';
  end if;

  if tg_op = 'INSERT' then
    perform 1
    from public.series s
    where s.id = new.series_id
    for update;

    if not found then
      raise exception 'parent series must exist before a release schedule is created';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.taleforge_lock_release_schedule_parent() from public, anon, authenticated, service_role;

drop trigger if exists trg_lock_release_schedule_parent on public.release_schedules;
create trigger trg_lock_release_schedule_parent
before insert or update of series_id on public.release_schedules
for each row
execute function public.taleforge_lock_release_schedule_parent();

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

  -- A stale service-role worker may still try to toggle automation flags
  -- while leaving an old readiness marker intact. Revoke that marker and all
  -- automatic flags instead of allowing the old authorization to survive.
  if tg_op = 'UPDATE'
     and old.automation_ready_at is not null
     and new.automation_ready_at is not null
     and (
       new.enabled is distinct from old.enabled
       or new.auto_generate is distinct from old.auto_generate
       or new.auto_publish is distinct from old.auto_publish
     )
     and not exists (
       select 1
       from public.taleforge_release_readiness_authorizations a
       where a.transaction_id = pg_catalog.pg_current_xact_id()
         and a.schedule_id = new.id
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
  v_lifecycle_metadata jsonb;
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
  select sl.metadata into v_lifecycle_metadata
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

  -- Bind readiness to the exact creation run recorded by the runner in
  -- the locked lifecycle row; never borrow another run's evidence by recency.
  select r.id, r.pipeline_snapshot
    into v_run_id, v_snapshot
  from public.taleforge_autonomous_series_creation_runs r
  where r.id::text = coalesce(v_lifecycle_metadata->>'autonomous_creation_run_id', '')
    and r.series_id = v_schedule.series_id
    and r.status = 'created'
    and r.dry_run = false
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
      auto_publish = false,
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
        'auto_publication_enabled', false,
         'publication_approval_required', true,
        'readiness_pending', false
      ),
      updated_at = now()
  where id = v_run_id;

  return jsonb_build_object(
    'ready', true,
    'generation_enabled', true,
    'publication_enabled', false,
    'publication_approval_required', true,
    'schedule_id', v_schedule.id,
    'series_id', v_schedule.series_id,
    'automation_ready_at', (select rs.automation_ready_at from public.release_schedules rs where rs.id = v_schedule.id)
  );
end;
$function$;

revoke all on function public.taleforge_mark_release_automation_ready(uuid) from public, anon, authenticated;
grant execute on function public.taleforge_mark_release_automation_ready(uuid) to service_role;


-- Close the final status-check race at the database publication boundary.
-- Locking the parent series serializes chapter publication with completion:
-- whichever transaction acquires the series row first determines the order.
create or replace function public.taleforge_guard_chapter_publication_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_series_status text;
begin
  if new.status <> 'published'
     or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;

  select s.status into v_series_status
  from public.series s
  where s.id = new.series_id
  for update;

  if not found or v_series_status <> 'ongoing' then
    raise exception 'series must be ongoing before chapter publication';
  end if;

  return new;
end;
$function$;

revoke all on function public.taleforge_guard_chapter_publication_lifecycle() from public, anon, authenticated, service_role;

drop trigger if exists trg_guard_chapter_publication_lifecycle on public.chapters;
create trigger trg_guard_chapter_publication_lifecycle
before insert or update of status on public.chapters
for each row
execute function public.taleforge_guard_chapter_publication_lifecycle();


-- Serialize autonomous creation-policy evaluation with the enclosing series
-- creation transaction. The row lock is retained until that transaction ends,
-- so a second runner rechecks counts after the first creation commits.
create or replace function public.taleforge_check_autonomous_creation_gate(
  p_opportunity_id uuid,
  p_concept_overall_score numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  p record;
  o record;
  v_real_series integer;
  v_unpublished_autonomous integer;
  v_recent_autonomous integer;
  v_allowed boolean := true;
  v_reason text := 'allowed';
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select * into p
  from public.taleforge_autonomous_creation_policy
  where policy_key = 'production'
  for update;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'policy_missing');
  end if;

  if not p.enabled then
    return jsonb_build_object('allowed', false, 'reason', 'production_creation_disabled', 'policy_key', p.policy_key);
  end if;

  select * into o
  from public.taleforge_story_opportunities
  where id = p_opportunity_id;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'opportunity_missing');
  end if;

  if coalesce(o.opportunity_score, 0) < p.min_opportunity_score then
    return jsonb_build_object('allowed', false, 'reason', 'opportunity_score_below_threshold',
      'opportunity_score', coalesce(o.opportunity_score, 0), 'minimum', p.min_opportunity_score);
  end if;

  if p_concept_overall_score is not null and p_concept_overall_score < p.min_concept_overall_score then
    return jsonb_build_object('allowed', false, 'reason', 'concept_score_below_threshold',
      'concept_overall_score', p_concept_overall_score, 'minimum', p.min_concept_overall_score);
  end if;

  select count(*) into v_real_series
  from public.series s
  where not (p.exclude_internal_test_series and lower(coalesce(s.title, '')) = 'taleforge autonomous pipeline test');

  if v_real_series >= p.max_total_production_series then
    return jsonb_build_object('allowed', false, 'reason', 'production_series_cap_reached',
      'real_series_count', v_real_series, 'maximum', p.max_total_production_series);
  end if;

  select count(*) into v_unpublished_autonomous
  from public.taleforge_autonomous_series_creation_runs r
  join public.series s on s.id = r.series_id
  where r.status = 'created'
    and s.status in ('draft', 'candidate', 'planned')
    and not (p.exclude_internal_test_series and lower(coalesce(s.title, '')) = 'taleforge autonomous pipeline test');

  if v_unpublished_autonomous >= p.max_unpublished_autonomous_series then
    return jsonb_build_object('allowed', false, 'reason', 'unpublished_autonomous_cap_reached',
      'unpublished_autonomous_count', v_unpublished_autonomous, 'maximum', p.max_unpublished_autonomous_series);
  end if;

  select count(*) into v_recent_autonomous
  from public.taleforge_autonomous_series_creation_runs r
  where r.status = 'created'
    and r.created_at >= now() - interval '7 days';

  if v_recent_autonomous >= p.max_autonomous_creations_per_7d then
    return jsonb_build_object('allowed', false, 'reason', 'weekly_autonomous_creation_cap_reached',
      'recent_autonomous_creations', v_recent_autonomous, 'maximum', p.max_autonomous_creations_per_7d);
  end if;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reason', v_reason,
    'real_series_count', v_real_series,
    'max_total_production_series', p.max_total_production_series,
    'unpublished_autonomous_count', v_unpublished_autonomous,
    'max_unpublished_autonomous_series', p.max_unpublished_autonomous_series,
    'recent_autonomous_creations_7d', v_recent_autonomous,
    'max_autonomous_creations_7d', p.max_autonomous_creations_per_7d,
    'min_opportunity_score', p.min_opportunity_score,
    'min_concept_overall_score', p.min_concept_overall_score
  );
end;
$function$;

revoke all on function public.taleforge_check_autonomous_creation_gate(uuid, numeric) from public, anon, authenticated;
grant execute on function public.taleforge_check_autonomous_creation_gate(uuid, numeric) to service_role;

commit;
