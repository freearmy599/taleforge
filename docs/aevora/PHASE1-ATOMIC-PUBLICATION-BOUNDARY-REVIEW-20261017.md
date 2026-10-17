# Aevora Phase 1 — Atomic publication boundary review (2026-10-17)

## Status

**Open / release-blocking.** This is a source review and design boundary record, not an implementation or authorization to deploy. Automatic publishing remains NO-GO.

## Evidence reviewed

- Branch: `aevora/release-scheduler-hardening`.
- Publisher source: `supabase/functions/release-publisher/index.ts` (branch source reviewed on 2026-10-17).
- Scheduler source: `supabase/functions/release-scheduler/index.ts`.
- Candidate quality-review transaction pattern: `supabase/migrations/20261017150000_aevora_atomic_quality_review_commit.sql`.
- Latest confirmed source validation before this review: [CI run 39050743940](https://github.com/freearmy599/taleforge/actions/runs/39050743940), both jobs passed. The run validates branch tests and a disposable PostgreSQL environment, not production.

## Findings

1. **Authorization is intentionally fail-closed.** The publisher rejects automatic publication until trusted approval exists and is checked at the database commit boundary. Manual or absent schedule state is not treated as approval. The scheduler has an automatic-publication preflight that exits before claiming a lease or making publisher/lifecycle/schedule-advance calls when the authorization implementation is absent.
2. **The publisher still uses multiple independent database requests for publication.** The chapter insert is followed by separate synchronization of the generation output, blueprint, series publication timestamp, and canon-sync outbox. A later synchronization error can therefore leave a chapter row committed while some related records remain stale. The publisher reports incomplete synchronization as failure, but reporting failure does not roll back an already committed chapter insert.
3. **Idempotency/race checks are safer but do not make the multi-table operation atomic.** Existing and duplicate-race chapter paths require a matching published chapter/output, and the scheduler separately verifies the returned chapter ID, series, chapter number, and published status. These are important guards, but they do not replace one database transaction for the full publication boundary.
4. **Schedule advancement is separately lease-fenced.** The scheduler requires every selected publication to be confirmed and blocks advancement after publication/lease failures. This protects the cursor from partial batches but cannot undo a partial write inside the publisher.
5. **A suitable pattern exists elsewhere in the branch, but publication is a different contract.** The candidate `aevora_commit_quality_review` RPC demonstrates transactional update-plus-review persistence and service-role-only execution. It does not implement publication, trusted human approval, or the outbox contract.

## Required design before implementation

The publication boundary needs one reviewed database transaction (for example, a narrowly scoped RPC) that:

- accepts a stable generation-output ID and an approval reference bound to the exact output/version/content;
- validates that the approval is trusted, current, not revoked, and permitted for this series/chapter slot;
- locks or otherwise serializes the output, blueprint, series/lifecycle, and chapter slot in a documented lock order;
- rechecks output status, all review gates, blueprint identity, series eligibility, and slot uniqueness inside the transaction;
- inserts or idempotently confirms the published chapter, updates the generation output and blueprint, updates the series publication timestamp when appropriate, and enqueues the canon-sync outbox event atomically;
- returns a typed, minimal result that distinguishes committed publication, an already-published exact match, a conflicting chapter, stale approval, and transient failure;
- is executable only by the trusted server role, uses a pinned search path, and has disposable-PostgreSQL tests for duplicate races, stale approval, rollback on every failed write, and concurrent publication attempts.

## Decisions intentionally not guessed

- Who qualifies as a trusted human approver and how identity is authenticated.
- Whether approval expires, can be revoked, or must be re-issued after any content revision.
- Whether an existing exact-match published chapter should be returned as success when the original approval record is unavailable.
- The final RPC signature and lock order, which must follow the real schema constraints and be tested against the complete publication flow.

These are authorization and data-integrity decisions. They must be resolved before a production-capable implementation can be approved; this review does not silently choose defaults.

## Safety boundary

No production SQL, migrations, ACLs, Edge Function deployments, schedules, chapter rows, generation outputs, or publication state were changed. No generation/publication was triggered and no billable Supabase resource was created.
