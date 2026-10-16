-- These base tables contain internal story plans, ending details and production
-- lifecycle state. Current public SELECT policies can expose spoilers and
-- operational strategy; browser source audit found no direct table callers.
-- Trusted Edge Functions use service_role, whose grants are intentionally kept.
BEGIN;

DO $lock$
DECLARE
  table_name text;
  target regclass;
  column_list text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'story_arc_plan',
    'story_ending_plans',
    'story_lifecycle'
  ]
  LOOP
    target := to_regclass(format('public.%I', table_name));
    IF target IS NULL THEN
      RAISE EXCEPTION 'required internal story-planning relation public.% is missing; refusing partial ACL hardening', table_name;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);

    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
      INTO column_list
    FROM pg_catalog.pg_attribute
    WHERE attrelid = target AND attnum > 0 AND NOT attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_list,
        table_name
      );
    END IF;

    FOR policy_name IN
      SELECT p.policyname
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = table_name
        AND p.roles && ARRAY['anon', 'authenticated', 'public']::name[]
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, table_name);
    END LOOP;
  END LOOP;
END
$lock$;

COMMIT;
