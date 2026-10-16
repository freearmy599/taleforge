-- Aevora Phase 1: remove client defaults for future public tables and sequences.
-- Branch-only candidate; this does not change existing-object ACLs.
-- Do not mutate global defaults or managed schemas from this app-schema repair.
-- PostgreSQL default ACLs are additive: a schema-scoped REVOKE cannot cancel a
-- client grant from a global default ACL. Fail closed if one is detected.
-- Function EXECUTE defaults are intentionally excluded: PostgreSQL's built-in
-- PUBLIC EXECUTE default is global, and safely changing it requires a separate
-- owner/schema impact review plus function-level EXECUTE allowlists.
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
    RAISE EXCEPTION 'required Supabase client roles are missing; refusing public default ACL repair';
  END IF;

  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    SELECT oid INTO owner_oid
    FROM pg_catalog.pg_roles
    WHERE rolname = owner_role;

    IF owner_oid IS NULL THEN
      RAISE EXCEPTION 'required default-privilege owner role % is missing; refusing public default ACL repair', owner_role;
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
        AND d.defaclobjtype IN ('r', 'S')
        AND a.grantee IN (0, anon_oid, authenticated_oid)
        AND a.privilege_type IN (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'MAINTAIN', 'TRUNCATE',
          'REFERENCES', 'TRIGGER', 'USAGE'
        )
    ) THEN
      RAISE EXCEPTION 'global table or sequence client defaults exist for owner role %; public-schema REVOKE cannot safely override them', owner_role;
    END IF;

    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated',
      owner_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated',
      owner_role
    );
  END LOOP;
END
$$;
