-- Ensure every published series has a usable production profile.
-- New series can safely use this baseline profile until a richer genre-specific profile is assigned.
insert into public.production_profiles (
  series_id, profile_key, genre, narrative_rules, world_rules,
  character_rules, pacing_rules, hook_rules, enabled
)
select
  s.id,
  'default_serialized_fiction_v1',
  coalesce((select g.name from public.genres g where g.id = s.genre_id), 'Fiction'),
  'Original serialized fiction. Maintain internal continuity, avoid copying existing works, and preserve established canon.',
  'Treat the series premise and established facts as canon. New world details must remain consistent with prior published chapters.',
  'Keep character motivations, relationships, voice, and knowledge consistent with published events.',
  'Use purposeful scene progression, escalating stakes, and a satisfying chapter-level movement.',
  'End with a meaningful unanswered question, revelation, decision, or consequence that encourages the next chapter.',
  true
from public.series s
where s.status in ('ongoing','completed')
  and not exists (
    select 1 from public.production_profiles p
    where p.series_id = s.id
  );