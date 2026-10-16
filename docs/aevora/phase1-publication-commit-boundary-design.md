# Aevora Phase 1 — publication commit-boundary design

Status: design and review gate only. Automated publication is intentionally blocked in the scheduler until the database commit boundary is implemented and verified.

## Current safety posture

The current release scheduler includes an explicit `publication_authorization_not_implemented` guard for real auto-publish work. Preserve that guard. Do not remove it because TypeScript checks or source-contract tests pass. A successful publisher HTTP response is not by itself proof that the chapter, series state, schedule cursor, and outbox are mutually consistent.

The read-only inventory at `docs/aevora/phase1-publication-schema-provenance.sql` enumerates the relevant relations and catalog evidence. It has not been treated as proof of the live schema.

## Required transaction boundary

The eventual database operation must validate authorization and commit all publication-critical state changes as one transaction. The exact function signature and SQL must be derived from reconciled migration history and authorized live catalog evidence, not guessed from Edge Function payloads.

Within one transaction, the operation must:

1. Verify the caller is an authorized server-side publisher and validate the exact schedule/series/output identifiers; ordinary clients must not be able to invoke the operation.
2. Re-check the current release schedule, series status, expected chapter/blueprint identity, required review qualifications, and any trusted authorization marker against database state at commit time.
3. Serialize competing attempts for the same scheduled chapter using a database-enforced lock/unique constraint or equivalent invariant.
4. Reject already-published or conflicting outputs without reporting a fresh successful publication.
5. Insert or confirm the chapter publication with a deterministic idempotency identity; any duplicate/race result must be explicitly distinguished from a new committed publication.
6. Advance the schedule cursor and update series activation/status only when the intended publication is confirmed in the same transaction. Failed, unauthorized, duplicate-conflict, or incomplete attempts must not advance release state.
7. Write the corresponding `publication_sync_outbox` event in the same transaction if it is part of the supported publication contract. External synchronization happens after commit and must use retry-safe outbox processing.
8. Return a typed, unambiguous result distinguishing committed publication, already-published idempotent replay, rejected authorization/review, stale schedule, and internal failure. The Edge Function must not map a conflict or no-op into `published: true` unless the stored state is independently confirmed to satisfy the contract.

## Required negative and concurrency tests

- Two concurrent publish requests for the same schedule/output yield at most one new publication and cannot double-advance the schedule.
- A failure at each transaction step rolls back chapter, series, schedule, and outbox mutations together.
- A duplicate chapter or unique-constraint race cannot return a false success.
- A non-publishable series, disabled/stale schedule, mismatched blueprint/output, or missing/failed review is rejected at the database boundary.
- An untrusted caller cannot invoke the commit operation; verify effective EXECUTE grants, owner, schema ACLs, and any `SECURITY DEFINER` settings.
- Schedule advancement and series activation are unchanged after rejected or failed publication.
- Outbox delivery failure after commit can be retried without repeating the publication transaction.
- The scheduler only treats the exact committed-result contract as success and retains its fail-closed guard when RPC results are missing, malformed, or ambiguous.

Static source tests are necessary but not sufficient. Run a disposable PostgreSQL transaction/concurrency rehearsal against the actual migration. Validate Supabase Edge Runtime behavior separately.

## Schema reconciliation before implementation

Use the read-only publication inventory through an already-authorized read-only SQL session. Reconcile relation ownership, column types/defaults, constraints, unique indexes, triggers, row-level security, schema/table/column ACLs, default privileges, routine definitions/owners, and outbox invariants with repository migration history. Resolve any drift before drafting the migration. Do not execute the inventory as a migration and do not capture production row payloads or credentials.

## Release gates

Keep automated publication blocked until the database transaction, ACL evidence, rollback rehearsal, concurrency regressions, scheduler/publisher contract tests, Edge Function type-checking, and full Phase 1 CI are green. The release also requires a documented rollback baseline and explicit rollout approval.

This document does not authorize production deployment, migrations, schedule mutation, chapter generation/publication, or a billable Supabase branch.
