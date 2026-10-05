-- TaleForge Story Lifecycle Engine foundation
-- Additive schema: production generation/review/release logic is integrated in later steps.

create table if not exists public.story_lifecycle (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null unique references public.series(id) on delete cascade,
  lifecycle_status text not null default 'preparing'
    check (lifecycle_status in ('preparing','launching','active','nearing_completion','completed','evergreen','paused','archived')),
  daily_chapters_min integer not null default 2 check (daily_chapters_min between 0 and 10),
  daily_chapters_max integer not null default 3 check (daily_chapters_max between daily_chapters_min and 10),
  launch_chapter_count integer not null default 5 check (launch_chapter_count between 1 and 30),
  minimum_buffer_chapters integer not null default 6 check (minimum_buffer_chapters >= 1 and minimum_buffer_chapters <= 100),
  target_buffer_chapters integer not null default 12 check (target_buffer_chapters >= minimum_buffer_chapters and target_buffer_chapters <= 200),
  planned_chapter_count integer check (planned_chapter_count is null or planned_chapter_count >= 1),
  current_arc text,
  completion_reason text,
  completion_detected_at timestamptz,
  last_lifecycle_review_at timestamptz,
  next_lifecycle_review_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists story_lifecycle_status_review_idx
  on public.story_lifecycle(lifecycle_status, next_lifecycle_review_at);

create index if not exists story_lifecycle_series_idx
  on public.story_lifecycle(series_id);

alter table public.story_lifecycle enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='story_lifecycle'
      and policyname='public can read lifecycle for published series'
  ) then
    create policy "public can read lifecycle for published series"
      on public.story_lifecycle
      for select
      to anon, authenticated
      using (
        exists (
          select 1 from public.series s
          where s.id = story_lifecycle.series_id
            and s.published_at is not null
        )
      );
  end if;
end $$;

insert into public.story_lifecycle
(series_id,lifecycle_status,daily_chapters_min,daily_chapters_max,launch_chapter_count,minimum_buffer_chapters,target_buffer_chapters)
select s.id,
       case
         when s.published_at is null then 'preparing'
         when s.status='completed' then 'completed'
         when s.status='ongoing' then 'active'
         else 'paused'
       end,
       2,3,5,6,12
from public.series s
where not exists (
  select 1 from public.story_lifecycle sl where sl.series_id=s.id
);
