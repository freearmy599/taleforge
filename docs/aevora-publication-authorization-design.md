# Aevora publication authorization — design gate

Status: design proposal only. No migration, function deployment, chapter write, or production configuration change is authorized by this document.

## Why this gate exists

Generation readiness, review approval, scheduler lease ownership, and publication authorization are separate facts. The scheduler/publisher branch intentionally blocks autonomous publication because no authorization primitive is yet enforced at the database commit boundary.

A service-role Edge Function is not itself a sufficient publication authorization boundary: it can be stale, retried, called through another worker, or race with a schedule/configuration change. A readiness timestamp alone only authorizes automation configuration; it must not be treated as approval to publish a specific chapter.

## Recommended boundary: one atomic database publication RPC

Implement a narrowly scoped `SECURITY DEFINER` PostgreSQL function that is the only supported write path for publication. The publisher should call this RPC and must not directly insert into `public.chapters`.

The RPC should, in one transaction:

1. Lock the target series and the relevant release-schedule row(s) in a documented, consistent lock order.
2. Verify the generation output belongs to that series and is in an eligible terminal status.
3. Verify the current publication review is approved and every required quality, continuity, originality, and safety gate is explicitly true.
4. Verify that the series is eligible for publication and that automation configuration is unique, enabled, ready, and consistent with the requested publication mode.
5. For automated publication, require a separate, durable, human-authorized publication approval bound to the exact output/chapter and policy version. A schedule-ready marker or generic governance pass is not a substitute.
6. Validate chapter identity and sequence uniqueness under the lock; handle idempotent retries only when the existing chapter matches the exact expected published output. A duplicate row with a different output must be a conflict, never success.
7. Insert the published chapter and the canonical-sync outbox event in the same transaction.
8. Return a minimal result that explicitly distinguishes `published`, `already_published_same_output`, and conflict/failure. The Edge Function must not infer publication from HTTP 200 alone.
9. Commit all or none. If the outbox insert fails, the chapter insert must roll back as well.

The exact human-approval mechanism is a product/security decision and must be specified before implementation. Approval must be auditable, revocable before commit, scoped to the intended output, and impossible to mint through ordinary client roles or the scheduler's service-role path.

## Database privilege and function hardening

- Revoke execute from `PUBLIC`, `anon`, and `authenticated`; grant only to the intended server role.
- Use `SECURITY DEFINER` only with a fixed empty search path and fully qualified object references.
- Do not accept arbitrary table names, SQL fragments, caller-supplied review booleans, or a caller-supplied `published=true` claim.
- Derive series/output/review/authorization facts from locked database rows inside the RPC.
- Ensure direct INSERT/UPDATE/DELETE on `public.chapters` is not available to browser roles. Inventory all server writers and migrate them to the approved path or explicitly classify a separate trusted manual path.
- Do not allow a client role to create/modify publication-authorization records or write the transaction-local evidence used by any authorization trigger.
- Keep response payloads free of provider credentials and internal exception diagnostics.

## Concurrency and idempotency tests required

Use a disposable PostgreSQL rehearsal and assert:

- Approved output publishes once; a retry for the same output returns the exact idempotent result.
- A retry for a different output or different chapter content conflicts and does not claim success.
- Missing, revoked, stale, wrong-series, or wrong-policy approval is rejected.
- A schedule changed to unready/disabled before the RPC lock is acquired cannot publish automatically.
- Two concurrent attempts for the same sequence produce one chapter and one consistent outbox event.
- Duplicate sequence, chapter-ID race, or output-ID race cannot produce a false-success response.
- Review gates that are false, null, absent, or changed after approval block publication.
- Canonical outbox failure rolls back the chapter insert.
- Lease loss blocks scheduler advancement, and partial publication never advances the release schedule.
- Lifecycle activation occurs only after the RPC confirms the required publication outcome.
- Trigger functions continue to work after client EXECUTE revokes; only the intended server role can call the RPC directly.
- Every candidate migration has an up/down or recovery strategy documented and rehearsed. Do not use production as a test environment.

## Rollout gates

1. Agree on and document the exact human approval actor, storage, revocation semantics, and policy versioning.
2. Implement the RPC and migration on the existing hardening branch only.
3. Add SQL-level security/concurrency fixtures and Edge publisher contract tests.
4. Run the complete disposable PostgreSQL and Edge source-validation workflow.
5. Inventory every current chapter writer and prove there is no bypass around the RPC.
6. Prepare a schedule-by-schedule transition/rollback plan before applying the readiness migration, which can disable existing schedules.
7. Obtain explicit production authorization before applying any migration or deploying any function.

Until these gates pass, retain the prepared scheduler/publisher fail-closed stop for automated publication. No production change is implied by this proposal.
