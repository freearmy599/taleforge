\set ON_ERROR_STOP on
CREATE TABLE public.aevora_default_privilege_probe (id integer);
CREATE SEQUENCE public.aevora_default_privilege_probe_seq;
CREATE FUNCTION public.aevora_default_privilege_probe_fn() RETURNS integer
LANGUAGE sql AS $function$ SELECT 1 $function$;

SET ROLE supabase_admin;
CREATE TABLE public.aevora_supabase_admin_default_privilege_probe (id integer);
CREATE SEQUENCE public.aevora_supabase_admin_default_privilege_probe_seq;
CREATE FUNCTION public.aevora_supabase_admin_default_privilege_probe_fn() RETURNS integer
LANGUAGE sql AS $function$ SELECT 1 $function$;
RESET ROLE;

DO $assert$
DECLARE
  client_role text;
  object_name text;
  sequence_name text;
  function_name text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    FOREACH object_name IN ARRAY ARRAY[
      'aevora_default_privilege_probe',
      'aevora_supabase_admin_default_privilege_probe'
    ]
    LOOP
      IF has_table_privilege(client_role, format('public.%I', object_name), 'SELECT')
         OR has_table_privilege(client_role, format('public.%I', object_name), 'INSERT')
         OR has_table_privilege(client_role, format('public.%I', object_name), 'UPDATE')
         OR has_table_privilege(client_role, format('public.%I', object_name), 'DELETE')
         OR has_table_privilege(client_role, format('public.%I', object_name), 'MAINTAIN')
         OR has_table_privilege(client_role, format('public.%I', object_name), 'TRUNCATE')
         OR has_table_privilege(client_role, format('public.%I', object_name), 'REFERENCES')
         OR has_table_privilege(client_role, format('public.%I', object_name), 'TRIGGER') THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % received a broad table privilege on newly created object %', client_role, object_name;
      END IF;

      sequence_name := object_name || '_seq';
      IF has_sequence_privilege(client_role, format('public.%I', sequence_name), 'USAGE')
         OR has_sequence_privilege(client_role, format('public.%I', sequence_name), 'SELECT')
         OR has_sequence_privilege(client_role, format('public.%I', sequence_name), 'UPDATE') THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % received a broad sequence privilege on newly created object %', client_role, sequence_name;
      END IF;

      function_name := object_name || '_fn';
      IF NOT has_function_privilege(client_role, format('public.%I()', function_name), 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: function default scope changed unexpectedly for %', function_name;
      END IF;
    END LOOP;
  END LOOP;
END
$assert$;
SELECT 'public table and sequence defaults revoked; function EXECUTE defaults remain explicitly out of scope' AS result;
