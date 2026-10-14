-- Reader events are a write-only telemetry intake for ordinary clients.
-- Keep the existing INSERT RLS policy as the row-level validation gate, but
-- remove unrelated relation privileges that RLS does not constrain (including
-- TRUNCATE, TRIGGER, and REFERENCES). Trusted service_role grants are preserved.
REVOKE ALL PRIVILEGES ON TABLE public.reader_events FROM PUBLIC, anon, authenticated;

-- Clean up any explicit column ACLs independently of relation-level privileges.
DO $$
DECLARE
  column_list text;
BEGIN
  SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
    INTO column_list
  FROM pg_attribute
  WHERE attrelid = 'public.reader_events'::regclass
    AND attnum > 0
    AND NOT attisdropped;

  IF column_list IS NOT NULL THEN
    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.reader_events FROM PUBLIC, anon, authenticated',
      column_list
    );
  END IF;
END
$$;

-- The published discovery RPC aggregates reader_events under its fixed,
-- allowlisted SECURITY DEFINER function; clients do not need direct SELECT.
GRANT INSERT ON TABLE public.reader_events TO anon, authenticated;
