\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

CREATE TYPE public.story_attachment_metrics AS (id bigint);

-- Isolated trigger table avoids conflicting with the broader chapter fixtures.
CREATE TABLE public.aevora_rpc_acl_trigger_source (id integer PRIMARY KEY, updated_at timestamptz);
ALTER TABLE public.aevora_rpc_acl_trigger_source ENABLE ROW LEVEL SECURITY;
CREATE POLICY aevora_rpc_fixture_select ON public.aevora_rpc_acl_trigger_source FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY aevora_rpc_fixture_insert ON public.aevora_rpc_acl_trigger_source FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY aevora_rpc_fixture_update ON public.aevora_rpc_acl_trigger_source FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.aevora_rpc_acl_trigger_source TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_attachment_directives(uuid)
RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE OR REPLACE FUNCTION public.get_active_story_arc_plan(uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.get_production_buffer_plan()
RETURNS TABLE(series_id uuid, title text, lifecycle_status text, target_buffer integer,
              active_buffer integer, deficit integer, priority_score integer)
LANGUAGE sql AS $$
  SELECT NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer, NULL::integer
  WHERE false
$$;
CREATE OR REPLACE FUNCTION public.get_story_narrative_destination(uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.prepare_next_chapter_blueprint(uuid)
RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE OR REPLACE FUNCTION public.refresh_story_attachment_metrics(uuid)
RETURNS public.story_attachment_metrics LANGUAGE sql AS $$ SELECT NULL::public.story_attachment_metrics $$;
CREATE OR REPLACE FUNCTION public.taleforge_get_long_term_architecture_context(uuid)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE OR REPLACE FUNCTION public.taleforge_score_story_opportunity(numeric, numeric, numeric, numeric, numeric)
RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;

-- Preserve any trigger-function bodies already supplied by the broader fixture.
-- Only create a minimal equivalent where the standalone rehearsal needs it.
DO $trigger_functions$
BEGIN
  IF to_regprocedure('public.taleforge_update_updated_at()') IS NULL THEN
    EXECUTE $ddl$CREATE FUNCTION public.taleforge_update_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN NEW.updated_at := now(); RETURN NEW; END $fn$;$ddl$;
  END IF;
  IF to_regprocedure('public.touch_story_lifecycle_updated_at()') IS NULL THEN
    EXECUTE $ddl$CREATE FUNCTION public.touch_story_lifecycle_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN NEW.updated_at := now(); RETURN NEW; END $fn$;$ddl$;
  END IF;
  IF to_regprocedure('public.update_series_chapter_count()') IS NULL THEN
    EXECUTE $ddl$CREATE FUNCTION public.update_series_chapter_count()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END $fn$;$ddl$;
  END IF;
  IF to_regprocedure('public.update_updated_at()') IS NULL THEN
    EXECUTE $ddl$CREATE FUNCTION public.update_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN NEW.updated_at := now(); RETURN NEW; END $fn$;$ddl$;
  END IF;
END
$trigger_functions$;

GRANT EXECUTE ON FUNCTION public.apply_attachment_directives(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_active_story_arc_plan(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_production_buffer_plan() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_story_narrative_destination(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_next_chapter_blueprint(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_story_attachment_metrics(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.taleforge_get_long_term_architecture_context(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.taleforge_score_story_opportunity(numeric, numeric, numeric, numeric, numeric) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.taleforge_update_updated_at() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_story_lifecycle_updated_at() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_series_chapter_count() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at() TO anon, authenticated, service_role;

CREATE TRIGGER aevora_rpc_acl_trigger_fixture
BEFORE UPDATE ON public.aevora_rpc_acl_trigger_source
FOR EACH ROW EXECUTE FUNCTION public.taleforge_update_updated_at();
