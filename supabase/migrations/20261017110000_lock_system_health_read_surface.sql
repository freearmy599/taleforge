-- Aevora Phase 1: close system-health snapshot and sensitive health read/write gaps.
-- Branch candidate only; not applied to production.
--
-- The raw snapshot and health evidence/blocking details are server control-plane
-- data, not a browser API. Lock the raw snapshot and health table to trusted server
-- roles. Keep the system registry's existing explicit SELECT policy for harmless
-- system metadata, while removing unapproved client writes and maintenance grants.
-- service_role grants are deliberately untouched.
BEGIN;

DO $lock$
DECLARE
  target_oid oid;
  column_list text;
  policy_name text;
BEGIN
  -- Raw health snapshot is server-only. Fail closed if it is missing or no longer
  -- the expected view type, rather than silently completing a partial ACL repair.
  SELECT c.oid
    INTO target_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'taleforge_system_health_snapshot'
    AND c.relkind = 'v';

  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'required view public.taleforge_system_health_snapshot is missing or not a view; refusing ACL hardening';
  END IF;

  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.taleforge_system_health_snapshot FROM PUBLIC, anon, authenticated';

  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO column_list
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = target_oid
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF column_list IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.taleforge_system_health_snapshot FROM PUBLIC, anon, authenticated',
      column_list
    );
  END IF;

  -- The health table exposes evidence and blocking details. Remove client SELECT
  -- policies as well as relation/column grants; RLS alone is not a grant boundary.
  SELECT c.oid
    INTO target_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'taleforge_system_health'
    AND c.relkind IN ('r', 'p');

  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'required health table public.taleforge_system_health is missing; refusing ACL hardening';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = target_oid) THEN
    RAISE EXCEPTION 'RLS is not enabled on public.taleforge_system_health; refusing ACL hardening';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'taleforge_system_health'
      AND p.cmd = 'SELECT'
      AND p.roles && ARRAY['anon', 'authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'expected existing client health SELECT policy missing; review intended read surface';
  END IF;

  FOR policy_name IN
    SELECT p.policyname
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'taleforge_system_health'
      AND p.cmd = 'SELECT'
      AND p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.taleforge_system_health', policy_name);
  END LOOP;

  EXECUTE 'REVOKE ALL PRIVILEGES ON TABLE public.taleforge_system_health FROM PUBLIC, anon, authenticated';

  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO column_list
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = target_oid
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF column_list IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.taleforge_system_health FROM PUBLIC, anon, authenticated',
      column_list
    );
  END IF;

  -- System registry is intentionally kept readable for basic public metadata,
  -- but client writes and table-maintenance privileges are not approved.
  SELECT c.oid
    INTO target_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'taleforge_system_registry'
    AND c.relkind IN ('r', 'p');

  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'required registry table public.taleforge_system_registry is missing; refusing ACL hardening';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = target_oid) THEN
    RAISE EXCEPTION 'RLS is not enabled on public.taleforge_system_registry; refusing to preserve public SELECT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'taleforge_system_registry'
      AND p.cmd = 'SELECT'
      AND p.roles && ARRAY['anon', 'authenticated']::name[]
  ) THEN
    RAISE EXCEPTION 'expected public registry SELECT policy missing; review intended read surface';
  END IF;

  EXECUTE 'REVOKE INSERT, UPDATE, DELETE, MAINTAIN, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.taleforge_system_registry FROM PUBLIC, anon, authenticated';

  -- Make the intended public metadata read explicit instead of relying on inherited grants.
  EXECUTE 'GRANT SELECT ON TABLE public.taleforge_system_registry TO anon, authenticated';

  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO column_list
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = target_oid
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF column_list IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.taleforge_system_registry FROM PUBLIC, anon, authenticated',
      column_list
    );
  END IF;
END
$lock$;

COMMIT;
