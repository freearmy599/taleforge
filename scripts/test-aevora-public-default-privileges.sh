#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_DEFAULT_PRIVILEGE_REHEARSAL:?Set AEVORA_DISPOSABLE_DEFAULT_PRIVILEGE_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE to opt into fixture setup}"
if [[ "$AEVORA_DISPOSABLE_DEFAULT_PRIVILEGE_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing default-privilege rehearsal: explicit disposable-database confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing default-privilege rehearsal against a Supabase URL. Use CI's disposable PostgreSQL service only." >&2
  exit 2
fi
database_url_without_query="${DATABASE_URL%%\?*}"
database_name="${database_url_without_query##*/}"
if [[ "$database_name" != aevora_* ]]; then
  echo "Refusing default-privilege rehearsal: database URL must identify an explicitly named aevora_ disposable database." >&2
  exit 2
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-public-default-privilege-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014170000_restrict_public_default_privileges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-public-default-privilege-assertions.sql

# A schema-scoped REVOKE cannot override additive global table/sequence defaults.
# Seed a global grant only in this disposable database and require fail-closed behavior.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT INSERT ON TABLES TO anon"
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014170000_restrict_public_default_privileges.sql; then
  echo "Expected a global default grant to block the schema-scoped repair, but it succeeded." >&2
  exit 1
fi
echo "Global INSERT default correctly blocks the schema-scoped default ACL repair."

# Isolate PostgreSQL 17's MAINTAIN privilege so the fail-closed check cannot
# pass merely because the INSERT default above was detected.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE INSERT ON TABLES FROM anon"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT MAINTAIN ON TABLES TO anon"
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014170000_restrict_public_default_privileges.sql; then
  echo "Expected a global MAINTAIN default to block the schema-scoped repair, but it succeeded." >&2
  exit 1
fi
echo "Global MAINTAIN default correctly blocks the schema-scoped default ACL repair."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE MAINTAIN ON TABLES FROM anon"
