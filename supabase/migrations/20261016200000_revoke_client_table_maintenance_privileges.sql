-- Aevora Phase 1: remove database-maintenance privileges from client roles.
-- Branch-only candidate. No client-facing CRUD privileges are changed by this
-- migration; SELECT/INSERT/UPDATE/DELETE are intentionally left untouched.
-- RLS does not block TRUNCATE, and browser/API roles have no need to create
-- triggers or foreign-key constraints.
DO $$
DECLARE
  target record;
  column_list text;
BEGIN
  FOR target IN
    SELECT c.relname
    FROM pg_catalog.pg_class AS c
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
    ORDER BY c.relname
  LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      target.relname
    );

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
      INTO column_list
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = format('public.%I', target.relname)::regclass
      AND a.attnum > 0
      AND NOT a.attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE REFERENCES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        column_list,
        target.relname
      );
    END IF;
  END LOOP;
END
$$;
