#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable database}"
: "${AEVORA_DISPOSABLE_SEARCH_PATH_REHEARSAL:?Explicit disposable-rehearsal acknowledgement is required}"
[[ "$AEVORA_DISPOSABLE_SEARCH_PATH_REHEARSAL" == "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]] || {
  echo "Refusing to run without explicit disposable acknowledgement." >&2
  exit 2
}
[[ "$DATABASE_URL" == */aevora_search_path_shadowing_test ]] || {
  echo "Refusing to run: DATABASE_URL must end with /aevora_search_path_shadowing_test." >&2
  exit 2
}

# Generic PostgreSQL behavior rehearsal only. It does not connect to Supabase
# and does not load or execute any live Aevora function definition.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE service_role NOLOGIN;
CREATE TABLE public.series (marker text NOT NULL);
INSERT INTO public.series(marker) VALUES ('public-row');

CREATE FUNCTION public.aevora_test_unqualified_lookup()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT marker FROM series LIMIT 1
$function$;
ALTER FUNCTION public.aevora_test_unqualified_lookup() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.aevora_test_unqualified_lookup() TO service_role;

SET ROLE service_role;
CREATE TEMP TABLE series (marker text NOT NULL);
INSERT INTO pg_temp.series(marker) VALUES ('temporary-shadow');
DO $assert$
BEGIN
  IF public.aevora_test_unqualified_lookup() <> 'temporary-shadow' THEN
    RAISE EXCEPTION 'Expected unqualified SECURITY DEFINER lookup to resolve temp relation first';
  END IF;
END
$assert$;
RESET ROLE;

CREATE FUNCTION public.aevora_test_qualified_lookup()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $function$
  SELECT marker FROM public.series LIMIT 1
$function$;
ALTER FUNCTION public.aevora_test_qualified_lookup() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.aevora_test_qualified_lookup() TO service_role;

SET ROLE service_role;
DO $assert$
BEGIN
  IF public.aevora_test_qualified_lookup() <> 'public-row' THEN
    RAISE EXCEPTION 'Expected schema-qualified lookup to resolve public relation';
  END IF;
END
$assert$;
RESET ROLE;

SELECT 'PASS: unqualified relation resolved temporary shadow; qualified relation resolved public table' AS rehearsal_result;
SQL
