# Aevora Phase 1 — Separate publication authorization design

Date: 2026-10-14  
Status: design proposal only; not implemented or deployed.

## Decision

Generation readiness and publication authorization are different capabilities. The existing `taleforge_mark_release_automation_ready(uuid)` RPC may enable generation only; it must keep `auto_publish=false`. No current branch artifact provides a separately audited publication-approval workflow, so automatic publication remains unavailable.

This document deliberately does not add a migration, RPC, grant, or production mutation. The authorization principal and approval UX are unresolved design inputs and must not be guessed.

## Threat model

The design must resist:

- a generation-readiness action implicitly granting publication;
- a stale service-role worker reusing old readiness or bootstrap evidence;
- direct table writes or a caller-settable session variable forging approval;
- approval for one series/schedule/configuration being reused for another;
- schedule cadence, timezone, series lifecycle, or publication policy changing after approval;
- duplicate requests, retries, concurrent approvers, and partial failures creating ambiguous state;
- a generated chapter being treated as publishable without its required quality, safety, originality, continuity, and status checks;
- a log or API response reporting approval when the durable database transaction did not commit.

## Required authorization record

Before implementation, agree a versioned record containing at least:

- immutable approval ID;
- series ID and schedule ID;
- the exact schedule/configuration snapshot or canonical digest approved;
- explicit capability: `publish` (never inferred from `generate`);
- decision: approved/rejected/revoked;
- authenticated human approver identity and authorization source;
- reason and review reference;
- created/updated timestamps and revocation actor/reason;
- policy/version identifier and audit correlation ID.

The database must reject mismatched series/schedule IDs and stale configuration digests. A mutable schedule row or a service-role request body alone is not evidence of human approval.

## Required transaction and authorization boundary

1. Establish the actual human approval principal and how it is authenticated. Do not assume a client role, JWT claim, secret header, service-role key, or caller-settable GUC is sufficient.
2. Permit approval writes only through a narrowly scoped server/database path that verifies that principal and its publication-approval permission.
3. Lock in a documented order: series, lifecycle, schedule, then approval record. Re-read lifecycle, uniqueness, configuration, and policy under those locks.
4. Persist the approval record and its audit event atomically. Idempotent retries must return the same decision and must not silently widen scope.
5. Require the publication authorization to be current at the point publication is committed, not merely when a scheduler starts. Revocation/configuration changes must invalidate authorization.
6. Keep generation readiness independent. Revoking publication approval must never enable or disable generation as a side effect unless a separately specified policy says so.
7. Use least-privilege grants. Client roles must not directly mutate approval records or schedule flags; function owners, `SECURITY DEFINER`, fixed search paths, EXECUTE grants, RLS, and column grants require catalog verification.
8. If authorization evidence is missing, malformed, stale, ambiguous, or unavailable, reject publication and preserve a diagnostic audit record without exposing secrets.

## Required invariants and tests

- Generation-readiness RPC returns `publication_enabled=false` and never sets `auto_publish=true`.
- No approval record means publication is rejected, including direct publisher invocation.
- Generation approval cannot be converted to publication approval by a caller-controlled field.
- Approval for series A cannot authorize series B or a different schedule.
- Changing approved cadence/timezone/configuration revokes or invalidates the approval.
- A completed, cancelled, hiatus, draft, or otherwise ineligible series cannot publish even with an approval record.
- Revocation racing publication has deterministic transaction ordering and no stale worker can publish after revocation wins.
- Duplicate approval requests are idempotent; conflicting decisions are rejected and audited.
- Provider cooldown, quality/review gates, publisher idempotency, and actual chapter status checks remain independent requirements.
- Runtime tests exercise direct SQL/table attempts, API-role grants, RPC caller identities, concurrency, rollback, and audit completeness on a disposable PostgreSQL fixture.
- Supabase-specific catalog/RLS/ACL checks are verified separately; fixture tests alone do not close that gate.

## Approval state machine

```text
no approval
   | authorized human approves exact snapshot
   v
approved ---- configuration/lifecycle change ----> invalidated
   | authorized human revokes
   v
revoked

rejected decisions remain explicit audit records; a new approval requires a new decision.
```

The transition implementation must be idempotent and transactionally enforced. The diagram is a specification, not executable SQL.

## Release gate

Do not implement or enable publication automation until all are true:

- human approver identity and authorization source are agreed;
- approval UI/API and threat model are reviewed;
- database schema, RLS, grants, RPC boundary, and revocation semantics are reviewed;
- concurrency and rollback tests pass;
- publisher performs an authoritative in-transaction authorization check;
- each intended series has an explicit publication decision and recorded snapshot;
- production catalog evidence and a production-specific recovery baseline are captured;
- a human operator approves a staged rollout plan.

Until then, keep `auto_publish=false` for every series. No production migration, deployment, schedule mutation, generation, or publication is authorized by this document.
