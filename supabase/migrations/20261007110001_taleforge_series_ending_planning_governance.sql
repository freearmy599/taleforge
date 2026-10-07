insert into public.taleforge_system_registry(system_key,display_name,domain,status,authority_level,criticality,description,health_check_prefix)
values('ending_planning','Series Ending Planning','story_architecture','active',95,'critical','Governed series-level ending architecture defining final conflict, resolution, character/world end states, required payoffs, and closure requirements.','ending_planning_integrity')
on conflict(system_key) do update set display_name=excluded.display_name,domain=excluded.domain,status=excluded.status,authority_level=excluded.authority_level,criticality=excluded.criticality,description=excluded.description,health_check_prefix=excluded.health_check_prefix;

insert into public.taleforge_system_dependencies(system_key,depends_on_system_key,dependency_type) values
('ending_planning','story_dna','required'),('ending_planning','story_identity','required'),('ending_planning','plot_threads','recommended'),('arc_planning','ending_planning','required'),('generation_context','ending_planning','required') on conflict do nothing;

create or replace function public.taleforge_verify_ending_planning() returns jsonb language plpgsql security definer set search_path=public as $$
declare pc int; cc int; ic int; mc int; dc int; d jsonb; st text; sc int;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 select count(*) into pc from public.series s where s.description not ilike '%temporary internal series%' and s.ai_disclosure not ilike '%internal test content%';
 select count(*) into cc from public.series s where s.description not ilike '%temporary internal series%' and s.ai_disclosure not ilike '%internal test content%' and exists(select 1 from public.story_ending_plans e where e.series_id=s.id);
 select count(*) into ic from public.story_ending_plans e join public.series s on s.id=e.series_id where s.description not ilike '%temporary internal series%' and s.ai_disclosure not ilike '%internal test content%' and (coalesce(e.planned_ending_chapter,0)<1 or nullif(trim(e.final_conflict),'') is null or nullif(trim(e.final_resolution),'') is null or jsonb_typeof(e.character_end_states)<>'array' or jsonb_typeof(e.world_end_state)<>'object' or jsonb_typeof(e.required_payoffs)<>'array' or jsonb_typeof(e.required_resolutions)<>'array' or jsonb_typeof(e.required_unresolved_threads)<>'array' or jsonb_typeof(e.ending_requirements)<>'array' or e.status not in ('draft','active','approved','superseded','retired'));
 select count(*) into dc from (select e.series_id from public.story_ending_plans e join public.series s on s.id=e.series_id where s.description not ilike '%temporary internal series%' and s.ai_disclosure not ilike '%internal test content%' and e.status in ('draft','active','approved') group by e.series_id having count(*)>1) x;
 select count(*) into mc from public.story_ending_plans e join public.story_arc_plan a on a.series_id=e.series_id join public.series s on s.id=e.series_id where s.description not ilike '%temporary internal series%' and s.ai_disclosure not ilike '%internal test content%' and e.planned_ending_chapter is not null and a.target_ending_chapter is not null and e.planned_ending_chapter<>a.target_ending_chapter;
 if pc=cc and ic=0 and dc=0 and mc=0 then st:='pass'; sc:=100; elsif cc=pc and ic=0 then st:='warn'; sc:=70; else st:='fail'; sc:=0; end if;
 d:=jsonb_build_object('production_series',pc,'covered_series',cc,'uncovered_series',pc-cc,'invalid_plans',ic,'duplicate_active_or_draft_plans',dc,'arc_ending_chapter_mismatches',mc,'ending_reviews_present',(select count(*) from public.story_ending_reviews),'checked_at',now());
 insert into public.taleforge_system_checks(check_key,category,status,score,details,checked_at) values('ending_planning_integrity','story_architecture',st,sc,d,now());
 perform public.taleforge_refresh_system_health();
 return jsonb_build_object('status',st,'score',sc,'details',d);
end; $$;
revoke all on function public.taleforge_verify_ending_planning() from public,anon,authenticated;
grant execute on function public.taleforge_verify_ending_planning() to service_role;

create or replace function public.taleforge_build_generation_context(p_blueprint_id uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare base jsonb; memory jsonb; ending jsonb; final_context jsonb; snapshot_id uuid; final_hash text; b record;
begin
 if auth.role()<>'service_role' then raise exception 'service_role required'; end if;
 select id,series_id,chapter_number into b from public.chapter_blueprints where id=p_blueprint_id;
 if not found then raise exception 'Chapter blueprint not found: %',p_blueprint_id; end if;
 base:=public.taleforge_build_generation_context_base(p_blueprint_id); memory:=public.taleforge_build_narrative_memory(p_blueprint_id);
 select coalesce(jsonb_build_object('id',e.id,'series_id',e.series_id,'planned_ending_chapter',e.planned_ending_chapter,'ending_type',e.ending_type,'final_arc',e.final_arc,'final_conflict',e.final_conflict,'final_resolution',e.final_resolution,'character_end_states',e.character_end_states,'world_end_state',e.world_end_state,'required_payoffs',e.required_payoffs,'required_resolutions',e.required_resolutions,'required_unresolved_threads',e.required_unresolved_threads,'ending_requirements',e.ending_requirements,'status',e.status),'{}'::jsonb) into ending from public.story_ending_plans e where e.series_id=b.series_id and e.status in ('draft','active','approved') order by case e.status when 'approved' then 1 when 'active' then 2 else 3 end,e.updated_at desc limit 1;
 final_context:=jsonb_set(base->'context','{narrative_memory}',coalesce(memory->'payload','{}'::jsonb),true);
 final_context:=jsonb_set(final_context,'{ending_plan}',ending,true);
 final_context:=jsonb_set(final_context,'{context_version}',to_jsonb('generation-context-v3'::text),true);
 final_hash:=md5(final_context::text);
 update public.taleforge_generation_context_snapshots set context_hash=final_hash,payload=final_context where id=(base->>'snapshot_id')::uuid returning id into snapshot_id;
 return jsonb_build_object('snapshot_id',snapshot_id,'context_hash',final_hash,'context',final_context,'narrative_memory_snapshot_id',memory->>'snapshot_id','narrative_memory_hash',memory->>'memory_hash','context_version','generation-context-v3','ending_plan_id',ending->>'id');
end; $$;
revoke all on function public.taleforge_build_generation_context(uuid) from public,anon,authenticated;
grant execute on function public.taleforge_build_generation_context(uuid) to service_role;