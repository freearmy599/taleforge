-- TaleForge: multi-series production profiles and starter production queues
create table if not exists public.production_profiles (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null unique references public.series(id) on delete cascade,
  profile_key text not null,
  genre text not null,
  narrative_rules jsonb not null default '{}'::jsonb,
  world_rules jsonb not null default '{}'::jsonb,
  character_rules jsonb not null default '{}'::jsonb,
  pacing_rules jsonb not null default '{}'::jsonb,
  hook_rules jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.production_profiles enable row level security;

drop policy if exists "public can read enabled production profiles" on public.production_profiles;
create policy "public can read enabled production profiles"
  on public.production_profiles
  for select to anon, authenticated
  using (enabled = true);

with g as (select id, slug from public.genres)
insert into public.series
(title,slug,subtitle,description,primary_genre_id,status,age_rating,mood,intensity,chapter_count,views,reads_completed,followers_count,ai_assisted,ai_disclosure,origin_type,originality_status,seo_title,seo_description,version)
select * from (values
('The Hollow Crown','the-hollow-crown','A kingdom where every throne remembers its dead.','A dark fantasy serial about an exiled heir who discovers that the kingdom records every ruler inside a living crown—and the next memory belongs to someone who has not yet died.',(select id from g where slug='fantasy'),'ongoing','13+','dark, mythic','high',0,0,0,0,true,'AI-assisted original fiction.','ai_original','pending','The Hollow Crown — TaleForge','An original dark fantasy serial about a living crown and an heir who must outwit the memories trapped inside it.',1),
('The Last Unsent Letter','the-last-unsent-letter','Every mystery begins with a message that never arrived.','A mystery serial following a young archivist who finds letters dated decades in the future, each predicting a disappearance that has not happened yet.',(select id from g where slug='mystery'),'ongoing','13+','eerie, investigative','medium',0,0,0,0,true,'AI-assisted original fiction.','ai_original','pending','The Last Unsent Letter — TaleForge','An original mystery serial about future-dated letters that predict disappearances.',1),
('After the Red Eclipse','after-the-red-eclipse','Humanity woke to find the moon had changed the rules.','A science-fiction survival serial set after a red eclipse rewrites physical laws in small pockets of Earth, forcing engineers and refugees to map the new reality before it spreads.',(select id from g where slug='science-fiction'),'ongoing','13+','tense, wonder-filled','high',0,0,0,0,true,'AI-assisted original fiction.','ai_original','pending','After the Red Eclipse — TaleForge','An original science-fiction serial about altered physical laws after a mysterious eclipse.',1),
('The House That Grows Rooms','the-house-that-grows-rooms','A haunted house that changes when people lie.','A supernatural horror serial about siblings inheriting a house whose impossible rooms appear whenever someone hides a truth—and one room is waiting for them.',(select id from g where slug='horror'),'ongoing','13+','claustrophobic, uncanny','high',0,0,0,0,true,'AI-assisted original fiction.','ai_original','pending','The House That Grows Rooms — TaleForge','An original supernatural horror serial about a house that creates rooms from hidden truths.',1)
) as v(title,slug,subtitle,description,primary_genre_id,status,age_rating,mood,intensity,chapter_count,views,reads_completed,followers_count,ai_assisted,ai_disclosure,origin_type,originality_status,seo_title,seo_description,version)
where not exists (select 1 from public.series s where s.slug=v.slug);

insert into public.production_profiles(series_id,profile_key,genre,narrative_rules,world_rules,character_rules,pacing_rules,hook_rules)
select id,slug,
case slug when 'the-hollow-crown' then 'fantasy' when 'the-last-unsent-letter' then 'mystery' when 'after-the-red-eclipse' then 'science-fiction' else 'horror' end,
'{"focus":["distinctive atmosphere","consequential choices","continuity"]}'::jsonb,
'{"rules":["internal consistency","new rules require narrative evidence"]}'::jsonb,
'{"agency":"characters make consequential choices","motives":"distinct motives"}'::jsonb,
'{"escalation":"each chapter changes the situation","tempo":"controlled build with reversals"}'::jsonb,
'{"ending":"create a consequential question or choice"}'::jsonb
from public.series
where slug in ('the-hollow-crown','the-last-unsent-letter','after-the-red-eclipse','the-house-that-grows-rooms')
on conflict (series_id) do update set updated_at=now();

insert into public.chapter_blueprints
(series_id,chapter_number,title,purpose,summary,plot_events,character_developments,world_reveals,clues_and_mysteries,continuity_requirements,previous_chapter_dependencies,ending_hook,target_word_count,generation_status,release_status,version)
select id,1,
case slug when 'the-hollow-crown' then 'The Crown Beneath the Chapel' when 'the-last-unsent-letter' then 'The Letter With Tomorrow’s Date' when 'after-the-red-eclipse' then 'The Gravity Line' else 'The Room Behind the Pantry' end,
'Open the series with its defining mystery and establish the protagonist’s first consequential choice.',
case slug when 'the-hollow-crown' then 'An exile returns secretly to the old chapel and discovers a crown that remembers rulers erased from history.' when 'the-last-unsent-letter' then 'An archivist finds a sealed letter written in a familiar hand and dated tomorrow; its final paragraph describes a disappearance.' when 'after-the-red-eclipse' then 'An engineer discovers a street where gravity changes direction at sunset and realizes the boundary is moving.' else 'Two siblings explore their inheritance and discover a new room where the pantry should be; inside is evidence of a secret neither remembers sharing.' end,
'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,
case slug when 'the-hollow-crown' then 'The crown speaks the name of a living person who has not yet become king.' when 'the-last-unsent-letter' then 'The letter contains a detail that only the next missing person could know.' when 'after-the-red-eclipse' then 'The moving gravity boundary reaches a place it should not be able to reach.' else 'The new room contains a photograph taken inside the house tomorrow.' end,
4000,'planned','unreleased',1
from public.series s
where s.slug in ('the-hollow-crown','the-last-unsent-letter','after-the-red-eclipse','the-house-that-grows-rooms')
and not exists (select 1 from public.chapter_blueprints b where b.series_id=s.id and b.chapter_number=1);

insert into public.release_schedules
(series_id,enabled,schedule_mode,interval_hours,timezone,chapters_ahead,auto_generate,auto_publish,next_release_at)
select id,true,'interval',24,'Asia/Kolkata',2,true,false,now()
from public.series s
where s.slug in ('the-hollow-crown','the-last-unsent-letter','after-the-red-eclipse','the-house-that-grows-rooms')
and not exists (select 1 from public.release_schedules r where r.series_id=s.id);
