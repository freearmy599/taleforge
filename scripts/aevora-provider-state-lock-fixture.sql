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
  consecutive_throttle_count integer NOT NULL DEFAULT 0,
  cooldown_until timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Deliberately recreate the over-broad live ACL condition on disposable PostgreSQL.
GRANT ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state TO anon, authenticated;
GRANT SELECT (last_error), UPDATE (last_error) ON TABLE public.taleforge_ai_provider_state TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state TO service_role;

INSERT INTO public.taleforge_ai_provider_state(provider, last_error)
VALUES
  ('gemini', 'Gemini HTTP 503 raw fixture diagnostic'),
  ('other', 'fixture diagnostic unrelated to Gemini');
