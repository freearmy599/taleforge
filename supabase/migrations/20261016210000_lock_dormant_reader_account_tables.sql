-- Aevora Phase 1: lock dormant reader account/community tables until
-- auth-backed user workflows and their ownership/moderation policies are built.
-- These relations are RLS-enabled with no policies and are not called by the
-- current reader browser routes. Fail closed if schema assumptions drift.
DO $$
DECLARE
  v_table_name text;
  v_target oid;
  v_rls_enabled boolean;
  v_column_list text;
BEGIN
  FOREACH v_table_name IN ARRAY ARRAY[
    'profiles',
    'bookmarks',
    'collections',
    'collection_stories',
    'comments',
    'likes',
    'notifications',
    'ratings',
    'reading_history',
    'story_reports',
    'recommendations'
  ]
  LOOP
    SELECT c.oid, c.relrowsecurity
      INTO v_target, v_rls_enabled
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = v_table_name
      AND c.relkind IN ('r', 'p');

    IF v_target IS NULL THEN
      RAISE EXCEPTION 'required dormant account/community table public.% is missing; refusing ACL repair', v_table_name;
    END IF;

    IF NOT v_rls_enabled THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%; refusing dormant-table ACL repair', v_table_name;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = v_table_name
    ) THEN
      RAISE EXCEPTION 'public.% unexpectedly has an RLS policy; review intended client workflow before locking it', v_table_name;
    END IF;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      v_table_name
    );

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO v_column_list
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = v_target
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF v_column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_column_list,
        v_table_name
      );
    END IF;
  END LOOP;
END
$$;
