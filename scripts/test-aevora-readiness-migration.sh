#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-migration-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014210000_release_automation_readiness_gate.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-migration-assertions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-rollback.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-readiness-rollback-assertions.sql
