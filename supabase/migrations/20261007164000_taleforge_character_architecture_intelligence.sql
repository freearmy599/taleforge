create table if not exists public.taleforge_story_concept_characters (
 id uuid primary key default gen_random_uuid(),
 concept_id uuid not null references public.taleforge_story_concept_candidates(id) on delete cascade,
 character_key text not null,
 display_name text,
 narrative_role text not null,
 importance_level text not null default 'important',
 arc_function text,
 plot_function text,
 relationship_function text,
 world_function text,
 conflict_function text,
 growth_function text,
 power_profile jsonb not null default '{}'::jsonb,
 personality_profile jsonb not null default '{}'::jsonb,
 explicit_constraints jsonb not null default '{}'::jsonb,
 invariants jsonb not null default '{}'::jsonb,
 dependencies jsonb not null default '[]'::jsonb,
 required_arc_presence jsonb not null default '[]'::jsonb,
 required_thread_keys jsonb not null default '[]'::jsonb,
 end_state_requirements jsonb not null default '{}'::jsonb,
 status text not null default 'designed',
 engine_version text not null default 'character-architecture-v1',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(concept_id, character_key),
 check (importance_level in ('core','major','important','supporting')),
 check (jsonb_typeof(power_profile)='object'),
 check (jsonb_typeof(personality_profile)='object'),
 check (jsonb_typeof(explicit_constraints)='object'),
 check (jsonb_typeof(invariants)='object'),
 check (jsonb_typeof(dependencies)='array'),
 check (jsonb_typeof(required_arc_presence)='array'),
 check (jsonb_typeof(required_thread_keys)='array'),
 check (jsonb_typeof(end_state_requirements)='object')
);
create index if not exists idx_taleforge_concept_characters_concept on public.taleforge_story_concept_characters(concept_id);
alter table public.taleforge_story_concept_characters enable row level security;
create policy "public read concept character architecture" on public.taleforge_story_concept_characters for select to anon, authenticated using (exists (select 1 from public.taleforge_story_concept_candidates c where c.id=concept_id and c.status in ('candidate','validated','approved')));

create table if not exists public.taleforge_character_architecture (
 id uuid primary key default gen_random_uuid(),
 series_id uuid not null references public.series(id) on delete cascade,
 character_id uuid references public.story_characters(id) on delete set null,
 character_key text not null,
 narrative_role text not null,
 importance_level text not null default 'important',
 arc_function text,
 plot_function text,
 relationship_function text,
 world_function text,
 conflict_function text,
 growth_function text,
 power_profile jsonb not null default '{}'::jsonb,
 personality_profile jsonb not null default '{}'::jsonb,
 explicit_constraints jsonb not null default '{}'::jsonb,
 invariants jsonb not null default '{}'::jsonb,
 dependencies jsonb not null default '[]'::jsonb,
 required_arc_presence jsonb not null default '[]'::jsonb,
 required_thread_keys jsonb not null default '[]'::jsonb,
 end_state_requirements jsonb not null default '{}'::jsonb,
 source_system text not null default 'story_concept',
 source_version integer not null default 1,
 status text not null default 'active',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(series_id, character_key),
 check (importance_level in ('core','major','important','supporting')),
 check (jsonb_typeof(power_profile)='object'),
 check (jsonb_typeof(personality_profile)='object'),
 check (jsonb_typeof(explicit_constraints)='object'),
 check (jsonb_typeof(invariants)='object'),
 check (jsonb_typeof(dependencies)='array'),
 check (jsonb_typeof(required_arc_presence)='array'),
 check (jsonb_typeof(required_thread_keys)='array'),
 check (jsonb_typeof(end_state_requirements)='object')
);
create index if not exists idx_taleforge_character_architecture_series on public.taleforge_character_architecture(series_id);
create index if not exists idx_taleforge_character_architecture_character on public.taleforge_character_architecture(character_id);
alter table public.taleforge_character_architecture enable row level security;
create policy "public read active character architecture" on public.taleforge_character_architecture for select to anon, authenticated using (status='active');

insert into public.taleforge_system_registry(system_key,display_name,domain,status,authority_level,criticality,description,health_check_prefix)
values ('character_architecture','Character Architecture Intelligence','story_architecture','building',95,'critical','Defines the full causally important cast, role-specific arc and plot functions, power/personality constraints, invariants, dependencies, and required story presence before canon generation.','character_architecture_integrity')
on conflict (system_key) do update set display_name=excluded.display_name,domain=excluded.domain,status=excluded.status,authority_level=excluded.authority_level,criticality=excluded.criticality,description=excluded.description,health_check_prefix=excluded.health_check_prefix;
insert into public.taleforge_system_dependencies(system_key,depends_on_system_key,dependency_type)
values ('character_architecture','story_concept','required'),('character_architecture','story_dna','required'),('character_architecture','story_identity','required'),('character_architecture','plot_threads','recommended'),('character_architecture','narrative_depth','recommended')
on conflict do nothing;
