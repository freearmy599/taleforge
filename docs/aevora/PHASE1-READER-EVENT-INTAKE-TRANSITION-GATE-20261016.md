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


## Additional source review: quota/idempotency mixed-writer edge case (2026-10-16)

A review of the branch-only `20261015120000_reader_event_intake_rpc.sql` found a rollout edge case that must be resolved before the RPC is accepted:

- The RPC serializes duplicate event UUIDs using an advisory transaction lock, checks for an existing UUID, then reserves quota and inserts the event.
- The table also supports direct browser INSERT in the current compatibility path. A direct INSERT does not acquire the RPC's advisory lock.
- If a direct writer inserts the same UUID after the RPC's initial existence check but before its INSERT, the RPC's `ON CONFLICT ... DO NOTHING` path can return `duplicate` after quota buckets have already been incremented. Returning JSON does not roll back those prior writes.
- The ordinary intended RPC-to-RPC duplicate path is serialized by the advisory lock, but this mixed-writer race is relevant during a staged migration if direct and RPC writers overlap.

Required resolution: either prove the deployment sequence prevents overlapping direct/RPC writers with the same keys, or restructure the RPC so quota increments are committed only for a successfully inserted event (or are transactionally rolled back for a duplicate outcome). Add a PostgreSQL concurrency test that races a direct insert against RPC intake for the same UUID and asserts duplicate handling does not consume quota unexpectedly. Do not enable the frontend flag or remove direct INSERT until this is resolved and rehearsed.

This is a source-level finding in a branch-only migration; it is not evidence that the function or quota tables exist in production.
