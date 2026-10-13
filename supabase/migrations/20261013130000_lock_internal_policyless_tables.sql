-- Lock internal Aevora intelligence/control tables that currently have RLS enabled
-- but no policies. With no policies, row access is denied; broad table grants still
-- leave unnecessary TRUNCATE/DDL-adjacent capabilities. These are not client APIs.
-- Do not add anon/authenticated policies to this list.
DO $$
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
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    END IF;
  END LOOP;
END
$$;
