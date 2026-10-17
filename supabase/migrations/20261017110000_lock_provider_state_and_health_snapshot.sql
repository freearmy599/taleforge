-- Aevora Phase 1: close remaining provider-state and health-control ACL gaps.
-- Branch candidate only. Do not apply to production until the complete migration
-- sequence and live-reader impact are reviewed.
--
-- Provider throttle/cooldown state is server control-plane data, not a browser API.
-- The raw health snapshot includes evidence and blocking details; expose it only
-- through a future deliberately designed public projection. Keep the existing
-- explicit SELECT policies on system registry/health for compatibility, but remove
-- unapproved client writes and table-maintenance privileges from those base tables.
-- service_role grants are intentionally untouched.
BEGIN;

DO $lock$
DECLARE
  target_name text;
  target_oid oid;
  column_list text;
  policy_count integer;
BEGIN
  -- These are server-only control-plane relations. Require their expected shape
  -- rather than silently completing only part of the hardening.
  FOREACH target_name IN ARRAY ARRAY[
    'taleforge_ai_provider_state',
    'taleforge_system_health_snapshot'
  ]
  LOOP
    SELECT c.oid
      INTO target_oid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = target_name
      AND c.relkind IN ('r', 'p', 'v');

    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'required control-plane relation public.% is missing; refusing partial ACL hardening', target_name;
    END IF;

    IF target_name = 'taleforge_ai_provider_state' THEN
      IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = target_oid) THEN
        RAISE EXCEPTION 'RLS is not enabled on public.%; review before locking provider state', target_name;
      END IF;

      SELECT count(*) INTO policy_count
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = target_name;

      IF policy_count <> 0 THEN
        RAISE EXCEPTION 'public.% unexpectedly has policies; review intended access before locking provider state', target_name;
      END IF;
    END IF;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      target_name
    );

    -- Column grants can survive a relation-level revoke, so remove those too.
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO column_list
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = target_oid
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_list,
        target_name
      );
    END IF;
  END LOOP;

  -- These base relations currently have explicit public SELECT policies. Preserve
  -- those read policies while revoking writes and non-RLS table-level privileges.
  FOREACH target_name IN ARRAY ARRAY[
    'taleforge_system_registry',
    'taleforge_system_health'
  ]
  LOOP
    SELECT c.oid
      INTO target_oid
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = target_name
      AND c.relkind IN ('r', 'p');

    IF target_oid IS NULL THEN
      RAISE EXCEPTION 'required public health relation public.% is missing; refusing partial ACL hardening', target_name;
    END IF;

    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = target_oid) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%; refusing to preserve public SELECT without RLS', target_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = target_name
        AND p.cmd = 'SELECT'
        AND p.roles && ARRAY['anon', 'authenticated']::name[]
    ) THEN
      RAISE EXCEPTION 'expected public SELECT policy missing on public.%; review intended read surface', target_name;
    END IF;

    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, MAINTAIN, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      target_name
    );

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO column_list
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = target_oid
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE public.%2$I FROM PUBLIC, anon, authenticated',
        column_list,
        target_name
      );
    END IF;
  END LOOP;
END
$lock$;

COMMIT;
