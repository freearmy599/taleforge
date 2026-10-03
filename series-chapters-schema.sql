-- ============================================
-- TALEFORGE — SERIES + CHAPTERS ARCHITECTURE
-- Step 39A
-- Non-destructive migration
-- ============================================

-- ============================================
-- 1. SERIES
-- ============================================

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  slug text not null unique,

  subtitle text,
  description text,

  author_id uuid,

  primary_genre_id uuid
    references public.genres(id)
    on delete set null,

  cover_image text,
  banner_image text,

  status text not null default 'draft'
    check (status in (
      'draft',
      'ongoing',
      'completed',
      'hiatus',
      'cancelled'
    )),

  age_rating text not null default 'general',

  mood text,
  intensity text,

  chapter_count integer not null default 0,

  views bigint not null default 0,
  reads_completed bigint not null default 0,
  followers_count bigint not null default 0,

  ai_assisted boolean not null default false,
  ai_disclosure text,

  origin_type text not null default 'ai_original'
    check (origin_type in (
      'ai_original',
      'human_original',
      'human_ai_assisted'
    )),

  originality_status text not null default 'pending'
    check (originality_status in (
      'pending',
      'checked',
      'flagged',
      'approved'
    )),

  seo_title text,
  seo_description text,
  canonical_url text,

  published_at timestamptz,

  version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ============================================
-- 2. CHAPTERS
-- ============================================

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),

  series_id uuid not null
    references public.series(id)
    on delete cascade,

  chapter_number integer not null,
  title text not null,

  subtitle text,
  summary text,

  content text not null,

  word_count integer not null default 0,
  reading_time integer not null default 1,

  status text not null default 'draft'
    check (status in (
      'draft',
      'review',
      'approved',
      'published',
      'scheduled'
    )),

  cover_image text,

  ai_assisted boolean not null default false,
  ai_disclosure text,

  origin_type text not null default 'ai_original'
    check (origin_type in (
      'ai_original',
      'human_original',
      'human_ai_assisted'
    )),

  originality_status text not null default 'pending'
    check (originality_status in (
      'pending',
      'checked',
      'flagged',
      'approved'
    )),

  published_at timestamptz,

  version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(series_id, chapter_number)
);


-- ============================================
-- 3. INDEXES
-- ============================================

create index if not exists idx_series_slug
on public.series(slug);

create index if not exists idx_series_status
on public.series(status);

create index if not exists idx_series_genre
on public.series(primary_genre_id);

create index if not exists idx_series_published_at
on public.series(published_at desc);

create index if not exists idx_chapters_series
on public.chapters(series_id);

create index if not exists idx_chapters_series_number
on public.chapters(series_id, chapter_number);

create index if not exists idx_chapters_status
on public.chapters(status);

create index if not exists idx_chapters_published_at
on public.chapters(published_at desc);


-- ============================================
-- 4. UPDATED_AT TRIGGER
-- ============================================

create trigger set_series_updated_at
before update on public.series
for each row
execute function public.update_updated_at_column();

create trigger set_chapters_updated_at
before update on public.chapters
for each row
execute function public.update_updated_at_column();


-- ============================================
-- 5. ENABLE ROW LEVEL SECURITY
-- ============================================

alter table public.series enable row level security;
alter table public.chapters enable row level security;


-- ============================================
-- 6. PUBLIC READ ACCESS — SERIES
-- ============================================

create policy "Public can read published series"
on public.series
for select
to anon, authenticated
using (
  status in ('ongoing', 'completed')
);


-- ============================================
-- 7. PUBLIC READ ACCESS — CHAPTERS
-- ============================================

create policy "Public can read published chapters"
on public.chapters
for select
to anon, authenticated
using (
  status = 'published'
  and exists (
    select 1
    from public.series
    where series.id = chapters.series_id
      and series.status in ('ongoing', 'completed')
  )
);


-- ============================================
-- 8. CHAPTER COUNT FUNCTION
-- ============================================

create or replace function public.update_series_chapter_count()
returns trigger
language plpgsql
as $$
begin

  if tg_op = 'DELETE' then

    update public.series
    set chapter_count = (
      select count(*)
      from public.chapters
      where chapters.series_id = old.series_id
        and chapters.status in ('published', 'approved')
    )
    where id = old.series_id;

    return old;

  else

    update public.series
    set chapter_count = (
      select count(*)
      from public.chapters
      where chapters.series_id = new.series_id
        and chapters.status in ('published', 'approved')
    )
    where id = new.series_id;

    return new;

  end if;

end;
$$;


-- ============================================
-- 9. CHAPTER COUNT TRIGGER
-- ============================================

create trigger update_series_chapter_count_trigger
after insert or update or delete
on public.chapters
for each row
execute function public.update_series_chapter_count();


-- ============================================
-- COMPLETE
-- ============================================
