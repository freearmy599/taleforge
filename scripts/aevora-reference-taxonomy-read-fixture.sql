\set ON_ERROR_STOP on
-- Disposable fixtures only. Models public active-row policies plus both
-- relation-level and column-level SELECT grants that the candidate must remove.
DO $$
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
    EXECUTE format('CREATE TABLE public.%I (id bigint PRIMARY KEY, status text, internal_rules jsonb)', target_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', target_name);
    EXECUTE format('CREATE POLICY active_rows ON public.%I FOR SELECT TO anon, authenticated USING (status = ''active'')', target_name);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO PUBLIC, anon, authenticated, service_role', target_name);
    EXECUTE format('GRANT SELECT (internal_rules) ON TABLE public.%I TO anon, authenticated', target_name);
  END LOOP;
END
$$;
