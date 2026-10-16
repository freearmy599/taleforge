# Aevora Phase 1 — Reader Event Intake Gate (2026-10-16)

Status: blocked. This is a read-only audit note, not a deployment instruction.

## Confirmed observations

- The live Supabase Edge Function inventory for project `sxmbnlgufqhcwxcpcsvb` did not list a function named `reader-event-intake`.
- A read-only catalog lookup found no `public.aevora_ingest_reader_event` or `public.aevora_prune_reader_event_quota_buckets` routines and no quota bucket tables in schema `aevora_private`.
- The live `public.reader_events` table has seven columns (`id`, `visitor_id`, `event_type`, `series_id`, `chapter_id`, `progress_percent`, `created_at`) and does **not** have the branch-added `event_uuid` column. A selected migration-ledger lookup returned no rows for the branch's reader-event migrations. Verify authoritative migration history before making claims about how or when they were deployed.
- Branch `supabase-client.js` sets `window.taleForgeReaderEventIntakeEnabled = false`.
- Branch `reading-progress.js` therefore uses direct `reader_events` INSERT. If the flag is enabled, it instead calls `/functions/v1/reader-event-intake`.
- Branch source contains an intake handler, an RPC migration, and a migration intending to make client access to `reader_events` INSERT-only. Their existence in source does not prove live deployment.

## Decision

Do not enable the replacement intake flag or remove direct INSERT yet. The endpoint and database RPC are not verified in the live project; switching either side prematurely could break event capture. The broad live grants remain a security gap, not an acceptable final state.

## Required staged acceptance

1. Confirm deployed frontend source and authoritative live migration records.
2. Review the quota RPC, idempotency, concurrent requests, cleanup, failure paths and anonymous visitor-hint limitations.
3. Rehearse the schema, strict routine ACLs, and INSERT-only client access in a disposable database.
4. Deploy the endpoint only after validation; confirm it appears in the live inventory and test accepted, duplicate, limited, invalid and unavailable responses.
5. Test the frontend with the flag enabled in a controlled environment and verify event capture, rate limits, idempotency and graceful failure.
6. Switch the flag only after the endpoint is verified. Keep a documented rollback.
7. Remove direct client INSERT only after the replacement works end-to-end; then verify effective grants and RLS again.
8. Keep trending/intelligence access gated until the aggregate read path and abuse controls are explicitly approved.

No production functions, tables, policies, grants, migrations, feature flags, schedules, generation or publication state were changed.
