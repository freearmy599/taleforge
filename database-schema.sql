-- =========================================================
-- TALEFORGE DATABASE SCHEMA
-- PostgreSQL / Supabase
-- =========================================================

-- =========================================================
-- 1. PROFILES
-- =========================================================

create table if not exists public.profiles (
  id uuid primary key,
  username text unique,
  display_name text,
  bio text,
  avatar_url text,
  role text not null default 'reader'
    check (role in ('reader', 'creator', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- =========================================================
-- 2. GENRES
-- =========================================================

create table if not exists public.genres (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);


-- =========================================================
-- 3. TAGS
-- =========================================================

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);


-- =========================================================
-- 4. STORIES
-- =========================================================

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  slug text not null unique,
  subtitle text,
  summary text,
  content text not null,

  author_id uuid references public.profiles(id)
    on delete set null,

  primary_genre_id uuid references public.genres(id)
    on delete set null,

  reading_time integer not null default 1
    check (reading_time > 0),

  word_count integer not null default 0
    check (word_count >= 0),

  age_rating text not null default 'general'
    check (age_rating in ('general', 'teen', 'mature')),

  mood text,
  intensity text
    check (intensity in ('Low', 'Medium', 'High')),

  status text not null default 'draft'
    check (
      status in (
        'draft',
        'ai_review',
        'needs_review',
        'approved',
        'published',
        'archived'
      )
    ),

  cover_image text,

  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  views bigint not null default 0
    check (views >= 0),

  reads_completed bigint not null default 0
    check (reads_completed >= 0),

  likes_count bigint not null default 0
    check (likes_count >= 0),

  saves_count bigint not null default 0
    check (saves_count >= 0),

  rating_average numeric(3,2) not null default 0
    check (rating_average >= 0 and rating_average <= 5),

  rating_count bigint not null default 0
    check (rating_count >= 0),

  ai_assisted boolean not null default false,

  ai_disclosure text,

  seo_title text,
  seo_description text,
  canonical_url text,

  version integer not null default 1
);


-- =========================================================
-- 5. STORY TAGS
-- =========================================================

create table if not exists public.story_tags (
  story_id uuid not null references public.stories(id)
    on delete cascade,

  tag_id uuid not null references public.tags(id)
    on delete cascade,

  primary key (story_id, tag_id)
);


-- =========================================================
-- 6. COLLECTIONS
-- =========================================================

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  slug text not null unique,
  description text,

  creator_id uuid references public.profiles(id)
    on delete set null,

  cover_image text,

  is_public boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- =========================================================
-- 7. COLLECTION STORIES
-- =========================================================

create table if not exists public.collection_stories (
  collection_id uuid not null references public.collections(id)
    on delete cascade,

  story_id uuid not null references public.stories(id)
    on delete cascade,

  position integer not null default 0,

  added_at timestamptz not null default now(),

  primary key (collection_id, story_id)
);


-- =========================================================
-- 8. BOOKMARKS
-- =========================================================

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles(id)
    on delete cascade,

  story_id uuid not null references public.stories(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  unique (user_id, story_id)
);


-- =========================================================
-- 9. READING HISTORY
-- =========================================================

create table if not exists public.reading_history (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles(id)
    on delete cascade,

  story_id uuid not null references public.stories(id)
    on delete cascade,

  progress_percent integer not null default 0
    check (progress_percent >= 0 and progress_percent <= 100),

  completed boolean not null default false,

  last_read_at timestamptz not null default now(),

  unique (user_id, story_id)
);


-- =========================================================
-- 10. LIKES
-- =========================================================

create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles(id)
    on delete cascade,

  story_id uuid not null references public.stories(id)
    on delete cascade,

  created_at timestamptz not null default now(),

  unique (user_id, story_id)
);


-- =========================================================
-- 11. RATINGS
-- =========================================================

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles(id)
    on delete cascade,

  story_id uuid not null references public.stories(id)
    on delete cascade,

  rating integer not null
    check (rating >= 1 and rating <= 5),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, story_id)
);


-- =========================================================
-- 12. COMMENTS
-- =========================================================

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles(id)
    on delete cascade,

  story_id uuid not null references public.stories(id)
    on delete cascade,

  parent_comment_id uuid references public.comments(id)
    on delete cascade,

  content text not null
    check (length(trim(content)) > 0),

  status text not null default 'visible'
    check (status in ('visible', 'hidden', 'flagged', 'deleted')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- =========================================================
-- 13. STORY REPORTS
-- =========================================================

create table if not exists public.story_reports (
  id uuid primary key default gen_random_uuid(),

  reporter_id uuid references public.profiles(id)
    on delete set null,

  story_id uuid references public.stories(id)
    on delete cascade,

  comment_id uuid references public.comments(id)
    on delete cascade,

  reason text not null,

  details text,

  status text not null default 'open'
    check (status in ('open', 'reviewing', 'resolved', 'dismissed')),

  created_at timestamptz not null default now(),
  resolved_at timestamptz
);


-- =========================================================
-- 14. STORY VERSIONS
-- =========================================================

create table if not exists public.story_versions (
  id uuid primary key default gen_random_uuid(),

  story_id uuid not null references public.stories(id)
    on delete cascade,

  version_number integer not null,

  title text not null,
  summary text,
  content text not null,

  created_by uuid references public.profiles(id)
    on delete set null,

  change_note text,

  created_at timestamptz not null default now(),

  unique (story_id, version_number)
);


-- =========================================================
-- 15. RECOMMENDATIONS
-- =========================================================

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),

  user_id uuid references public.profiles(id)
    on delete cascade,

  story_id uuid not null references public.stories(id)
    on delete cascade,

  score numeric(10,4) not null default 0,

  reason text,

  created_at timestamptz not null default now(),

  unique (user_id, story_id)
);


-- =========================================================
-- 16. NOTIFICATIONS
-- =========================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references public.profiles(id)
    on delete cascade,

  type text not null,

  title text not null,
  message text,

  link text,

  is_read boolean not null default false,

  created_at timestamptz not null default now()
);


-- =========================================================
-- 17. INDEXES
-- =========================================================

create index if not exists idx_stories_slug
  on public.stories(slug);

create index if not exists idx_stories_status
  on public.stories(status);

create index if not exists idx_stories_genre
  on public.stories(primary_genre_id);

create index if not exists idx_stories_author
  on public.stories(author_id);

create index if not exists idx_stories_published_at
  on public.stories(published_at desc);

create index if not exists idx_stories_created_at
  on public.stories(created_at desc);

create index if not exists idx_stories_views
  on public.stories(views desc);

create index if not exists idx_story_tags_tag
  on public.story_tags(tag_id);

create index if not exists idx_bookmarks_user
  on public.bookmarks(user_id);

create index if not exists idx_bookmarks_story
  on public.bookmarks(story_id);

create index if not exists idx_history_user
  on public.reading_history(user_id);

create index if not exists idx_history_story
  on public.reading_history(story_id);

create index if not exists idx_likes_story
  on public.likes(story_id);

create index if not exists idx_ratings_story
  on public.ratings(story_id);

create index if not exists idx_comments_story
  on public.comments(story_id);

create index if not exists idx_notifications_user
  on public.notifications(user_id);


-- =========================================================
-- 18. UPDATED_AT FUNCTION
-- =========================================================

create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =========================================================
-- 19. UPDATED_AT TRIGGERS
-- =========================================================

drop trigger if exists profiles_updated_at
on public.profiles;

create trigger profiles_updated_at
before update on public.profiles
for each row
execute function public.update_updated_at();


drop trigger if exists stories_updated_at
on public.stories;

create trigger stories_updated_at
before update on public.stories
for each row
execute function public.update_updated_at();


drop trigger if exists collections_updated_at
on public.collections;

create trigger collections_updated_at
before update on public.collections
for each row
execute function public.update_updated_at();


drop trigger if exists ratings_updated_at
on public.ratings;

create trigger ratings_updated_at
before update on public.ratings
for each row
execute function public.update_updated_at();


drop trigger if exists comments_updated_at
on public.comments;

create trigger comments_updated_at
before update on public.comments
for each row
execute function public.update_updated_at();


-- =========================================================
-- 20. INITIAL GENRES
-- =========================================================

insert into public.genres (name, slug, description)
values
  ('Fantasy', 'fantasy', 'Magic, mythical worlds and extraordinary adventures.'),
  ('Mystery', 'mystery', 'Secrets, investigations and unexplained events.'),
  ('Science Fiction', 'science-fiction', 'Future technology, space and scientific possibilities.'),
  ('Horror', 'horror', 'Eerie, unsettling and supernatural stories.'),
  ('Thriller', 'thriller', 'Suspenseful stories filled with tension and uncertainty.'),
  ('Comedy', 'comedy', 'Funny and entertaining stories.'),
  ('Adventure', 'adventure', 'Journeys, exploration and discovery.'),
  ('Drama', 'drama', 'Character-focused stories about meaningful conflicts and choices.'),
  ('Romance', 'romance', 'Stories centered around relationships and emotional connections.'),
  ('Historical', 'historical', 'Stories inspired by historical settings and periods.'),
  ('Young Adult', 'young-adult', 'Stories focused on teenage and young adult characters.'),
  ('Literary', 'literary', 'Character-driven and stylistically focused fiction.')
on conflict (slug) do nothing;


-- =========================================================
-- END OF TALEFORGE DATABASE SCHEMA
-- =========================================================
