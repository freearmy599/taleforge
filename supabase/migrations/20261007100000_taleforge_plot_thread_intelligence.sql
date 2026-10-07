-- TaleForge: canonical plot-thread / foreshadowing / payoff intelligence
-- Derived only from existing Story DNA, Story Blueprint, Arc Plan and Chapter Blueprint data.

create table if not exists public.taleforge_narrative_threads (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  thread_key text not null,
  thread_type text not null check (thread_type in ('mystery','clue','foreshadowing','payoff','conflict','question')),
  status text not null default 'open' check (status in ('planned','open','progressing','resolved','abandoned','blocked')),
  title text,
  description text not null,
  source_system text not null,
  source_path text not null,
  source_version integer,
  introduced_chapter integer,
  target_payoff_chapter integer,
  resolved_chapter integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_id, thread_key)
);

create index if not exists idx_taleforge_narrative_threads_series_status on public.taleforge_narrative_threads(series_id,status);
create index if not exists idx_taleforge_narrative_threads_series_type on public.taleforge_narrative_threads(series_id,thread_type);

alter table public.taleforge_narrative_threads enable row level security;
drop policy if exists "active narrative threads are publicly readable" on public.taleforge_narrative_threads;
create policy "active narrative threads are publicly readable"
on public.taleforge_narrative_threads for select to anon, authenticated using (true);

insert into public.taleforge_narrative_threads
(series_id,thread_key,thread_type,status,title,description,source_system,source_path,source_version,target_payoff_chapter,metadata)
select d.series_id,'dna-mystery-'||md5(coalesce(x.value::text,'')),'mystery','planned',null,
trim(both '"' from x.value::text),'story_dna','mystery_threads',d.version,null,
jsonb_build_object('seeded_from','existing_story_dna')
from public.story_dna d
cross join lateral jsonb_array_elements(d.mystery_threads) x
where d.status='active' and jsonb_typeof(d.mystery_threads)='array' and jsonb_typeof(x.value)='string'
  and nullif(trim(both '"' from x.value::text),'') is not null
on conflict (series_id,thread_key) do nothing;

insert into public.taleforge_narrative_threads
(series_id,thread_key,thread_type,status,title,description,source_system,source_path,source_version,target_payoff_chapter,metadata)
select d.series_id,'dna-payoff-'||md5(coalesce(x.value::text,'')),'payoff','planned',null,
case when jsonb_typeof(x.value)='object' then coalesce(x.value->>'description',x.value::text) else trim(both '"' from x.value::text) end,
'story_dna','payoff_targets',d.version,
case when jsonb_typeof(x.value)='object' and (x.value->>'chapter_target')~'^[0-9]+$' then (x.value->>'chapter_target')::int end,
jsonb_build_object('seeded_from','existing_story_dna','target_id',case when jsonb_typeof(x.value)='object' then x.value->>'target_id' end)
from public.story_dna d cross join lateral jsonb_array_elements(d.payoff_targets) x
where d.status='active' and jsonb_typeof(d.payoff_targets)='array'
on conflict (series_id,thread_key) do nothing;

insert into public.taleforge_narrative_threads
(series_id,thread_key,thread_type,status,title,description,source_system,source_path,source_version,target_payoff_chapter,metadata)
select a.series_id,'arc-payoff-'||md5(coalesce(x.value::text,'')),'payoff','planned',null,
case when jsonb_typeof(x.value)='object' then coalesce(x.value->>'description',x.value::text) else trim(both '"' from x.value::text) end,
'story_arc_plan','required_payoffs',a.version,
case when jsonb_typeof(x.value)='object' and (x.value->>'chapter_target')~'^[0-9]+$' then (x.value->>'chapter_target')::int end,
jsonb_build_object('seeded_from','existing_story_arc_plan','target_id',case when jsonb_typeof(x.value)='object' then x.value->>'target_id' end)
from public.story_arc_plan a cross join lateral jsonb_array_elements(a.required_payoffs) x
where a.status='active' and jsonb_typeof(a.required_payoffs)='array'
on conflict (series_id,thread_key) do nothing;

insert into public.taleforge_narrative_threads
(series_id,thread_key,thread_type,status,title,description,source_system,source_path,source_version,target_payoff_chapter,metadata)
select sb.series_id,'blueprint-payoff-'||md5(coalesce(x.value::text,'')),'payoff','planned',null,
case when jsonb_typeof(x.value)='object' then coalesce(x.value->>'description',x.value::text) else trim(both '"' from x.value::text) end,
'story_blueprints','required_payoffs',sb.version,
case when jsonb_typeof(x.value)='object' and (x.value->>'chapter_target')~'^[0-9]+$' then (x.value->>'chapter_target')::int end,
jsonb_build_object('seeded_from','existing_story_blueprint')
from public.story_blueprints sb cross join lateral jsonb_array_elements(sb.required_payoffs) x
where sb.generation_status<>'rejected' and jsonb_typeof(sb.required_payoffs)='array'
on conflict (series_id,thread_key) do nothing;

insert into public.taleforge_narrative_threads
(series_id,thread_key,thread_type,status,title,description,source_system,source_path,source_version,introduced_chapter,metadata)
select cb.series_id,'chapter-clue-'||md5(cb.id::text||':'||x.value::text),'clue','planned',null,
case when jsonb_typeof(x.value)='object' then coalesce(x.value->>'description',x.value::text) else trim(both '"' from x.value::text) end,
'chapter_blueprints','clues_and_mysteries',cb.version,cb.chapter_number,
jsonb_build_object('seeded_from','existing_chapter_blueprint','blueprint_id',cb.id,'chapter_number',cb.chapter_number)
from public.chapter_blueprints cb cross join lateral jsonb_array_elements(cb.clues_and_mysteries) x
join public.series s on s.id=cb.series_id
where cb.generation_status in ('planned','queued','generating','generated','published')
  and jsonb_typeof(cb.clues_and_mysteries)='array'
  and coalesce(s.description,'') not ilike '%temporary internal series%'
  and coalesce(s.ai_disclosure,'') not ilike '%internal test content%'
on conflict (series_id,thread_key) do nothing;

create or replace function public.taleforge_build_narrative_memory(p_blueprint_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare b record; payload jsonb; memory_hash text; snapshot_id uuid;
begin
 if current_user not in ('postgres','service_role') and coalesce(current_setting('request.jwt.claim.role',true))<>'service_role' then raise exception 'service_role required'; end if;
 select cb.id,cb.series_id,cb.chapter_number into b from public.chapter_blueprints cb where cb.id=p_blueprint_id limit 1;
 if b.id is null then raise exception 'chapter blueprint not found'; end if;
 select jsonb_build_object(
  'memory_version','narrative-memory-v2','series_id',b.series_id,
  'through_chapter',coalesce((select current_chapter_number from public.story_continuity_state where series_id=b.series_id),b.chapter_number-1),
  'continuity_state',(select to_jsonb(cs) from public.story_continuity_state cs where cs.series_id=b.series_id),
  'characters',coalesce((select jsonb_agg(to_jsonb(c) order by c.last_seen_chapter desc nulls last,c.name) from public.story_characters c where c.series_id=b.series_id),'[]'::jsonb),
  'relationships',coalesce((select jsonb_agg(to_jsonb(r) order by r.last_changed_chapter desc nulls last) from public.character_relationships r where r.series_id=b.series_id),'[]'::jsonb),
  'world_elements',coalesce((select jsonb_agg(to_jsonb(w) order by w.last_referenced_chapter desc nulls last,w.name) from public.story_world_elements w where w.series_id=b.series_id),'[]'::jsonb),
  'character_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.chapter_number desc,e.created_at desc) from public.character_continuity_events e where e.series_id=b.series_id and e.chapter_number<b.chapter_number),'[]'::jsonb),
  'world_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.chapter_number desc,e.created_at desc) from public.world_continuity_events e where e.series_id=b.series_id and e.chapter_number<b.chapter_number),'[]'::jsonb),
  'chapter_snapshots',coalesce((select jsonb_agg(to_jsonb(x) order by x.chapter_number desc) from (select s.* from public.chapter_continuity_snapshots s where s.series_id=b.series_id and s.chapter_number<b.chapter_number order by s.chapter_number desc limit 12)x),'[]'::jsonb),
  'arc_plan',(select to_jsonb(a) from public.story_arc_plan a where a.series_id=b.series_id and a.status='active' order by a.version desc limit 1),
  'narrative_threads',coalesce((select jsonb_agg(to_jsonb(t) order by t.target_payoff_chapter nulls last,t.thread_type,t.thread_key) from public.taleforge_narrative_threads t where t.series_id=b.series_id),'[]'::jsonb)
 ) into payload;
 memory_hash=md5(payload::text);
 insert into public.taleforge_narrative_memory_snapshots(series_id,chapter_number,source_blueprint_id,memory_version,memory_hash,payload)
 values(b.series_id,b.chapter_number,b.id,'narrative-memory-v2',memory_hash,payload) returning id into snapshot_id;
 return jsonb_build_object('snapshot_id',snapshot_id,'memory_hash',memory_hash,'memory_version','narrative-memory-v2','payload',payload);
end;$function$;

revoke execute on function public.taleforge_build_narrative_memory(uuid) from public,anon,authenticated;
grant execute on function public.taleforge_build_narrative_memory(uuid) to service_role;

insert into public.taleforge_system_registry(system_key,display_name,domain,status,authority_level,criticality,description,health_check_prefix)
values('plot_threads','Plot Thread & Payoff Intelligence','story_architecture','building',95,'critical','Canonical lifecycle for mysteries, clues, foreshadowing, conflicts, questions, and planned payoffs.','plot_threads_integrity')
on conflict(system_key) do update set description=excluded.description,authority_level=excluded.authority_level,criticality=excluded.criticality,health_check_prefix=excluded.health_check_prefix;

insert into public.taleforge_system_dependencies(system_key,depends_on_system_key,dependency_type)
values
('plot_threads','story_dna','required'),('plot_threads','story_blueprint','required'),
('plot_threads','arc_planning','required'),('plot_threads','chapter_planning','required'),
('plot_threads','narrative_memory','required')
on conflict do nothing;

create or replace function public.taleforge_verify_plot_threads()
returns jsonb language plpgsql security definer set search_path=public
as $function$
declare prod_count int; covered_count int; thread_count int; invalid_count int; result jsonb;
begin
 if current_user not in ('postgres','service_role') and coalesce(current_setting('request.jwt.claim.role',true))<>'service_role' then raise exception 'service_role required'; end if;
 select count(*) into prod_count from public.series s where coalesce(s.description,'') not ilike '%temporary internal series%' and coalesce(s.ai_disclosure,'') not ilike '%internal test content%';
 select count(distinct t.series_id) into covered_count from public.taleforge_narrative_threads t join public.series s on s.id=t.series_id where coalesce(s.description,'') not ilike '%temporary internal series%' and coalesce(s.ai_disclosure,'') not ilike '%internal test content%';
 select count(*) into thread_count from public.taleforge_narrative_threads t join public.series s on s.id=t.series_id where coalesce(s.description,'') not ilike '%temporary internal series%' and coalesce(s.ai_disclosure,'') not ilike '%internal test content%';
 select count(*) into invalid_count from public.taleforge_narrative_threads t where nullif(trim(t.description),'') is null or t.thread_type not in ('mystery','clue','foreshadowing','payoff','conflict','question') or t.status not in ('planned','open','progressing','resolved','abandoned','blocked') or (t.target_payoff_chapter is not null and t.target_payoff_chapter<1);
 result=jsonb_build_object('status',case when prod_count=0 then 'blocked' when covered_count=prod_count and thread_count>0 and invalid_count=0 then 'pass' else 'warn' end,'production_series',prod_count,'covered_series',covered_count,'thread_count',thread_count,'invalid_threads',invalid_count,'verified_at',now());
 insert into public.taleforge_system_checks(check_key,category,status,score,details) values('plot_threads_integrity','plot_threads',result->>'status',case when result->>'status'='pass' then 100 else 70 end,result);
 perform public.taleforge_refresh_system_health();
 return result;
end;$function$;

revoke execute on function public.taleforge_verify_plot_threads() from public,anon,authenticated;
grant execute on function public.taleforge_verify_plot_threads() to service_role;
