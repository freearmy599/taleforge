\set ON_ERROR_STOP on
DO $assert$
DECLARE
  client_role text;
  privilege_name text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF NOT has_table_privilege(client_role, 'public.chapters', 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: intended public chapter SELECT access was removed for %', client_role;
    END IF;

    FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF has_table_privilege(client_role, 'public.chapters', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on public.chapters', client_role, privilege_name;
      END IF;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['INSERT', 'UPDATE']
    LOOP
      IF has_column_privilege(client_role, 'public.chapters', 'title', privilege_name)
         OR has_column_privilege(client_role, 'public.chapters', 'content', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains column-level % on public.chapters', client_role, privilege_name;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH privilege_name IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  LOOP
    IF NOT has_table_privilege('service_role', 'public.chapters', privilege_name) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost % on public.chapters', privilege_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'chapters'
      AND policyname = 'fixture public chapter read' AND cmd = 'SELECT'
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: migration unexpectedly removed the chapter read policy';
  END IF;
END
$assert$;
SELECT 'chapter client write ACL assertions passed' AS result;
