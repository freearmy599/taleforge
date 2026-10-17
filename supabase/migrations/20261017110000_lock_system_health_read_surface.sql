-- Aevora Phase 1: close system-health snapshot and write-ACL gaps.
-- Branch candidate only; not applied to production.
--
-- The raw snapshot includes operational evidence and blocking details, so it is
-- not a browser API. A future public UI should use a deliberately scoped projection.
-- Keep existing explicit SELECT policies on system_registry/system_health for
-- compatibility, but remove client write and table-maintenance privileges.
-- service_role grants are deliberately untouched.
BEGIN;

DO $lock$
DECLARE
  target_name text;
  target_oid oid;
  column_list text;
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

  -- Base relations currently have explicit public SELECT policies. Preserve those
  -- read paths, but eliminate write and maintenance grants that RLS cannot block
  -- in all cases (notably TRUNCATE).
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
