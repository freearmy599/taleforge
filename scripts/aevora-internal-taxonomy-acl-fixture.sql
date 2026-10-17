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
    EXECUTE 'CREATE ROLE service_role NOLOGIN';
  END IF;
END
$roles$;

DO $tables$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
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
    EXECUTE format('CREATE TABLE public.%I (id integer)', relation_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO anon, authenticated, service_role', relation_name);
    EXECUTE format('GRANT SELECT (id), INSERT (id), UPDATE (id), REFERENCES (id) ON TABLE public.%I TO anon, authenticated', relation_name);
  END LOOP;
END
$tables$;
