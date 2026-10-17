#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${AEVORA_DISPOSABLE_RPC_ACL_REHEARSAL:?Set AEVORA_DISPOSABLE_RPC_ACL_REHEARSAL=I_UNDERSTAND_THIS_IS_DISPOSABLE to opt into fixture setup}"
if [[ "$AEVORA_DISPOSABLE_RPC_ACL_REHEARSAL" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing internal RPC ACL rehearsal: explicit disposable-database confirmation did not match." >&2
  exit 2
fi
if [[ "$DATABASE_URL" =~ supabase\.(co|com) ]] || [[ "$DATABASE_URL" =~ pooler\.supabase\.com ]]; then
  echo "Refusing internal RPC ACL rehearsal against a Supabase URL. Use CI's disposable PostgreSQL service only." >&2
  exit 2
fi
database_url_without_query="${DATABASE_URL%%\?*}"
database_name="${database_url_without_query##*/}"
if [[ "$database_name" != aevora_* ]]; then
  echo "Refusing internal RPC ACL rehearsal: database URL must identify an explicitly named aevora_ disposable database." >&2
  exit 2
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-rpc-acl-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261013110000_restrict_internal_invoker_rpc_execution.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-internal-rpc-acl-assertions.sql

for client_role in anon authenticated; do
  log_file="/tmp/aevora-rpc-acl-direct-call-${client_role}.log"
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET ROLE ${client_role}; SELECT public.apply_attachment_directives('00000000-0000-0000-0000-000000000001'::uuid);" > "$log_file" 2>&1; then
    echo "ASSERTION_FAILED: ${client_role} directly executed internal RPC after revocation." >&2
    exit 1
  fi
  if ! grep -qi "permission denied for function apply_attachment_directives" "$log_file"; then
    cat "$log_file" >&2
    echo "ASSERTION_FAILED: direct RPC call for ${client_role} failed for an unexpected reason." >&2
    exit 1
  fi
  echo "internal RPC direct-client denial assertion passed for ${client_role}"
done
