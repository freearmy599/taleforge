create or replace function public.taleforge_verify_story_blueprint()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_series integer;
  covered_series integer;
  invalid_blueprints integer;
  status text;
  score numeric;
begin
  select count(*) into total_series from public.series;
  select count(distinct series_id) into covered_series
  from public.story_blueprints
  where generation_status not in ('failed','blocked');

  select count(*) into invalid_blueprints
  from public.story_blueprints
  where coalesce(trim(premise),'') = ''
     or coalesce(trim(hook),'') = ''
     or version < 1;

  if total_series = 0 then
    status := 'pass'; score := 100;
  elsif covered_series = total_series and invalid_blueprints = 0 then
    status := 'pass'; score := 100;
  elsif covered_series > 0 and invalid_blueprints = 0 then
    status := 'warn'; score := greatest(0, round(100.0 * covered_series / total_series, 2));
  else
    status := 'warn'; score := greatest(0, round(100.0 * (covered_series::numeric / greatest(total_series,1)) * 0.8, 2));
  end if;

  insert into public.taleforge_system_checks(check_key,category,status,score,details)
  values ('story_blueprint_integrity','architecture',status,score,
    jsonb_build_object(
      'total_series',total_series,
      'series_with_usable_blueprint',covered_series,
      'invalid_blueprints',invalid_blueprints,
      'verified_at',now()
    ));
end;
$$;

create or replace function public.taleforge_verify_publication_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_count integer;
  failed_count integer;
  stale_processing integer;
  check_status text;
  check_score numeric;
begin
  select count(*) into pending_count
  from public.publication_sync_outbox o
  where o.status in ('pending','processing');

  select count(*) into failed_count
  from public.publication_sync_outbox o
  where o.status = 'failed';

  select count(*) into stale_processing
  from public.publication_sync_outbox o
  where o.status = 'processing'
    and coalesce(o.locked_at, o.created_at) < now() - interval '30 minutes';

  if stale_processing > 0 or failed_count > 0 then
    check_status := 'warn'; check_score := 70;
  else
    check_status := 'pass'; check_score := 100;
  end if;

  insert into public.taleforge_system_checks(check_key,category,status,score,details)
  values ('publication_sync_integrity','publishing',check_status,check_score,
    jsonb_build_object(
      'pending_or_processing',pending_count,
      'failed',failed_count,
      'stale_processing',stale_processing,
      'verified_at',now()
    ));
end;
$$;

create or replace function public.taleforge_verify_reader_progress()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invalid_rows integer;
  orphan_rows integer;
  status text;
  score numeric;
begin
  select count(*) into invalid_rows
  from public.reading_history
  where progress_percent < 0
     or progress_percent > 100
     or (completed = true and progress_percent < 100);

  select count(*) into orphan_rows
  from public.reading_history rh
  left join public.stories s on s.id = rh.story_id
  where s.id is null;

  if invalid_rows > 0 or orphan_rows > 0 then
    status := 'warn'; score := 70;
  else
    status := 'pass'; score := 100;
  end if;

  insert into public.taleforge_system_checks(check_key,category,status,score,details)
  values ('reader_progress_integrity','reader',status,score,
    jsonb_build_object(
      'reading_history_rows',(select count(*) from public.reading_history),
      'invalid_rows',invalid_rows,
      'orphan_rows',orphan_rows,
      'verified_at',now()
    ));
end;
$$;

revoke execute on function public.taleforge_verify_story_blueprint() from public, anon, authenticated;
revoke execute on function public.taleforge_verify_publication_sync() from public, anon, authenticated;
revoke execute on function public.taleforge_verify_reader_progress() from public, anon, authenticated;
grant execute on function public.taleforge_verify_story_blueprint() to service_role;
grant execute on function public.taleforge_verify_publication_sync() to service_role;
grant execute on function public.taleforge_verify_reader_progress() to service_role;

update public.taleforge_system_registry
set health_check_prefix='story_blueprint_integrity', updated_at=now()
where system_key='story_blueprint';

update public.taleforge_system_registry
set health_check_prefix='publication_sync_integrity', updated_at=now()
where system_key='publication_sync';

update public.taleforge_system_registry
set health_check_prefix='reader_progress_integrity', updated_at=now()
where system_key='reader_progress';
