\set ON_ERROR_STOP on
DO $assert$
DECLARE
  client_role text;
  privilege_name text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','MAINTAIN','TRUNCATE','REFERENCES','TRIGGER']
    LOOP
      IF has_table_privilege(client_role, 'public.taleforge_system_health_snapshot', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on raw health snapshot', client_role, privilege_name;
      END IF;
      IF has_table_privilege(client_role, 'public.taleforge_system_health', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on sensitive system health', client_role, privilege_name;
      END IF;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','MAINTAIN','TRUNCATE','REFERENCES','TRIGGER']
    LOOP
      IF has_table_privilege(client_role, 'public.taleforge_system_registry', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on system registry', client_role, privilege_name;
      END IF;
    END LOOP;

    IF NOT has_table_privilege(client_role, 'public.taleforge_system_registry', 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: intended public registry SELECT grant was removed for %', client_role;
    END IF;

    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES']
    LOOP
      IF has_column_privilege(client_role, 'public.taleforge_system_health', 'evidence', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains column-level % grant on system health evidence', client_role, privilege_name;
      END IF;
    END LOOP;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'taleforge_system_health'
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: sensitive system health still has client-access policies';
  END IF;

  FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
  LOOP
    IF NOT has_table_privilege('service_role', 'public.taleforge_system_registry', privilege_name)
       OR NOT has_table_privilege('service_role', 'public.taleforge_system_health', privilege_name) THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost % on health base tables', privilege_name;
    END IF;
  END LOOP;

  IF NOT has_table_privilege('service_role', 'public.taleforge_system_health_snapshot', 'SELECT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost SELECT on health snapshot';
  END IF;

  IF (SELECT count(*) FROM public.taleforge_system_health_snapshot) <> 1 THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: service_role cannot read the expected snapshot row';
  END IF;
END
$assert$;
SELECT 'system-health snapshot and sensitive-read ACL assertions passed' AS result;
