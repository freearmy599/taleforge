\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

DROP TABLE IF EXISTS public.chapter_reviews CASCADE;
DROP TABLE IF EXISTS public.chapter_generation_outputs CASCADE;
CREATE TABLE public.chapter_generation_outputs (
  id uuid PRIMARY KEY,
  generation_status text NOT NULL CHECK (generation_status IN ('generated','quality_check','needs_revision','approved','rejected','published')),
  quality_score numeric,
  quality_report jsonb,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE public.chapter_reviews (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  generation_output_id uuid NOT NULL REFERENCES public.chapter_generation_outputs(id) ON DELETE CASCADE,
  review_type text NOT NULL CHECK (review_type IN ('quality','continuity','originality','safety')),
  status text NOT NULL CHECK (status IN ('pending','running','passed','needs_revision','failed')),
  score numeric,
  findings jsonb,
  reviewer_model text,
  reviewer_version text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (generation_output_id, review_type)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chapter_generation_outputs, public.chapter_reviews TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC;

INSERT INTO public.chapter_generation_outputs(id,generation_status,updated_at)
VALUES
 ('00000000-0000-0000-0000-000000000001','generated','2000-01-01T00:00:00Z'),
 ('00000000-0000-0000-0000-000000000002','published','2000-01-01T00:00:00Z'),
 ('00000000-0000-0000-0000-000000000003','generated','2000-01-01T00:00:00Z');
CREATE FUNCTION public.aevora_fixture_reject_quality_review_write()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reviewer_version = 'force-write-failure' THEN
    RAISE EXCEPTION 'fixture forced review persistence failure';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER aevora_fixture_reject_quality_review_write
BEFORE INSERT OR UPDATE ON public.chapter_reviews
FOR EACH ROW EXECUTE FUNCTION public.aevora_fixture_reject_quality_review_write();
