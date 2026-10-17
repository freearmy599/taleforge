\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

-- The live refresh function returns this table's composite row type.
CREATE TYPE public.story_attachment_metrics AS (id bigint);

-- Use a namespaced disposable table so this fixture composes safely with the
-- broader internal-table lock rehearsal, which also defines public.chapters.
CREATE TABLE public.aevora_rpc_acl_trigger_source (id integer PRIMARY KEY, touched boolean NOT NULL DEFAULT false);
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
CREATE OR REPLACE FUNCTION public.taleforge_update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.touched := true; RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.touch_story_lifecycle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.update_series_chapter_count()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

-- Model inherited PUBLIC EXECUTE and direct client grants, while preserving
-- explicit server-role EXECUTE grants as observed in the live catalog.
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
