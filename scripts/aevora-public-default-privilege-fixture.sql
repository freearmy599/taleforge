\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'supabase_admin') THEN
    EXECUTE 'CREATE ROLE supabase_admin NOLOGIN';
  END IF;
END
$roles$;

-- Seed broad defaults only in this disposable database to reproduce the risk
-- for both object owners discovered in the live catalog.
GRANT CREATE ON SCHEMA public TO supabase_admin;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated;
