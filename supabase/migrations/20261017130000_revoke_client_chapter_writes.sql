-- Aevora Phase 1: chapter rows are public/readable content, not a browser write API.
-- Preserve client SELECT access and all service_role privileges. Only revoke direct
-- client write grants; publication must go through the guarded server-side path.
-- Branch candidate only; do not apply to production without the rollout gate.
BEGIN;

DO $chapter_acl$
DECLARE
  target_oid oid;
  column_list text;
BEGIN
  SELECT c.oid
    INTO target_oid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'chapters'
    AND c.relkind IN ('r', 'p');

  IF target_oid IS NULL THEN
    RAISE EXCEPTION 'required public.chapters table is missing or not a base/partitioned table; refusing write-ACL hardening';
  END IF;

  EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON TABLE public.chapters FROM PUBLIC, anon, authenticated';

  SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
    INTO column_list
  FROM pg_catalog.pg_attribute a
  WHERE a.attrelid = target_oid
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF column_list IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT (%1$s), UPDATE (%1$s) ON TABLE public.chapters FROM PUBLIC, anon, authenticated',
      column_list
    );
  END IF;
END
$chapter_acl$;

-- Make the intended public reading contract explicit. RLS policies remain intact.
GRANT SELECT ON TABLE public.chapters TO anon, authenticated;

COMMIT;
