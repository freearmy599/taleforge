# Phase 1 reader-event intake implementation plan — 2026-10-15

## Status

Planning artifact only. No endpoint, database object, production setting, or browser write path is changed by this document. The branch's existing direct browser insert is still active where its current database policies permit it. Public trending remains gated.

## Design decision

Use a dedicated Supabase Edge Function as the only future public intake boundary, with an atomic database RPC for quota consumption and insertion. Do not implement quota checking as a read-then-write sequence in JavaScript: concurrent requests could race past a limit. Do not trust `visitor_id`, event UUIDs, client timestamps, or client-provided IP headers as authenticated identity.

## Endpoint contract

Accept POST JSON only. Enforce a small request-body limit before parsing; reject malformed JSON, arrays, unknown keys, unsupported event types, invalid UUIDs, malformed series/chapter IDs, and progress outside integer 0–100. Ignore client timestamps and assign server time. Keep the existing event vocabulary: `story_open`, `chapter_start`, `reading_progress`, `chapter_complete`, `follow`, `unfollow`, `bookmark`, `unbookmark`.

Require an eligible series for every event. If a chapter is supplied, require it to belong to that series and be published. Treat the browser visitor identifier as a best-effort deduplication hint only; never describe anonymous events as verified unique readers.

Return a minimal success response and stable machine-readable errors. Do not echo payloads, credentials, database diagnostics, IPs, or provider/database error text. Handle duplicate event UUIDs idempotently. Never log raw event bodies or secrets.

## Atomic quota / insert boundary

The endpoint should call one narrowly scoped SECURITY DEFINER RPC (or equivalent transaction) that performs, atomically:
1. Validate the event and series/chapter relationship against current database state.
2. Enforce server-controlled per-source short-window and daily limits, plus event-specific contribution caps.
3. Apply idempotency for a supplied event UUID.
4. Insert the event with server-assigned timestamp.
5. Return only accepted/duplicate/limited/invalid outcomes, without raw row data.

The quota store and RPC must be inaccessible to anon/authenticated roles. Fix the RPC search_path, schema-qualify referenced objects, revoke default PUBLIC execute, and grant execute only to the function's server role. Limit retained network-derived signals; trust only gateway-controlled metadata, hash/minimize identifiers, document retention, and never accept arbitrary forwarded-IP headers from the request body.

Do not add a client-supplied identity claim or assume rotating visitor IDs are preventable without an account/session decision.

## Compatibility and rollout sequence

1. Add isolated migration and SQL assertions for server-only quota objects, RPC privileges, concurrent quota races, idempotency races, invalid relationships, payload limits, and exact limit boundaries.
2. Implement the Edge Function and source-contract tests for methods, body size, allowlist, progress validation, safe errors, no credential leakage, and no raw-payload logging.
3. Type-check the function and execute disposable PostgreSQL rehearsals. Exercise parallel requests at the quota boundary; exactly the configured number may succeed.
4. Add a compatibility test for the existing `window.taleForgeProgress.track(event_type, data)` interface, then add a branch-only opt-in switch so browser reads/UI do not depend on intake availability.
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

NO-GO for production. No production migration, deployment, schedule mutation, chapter generation, publication, or billable Supabase branch is authorized by this plan. The next implementation commit must contain the migration/RPC, Edge Function, tests, and workflow integration together, followed by successful CI and disposable-database verification.
