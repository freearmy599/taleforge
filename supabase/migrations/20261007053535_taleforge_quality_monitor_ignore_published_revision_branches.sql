-- Keep governance focused on unresolved production work.
-- Once a chapter is published, later/superseded revision branches for that
-- chapter must not re-open the quality or continuity gate.

create or replace function public.run_taleforge_quality_monitor()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  published_series int;
  published_chapters int;
  future_generated int;
  weak_quality int;
  weak_continuity int;
  missing_ending int;
  stale_generations int;
  reviewed_outputs int;
  result jsonb;
begin
  select count(distinct c.series_id)::int into published_series
  from public.chapters c join public.series s on s.id=c.series_id
  where c.status='published'
    and coalesce(s.description,'') not ilike '%temporary internal series%'
    and coalesce(s.ai_disclosure,'') not ilike '%internal test content%';

  select count(*)::int into published_chapters
  from public.chapters c join public.series s on s.id=c.series_id
  where c.status='published'
    and coalesce(s.description,'') not ilike '%temporary internal series%'
    and coalesce(s.ai_disclosure,'') not ilike '%internal test content%';

  select count(*)::int into future_generated
  from public.chapter_blueprints b join public.series s on s.id=b.series_id
  where b.generation_status='generated' and b.release_status<>'published'
    and coalesce(s.description,'') not ilike '%temporary internal series%'
    and coalesce(s.ai_disclosure,'') not ilike '%internal test content%';

  with latest_output as (
    select distinct on (o.chapter_blueprint_id)
      o.id,o.chapter_blueprint_id,o.generation_status,o.created_at
    from public.chapter_generation_outputs o
    join public.series s on s.id=o.series_id
    where coalesce(s.description,'') not ilike '%temporary internal series%'
      and coalesce(s.ai_disclosure,'') not ilike '%internal test content%'
      and not exists (
        select 1 from public.chapters pc
        where pc.series_id=o.series_id
          and pc.chapter_number=o.chapter_number
          and pc.status='published'
      )
    order by o.chapter_blueprint_id,o.generation_attempt desc,o.created_at desc
  ),
  latest_quality as (
    select distinct on (q.generation_output_id)
      q.generation_output_id,q.status,q.reviewed_at
    from public.chapter_quality_checks q
    order by q.generation_output_id,q.created_at desc
  )
  select count(*)::int into weak_quality
  from latest_output o join latest_quality q on q.generation_output_id=o.id
  where q.status in ('needs_revision','blocked')
    and o.generation_status not in ('published');

  with latest_output as (
    select distinct on (o.chapter_blueprint_id)
      o.id,o.chapter_blueprint_id,o.generation_status,o.created_at
    from public.chapter_generation_outputs o
    join public.series s on s.id=o.series_id
    where coalesce(s.description,'') not ilike '%temporary internal series%'
      and coalesce(s.ai_disclosure,'') not ilike '%internal test content%'
      and not exists (
        select 1 from public.chapters pc
        where pc.series_id=o.series_id
          and pc.chapter_number=o.chapter_number
          and pc.status='published'
      )
    order by o.chapter_blueprint_id,o.generation_attempt desc,o.created_at desc
  ),
  latest_continuity as (
    select distinct on (c.generation_output_id)
      c.generation_output_id,c.status,c.reviewed_at
    from public.chapter_continuity_checks c
    order by c.generation_output_id,c.created_at desc
  )
  select count(*)::int into weak_continuity
  from latest_output o join latest_continuity c on c.generation_output_id=o.id
  where c.status in ('needs_revision','blocked')
    and o.generation_status not in ('published');

  with latest_output as (
    select distinct on (o.chapter_blueprint_id)
      o.id,o.generation_status
    from public.chapter_generation_outputs o
    join public.series s on s.id=o.series_id
    where coalesce(s.description,'') not ilike '%temporary internal series%'
      and coalesce(s.ai_disclosure,'') not ilike '%internal test content%'
      and not exists (
        select 1 from public.chapters pc
        where pc.series_id=o.series_id
          and pc.chapter_number=o.chapter_number
          and pc.status='published'
      )
    order by o.chapter_blueprint_id,o.generation_attempt desc,o.created_at desc
  )
  select count(*)::int into reviewed_outputs
  from latest_output o
  where o.generation_status in ('approved','published')
     or exists (select 1 from public.chapter_quality_checks q where q.generation_output_id=o.id);

  select count(*)::int into missing_ending
  from (
    select distinct c.series_id from public.chapters c
    join public.series s on s.id=c.series_id
    where c.status='published'
      and coalesce(s.description,'') not ilike '%temporary internal series%'
      and coalesce(s.ai_disclosure,'') not ilike '%internal test content%'
  ) published
  left join public.story_ending_plans ep on ep.series_id=published.series_id
  where ep.id is null;

  select count(*)::int into stale_generations
  from public.generation_jobs
  where status in ('queued','running')
    and created_at < now()-interval '2 hours';

  insert into public.taleforge_system_checks(check_key,category,status,score,details)
  values
    ('published_content','content',case when published_series>0 and published_chapters>0 then 'pass' else 'warn' end,null,jsonb_build_object('published_series',published_series,'published_chapters',published_chapters,'internal_test_series_excluded',true)),
    ('production_buffer','production',case when future_generated>0 then 'pass' else 'warn' end,null,jsonb_build_object('future_generated',future_generated,'internal_test_series_excluded',true)),
    ('quality_gate','quality',case when weak_quality=0 then 'pass' else 'warn' end,null,jsonb_build_object('current_needs_revision_or_blocked',weak_quality,'published_chapter_revision_branches_excluded',true,'internal_test_series_excluded',true)),
    ('continuity_gate','quality',case when weak_continuity=0 then 'pass' else 'warn' end,null,jsonb_build_object('current_needs_revision_or_blocked',weak_continuity,'published_chapter_revision_branches_excluded',true,'internal_test_series_excluded',true)),
    ('ending_coverage','story_integrity',case when missing_ending=0 then 'pass' else 'warn' end,null,jsonb_build_object('published_series_missing_ending_plan',missing_ending,'internal_test_series_excluded',true)),
    ('generation_queue','automation',case when stale_generations=0 then 'pass' else 'fail' end,null,jsonb_build_object('stale_jobs',stale_generations)),
    ('review_coverage','quality',case when reviewed_outputs>0 then 'pass' else 'warn' end,null,jsonb_build_object('reviewed_or_approved_current_outputs',reviewed_outputs,'published_chapter_revision_branches_excluded',true,'internal_test_series_excluded',true));

  if weak_quality=0 then
    update public.taleforge_quality_alerts set resolved_at=now()
    where alert_key='active_quality_issues' and resolved_at is null;
  else
    insert into public.taleforge_quality_alerts(alert_key,severity,message,details)
    select 'active_quality_issues','warning','Current production generation outputs still contain quality-gate failures.',jsonb_build_object('count',weak_quality)
    where not exists (select 1 from public.taleforge_quality_alerts a where a.alert_key='active_quality_issues' and a.resolved_at is null);
  end if;

  if weak_continuity=0 then
    update public.taleforge_quality_alerts set resolved_at=now()
    where alert_key='active_continuity_issues' and resolved_at is null;
  else
    insert into public.taleforge_quality_alerts(alert_key,severity,message,details)
    select 'active_continuity_issues','warning','Current production generation outputs still contain continuity-gate failures.',jsonb_build_object('count',weak_continuity)
    where not exists (select 1 from public.taleforge_quality_alerts a where a.alert_key='active_continuity_issues' and a.resolved_at is null);
  end if;

  if missing_ending=0 then
    update public.taleforge_quality_alerts set resolved_at=now()
    where alert_key='missing_ending_plan' and resolved_at is null;
  else
    insert into public.taleforge_quality_alerts(alert_key,severity,message,details)
    select 'missing_ending_plan','warning','Published story does not yet have an approved narrative destination.',jsonb_build_object('count',missing_ending)
    where not exists (select 1 from public.taleforge_quality_alerts a where a.alert_key='missing_ending_plan' and a.resolved_at is null);
  end if;

  if stale_generations=0 then
    update public.taleforge_quality_alerts set resolved_at=now()
    where alert_key='stale_generation_jobs' and resolved_at is null;
  end if;

  result:=jsonb_build_object(
    'checked_at',now(),
    'published_series',published_series,
    'published_chapters',published_chapters,
    'future_generated',future_generated,
    'quality_issues',weak_quality,
    'continuity_issues',weak_continuity,
    'missing_ending_plans',missing_ending,
    'stale_generation_jobs',stale_generations,
    'reviewed_or_approved_current_outputs',reviewed_outputs,
    'published_chapter_revision_branches_excluded',true,
    'internal_test_series_excluded',true);
  return result;
end;
$function$;