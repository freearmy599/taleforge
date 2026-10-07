-- TaleForge: governed Character/Relationship Continuity, World State, and Narrative Memory coverage
-- This layer reuses the existing character/world/continuity data model; it does not fabricate missing story data.

insert into public.taleforge_system_registry
(system_key,display_name,domain,status,authority_level,criticality,description,health_check_prefix)
values
('character_continuity','Character & Relationship Continuity','story_intelligence','active',95,'critical','Governed character state, relationship evolution, knowledge, goals, and continuity events across published story history.','character_continuity_integrity'),
('world_state','World State Engine','story_intelligence','active',95,'critical','Governed world elements, rules, knowledge boundaries, state changes, and world continuity history.','world_state_integrity'),
('narrative_memory','Narrative Memory','story_intelligence','building',95,'critical','Long-running narrative memory assembled from continuity state, chapter snapshots, character/world events, and unresolved story state.','narrative_memory_integrity')
on conflict (system_key) do update set
display_name=excluded.display_name, domain=excluded.domain, status=excluded.status,
authority_level=excluded.authority_level, criticality=excluded.criticality,
description=excluded.description, health_check_prefix=excluded.health_check_prefix, updated_at=now();

insert into public.taleforge_system_dependencies(system_key,depends_on_system_key,dependency_type)
values
('character_continuity','story_dna','required'),
('character_continuity','story_identity','required'),
('character_continuity','continuity','required'),
('world_state','story_dna','required'),
('world_state','story_identity','required'),
('world_state','continuity','required'),
('narrative_memory','character_continuity','required'),
('narrative_memory','world_state','required'),
('narrative_memory','continuity','required'),
('narrative_memory','canon','required')
on conflict do nothing;

create or replace function public.taleforge_verify_character_world_memory()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  production_series int; character_series int; character_invalid int; relationship_invalid int;
  world_series int; world_invalid int; continuity_series int; snapshot_series int; event_series int;
  malformed int := 0; coverage_gaps int := 0; health_status text; result jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'service_role required'; end if;

  select count(*) into production_series from public.series s
  where not (coalesce(s.description,'') ilike '%temporary internal series%' or coalesce(s.ai_disclosure,'') ilike '%internal test content%')
    and coalesce(s.status,'') not in ('archived','deleted');

  select count(distinct sc.series_id) into character_series from public.story_characters sc join public.series s on s.id=sc.series_id
  where not (coalesce(s.description,'') ilike '%temporary internal series%' or coalesce(s.ai_disclosure,'') ilike '%internal test content%');

  select count(*) into character_invalid from public.story_characters sc
  where sc.series_id in (select s.id from public.series s where not (coalesce(s.description,'') ilike '%temporary internal series%' or coalesce(s.ai_disclosure,'') ilike '%internal test content%'))
    and (nullif(trim(sc.name),'') is null or sc.current_state is null or sc.knowledge_state is null);

  select count(*) into relationship_invalid from public.character_relationships cr
  where cr.character_a_id=cr.character_b_id or nullif(trim(cr.relationship_type),'') is null or (cr.strength is not null and cr.strength < 0);

  select count(distinct we.series_id) into world_series from public.story_world_elements we join public.series s on s.id=we.series_id
  where not (coalesce(s.description,'') ilike '%temporary internal series%' or coalesce(s.ai_disclosure,'') ilike '%internal test content%');

  select count(*) into world_invalid from public.story_world_elements we
  where nullif(trim(we.name),'') is null or nullif(trim(we.element_type),'') is null or we.properties is null or we.rules is null;

  select count(distinct cs.series_id) into continuity_series from public.story_continuity_state cs where cs.current_chapter_number is not null and cs.current_chapter_number >= 0;
  select count(distinct ss.series_id) into snapshot_series from public.chapter_continuity_snapshots ss;
  select count(distinct x.series_id) into event_series from (select series_id from public.character_continuity_events union select series_id from public.world_continuity_events) x;

  malformed := character_invalid + relationship_invalid + world_invalid;
  coverage_gaps := case when character_series < production_series then 1 else 0 end + case when world_series < production_series then 1 else 0 end;
  health_status := case when malformed>0 then 'fail' when coverage_gaps>0 then 'warn' else 'pass' end;

  result := jsonb_build_object('production_series',production_series,'character_series_covered',character_series,'invalid_characters',character_invalid,'invalid_relationships',relationship_invalid,'world_series_covered',world_series,'invalid_world_elements',world_invalid,'continuity_series_covered',continuity_series,'snapshot_series_covered',snapshot_series,'event_series_covered',event_series,'coverage_gaps',coverage_gaps,'status',upper(health_status));

  insert into public.taleforge_system_checks(check_key,category,status,score,details,checked_at)
  values
    ('character_continuity_integrity','story_intelligence',health_status,case when health_status='pass' then 100 when health_status='warn' then 70 else 0 end,result,now()),
    ('world_state_integrity','story_intelligence',health_status,case when health_status='pass' then 100 when health_status='warn' then 70 else 0 end,result,now()),
    ('narrative_memory_integrity','story_intelligence',health_status,case when health_status='pass' then 100 when health_status='warn' then 70 else 0 end,result,now());
  perform public.taleforge_refresh_system_health();
  return result;
end; $$;

revoke all on function public.taleforge_verify_character_world_memory() from public,anon,authenticated;
grant execute on function public.taleforge_verify_character_world_memory() to service_role;
