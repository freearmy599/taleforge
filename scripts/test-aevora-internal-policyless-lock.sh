#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_INTERNAL_LOCK_REHEARSAL:?Set AEVORA_DISPOSABLE_INTERNAL_LOCK_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE to opt into fixture setup}"
if [[ "$AEVORA_DISPOSABLE_INTERNAL_LOCK_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing internal-table lock rehearsal: explicit disposable-database confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing internal-table lock rehearsal against a Supabase URL. Use CI's disposable PostgreSQL service only." >&2
  exit 2
fi
database_url_without_query="${DATABASE_URL%%\?*}"
database_name="${database_url_without_query##*/}"
if [[ "$database_name" != aevora_* ]]; then
  echo "Refusing internal-table lock rehearsal: database URL must identify an explicitly named aevora_ disposable database." >&2
  exit 2
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-policyless-lock-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261013130000_lock_internal_policyless_tables.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016200000_revoke_client_table_maintenance_privileges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016203000_revoke_client_maintenance_default_privileges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE public.future_postgres_table (id bigint PRIMARY KEY)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET ROLE supabase_admin; CREATE TABLE public.future_supabase_admin_table (id bigint PRIMARY KEY); RESET ROLE;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-policyless-lock-assertions.sql

# Rehearse the separate public-schema default ACL repair after the maintenance-only
# assertions, so this test can distinguish future CRUD defaults from maintenance defaults.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014170000_restrict_public_default_privileges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE public.future_default_postgres_table (id bigint PRIMARY KEY); CREATE SEQUENCE public.future_default_postgres_sequence"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET ROLE supabase_admin; CREATE TABLE public.future_default_supabase_admin_table (id bigint PRIMARY KEY); CREATE SEQUENCE public.future_default_supabase_admin_sequence; RESET ROLE;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $
DECLARE
  table_name text;
  sequence_name text;
  role_name text;
  privilege_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['future_default_postgres_table','future_default_supabase_admin_table']
  LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated']
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
      LOOP
        IF has_table_privilege(role_name, format('public.%I', table_name), privilege_name) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: future default table % grants % to %', table_name, privilege_name, role_name;
        END IF;
      END LOOP;
    END LOOP;

    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
    LOOP
      IF NOT has_table_privilege('service_role', format('public.%I', table_name), privilege_name) THEN
        RAISE EXCEPTION 'ASSERTION_FAILED: service_role lost % on future default table %', privilege_name, table_name;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH sequence_name IN ARRAY ARRAY['future_default_postgres_sequence','future_default_supabase_admin_sequence']
  LOOP
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated']
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY['USAGE','SELECT','UPDATE']
      LOOP
        IF has_sequence_privilege(role_name, format('public.%I', sequence_name), privilege_name) THEN
          RAISE EXCEPTION 'ASSERTION_FAILED: future default sequence % grants % to %', sequence_name, privilege_name, role_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$;
SELECT 'public future table and sequence default ACL assertions passed' AS result;
SQL

# A global default cannot be safely counteracted by a public-schema-only REVOKE.
# Seed one in this disposable database and require the migration to fail closed.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT TRUNCATE ON TABLES TO anon"
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016203000_revoke_client_maintenance_default_privileges.sql; then
  echo "Expected global maintenance default to block the schema-scoped migration, but it succeeded." >&2
  exit 1
fi
echo "Global maintenance default correctly blocks the schema-scoped default ACL repair."
