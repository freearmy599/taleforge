-- Prevent future objects in public from inheriting broad client privileges.
-- This is a branch-only hardening proposal; do not apply to production without approval.
-- Existing objects still require explicit inventory and allowlisted grants.
DO $$
DECLARE
  owner_role text;
BEGIN
  FOREACH owner_role IN ARRAY ARRAY['postgres', 'supabase_admin']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = owner_role) THEN
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
    END IF;
  END LOOP;
END
$$;
