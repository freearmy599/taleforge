# Aevora publication commit-boundary fencing — design note

## Status

**Open release blocker; no production changes.** The scheduler has a lease and lease-fenced schedule/lifecycle updates, but the publisher currently inserts a chapter through a separate PostgREST request. A lease renewal immediately before the HTTP call is not commit-time ownership enforcement.

The current publisher intentionally returns HTTP 423 with `PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED` for automatic-publication schedules. Keep this fail-closed guard in place until a separately reviewed database commit boundary exists. Do not infer that passing a lease token in an HTTP body alone solves the race.

## Observed boundary

The scheduler currently:
1. Claims a schedule lease.
2. Renews and checks that lease immediately before invoking the publisher.
3. Calls `release-publisher` with the generation output ID.
4. Confirms the returned chapter against the database.
5. Advances the schedule and activates lifecycle only through lease-fenced RPCs.

The publisher's chapter insert is a separate database request. Therefore steps 2 and 3 leave a time-of-check/time-of-use gap. The publisher's current automatic-publication authorization guard prevents this path from being used for automated release today, but that guard must not be removed as a shortcut.

## Required design before enabling automated publication

Implement and rehearse one narrowly scoped, server-only database RPC that owns the final publication transaction. It must:

1. Accept the output ID and the schedule/lease identity required for the automated path; never trust a lease token without checking it in the database.
2. Lock the matching lease row with `SELECT ... FOR UPDATE`, then verify schedule ID, exact lease token, and unexpired lease after obtaining the lock. A competing lease claim must serialize on the same row; it cannot take ownership while this transaction is holding the row lock.
3. Within that same transaction, revalidate the current schedule/series relationship, series eligibility, output status, matching blueprint, publication review decision, and all required review gates. Any missing, ambiguous, stale, or errored precondition must abort without inserting a chapter.
4. Insert the published chapter and enforce the unique series/chapter slot. Handle an existing chapter only if its identity and published status are confirmed; do not turn an unrelated slot occupant into success.
5. Record the publication result and any required durable outbox event in a transactionally safe way. Do not rely on a later HTTP response to establish that the chapter was atomically authorized.
6. Return a minimal, stable result that distinguishes inserted, already-published, conflict, and authorization/lease rejection outcomes. The scheduler must independently confirm the persisted chapter before advancing its schedule.
7. Pin `search_path`, schema-qualify objects, revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant execution only to the required trusted server roles. Add owner/default-privilege review to the rollout checklist.
8. Keep manual publication behavior separate and explicit; a manual path must not be accidentally forced to present an automation lease, nor should it inherit automated authorization.

The transaction should lock the lease row before the publication commit path and hold that lock through the chapter insert. This serializes a new claim against the in-flight commit: a new scheduler cannot take ownership and publish concurrently while the prior transaction is committing. The RPC must check expiry after acquiring the lock so a caller that waited for the lock cannot use an already-expired lease.

## Required tests

- Expired lease rejects before any chapter insert.
- Wrong token or wrong schedule ID rejects before any chapter insert.
- Two concurrent callers using different lease tokens cannot both commit publication for the same schedule ownership window.
- A competing claim blocks behind the publication transaction and can take ownership only after that transaction finishes.
- Review/output/blueprint/series precondition changes reject atomically.
- Duplicate chapter-slot races return success only for the exact matching, confirmed published chapter.
- RPC privilege and pinned-search-path contracts pass in the disposable PostgreSQL rehearsal.
- Publisher response loss after commit is safely idempotent; retry never creates a duplicate or reports an unrelated chapter as success.
- Scheduler advances the schedule only after database-confirmed publication and its own still-valid lease-fenced advancement RPC succeeds.

## Go/no-go

Until the RPC, privilege tests, concurrency tests, and scheduler integration are implemented and green, automated publication remains **NO-GO**. Do not deploy, apply a production migration, mutate schedules, generate chapters, or publish chapters as part of this design work. No billable Supabase branch is needed or authorized.
