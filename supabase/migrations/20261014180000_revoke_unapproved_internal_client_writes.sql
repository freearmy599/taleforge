-- Least-privilege repair for internal-prefixed relations with client write
-- grants but no applicable client write RLS policy in the 2026-10-14 audit.
-- Preserve SELECT grants for separate read-surface review; this migration does
-- not approve or expand client reads. Internal-only read access is handled by
-- the explicit server-only lock migration and must remain separately classified.
-- Branch-only candidate: do not apply until migration compatibility is approved.
DO $$
DECLARE
  table_name text;
  column_list text;
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
      EXECUTE format(
        'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        table_name
      );

      SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
        INTO column_list
      FROM pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', table_name))
        AND attnum > 0
        AND NOT attisdropped;

      IF column_list IS NOT NULL THEN
        EXECUTE format(
          'REVOKE INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
          column_list,
          table_name
        );
      END IF;
    END IF;
  END LOOP;
END
$$;
