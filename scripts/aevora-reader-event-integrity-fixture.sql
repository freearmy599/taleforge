\set ON_ERROR_STOP on

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS';
  END IF;
END;
$roles$;

CREATE TABLE public.series (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  subtitle text,
  description text,
  status text NOT NULL,
  published_at timestamptz
);
CREATE TABLE public.chapters (
  id uuid PRIMARY KEY,
  series_id uuid NOT NULL REFERENCES public.series(id) ON DELETE CASCADE,
  status text NOT NULL
);
CREATE TABLE public.reader_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'story_open','chapter_start','reading_progress','chapter_complete',
    'follow','unfollow','bookmark','unbookmark'
  )),
  series_id uuid REFERENCES public.series(id) ON DELETE CASCADE,
  chapter_id uuid REFERENCES public.chapters(id) ON DELETE CASCADE,
  progress_percent smallint CHECK (progress_percent BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.aevora_engineering_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event text NOT NULL
);
CREATE TABLE public.story_intelligence (
  series_id uuid PRIMARY KEY REFERENCES public.series(id) ON DELETE CASCADE,
  synopsis text
);

ALTER TABLE public.series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read eligible series" ON public.series
FOR SELECT TO anon, authenticated USING (status IN ('ongoing','completed'));
CREATE POLICY "Public can read published chapters" ON public.chapters
FOR SELECT TO anon, authenticated USING (
  status = 'published' AND EXISTS (
    SELECT 1 FROM public.series s
    WHERE s.id = chapters.series_id AND s.status IN ('ongoing','completed')
  )
);

INSERT INTO public.series(id,title,status) VALUES
('00000000-0000-0000-0000-000000000101','Eligible A','ongoing'),
('00000000-0000-0000-0000-000000000102','Eligible B','ongoing'),
('00000000-0000-0000-0000-000000000103','Ineligible','draft'),
('00000000-0000-0000-0000-000000000104','Completed','completed');

INSERT INTO public.chapters(id,series_id,status) VALUES
('00000000-0000-0000-0000-000000000111','00000000-0000-0000-0000-000000000101','published'),
('00000000-0000-0000-0000-000000000112','00000000-0000-0000-0000-000000000101','draft'),
('00000000-0000-0000-0000-000000000141','00000000-0000-0000-0000-000000000104','published'),
('00000000-0000-0000-0000-000000000121','00000000-0000-0000-0000-000000000102','published');

GRANT SELECT ON public.series, public.chapters TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.reader_events TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.reader_events TO service_role;
GRANT ALL PRIVILEGES ON SEQUENCE public.reader_events_id_seq, public.aevora_engineering_events_id_seq TO anon, authenticated;
GRANT ALL PRIVILEGES ON SEQUENCE public.reader_events_id_seq, public.aevora_engineering_events_id_seq TO service_role;

-- Legacy policy intentionally lacks the chapter.series_id pair comparison.
CREATE POLICY "Public can record reader events" ON public.reader_events
FOR INSERT TO anon, authenticated
WITH CHECK (
  visitor_id IS NOT NULL
  AND length(visitor_id) BETWEEN 16 AND 100
  AND (series_id IS NULL OR EXISTS (
    SELECT 1 FROM public.series s
    WHERE s.id = reader_events.series_id AND s.status IN ('ongoing','completed')
  ))
  AND (chapter_id IS NULL OR EXISTS (
    SELECT 1 FROM public.chapters c
    JOIN public.series s ON s.id = c.series_id
    WHERE c.id = reader_events.chapter_id
      AND c.status = 'published'
      AND s.status IN ('ongoing','completed')
  ))
);
