update public.taleforge_system_registry
set health_check_prefix = case system_key
  when 'generation' then 'generation_queue'
  when 'quality' then 'quality_gate'
  when 'continuity' then 'continuity_gate'
  when 'publication' then 'published_content'
  when 'release_scheduler' then 'production_buffer'
  when 'canon' then 'published_content'
  when 'revision' then 'review_coverage'
  when 'verification' then 'production_buffer'
  else health_check_prefix
end,
updated_at = now()
where system_key in ('generation','quality','continuity','publication','release_scheduler','canon','revision','verification');

create or replace function public.taleforge_refresh_system_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  reg record;
  dep_system record;
  latest_status text;
  latest_score numeric;
  latest_checked timestamptz;
  final_status text;
  final_score numeric;
  reason text;
  ev jsonb;
  refreshed integer := 0;
begin
  for reg in select system_key, health_check_prefix from public.taleforge_system_registry loop
    latest_status := null;
    latest_score := null;
    latest_checked := null;
    final_status := 'unknown';
    final_score := null;
    reason := null;
    ev := '{}'::jsonb;

    if reg.health_check_prefix is not null then
      select c.status, c.score, c.checked_at
      into latest_status, latest_score, latest_checked
      from public.taleforge_system_checks c
      where c.check_key = reg.health_check_prefix
      order by c.checked_at desc
      limit 1;

      if latest_status = 'pass' then
        final_status := 'healthy';
        final_score := coalesce(latest_score, 100);
      elsif latest_status in ('warn','warning') then
        final_status := 'degraded';
        final_score := coalesce(latest_score, 70);
        reason := 'Latest verification check is warning.';
      elsif latest_status in ('fail','error','blocked') then
        final_status := 'blocked';
        final_score := coalesce(latest_score, 0);
        reason := 'Latest verification check failed.';
      elsif latest_status is not null then
        reason := 'Latest verification check has an unrecognized status.';
      else
        reason := 'No verification evidence has been recorded for this system.';
      end if;

      ev := jsonb_build_object(
        'check_key', reg.health_check_prefix,
        'check_status', latest_status,
        'check_score', latest_score,
        'checked_at', latest_checked
      );
    else
      reason := 'No health-check mapping configured yet.';
    end if;

    insert into public.taleforge_system_health
      (system_key, health_status, health_score, last_verified_at, blocking_reason, evidence, updated_at)
    values
      (reg.system_key, final_status, final_score, latest_checked, reason, ev, now())
    on conflict (system_key) do update set
      health_status = excluded.health_status,
      health_score = excluded.health_score,
      last_verified_at = excluded.last_verified_at,
      blocking_reason = excluded.blocking_reason,
      evidence = excluded.evidence,
      updated_at = now();

    refreshed := refreshed + 1;
  end loop;

  for i in 1..10 loop
    for dep_system in
      select h.system_key, h.health_status
      from public.taleforge_system_health h
    loop
      if dep_system.health_status <> 'blocked'
         and exists (
           select 1
           from public.taleforge_system_dependencies d
           join public.taleforge_system_health dh
             on dh.system_key = d.depends_on_system_key
           where d.system_key = dep_system.system_key
             and d.dependency_type = 'required'
             and dh.health_status = 'blocked'
         )
      then
        update public.taleforge_system_health h
        set health_status = 'blocked',
            health_score = 0,
            blocking_reason = 'Required dependency is blocked.',
            evidence = coalesce(h.evidence,'{}'::jsonb) || jsonb_build_object('blocked_by_dependency', true),
            updated_at = now()
        where h.system_key = dep_system.system_key;
      elsif dep_system.health_status = 'healthy'
        and exists (
          select 1
          from public.taleforge_system_dependencies d
          join public.taleforge_system_health dh
            on dh.system_key = d.depends_on_system_key
          where d.system_key = dep_system.system_key
            and d.dependency_type = 'required'
            and dh.health_status in ('degraded','unknown')
        )
      then
        update public.taleforge_system_health h
        set health_status = 'degraded',
            health_score = least(coalesce(h.health_score,100),70),
            blocking_reason = 'Required dependency is degraded or not yet verified.',
            evidence = coalesce(h.evidence,'{}'::jsonb) || jsonb_build_object('degraded_by_dependency', true),
            updated_at = now()
        where h.system_key = dep_system.system_key;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('refreshed_systems', refreshed, 'refreshed_at', now());
end;
$$;

revoke all on function public.taleforge_refresh_system_health() from public;
grant execute on function public.taleforge_refresh_system_health() to service_role;

create or replace view public.taleforge_system_health_snapshot as
select
  r.system_key,
  r.display_name,
  r.domain,
  r.status as registry_status,
  r.authority_level,
  r.criticality,
  h.health_status,
  h.health_score,
  h.last_verified_at,
  h.blocking_reason,
  h.evidence,
  h.updated_at
from public.taleforge_system_registry r
left join public.taleforge_system_health h on h.system_key = r.system_key;

grant select on public.taleforge_system_health_snapshot to anon, authenticated;

select public.taleforge_refresh_system_health();
