create table if not exists public.taleforge_story_concept_candidates (
  id uuid primary key default gen_random_uuid(),
  concept_key text not null unique,
  version integer not null default 1 check (version >= 1),
  status text not null default 'draft' check (status in ('draft','candidate','validated','approved','rejected','superseded')),
  opportunity_id uuid references public.taleforge_story_opportunities(id) on delete set null,
  title_seed text,
  central_premise text,
  reader_promise text,
  protagonist_engine jsonb not null default '{}'::jsonb,
  central_conflict jsonb not null default '{}'::jsonb,
  world_premise jsonb not null default '{}'::jsonb,
  progression_engine jsonb not null default '{}'::jsonb,
  mystery_engine jsonb not null default '{}'::jsonb,
  faction_engine jsonb not null default '{}'::jsonb,
  relationship_engine jsonb not null default '{}'::jsonb,
  major_arc_potential jsonb not null default '{}'::jsonb,
  minor_arc_potential jsonb not null default '{}'::jsonb,
  ending_potential jsonb not null default '{}'::jsonb,
  differentiation_profile jsonb not null default '{}'::jsonb,
  originality_constraints jsonb not null default '{}'::jsonb,
  safety_constraints jsonb not null default '{}'::jsonb,
  source_signals jsonb not null default '{}'::jsonb,
  engine_version text not null default 'concept-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_taleforge_story_concept_candidates_status on public.taleforge_story_concept_candidates(status);
create index if not exists idx_taleforge_story_concept_candidates_opportunity on public.taleforge_story_concept_candidates(opportunity_id);
alter table public.taleforge_story_concept_candidates enable row level security;
drop policy if exists "active concept candidates are publicly readable" on public.taleforge_story_concept_candidates;
create policy "active concept candidates are publicly readable" on public.taleforge_story_concept_candidates for select to anon, authenticated using (status in ('candidate','validated','approved'));

create table if not exists public.taleforge_story_concept_evaluations (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.taleforge_story_concept_candidates(id) on delete cascade,
  opportunity_score numeric(5,2), viability_score numeric(5,2), differentiation_score numeric(5,2),
  sustainability_score numeric(5,2), arc_depth_score numeric(5,2), ending_score numeric(5,2),
  originality_score numeric(5,2), safety_score numeric(5,2), overall_score numeric(5,2),
  decision text not null check (decision in ('strong_candidate','needs_design','blocked')),
  reasons jsonb not null default '[]'::jsonb, evidence jsonb not null default '{}'::jsonb,
  engine_version text not null default 'concept-v1', created_at timestamptz not null default now()
);
create index if not exists idx_taleforge_story_concept_evaluations_concept on public.taleforge_story_concept_evaluations(concept_id);
alter table public.taleforge_story_concept_evaluations enable row level security;
drop policy if exists "validated concept evaluations are publicly readable" on public.taleforge_story_concept_evaluations;
create policy "validated concept evaluations are publicly readable" on public.taleforge_story_concept_evaluations for select to anon, authenticated using (decision in ('strong_candidate','needs_design'));

create or replace function public.taleforge_evaluate_story_concept(
 p_concept_id uuid, p_opportunity_score numeric default 0, p_viability_score numeric default 0,
 p_differentiation_score numeric default 0, p_sustainability_score numeric default 0,
 p_arc_depth_score numeric default 0, p_ending_score numeric default 0,
 p_originality_score numeric default 0, p_safety_score numeric default 100)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_overall numeric(5,2); v_decision text; v_reasons jsonb := '[]'::jsonb; v_concept record;
begin
 if current_user <> 'service_role' then raise exception 'service_role required'; end if;
 select * into v_concept from public.taleforge_story_concept_candidates where id=p_concept_id;
 if not found then raise exception 'concept not found'; end if;
 if nullif(trim(v_concept.central_premise),'') is null or nullif(trim(v_concept.reader_promise),'') is null
    or jsonb_typeof(v_concept.protagonist_engine)<>'object' or jsonb_typeof(v_concept.central_conflict)<>'object'
    or jsonb_typeof(v_concept.world_premise)<>'object' or jsonb_typeof(v_concept.major_arc_potential)<>'object'
    or jsonb_typeof(v_concept.ending_potential)<>'object' then
   v_decision:='blocked'; v_reasons:=v_reasons||jsonb_build_array('required concept structures are incomplete'); v_overall:=0;
 else
   v_overall:=round((greatest(0,least(100,p_opportunity_score))*0.12+greatest(0,least(100,p_viability_score))*0.18+
   greatest(0,least(100,p_differentiation_score))*0.16+greatest(0,least(100,p_sustainability_score))*0.16+
   greatest(0,least(100,p_arc_depth_score))*0.14+greatest(0,least(100,p_ending_score))*0.10+
   greatest(0,least(100,p_originality_score))*0.10+greatest(0,least(100,p_safety_score))*0.04)::numeric,2);
   if p_safety_score<70 then v_decision:='blocked'; v_reasons:=v_reasons||jsonb_build_array('safety score below release threshold');
   elsif v_overall>=80 and p_originality_score>=65 and p_sustainability_score>=65 then v_decision:='strong_candidate';
   elsif v_overall>=60 then v_decision:='needs_design'; else v_decision:='blocked'; end if;
 end if;
 insert into public.taleforge_story_concept_evaluations(concept_id,opportunity_score,viability_score,differentiation_score,sustainability_score,arc_depth_score,ending_score,originality_score,safety_score,overall_score,decision,reasons,evidence)
 values(p_concept_id,p_opportunity_score,p_viability_score,p_differentiation_score,p_sustainability_score,p_arc_depth_score,p_ending_score,p_originality_score,p_safety_score,v_overall,v_decision,v_reasons,jsonb_build_object('concept_engine_version','concept-v1','content_generation_performed',false));
 return jsonb_build_object('concept_id',p_concept_id,'overall_score',v_overall,'decision',v_decision,'reasons',v_reasons);
end; $$;
revoke execute on function public.taleforge_evaluate_story_concept(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.taleforge_evaluate_story_concept(uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to service_role;

insert into public.taleforge_system_registry(system_key,display_name,domain,status,authority_level,criticality,description,health_check_prefix)
values('story_concept','Story Concept Intelligence','story_architecture','active',95,'critical','Transforms validated story opportunities into structured concept candidates without writing chapters or modifying production canon.','story_concept_integrity')
on conflict(system_key) do update set display_name=excluded.display_name,domain=excluded.domain,status=excluded.status,authority_level=excluded.authority_level,criticality=excluded.criticality,description=excluded.description,health_check_prefix=excluded.health_check_prefix;
insert into public.taleforge_system_dependencies(system_key,depends_on_system_key,dependency_type) values
('story_concept','story_opportunity','required'),('story_concept','novelty_engine','required'),('story_concept','inversion_engine','recommended') on conflict do nothing;

create or replace function public.taleforge_verify_story_concept()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_count integer; v_invalid integer; v_evals integer;
begin
 if current_user<>'service_role' then raise exception 'service_role required'; end if;
 select count(*) into v_count from public.taleforge_story_concept_candidates;
 select count(*) into v_invalid from public.taleforge_story_concept_candidates c where nullif(trim(c.central_premise),'') is null or nullif(trim(c.reader_promise),'') is null or jsonb_typeof(c.protagonist_engine)<>'object' or jsonb_typeof(c.central_conflict)<>'object' or jsonb_typeof(c.world_premise)<>'object';
 select count(*) into v_evals from public.taleforge_story_concept_evaluations;
 insert into public.taleforge_system_checks(check_name,status,details) values('story_concept_integrity',case when v_invalid=0 then 'PASS' else 'WARN' end,jsonb_build_object('concept_candidates',v_count,'invalid_concepts',v_invalid,'evaluations',v_evals,'content_generation_performed',false,'canonical_story_dna_mutation',false));
 return jsonb_build_object('status',case when v_invalid=0 then 'healthy' else 'degraded' end,'concept_candidates',v_count,'invalid_concepts',v_invalid,'evaluations',v_evals);
end; $$;
revoke execute on function public.taleforge_verify_story_concept() from public,anon,authenticated;
grant execute on function public.taleforge_verify_story_concept() to service_role;
