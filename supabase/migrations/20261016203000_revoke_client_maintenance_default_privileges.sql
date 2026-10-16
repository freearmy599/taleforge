-- Aevora Phase 1: keep future public tables free of client maintenance grants.
-- Branch-only candidate. Schema-scoped only; never change global defaults here.
-- If a global maintenance grant exists, fail closed because a schema-specific
-- REVOKE cannot override an additive global default ACL.
DO $$
DECLARE
  owner_role text;
  owner_oid oid;
  executor_is_superuser boolean := false;
  anon_oid oid;
  authenticated_oid oid;
BEGIN
  SELECT COALESCE(rolsuper, false)
    INTO executor_is_superuser
  FROM pg_catalog.pg_roles
  WHERE rolname = current_user;

  SELECT oid INTO anon_oid FROM pg_catalog.pg_roles WHERE rolname = 'anon';
  SELECT oid INTO authenticated_oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated';

  IF anon_oid IS NULL OR authenticated_oid IS NULL THEN
    RAISE EXCEPTION 'required Supabase client roles are missing; refusing default ACL repair';
  END IF;

  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    SELECT oid INTO owner_oid
    FROM pg_catalog.pg_roles
    WHERE rolname = owner_role;

    IF owner_oid IS NULL THEN
      RAISE EXCEPTION 'required owner role % is missing; refusing default ACL repair', owner_role;
    END IF;

    IF NOT executor_is_superuser
       AND NOT pg_catalog.pg_has_role(current_user, owner_role, 'MEMBER') THEN
      RAISE EXCEPTION 'executor cannot administer default privileges for owner role %; an authorized owner operation is required', owner_role;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_default_acl AS d
      CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS a
      WHERE d.defaclrole = owner_oid
        AND d.defaclnamespace = 0
        AND d.defaclobjtype = 'r'
        AND a.grantee IN (0, anon_oid, authenticated_oid)
        AND a.privilege_type IN ('MAINTAIN', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
    ) THEN
      RAISE EXCEPTION 'global table maintenance defaults exist for owner role %; schema-scoped repair cannot override them safely', owner_role;
    END IF;

    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE MAINTAIN, TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM PUBLIC, anon, authenticated',
      owner_role
    );
  END LOOP;
END
$$;
