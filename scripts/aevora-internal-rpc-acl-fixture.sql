\set ON_ERROR_STOP on
-- The live function returns this table's composite row type. This isolated
-- fixture models that return type without requiring the production table shape.
CREATE TYPE public.story_attachment_metrics AS (id bigint);

-- Minimal disposable fixtures for the exact function signatures in the
-- internal EXECUTE migration. This file is only run by the guarded local/CI
-- disposable PostgreSQL rehearsal, never against Supabase.
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
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.touch_story_lifecycle_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.update_series_chapter_count()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;

-- Model both inherited PUBLIC EXECUTE and direct client grants. Also verify
-- the migration does not remove the trusted server role's explicit grants.
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

-- Trigger execution must continue working after client EXECUTE is revoked.
CREATE TRIGGER aevora_rpc_acl_trigger_fixture
BEFORE UPDATE ON public.chapters
FOR EACH ROW EXECUTE FUNCTION public.taleforge_update_updated_at();
