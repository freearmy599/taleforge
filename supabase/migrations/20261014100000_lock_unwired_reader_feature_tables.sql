-- Aevora reader-feature tables are not wired to the current browser UI.
-- The current reader stores follows/bookmarks/history locally, and no direct
-- browser or Edge Function table calls were found for these tables in the branch.
-- Keep the tables (and their FKs/triggers) intact, but deny direct client access
-- until each feature has a reviewed, owner-scoped policy contract.
-- This migration is branch-only and must not be applied to production without approval.
DO $$
DECLARE
  table_name text;
  column_list text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'bookmarks',
    'collection_stories',
    'collections',
    'comments',
    'likes',
    'notifications',
    'profiles',
    'ratings',
    'reading_history',
    'recommendations',
    'story_reports'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);

      SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
        INTO column_list
      FROM pg_attribute
      WHERE attrelid = to_regclass(format('public.%I', table_name))
        AND attnum > 0
        AND NOT attisdropped;

      IF column_list IS NOT NULL THEN
        EXECUTE format(
          'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
          column_list,
          table_name
        );
      END IF;
    END IF;
  END LOOP;
END
$$;
