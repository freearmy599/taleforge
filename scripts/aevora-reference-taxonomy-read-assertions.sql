\set ON_ERROR_STOP on
DO $assert$
DECLARE
  target_name text;
BEGIN
  FOREACH target_name IN ARRAY ARRAY[
    'taleforge_genre_taxonomy',
    'taleforge_subgenre_intelligence',
    'taleforge_narrative_modes',
    'taleforge_story_trope_library',
    'taleforge_genre_grammars',
    'taleforge_genre_inversion_patterns',
    'taleforge_grammar_compatibility',
    'taleforge_hybrid_story_recipes',
    'taleforge_hybrid_story_recipes_generated',
    'taleforge_narrative_culture_profiles',
    'taleforge_series_genre_grammar_profiles',
    'taleforge_series_genre_profiles',
    'taleforge_series_narrative_profiles',
    'taleforge_series_subgenre_profiles'
  ]
  LOOP
    IF has_table_privilege('anon', format('public.%I', target_name), 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: anon retains raw SELECT on public.%', target_name;
    END IF;
    IF has_table_privilege('authenticated', format('public.%I', target_name), 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: authenticated retains raw SELECT on public.%', target_name;
    END IF;
    IF has_column_privilege('anon', format('public.%I', target_name), 'internal_rules', 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: anon retains column SELECT on public.%.internal_rules', target_name;
    END IF;
    IF has_column_privilege('authenticated', format('public.%I', target_name), 'internal_rules', 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: authenticated retains column SELECT on public.%.internal_rules', target_name;
    END IF;
    IF NOT has_table_privilege('service_role', format('public.%I', target_name), 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost SELECT on public.%', target_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies
      WHERE schemaname='public' AND tablename=target_name AND policyname='active_rows'
    ) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: fixture policy disappeared unexpectedly on public.%', target_name;
    END IF;
  END LOOP;
END
$assert$;
