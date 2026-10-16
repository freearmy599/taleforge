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
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_admin') THEN
    EXECUTE 'CREATE ROLE supabase_admin NOLOGIN';
  END IF;
END
$roles$;

GRANT CREATE ON SCHEMA public TO supabase_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO PUBLIC, anon, authenticated, service_role;

DO $tables$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'automation_config',
    'chapter_blueprints',
    'chapter_generation_outputs',
    'chapter_publication_reviews',
    'chapter_reviews',
    'generation_jobs',
    'generation_settings',
    'release_schedules',
    'story_blueprints',
    'story_versions',
    'story_arc_plan',
    'story_ending_plans',
    'story_lifecycle',
    'profiles',
    'bookmarks',
    'collections',
    'collection_stories',
    'comments',
    'likes',
    'notifications',
    'ratings',
    'reading_history',
    'story_reports',
    'recommendations',
    'taleforge_ceo_daily_operations',
    'taleforge_ceo_incidents',
    'taleforge_ceo_repair_plans',
    'taleforge_continuity_extraction_queue',
    'taleforge_executive_reports',
    'taleforge_generation_context_snapshots',
    'taleforge_hybrid_story_engine_runs',
    'taleforge_inversion_evaluations',
    'taleforge_narrative_profile_selections',
    'taleforge_novelty_signatures',
    'taleforge_story_concept_design_runs',
    'taleforge_story_opportunity_runs',
    'taleforge_system_governance_dependencies',
    'taleforge_system_governance_registry',
    'taleforge_system_governance_runs'
  ]
  LOOP
    EXECUTE format('CREATE TABLE public.%I (id bigint PRIMARY KEY)', table_name);
  END LOOP;
END
$tables$;

-- Dormant account/community tables have RLS enabled but intentionally no policies.
DO $dormant_rls$
DECLARE
  v_table_name text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'profiles',
    'bookmarks',
    'collections',
    'collection_stories',
    'comments',
    'likes',
    'notifications',
    'ratings',
    'reading_history',
    'story_reports',
    'recommendations',
    'story_arc_plan',
    'story_ending_plans',
    'story_lifecycle'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);
  END LOOP;
END
$dormant_rls$;

-- Model the current live public SELECT policies on internal story-planning tables.
CREATE POLICY "published arc plans readable" ON public.story_arc_plan
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "published ending plans readable" ON public.story_ending_plans
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public can read lifecycle for published series" ON public.story_lifecycle
  FOR SELECT TO anon, authenticated USING (true);

-- A user-facing table is included to prove maintenance-only revocation preserves CRUD.
CREATE TABLE public.chapters (id bigint PRIMARY KEY);

-- Deliberately model broad grants on every fixture table, including PUBLIC.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO PUBLIC, anon, authenticated, service_role;

-- Also model independent column grants: table-level REVOKE does not remove these.
DO $column_grants$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'automation_config',
    'chapter_blueprints',
    'chapter_generation_outputs',
    'chapter_publication_reviews',
    'chapter_reviews',
    'generation_jobs',
    'generation_settings',
    'release_schedules',
    'story_blueprints',
    'story_versions',
    'profiles',
    'bookmarks',
    'collections',
    'collection_stories',
    'comments',
    'likes',
    'notifications',
    'ratings',
    'reading_history',
    'story_reports',
    'recommendations',
    'taleforge_ceo_daily_operations',
    'taleforge_ceo_incidents',
    'taleforge_ceo_repair_plans',
    'taleforge_continuity_extraction_queue',
    'taleforge_executive_reports',
    'taleforge_generation_context_snapshots',
    'taleforge_hybrid_story_engine_runs',
    'taleforge_inversion_evaluations',
    'taleforge_narrative_profile_selections',
    'taleforge_novelty_signatures',
    'taleforge_story_concept_design_runs',
    'taleforge_story_opportunity_runs',
    'taleforge_system_governance_dependencies',
    'taleforge_system_governance_registry',
    'taleforge_system_governance_runs',
    'chapters',
    'story_arc_plan',
    'story_ending_plans',
    'story_lifecycle'
  ]
  LOOP
    EXECUTE format('GRANT SELECT (id), INSERT (id), UPDATE (id), REFERENCES (id) ON TABLE public.%I TO PUBLIC, anon, authenticated', table_name);
  END LOOP;
END
$column_grants$;
