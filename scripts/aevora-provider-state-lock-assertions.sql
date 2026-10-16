\set ON_ERROR_STOP on
DO $assert$
DECLARE
  client_role text;
  privilege_name text;
BEGIN
  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = 'taleforge_ai_provider_state') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: provider-state RLS is not enabled';
  END IF;
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','MAINTAIN','TRUNCATE','REFERENCES','TRIGGER']
    LOOP
      IF has_table_privilege(client_role, 'public.taleforge_ai_provider_state', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains provider-state table privilege %', client_role, privilege_name;
      END IF;
    END LOOP;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES']
    LOOP
      IF has_column_privilege(client_role, 'public.taleforge_ai_provider_state', 'last_error', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains provider-state column privilege %', client_role, privilege_name;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.taleforge_ai_provider_state', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.taleforge_ai_provider_state', 'UPDATE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: server service_role grants were unexpectedly removed';
  END IF;
  IF (SELECT last_error FROM public.taleforge_ai_provider_state WHERE provider = 'gemini')
       <> 'Gemini temporary overload response' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: legacy Gemini overload diagnostic was not sanitized';
  END IF;
  IF (SELECT last_error FROM public.taleforge_ai_provider_state WHERE provider = 'other')
       <> 'fixture diagnostic unrelated to Gemini' THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: non-Gemini diagnostic was unexpectedly changed';
  END IF;
END
$assert$;
SELECT 'provider-state lock ACL and redaction assertions passed' AS result;
