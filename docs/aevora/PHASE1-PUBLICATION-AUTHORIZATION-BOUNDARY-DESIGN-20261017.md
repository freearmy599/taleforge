# Aevora Phase 1 — Database Commit-Boundary Publication Authorization Design

Date: 2026-10-17  
Repository: `freearmy599/taleforge` (product brand: Aevora)  
Branch: `aevora/release-scheduler-hardening`

## Status and safety boundary

**Design only. No authorization schema, trigger, RPC, grant, Edge Function, cron, or production change is made or authorized by this document.** The current scheduler and publisher intentionally return a fail-closed result for real automated publication until separately approved authorization exists at the database commit boundary.

The existing `taleforge_release_readiness_authorizations` table and readiness-gate triggers are not publication approval. Readiness means a schedule/configuration has passed an operational review; it must not be treated as a human decision to publish a specific chapter.

## Current verified branch behavior

- `release-scheduler` stops non-dry-run schedules with `auto_publish=true` before lease acquisition and publisher calls.
- `release-publisher` independently reads the persisted release schedule and rejects automated publication before idempotent chapter handling or insertion when `auto_publish=true`.
- The publisher validates generation output, publication review, series, blueprint, and the existing chapter slot. Its duplicate path accepts only a chapter that matches the same output and is actually published.
- The branch has a candidate migration revoking direct `anon`/`authenticated` chapter writes, but this migration is not proof that deployed permissions have changed.
- Existing lease-fenced RPCs protect schedule/lifecycle writes; they do not authorize chapter publication.
- CI passing is branch evidence only. Automated publishing remains **NO-GO**.

## Required security property

A chapter must not become publicly published unless a single database transaction proves all required conditions and writes the chapter under that same transaction. A successful Edge Function response, an approved generation output, an automation-ready schedule, a lease, or an application-side check by itself is not publication authorization.

## Proposed architecture for review

1. **Use a dedicated database publication RPC as the only automated write path.** The RPC should be owned by a trusted database role, use a pinned safe `search_path`, validate all arguments, and lock the relevant rows in a documented consistent order. It should insert/transition the chapter and record the publication outcome atomically.
2. **Bind authorization to the exact target.** Any authorization record must bind to the exact generation output, series, chapter number/slot, and intended publication action. It must not be a reusable boolean on the series or schedule. Reject stale, revoked, expired, mismatched, or already-consumed authorization.
3. **Keep readiness separate from consent.** The current schedule readiness authorization may be a prerequisite for autonomous operation, but cannot satisfy the separate publication authorization requirement.
4. **Define the approver trust model before schema work.** Decide whether an authorized human must approve every chapter, approve a bounded batch, or explicitly enable a narrowly scoped automation policy. Define the trusted identity source, role checks, audit retention, expiry/revocation, and whether automated publication is allowed at all. Do not infer this from a service-role call or a client-supplied user ID.
5. **Enforce the write boundary with database privileges.** After proving all callers, make direct chapter insertion unavailable to ordinary clients and ensure the automated worker cannot bypass the RPC with direct table writes. Preserve reviewed reader access and server-side workflows. Avoid broad grant changes until the effective ACL and caller maps are reconciled.
6. **Return success only after commit confirmation.** The RPC should return an unambiguous committed chapter ID and target identifiers. The caller must read/verify the persisted row where needed; duplicate/idempotent requests may report success only if the exact matching chapter is already published and the requested synchronization contract is satisfied.
7. **Keep side effects outside the authorization decision.** Canon/outbox synchronization must be idempotent and observable. A sync warning must not be mislabeled as a fully synchronized publication; failed authorization must not enqueue events, advance schedules, activate series, or mutate publication metadata.
8. **Preserve scheduler fencing separately.** The scheduler lease controls which worker may advance schedule state. It must not grant permission to publish. Schedule advancement and lifecycle activation remain conditional on full-batch persisted publication confirmation and valid lease ownership.

## Minimum acceptance tests before the fail-closed stop can be removed

- No authorization, unknown authorization state, expired/revoked authorization, wrong approver, wrong output/series/chapter, or stale review: **no chapter write and no publication side effect**.
- A valid authorization and all quality/safety/review prerequisites: one committed publication with the exact authorized identifiers.
- Concurrent attempts for the same chapter slot: at most one publication; losers can only return success after verifying the exact already-published row.
- Failure at any validation step or during the database transaction: rollback leaves no partial chapter/authorization consumption.
- Ordinary `anon` and `authenticated` roles cannot invoke the privileged RPC or write chapters directly.
- The worker role cannot bypass the RPC with direct chapter writes after the privilege cutover; only the reviewed RPC owner can perform the protected write.
- Unauthorized direct RPC execution, malformed identifiers, duplicate approvals, and replay attempts are denied.
- Schedule advancement and lifecycle activation remain blocked after authorization rejection, partial batch failure, or lease loss.
- Disposable PostgreSQL rehearsal covers grants, function owner, `SECURITY DEFINER`, safe `search_path`, row locks, concurrency, rollback, and trigger behavior.
- A separate reviewed rollout/rollback plan proves deployed Edge versions, migrations, grants, and callers are compatible before any live change.

## Decisions still required before implementation

- Who is the trusted approver, and how is that identity authenticated inside the database transaction?
- Is authorization per chapter, per bounded batch, or an explicitly enabled autonomous policy with a defined scope and expiry?
- Which exact publication fields/status transitions are allowed, and which existing triggers or outbox writes must remain in the same transaction?
- Which role should own the RPC, and how will the service-role worker be prevented from bypassing it without breaking legitimate server workflows?
- What is the rollback plan if the new RPC or grant cutover blocks an existing trusted publication workflow?

**Conclusion:** Keep the existing fail-closed scheduler/publisher guards in place until the approver model is explicitly decided, the database-boundary implementation and tests pass, live schema/function/ACL parity is verified, and the rollout is separately authorized. No production changes are performed by this design.
