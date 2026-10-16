-- Aevora Phase 1: keep internal taxonomy/grammar recipes server-side until a
-- reviewed public projection exists. Branch candidate; not applied to production.
-- Ordinary browser and API roles do not need raw structural rules, originality
-- constraints, compatibility/risk reports, or series-specific planning profiles.
-- Trusted service_role access is deliberately preserved.
DO $$
DECLARE
  target_name text;
  column_list text;
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
    IF to_regclass(format('public.%I', target_name)) IS NULL THEN
      RAISE EXCEPTION 'required taxonomy relation public.% is missing; refusing partial read-surface lock', target_name;
    END IF;

    EXECUTE format(
      'REVOKE SELECT ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      target_name
    );

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO column_list
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = format('public.%I', target_name)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_list,
        target_name
      );
    END IF;
  END LOOP;
END
$$;
