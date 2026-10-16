\set ON_ERROR_STOP on
CREATE TABLE public.aevora_default_privilege_probe (id integer);
CREATE SEQUENCE public.aevora_default_privilege_probe_seq;
CREATE FUNCTION public.aevora_default_privilege_probe_fn() RETURNS integer
LANGUAGE sql AS $function$ SELECT 1 $function$;

DO $assert$
DECLARE
  client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF has_table_privilege(client_role, 'public.aevora_default_privilege_probe', 'SELECT')
       OR has_table_privilege(client_role, 'public.aevora_default_privilege_probe', 'INSERT')
       OR has_table_privilege(client_role, 'public.aevora_default_privilege_probe', 'UPDATE')
       OR has_table_privilege(client_role, 'public.aevora_default_privilege_probe', 'DELETE')
       OR has_table_privilege(client_role, 'public.aevora_default_privilege_probe', 'TRUNCATE')
       OR has_sequence_privilege(client_role, 'public.aevora_default_privilege_probe_seq', 'USAGE')
       OR has_sequence_privilege(client_role, 'public.aevora_default_privilege_probe_seq', 'SELECT')
       OR has_function_privilege(client_role, 'public.aevora_default_privilege_probe_fn()', 'EXECUTE') THEN
      RAISE EXCEPTION 'ASSERTION_FAILED: % received a broad privilege on a newly created public object', client_role;
    END IF;
  END LOOP;
  IF has_function_privilege('public', 'public.aevora_default_privilege_probe_fn()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC can execute a newly created public function';
  END IF;
END
$assert$;
SELECT 'public default privilege lock assertions passed' AS result;
