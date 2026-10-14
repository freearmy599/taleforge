-- Prevent future objects in public from inheriting broad client privileges.
-- This is a branch-only hardening proposal; do not apply to production without approval.
-- Existing objects still require explicit inventory and allowlisted grants.
-- The current production postgres role is not a member of supabase_admin, so this
-- migration must skip that owner rather than fail; its defaults need a separately
-- authorized privileged operation before Phase 1 can pass.
DO $$
DECLARE
  owner_role text;
BEGIN
  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role)
       AND pg_has_role(current_user, owner_role, 'MEMBER') THEN
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
      RAISE NOTICE 'Skipping default privileges for role %: migration executor is not a member; requires a privileged owner operation', owner_role;
    END IF;
  END LOOP;
END
$$;
