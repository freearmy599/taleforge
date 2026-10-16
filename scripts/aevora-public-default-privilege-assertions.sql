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
         OR has_table_privilege(client_role, format('public.%I', object_name), 'TRUNCATE')
         OR has_sequence_privilege(client_role, format('public.%I_seq', object_name), 'USAGE')
         OR has_sequence_privilege(client_role, format('public.%I_seq', object_name), 'SELECT')
         OR has_function_privilege(client_role, format('public.%I_fn()', object_name), 'EXECUTE') THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: % received a broad privilege on newly created object %', client_role, object_name;
      END IF;
    END LOOP;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'aevora_default_privilege_probe_fn',
        'aevora_supabase_admin_default_privilege_probe_fn'
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ASSERTION_FAILED: PUBLIC can execute a newly created public function';
  END IF;
END
$assert$;
SELECT 'public default privilege lock assertions passed' AS result;
