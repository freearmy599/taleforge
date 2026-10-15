#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
if [[ "${AEVORA_DISPOSABLE_TRENDING_REHEARSAL:-}" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Refusing to run trending integration rehearsal without disposable-database confirmation." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$repo_root/scripts/aevora-trending-state-fixture.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$repo_root/supabase/migrations/20261014130000_public_trending_aggregate_rpc.sql"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$repo_root/scripts/aevora-trending-state-assertions.sql"
