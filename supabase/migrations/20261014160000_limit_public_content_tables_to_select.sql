-- Public reader APIs only need SELECT on the content tables. Their existing RLS
-- policies continue to limit rows to published chapters/stories and ongoing or
-- completed series. Keep trusted service_role grants unchanged.
-- Branch-only least-privilege proposal; do not apply to production without approval.
DO $$
DECLARE
  table_name text;
  column_list text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'series',
    'chapters',
    'stories'
  ]
  LOOP
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
  END LOOP;
END
$$;

GRANT SELECT ON TABLE public.series, public.chapters, public.stories TO anon, authenticated;
