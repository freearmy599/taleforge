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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-reference-taxonomy-read-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-rpc-acl-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261013110000_restrict_internal_invoker_rpc_execution.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-rpc-acl-assertions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261013130000_lock_internal_policyless_tables.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016200000_revoke_client_table_maintenance_privileges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016203000_revoke_client_maintenance_default_privileges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016210000_lock_dormant_reader_account_tables.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016220000_lock_base_story_planning_read_surfaces.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE public.future_postgres_table (id bigint PRIMARY KEY)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET ROLE supabase_admin; CREATE TABLE public.future_supabase_admin_table (id bigint PRIMARY KEY); RESET ROLE;"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-policyless-lock-assertions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261017100000_lock_internal_reference_taxonomy_reads.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-reference-taxonomy-read-assertions.sql

# A global default cannot be safely counteracted by a public-schema-only REVOKE.
# Seed one in this disposable database and require the migration to fail closed.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT MAINTAIN ON TABLES TO anon"
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261016203000_revoke_client_maintenance_default_privileges.sql; then
  echo "Expected global maintenance default to block the schema-scoped migration, but it succeeded." >&2
  exit 1
fi
echo "Global maintenance default correctly blocks the schema-scoped default ACL repair."
