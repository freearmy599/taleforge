\set ON_ERROR_STOP on
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END
$roles$;

DROP VIEW IF EXISTS public.taleforge_system_health_snapshot;
DROP TABLE IF EXISTS public.taleforge_system_health;
DROP TABLE IF EXISTS public.taleforge_system_registry;

CREATE TABLE public.taleforge_system_registry (
  id bigint PRIMARY KEY,
  system_key text NOT NULL,
  display_name text NOT NULL
);
CREATE TABLE public.taleforge_system_health (
  id bigint PRIMARY KEY,
  system_key text NOT NULL,
  health_status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.taleforge_system_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.taleforge_system_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public can read system registry" ON public.taleforge_system_registry
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "public can read system health" ON public.taleforge_system_health
  FOR SELECT TO anon, authenticated USING (true);

CREATE VIEW public.taleforge_system_health_snapshot
WITH (security_invoker = true) AS
SELECT r.system_key, r.display_name, h.health_status, h.evidence
FROM public.taleforge_system_registry r
LEFT JOIN public.taleforge_system_health h USING (system_key);

GRANT ALL PRIVILEGES ON TABLE public.taleforge_system_registry TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.taleforge_system_health TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON TABLE public.taleforge_system_health_snapshot TO anon, authenticated, service_role;
GRANT SELECT (evidence), UPDATE (evidence) ON TABLE public.taleforge_system_health TO anon, authenticated;
GRANT SELECT (evidence) ON TABLE public.taleforge_system_health_snapshot TO anon, authenticated;

INSERT INTO public.taleforge_system_registry (id, system_key, display_name)
VALUES (1, 'fixture-system', 'Fixture System');
INSERT INTO public.taleforge_system_health (id, system_key, health_status, evidence)
VALUES (1, 'fixture-system', 'degraded', '{"fixture": true}'::jsonb);
