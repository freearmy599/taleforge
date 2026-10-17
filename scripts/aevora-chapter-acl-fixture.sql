\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

DROP TABLE IF EXISTS public.chapters;
CREATE TABLE public.chapters (
  id uuid PRIMARY KEY,
  series_id uuid NOT NULL,
  chapter_number integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  status text NOT NULL
);
ALTER TABLE public.chapters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fixture public chapter read" ON public.chapters
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "fixture client chapter insert" ON public.chapters
  FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "fixture client chapter update" ON public.chapters
  FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "fixture client chapter delete" ON public.chapters
  FOR DELETE TO anon, authenticated USING (true);

GRANT ALL PRIVILEGES ON TABLE public.chapters TO anon, authenticated, service_role;
GRANT INSERT (title), UPDATE (content) ON TABLE public.chapters TO anon, authenticated;
