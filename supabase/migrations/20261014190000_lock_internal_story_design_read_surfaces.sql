-- Candidate server-only lock for internal Aevora story-design/intelligence
-- relations that currently expose status-filtered SELECT policies to browser roles.
-- Current browser data code does not read these relations; readers use the public
-- series/chapters/genres surfaces. Review API compatibility before production rollout.
-- This migration is branch-only and intentionally does not alter reader-facing tables.
DO $$
DECLARE
  table_name text;
  column_list text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'taleforge_advanced_chapter_plans',
    'taleforge_character_architecture',
    'taleforge_ending_architecture',
    'taleforge_genre_grammars',
    'taleforge_genre_inversion_patterns',
    'taleforge_genre_taxonomy',
    'taleforge_grammar_compatibility',
    'taleforge_hybrid_story_recipes',
    'taleforge_hybrid_story_recipes_generated',
    'taleforge_narrative_arc_layers',
    'taleforge_narrative_culture_profiles',
    'taleforge_narrative_memory_consolidations',
    'taleforge_narrative_modes',
    'taleforge_series_genre_grammar_profiles',
    'taleforge_series_genre_profiles',
    'taleforge_series_narrative_profiles',
    'taleforge_series_subgenre_profiles',
    'taleforge_story_concept_arc_characters',
    'taleforge_story_concept_arc_endings',
    'taleforge_story_concept_arc_relationships',
    'taleforge_story_concept_arc_threads',
    'taleforge_story_concept_arc_world_functions',
    'taleforge_story_concept_arcs',
    'taleforge_story_concept_candidates',
    'taleforge_story_concept_character_causality',
    'taleforge_story_concept_characters',
    'taleforge_story_concept_evaluations',
    'taleforge_story_concept_faction_causality',
    'taleforge_story_concept_factions',
    'taleforge_story_concept_relationships',
    'taleforge_story_concept_state_transitions',
    'taleforge_story_concept_world_dependencies',
    'taleforge_story_concept_world_links',
    'taleforge_story_concept_world_rules',
    'taleforge_story_concept_world_state_models',
    'taleforge_story_concept_world_state_transitions',
    'taleforge_story_concept_worlds',
    'taleforge_story_opportunities',
    'taleforge_story_specific_depth_designs',
    'taleforge_story_trope_library',
    'taleforge_subgenre_intelligence'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);

      SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
        INTO column_list
      FROM pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', table_name))
        AND attnum > 0
        AND NOT attisdropped;

      IF column_list IS NOT NULL THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
          column_list,
          table_name
        );
      END IF;

      FOR policy_name IN
        SELECT p.policyname
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = table_name
          AND p.cmd IN ('SELECT', 'ALL')
          AND p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
