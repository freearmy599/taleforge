\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'CREATE ROLE anon NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'CREATE ROLE service_role NOLOGIN BYPASSRLS';
  END IF;
END
$roles$;

CREATE TABLE public.taleforge_ai_provider_state (
  provider text PRIMARY KEY,
  cooldown_until timestamptz NULL,
  consecutive_throttle_count integer NOT NULL DEFAULT 0,
  last_error text NULL,
  last_error_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
