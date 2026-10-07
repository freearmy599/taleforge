create table if not exists public.story_identity (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  version integer not null default 1 check (version >= 1),
  status text not null default 'active' check (status in ('draft','active','superseded','retired')),
  display_title text not null,
  display_subtitle text,
  one_line_hook text not null,
  identity_statement text not null,
  genre_positioning jsonb not null default '{}'::jsonb,
  tone_profile jsonb not null default '{}'::jsonb,
  audience_profile jsonb not null default '{}'::jsonb,
  visual_identity jsonb not null default '{}'::jsonb,
  discovery_keywords jsonb not null default '[]'::jsonb,
  seo_identity jsonb not null default '{}'::jsonb,
  source_dna_version integer not null check (source_dna_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(series_id, version)
);

create unique index if not exists story_identity_one_active_per_series
  on public.story_identity(series_id) where status = 'active';

create index if not exists story_identity_series_idx on public.story_identity(series_id);

alter table public.story_identity enable row level security;

drop policy if exists "story_identity_public_read" on public.story_identity;
create policy "story_identity_public_read"
  on public.story_identity for select to anon, authenticated
  using (status = 'active');

insert into public.story_identity (
  series_id, version, status, display_title, display_subtitle,
  one_line_hook, identity_statement, genre_positioning, tone_profile,
  audience_profile, visual_identity, discovery_keywords, seo_identity,
  source_dna_version
)
select
  s.id, 1, 'active', s.title, s.subtitle,
  coalesce(nullif(trim(d.reader_promise), ''), d.core_premise),
  d.core_premise, d.genre_profile,
  jsonb_build_object('mood', s.mood, 'intensity', s.intensity, 'narrative_voice', d.narrative_voice),
  jsonb_build_object('age_rating', s.age_rating, 'origin_type', s.origin_type),
  jsonb_build_object('cover_image', s.cover_image, 'banner_image', s.banner_image),
  (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select s.title as x
      union
      select g.name from public.genres g where g.id = s.primary_genre_id
    ) k
  ),
  jsonb_build_object('seo_title', s.seo_title, 'seo_description', s.seo_description, 'canonical_url', s.canonical_url),
  d.version
from public.series s
join lateral (
  select * from public.story_dna d
  where d.series_id = s.id and d.status = 'active'
  order by d.version desc limit 1
) d on true
where not exists (select 1 from public.story_identity si where si.series_id = s.id);

create or replace function public.taleforge_verify_story_identity()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  total_series integer; active_identity_series integer; bad_identity integer;
  duplicate_active integer; invalid_json integer; dna_mismatch integer;
  check_status text; score numeric; details jsonb;
begin
  select count(*) into total_series from public.series;
  select count(distinct series_id) into active_identity_series
    from public.story_identity where status = 'active';

  select count(*) into bad_identity
  from public.series s
  left join lateral (
    select si.* from public.story_identity si
    where si.series_id = s.id and si.status = 'active'
    order by si.version desc limit 1
  ) si on true
  where si.id is null
     or nullif(trim(si.display_title), '') is null
     or nullif(trim(si.one_line_hook), '') is null
     or nullif(trim(si.identity_statement), '') is null
     or si.version < 1 or si.source_dna_version < 1;

  select count(*) into duplicate_active
  from (
    select series_id from public.story_identity
    where status = 'active' group by series_id having count(*) > 1
  ) x;

  select count(*) into invalid_json
  from public.story_identity si
  where si.status = 'active'
    and (
      jsonb_typeof(si.genre_positioning) not in ('object','array')
      or jsonb_typeof(si.tone_profile) not in ('object','array')
      or jsonb_typeof(si.audience_profile) not in ('object','array')
      or jsonb_typeof(si.visual_identity) not in ('object','array')
      or jsonb_typeof(si.discovery_keywords) not in ('object','array')
      or jsonb_typeof(si.seo_identity) not in ('object','array')
    );

  select count(*) into dna_mismatch
  from public.story_identity si
  join lateral (
    select d.version from public.story_dna d
    where d.series_id = si.series_id and d.status = 'active'
    order by d.version desc limit 1
  ) d on true
  where si.status = 'active' and si.source_dna_version > d.version;

  if total_series = 0 then
    check_status := 'warn'; score := 0;
  elsif bad_identity = 0 and duplicate_active = 0 and invalid_json = 0
    and dna_mismatch = 0 and active_identity_series = total_series then
    check_status := 'pass'; score := 100;
  else
    check_status := 'warn';
    score := greatest(0, 100
      - case when active_identity_series < total_series then 30 else 0 end
      - least(bad_identity * 15, 45)
      - least(duplicate_active * 20, 30)
      - least(invalid_json * 5, 20)
      - least(dna_mismatch * 10, 30));
  end if;

  details := jsonb_build_object(
    'total_series', total_series,
    'series_with_active_identity', active_identity_series,
    'series_with_invalid_identity', bad_identity,
    'duplicate_active_series', duplicate_active,
    'active_identity_with_invalid_json', invalid_json,
    'identity_dna_version_mismatch', dna_mismatch,
    'verified_at', now());

  insert into public.taleforge_system_checks
    (check_key, category, status, score, details, checked_at)
  values
    ('story_identity_integrity', 'story_architecture', check_status, score, details, now());

  return jsonb_build_object('check_key','story_identity_integrity','status',check_status,'score',score,'details',details);
end;
$$;

revoke all on function public.taleforge_verify_story_identity() from public;
revoke all on function public.taleforge_verify_story_identity() from anon;
revoke all on function public.taleforge_verify_story_identity() from authenticated;
grant execute on function public.taleforge_verify_story_identity() to service_role;

insert into public.taleforge_system_registry
  (system_key, display_name, domain, status, authority_level, criticality, description, health_check_prefix)
values
  ('story_identity', 'Story Identity', 'story_architecture', 'active', 90, 'critical',
   'Stable identity layer connecting Story DNA to presentation, covers, discovery, recommendations, and SEO.',
   'story_identity_integrity')
on conflict (system_key) do update set
  display_name = excluded.display_name, domain = excluded.domain,
  status = excluded.status, authority_level = excluded.authority_level,
  criticality = excluded.criticality, description = excluded.description,
  health_check_prefix = excluded.health_check_prefix, updated_at = now();

insert into public.taleforge_system_dependencies
  (system_key, depends_on_system_key, dependency_type)
values
  ('story_identity','story_dna','required'),
  ('cover_page','story_identity','required'),
  ('discovery','story_identity','recommended'),
  ('recommendations','story_identity','recommended'),
  ('verification','story_identity','required')
on conflict (system_key, depends_on_system_key) do update
set dependency_type = excluded.dependency_type;

select public.taleforge_verify_story_identity();
select public.taleforge_refresh_system_health();
