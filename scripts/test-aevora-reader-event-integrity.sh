#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-reader-event-integrity-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014120000_lock_public_identity_sequence_grants.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014150000_reader_events_insert_only.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014200000_reader_event_relationship_integrity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261014220000_reader_event_idempotency_key.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/aevora-reader-event-integrity-assertions.sql
