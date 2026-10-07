-- TaleForge System Governance & Health Registry
-- Additive governance layer. Does not control story generation directly.
-- Applied to production Supabase on 2026-10-07.

create table if not exists public.taleforge_system_registry (
  system_key text primary key,
  display_name text not null,
  domain text not null,
  status text not null default 'planned'
    check (status in ('planned','building','active','degraded','paused','retired')),
  authority_level integer not null default 0 check (authority_level between 0 and 100),
  criticality text not null default 'normal'
    check (criticality in ('low','normal','high','critical')),
  description text not null default '',
  health_check_prefix text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.taleforge_system_dependencies (
  system_key text not null references public.taleforge_system_registry(system_key) on delete cascade,
  depends_on_system_key text not null references public.taleforge_system_registry(system_key) on delete cascade,
  dependency_type text not null default 'required'
    check (dependency_type in ('required','recommended','observability')),
  created_at timestamptz not null default now(),
  primary key (system_key, depends_on_system_key),
  check (system_key <> depends_on_system_key)
);

create table if not exists public.taleforge_system_health (
  system_key text primary key references public.taleforge_system_registry(system_key) on delete cascade,
  health_status text not null default 'unknown'
    check (health_status in ('healthy','degraded','blocked','unknown')),
  health_score numeric check (health_score is null or (health_score >= 0 and health_score <= 100)),
  last_verified_at timestamptz,
  blocking_reason text,
  evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.taleforge_system_registry enable row level security;
alter table public.taleforge_system_dependencies enable row level security;
alter table public.taleforge_system_health enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='taleforge_system_registry' and policyname='public can read system registry') then
    create policy "public can read system registry" on public.taleforge_system_registry for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='taleforge_system_dependencies' and policyname='public can read system dependencies') then
    create policy "public can read system dependencies" on public.taleforge_system_dependencies for select to anon, authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='taleforge_system_health' and policyname='public can read system health') then
    create policy "public can read system health" on public.taleforge_system_health for select to anon, authenticated using (true);
  end if;
end $$;

insert into public.taleforge_system_registry
(system_key, display_name, domain, status, authority_level, criticality, description)
values
('verification','System Verification & Health','governance','active',100,'critical','Platform-wide verification, dependency health, evidence and release safety governance.'),
('story_dna','Story DNA','story_architecture','active',90,'critical','Canonical identity and narrative constraints for a series.'),
('story_blueprint','Series Blueprint','story_architecture','active',90,'critical','Long-horizon structure and production blueprint.'),
('arc_planning','Arc Planning','story_architecture','building',90,'critical','Arc-level narrative planning and progression.'),
('chapter_planning','Chapter Planning','story_architecture','building',90,'critical','Chapter-level objectives and generation requirements.'),
('generation','Chapter Generation','production','active',90,'critical','AI chapter generation and output production.'),
('revision','Revision','production','active',90,'critical','Quality-driven chapter revision and selection.'),
('quality','Quality Gate','quality','active',95,'critical','Quality and release eligibility checks.'),
('continuity','Continuity','story_intelligence','active',95,'critical','Character, world and narrative continuity verification.'),
('canon','Canon Sync','story_intelligence','active',95,'critical','Canonical state synchronization after publication.'),
('publication','Publication','publishing','active',95,'critical','Controlled transition of approved chapters into public availability.'),
('release_scheduler','Release Scheduler','publishing','active',90,'critical','Determines and triggers scheduled release work.'),
('publication_sync','Publication Sync','publishing','active',90,'high','Processes publication events and downstream synchronization.'),
('reader_progress','Reader Progress','reader','active',50,'normal','Reading position, history and continuation state.'),
('discovery','Discovery','reader','building',60,'high','Content discovery, trending and exploration.'),
('recommendations','Recommendations','reader','building',55,'normal','Personalized story recommendations.'),
('cover_page','Cover Page','presentation','building',70,'high','Series visual identity and cover presentation lifecycle.'),
('autonomous_series','Autonomous New Series','creation','planned',95,'critical','Autonomous creation, validation and launch of new series.')
on conflict (system_key) do update set
  display_name=excluded.display_name,
  domain=excluded.domain,
  description=excluded.description,
  authority_level=excluded.authority_level,
  criticality=excluded.criticality,
  updated_at=now();

insert into public.taleforge_system_health(system_key, health_status)
select system_key,'unknown'
from public.taleforge_system_registry
on conflict (system_key) do nothing;

insert into public.taleforge_system_dependencies(system_key, depends_on_system_key)
values
('story_blueprint','story_dna'),
('arc_planning','story_blueprint'),
('chapter_planning','arc_planning'),
('generation','chapter_planning'),
('revision','generation'),
('quality','revision'),
('continuity','generation'),
('canon','publication'),
('publication','quality'),
('release_scheduler','generation'),
('publication_sync','publication'),
('autonomous_series','story_dna'),
('autonomous_series','story_blueprint'),
('autonomous_series','quality'),
('autonomous_series','cover_page'),
('verification','generation'),
('verification','revision'),
('verification','quality'),
('verification','continuity'),
('verification','publication'),
('verification','release_scheduler'),
('verification','publication_sync'),
('verification','canon'),
('verification','autonomous_series')
on conflict do nothing;
