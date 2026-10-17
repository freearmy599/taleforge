\set ON_ERROR_STOP on
DO $assert$
DECLARE
  relation_name text;
  client_role text;
  privilege_name text;
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
    'taleforge_series_narrative_profiles',
    'taleforge_series_genre_profiles',
    'taleforge_series_subgenre_profiles'
  ]
  LOOP
    FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY[
        'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
        'REFERENCES', 'TRIGGER', 'MAINTAIN'
      ]
      LOOP
        IF has_table_privilege(client_role, format('public.%I', relation_name), privilege_name) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: % retains relation privilege % on public.%', client_role, privilege_name, relation_name;
        END IF;
      END LOOP;

      IF has_any_column_privilege(client_role, format('public.%I', relation_name), 'SELECT')
         OR has_any_column_privilege(client_role, format('public.%I', relation_name), 'INSERT')
         OR has_any_column_privilege(client_role, format('public.%I', relation_name), 'UPDATE')
         OR has_any_column_privilege(client_role, format('public.%I', relation_name), 'REFERENCES') THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains a column privilege on public.%', client_role, relation_name;
      END IF;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY[
      'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE',
      'REFERENCES', 'TRIGGER', 'MAINTAIN'
    ]
    LOOP
      IF NOT has_table_privilege('service_role', format('public.%I', relation_name), privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost expected privilege % on public.%', privilege_name, relation_name;
      END IF;
    END LOOP;
  END LOOP;
END
$assert$;
SELECT 'taxonomy client relation/column privileges revoked; service_role access preserved' AS result;
