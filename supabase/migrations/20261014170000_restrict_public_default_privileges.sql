-- Prevent future objects in public from inheriting broad client privileges.
-- This is a branch-only hardening proposal; do not apply to production without approval.
-- Existing objects still require explicit inventory and allowlisted grants.
-- A superuser may alter another role's defaults even without explicit membership.
-- A non-superuser must be a member of the target owner role; otherwise skip it
-- explicitly and keep Phase 1 blocked until an authorized owner operation occurs.
DO $$
DECLARE
  owner_role text;
  executor_is_superuser boolean := false;
BEGIN
  SELECT COALESCE(rolsuper, false)
    INTO executor_is_superuser
  FROM pg_catalog.pg_roles
  WHERE rolname = current_user;

  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = owner_role)
       AND (
         executor_is_superuser
         OR pg_catalog.pg_has_role(current_user, owner_role, 'MEMBER')
       ) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated',
        owner_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated',
        owner_role
      );
    ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role) THEN
      RAISE NOTICE 'Skipping default privileges for role %: executor is neither a superuser nor a member; requires an authorized owner operation', owner_role;
    END IF;
  END LOOP;
END
$$;
