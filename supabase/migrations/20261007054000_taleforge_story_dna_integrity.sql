create or replace function public.taleforge_verify_story_dna()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  total_series integer;
  active_series integer;
  bad_series integer;
  duplicate_active integer;
  invalid_json integer;
  score numeric;
  check_status text;
  details jsonb;
begin
  select count(*) into total_series from public.series;
  select count(distinct series_id) into active_series from public.story_dna where status = 'active';

  select count(*) into bad_series
  from public.series s
  left join lateral (
    select d.* from public.story_dna d
    where d.series_id=s.id and d.status='active'
    order by d.version desc limit 1
  ) d on true
  where d.id is null
     or nullif(trim(d.core_premise),'') is null
     or nullif(trim(d.reader_promise),'') is null
     or nullif(trim(d.central_theme),'') is null
     or nullif(trim(d.narrative_voice),'') is null
     or d.version < 1;

  select count(*) into duplicate_active
  from (
    select series_id from public.story_dna where status='active'
    group by series_id having count(*) > 1
  ) x;

  select count(*) into invalid_json
  from public.story_dna d
  where d.status='active'
    and (
      jsonb_typeof(coalesce(d.protagonist_profiles,'{}'::jsonb)) not in ('object','array')
      or jsonb_typeof(coalesce(d.relationship_map,'{}'::jsonb)) not in ('object','array')
      or jsonb_typeof(coalesce(d.world_rules,'{}'::jsonb)) not in ('object','array')
      or jsonb_typeof(coalesce(d.story_constraints,'{}'::jsonb)) not in ('object','array')
      or jsonb_typeof(coalesce(d.mystery_threads,'{}'::jsonb)) not in ('object','array')
      or jsonb_typeof(coalesce(d.payoff_targets,'{}'::jsonb)) not in ('object','array')
      or jsonb_typeof(coalesce(d.forbidden_patterns,'{}'::jsonb)) not in ('object','array')
      or jsonb_typeof(coalesce(d.genre_profile,'{}'::jsonb)) not in ('object','array')
    );

  if total_series > 0 and bad_series=0 and duplicate_active=0 and invalid_json=0 and active_series=total_series then
    check_status:='pass'; score:=100;
  else
    check_status:='warn';
    score:=greatest(0,100-case when active_series<total_series then 30 else 0 end-least(bad_series*10,40)-least(duplicate_active*20,30)-least(invalid_json*5,20));
  end if;

  details:=jsonb_build_object('total_series',total_series,'series_with_active_dna',active_series,'series_with_invalid_dna',bad_series,'duplicate_active_series',duplicate_active,'active_dna_with_invalid_json',invalid_json,'verified_at',now());

  insert into public.taleforge_system_checks(check_key,category,status,score,details,checked_at)
  values('story_dna_integrity','story_architecture',check_status,score,details,now());

  return jsonb_build_object('check_key','story_dna_integrity','status',check_status,'score',score,'details',details);
end;
$$;

revoke all on function public.taleforge_verify_story_dna() from public;
grant execute on function public.taleforge_verify_story_dna() to service_role;

update public.taleforge_system_registry
set health_check_prefix='story_dna_integrity',status='active',updated_at=now()
where system_key='story_dna';

select public.taleforge_verify_story_dna();
select public.taleforge_refresh_system_health();
