-- Keep internal telemetry and publication-sync queue tables server-side only.
-- Deliberately create no anon/authenticated policies: these tables are not client APIs.
-- Revoke both relation-level and per-column grants; table-level REVOKE alone does
-- not remove separately granted column privileges.
DO $$
DECLARE
  table_name text;
  column_list text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'publication_sync_outbox',
    'story_attachment_metrics'
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
