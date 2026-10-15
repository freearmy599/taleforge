# Phase 1 reader-event intake implementation plan — 2026-10-15

## Status

Branch-only implementation prepared and source/disposable-database verification green in the prior baseline [CI run 38743257548](https://github.com/freearmy599/taleforge/actions/runs/38743257548). The browser tracker has an opt-in endpoint switch wired but disabled by default; browser cutover and production rollout remain pending. Added a public Edge Function, a SECURITY DEFINER RPC with server-only execute grants, isolated quota storage, source-contract tests, and disposable PostgreSQL assertions. Direct browser INSERT remains available for compatibility until a separately authorized cutover. No production setting or deployment was changed. Public trending remains gated.

## Design decision

Use a dedicated Supabase Edge Function as the only future public intake boundary, with an atomic database RPC for quota consumption and insertion. Do not implement quota checking as a read-then-write sequence in JavaScript: concurrent requests could race past a limit. Do not trust `visitor_id`, event UUIDs, client timestamps, or client-provided IP headers as authenticated identity.

## Endpoint contract

Accept POST JSON only. Enforce a small request-body limit before parsing; reject malformed JSON, arrays, unknown keys, unsupported event types, invalid UUIDs, malformed series/chapter IDs, and progress outside integer 0–100. Ignore client timestamps and assign server time. Keep the existing event vocabulary: `story_open`, `chapter_start`, `reading_progress`, `chapter_complete`, `follow`, `unfollow`, `bookmark`, `unbookmark`.

Require an eligible series for every event. If a chapter is supplied, require it to belong to that series and be published. Treat the browser visitor identifier as a best-effort deduplication hint only; never describe anonymous events as verified unique readers.

Return a minimal success response and stable machine-readable errors. Do not echo payloads, credentials, database diagnostics, IPs, or provider/database error text. Handle duplicate event UUIDs idempotently. Never log raw event bodies or secrets.

## Atomic quota / insert boundary

The endpoint calls one narrowly scoped SECURITY DEFINER RPC that performs, atomically:
1. Validate the event and series/chapter relationship against current database state.
2. Enforce global short-window and daily limits keyed by a hash of the browser-provided visitor hint, plus per-event daily contribution caps. These are abuse barriers, not source authentication; visitor IDs can be rotated.
3. Apply idempotency for a supplied event UUID.
4. Insert the event with server-assigned timestamp.
5. Return only accepted/duplicate/limited/invalid outcomes, without raw row data.

The quota store and RPC must be inaccessible to anon/authenticated roles. Fix the RPC search_path, schema-qualify referenced objects, revoke default PUBLIC execute, and grant execute only to the function's server role. Limit retained network-derived signals; trust only gateway-controlled metadata, hash/minimize identifiers, document retention, and never accept arbitrary forwarded-IP headers from the request body.

Do not add a client-supplied identity claim or assume rotating visitor IDs are preventable without an account/session decision.

## Compatibility and rollout sequence

1. [Prepared] Add isolated migration and SQL assertions for server-only quota objects, RPC privileges, idempotency, invalid relationships, global per-minute/daily limits, and a per-event daily cap. Concurrency-specific quota stress testing passed in [CI run 38743257548](https://github.com/freearmy599/taleforge/actions/runs/38743257548); the expanded per-event cap rehearsal is pending the current CI run. End-to-end invocation of the deployed Edge endpoint remains outstanding.
2. [Verified in CI run 38740534812] Implemented the Edge Function and source-contract tests for methods, body size, allowlist, progress validation, safe errors, no credential leakage, and no raw-payload logging. The request handler is isolated for Deno tests, which cover validation, RPC mapping, stable outcomes, and redacted failures.
3. [Verified in CI run 38738919711] Type-check the function and execute disposable PostgreSQL rehearsals. Parallel fresh-UUID requests at the per-minute boundary produced exactly 30 accepted and one limited; repeated UUID concurrency remained idempotent. A fixture collision was corrected by separating UUID namespaces.
4. [Prepared and contract-tested] The existing `window.taleForgeProgress.track(event_type, data)` interface is preserved. A branch-only opt-in flag now routes events through the Edge endpoint without direct-INSERT fallback when enabled; it remains disabled by default until endpoint deployment/verification.
5. Test rollout and rollback together. Do not revoke direct inserts until the endpoint is deployed and verified in the intended environment, browser traffic has been migrated, and a tested rollback path exists. The final production cutover requires separate explicit authorization.
6. Only after direct-insert bypass is closed and abuse controls are verified may the public trending gate be reconsidered.

## Required abuse tests

- Missing/malformed/oversized request; wrong method; unknown keys and event types.
- Invalid series, chapter from another series, unpublished chapter, and ineligible series.
- Client-supplied past/future timestamp cannot affect stored time.
- Same UUID sequentially and concurrently yields one logical event.
- Parallel fresh UUIDs at quota boundary cannot exceed the configured quota.
- Repeated opens, chapter starts, completion, and progress cannot inflate contribution beyond event-specific limits.
- Follow/unfollow and bookmark/unbookmark resolve to latest state, with out-of-order behavior explicitly defined.
- RPC and quota table cannot be read or called by ordinary API roles.
- Logs and error responses contain no raw payload, credentials, or database internals.
- Existing browser tracker compatibility and rollback behavior.

## Go/no-go

NO-GO for production. No production migration, deployment, schedule mutation, chapter generation, publication, or billable Supabase branch is authorized by this plan. The next verification pass must establish successful CI and disposable-database behavior, including concurrent quota requests and per-event daily cap boundaries. The public browser cutover and production approval remain separate gates.


## Verification update — 2026-10-15

CI run [38738919711](https://github.com/freearmy599/taleforge/actions/runs/38738919711) passed both prepared Edge Function/source-contract validation and the disposable PostgreSQL rehearsal after the cleanup-cooldown assertion was moved to the migration-owner context. The quota cleanup gate now checks a cheap singleton state row, claims a non-blocking advisory lock only when cleanup is due, and deletes at most 1000 expired rows per attempt, no more than once per minute. This bounds cleanup work without serializing every event through a global cleanup lock.

Still pending: a real deployed Edge Function invocation test, browser tracker cutover, direct-INSERT revocation staged with rollback, production owner-level ACL repair, explicit publication authorization principal/source, and fresh authorized disposition of the six legacy schedules. No production action was taken.


## Browser switch and full CI verification — 2026-10-15

[CI run 38739996092](https://github.com/freearmy599/taleforge/actions/runs/38739996092) passed both Edge Function/source-contract validation and the disposable PostgreSQL rehearsals on commit `555b09b1f1ec2998daf2436f27fd62d3a3822aae`. The staged browser switch preserves the tracker API and, when explicitly enabled, posts to `/functions/v1/reader-event-intake`; endpoint failure does not fall back to direct table INSERT, preventing a silent quota bypass in enabled mode. The flag remains `false` by default, and direct client INSERT grants remain in place for compatibility. The public endpoint is configured to skip JWT verification only for this function; its handler validates the request and uses server-only RPC credentials.

This is a prepared branch integration, not a deployed/verified endpoint. Before cutover, run a deployed endpoint smoke test, enable the browser switch in a controlled rollout, confirm intake metrics and rollback, then revoke direct INSERT privileges in a separately rehearsed migration. Production rollout remains NO-GO; no production migration, deployment, or data change occurred.


## Request-handler behavior tests — 2026-10-15

The request handler was separated from the Deno entrypoint so behavior can be tested without network access or secrets. The Deno suite now covers method/CORS handling, content-type enforcement, malformed and oversized bodies, unknown keys, event vocabulary and progress validation, pre-RPC rejection, RPC argument mapping, accepted/duplicate/rate-limited/invalid/unavailable responses, and secret/error redaction. The workflow runs these tests before the broader source-contract suite.

[CI run 38740534812](https://github.com/freearmy599/taleforge/actions/runs/38740534812) passed both jobs on commit `6522bc6192421771054342eaf1ec93390b4de8b4`, including the new Deno behavior tests, all prepared Edge Function type checks, static security contracts, and disposable PostgreSQL rehearsals. Additional explicit type annotations in the generation, review, world-continuity, and publication-review functions resolved strict-check failures exposed during this pass without changing their runtime logic.

Remaining gates are unchanged: deployed endpoint smoke test, controlled browser switch activation, telemetry/rollback verification, separately authorized direct-INSERT revocation, publication approval principal/source, owner-level production ACL repair, and per-schedule legacy dispositions. No production change was made.


## Quota/idempotency boundary tests — 2026-10-15

- The RPC now serializes non-null event UUIDs with a transaction-scoped advisory lock before checking for an existing event. This closes the concurrent duplicate race where two different visitor hints could both pass the initial duplicate check and consume separate quota buckets before the unique index rejected one insert.
- Disposable PostgreSQL coverage races the same UUID across distinct visitor hints and expects one `accepted` plus one `duplicate`; 31 independent fresh-UUID requests for one visitor hint must produce exactly 30 `accepted` and one `limited`; a separate daily-boundary loop resets only the minute bucket and expects exactly 1000 `accepted` and one `limited` in the same day window.
- The private quota bucket and cleanup-state tables are checked for no ordinary-role schema/table access. Cleanup is claimed at most once per minute through a non-blocking advisory lock, with at most 1000 expired rows deleted per cleanup attempt.
- These source and disposable-database tests are green in [CI run 38742040284](https://github.com/freearmy599/taleforge/actions/runs/38742040284). This verifies branch logic only; the browser switch remains disabled and no production migration or deployment has occurred.


## Event-specific quota hardening — 2026-10-15

The branch-only RPC now maintains separate daily quota buckets per event type, with a cap of 250 events per type per visitor hint per day in addition to the 30/minute and 1000/day global limits. The disposable SQL assertions check that the global daily boundary allows 1000 events spread across four event classes, while one event class is capped at 250. All quota buckets are checked before any counter is incremented, so rejected event classes and duplicate UUIDs cannot consume another event's quota budget. These are visitor-hint limits and do not prove unique people or prevent an attacker from rotating IDs. CI run [38744825970](https://github.com/freearmy599/taleforge/actions/runs/38744825970) passed on branch head `b896bb5392d92a5d21185b25444592a0099f6130`, including the quota boundary and rollout-preflight contracts. Production remains NO-GO.


## Rollout preflight visibility — 2026-10-15

The read-only production rollout preflight now reports whether anon/authenticated can still INSERT directly into `reader_events`, whether RLS is enabled, and whether the server-timestamp trigger and event-UUID unique index are present. It still avoids returning cron command text and wraps reads in a read-only transaction. This is intended to make the legacy bypass visible before any separately authorized cutover; it does not execute against production as part of CI and does not change grants. CI verification is pending for this latest addition.


## Latest branch verification — 2026-10-15

Implementation commit `b896bb5392d92a5d21185b25444592a0099f6130` passed [CI run 38744825970](https://github.com/freearmy599/taleforge/actions/runs/38744825970). The disposable PostgreSQL rehearsal covers global and per-event quota boundaries, concurrent idempotency, non-consuming duplicate handling, and non-consuming rejected-event checks. The read-only preflight contract checks direct INSERT grants/policies, the actual timestamp-trigger name, the event UUID unique index, and no raw cron-command output. This remains source/fixture verification only; no production database was queried or changed, and no Edge Function was deployed.


## SECURITY DEFINER search-path review — 2026-10-15

A focused review found that the intake RPC's objects were already schema-qualified, but its SECURITY DEFINER search path still listed application schemas. Both the ingestion RPC and quota-pruning helper now use only `pg_catalog` as their configured search path; application tables, quota objects, and the helper call remain schema-qualified. The endpoint source contract asserts both SECURITY DEFINER functions use this minimal path and rejects adding writable application schemas to it.

The change is branch-only. The browser switch remains disabled, direct INSERT remains open for compatibility, and public trending remains gated. Wait for the workflow that includes these exact commits before marking this hardening pass verified. Production remains NO-GO.
