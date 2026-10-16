-- Candidate server-only lock for the 27 high-priority internal Aevora story-design
-- relations identified in the 2026-10-16 public-read review. The 14 provisional
-- taxonomy/reference tables are deliberately excluded pending product/API review.
-- Current browser data code does not read the 27 internal relations; trusted workers
-- retain service_role access. This candidate remains unapplied pending rollout review.
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
    'taleforge_narrative_arc_layers',
    'taleforge_narrative_memory_consolidations',
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
    'taleforge_story_specific_depth_designs'
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
