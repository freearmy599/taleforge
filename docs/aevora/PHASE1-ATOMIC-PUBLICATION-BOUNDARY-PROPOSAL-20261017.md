# Aevora Atomic Publication Boundary — Proposal Only

Date: 2026-10-17  
Repository: `freearmy599/taleforge`  
Branch: `aevora/release-scheduler-hardening`

## Status

**Design requirements only. Not a migration, implementation, approval, or rollout authorization.** Automated publication remains NO-GO. The existing scheduler and publisher authorization stops must remain in place until a reviewed database commit boundary exists and the trusted human approver/authentication source has been explicitly decided.

## Why the current split flow is not sufficient

The Edge publisher can insert a published chapter and then separately synchronize the generation output, chapter blueprint, series publication timestamp, and canon-sync outbox. It reports failure if later synchronization is incomplete, but the chapter insert may already have committed. The scheduler can then observe a partial side effect without a single transaction that atomically commits the complete publication unit and schedule advancement. Strict response checks and leases reduce ambiguity; they do not create a cross-request transaction.

## Required transaction boundary

Before implementation, verify the authoritative live schema, constraints, triggers, function ownership, grants, and migration history. Then design a single database-owned operation that either commits the complete publication unit or rolls back all its database writes. The operation must validate, from persisted state and within the transaction:

1. A valid, unexpired, unrevoked publication authorization record exists for the requested series/scope and mode. Caller-provided booleans, request fields, generation readiness, or a service-role request alone must not count as approval.
2. The authorization principal and authentication mechanism match a human-approved configuration. **Identity/source remain unresolved and must not be invented by implementation.**
3. The automation schedule is unique, enabled, and explicitly in the supported automatic-publish mode; ambiguous or missing schedule state fails closed.
4. The schedule lease token is current and owned, and the expected schedule/version preconditions still hold.
5. The generation output, quality review, and blueprint still match the same series and chapter number and are in approved/publishable states.
6. The chapter slot is free, or an exact idempotent match to an already-published chapter is verified. A different chapter, draft row, content mismatch, or conflicting status fails closed.
7. Chapter insert/status, output status, blueprint release state, first-publication timestamp, required outbox event, and schedule cursor advancement are committed consistently. If any required operation fails, the transaction rolls back the publication unit. Any intentionally separable downstream delivery must be represented by a durable outbox row written inside the same transaction.

The function must be narrowly executable only by the intended server role; direct client roles must not be able to call it or write around it. Review SECURITY DEFINER ownership, fixed search_path, schema-qualified objects, and execute grants. Do not revoke broad schema-wide defaults or change production ACLs as part of this proposal.

## Required failure and concurrency rehearsals

- No approval; expired approval; revoked approval; wrong scope/series; wrong authentication principal.
- Disabled, missing, or ambiguous schedule; lease token missing, expired, superseded, or lost mid-race.
- Output/review/blueprint changed between preflight and commit.
- Two workers publishing the same slot concurrently: exactly one chapter; the loser either receives a verified exact idempotent result or a safe conflict.
- Existing draft/unpublished chapter in the slot; different content; wrong series or chapter number.
- Injected failure at each write boundary: chapter, output, blueprint, series timestamp, outbox, schedule advancement. Assert full rollback of the transaction-owned state.
- Successful transaction creates one durable outbox event; retries do not create duplicates; downstream retries are idempotent.
- Schedule advances only after the complete transaction is confirmed; no advancement after failure or lease loss.
- Browser roles and unrelated Edge functions cannot invoke the RPC or insert chapters directly.
- Audit trail records authorization reference, action/result, scope, timestamps, and safe failure code without leaking chapter content, secrets, or internal exception details.

## Compatibility and rollout gates

- Recover and reconcile authoritative production migration/function provenance first; the branch/live drift and `supabase_admin` default-privilege ownership gap remain separate blockers.
- Build disposable-PostgreSQL tests and function contracts before considering any migration.
- Keep the scheduler's `publication_authorization_not_implemented` stop until the database boundary, audit trail, and tests are complete.
- Do not choose approver identity, change production schema/ACLs, apply migrations, deploy functions, enable schedules, generate chapters, or publish chapters without explicit authorization.
- After all gates pass, prepare a separate rollout/rollback plan and request explicit approval before any production action.
