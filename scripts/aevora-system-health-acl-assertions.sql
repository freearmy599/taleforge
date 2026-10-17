\set ON_ERROR_STOP on
DO $assert$
DECLARE
  client_role text;
  privilege_name text;
BEGIN
  IF NOT has_table_privilege('anon', 'public.taleforge_system_health_snapshot', 'SELECT')
     AND has_table_privilege('authenticated', 'public.taleforge_system_health_snapshot', 'SELECT') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: unexpected asymmetric snapshot read grant';
  END IF;

  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','MAINTAIN','TRUNCATE','REFERENCES','TRIGGER']
    LOOP
      IF has_table_privilege(client_role, 'public.taleforge_system_health_snapshot', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on raw health snapshot', client_role, privilege_name;
      END IF;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['INSERT','UPDATE','DELETE','MAINTAIN','TRUNCATE','REFERENCES','TRIGGER']
    LOOP
      IF has_table_privilege(client_role, 'public.taleforge_system_registry', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on system registry', client_role, privilege_name;
      END IF;
      IF has_table_privilege(client_role, 'public.taleforge_system_health', privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % retains % on system health', client_role, privilege_name;
      END IF;
    END LOOP;

    IF NOT has_table_privilege(client_role, 'public.taleforge_system_registry', 'SELECT')
       OR NOT has_table_privilege(client_role, 'public.taleforge_system_health', 'SELECT') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: intended public SELECT grant was removed for %', client_role;
    END IF;

    IF has_column_privilege(client_role, 'public.taleforge_system_health', 'evidence', 'UPDATE')
       OR has_column_privilege(client_role, 'public.taleforge_system_health', 'evidence', 'REFERENCES') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: % retains column-level write/reference grant on system health evidence', client_role;
    END IF;
  END LOOP;

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
SELECT 'system-health snapshot and write-ACL assertions passed' AS result;
