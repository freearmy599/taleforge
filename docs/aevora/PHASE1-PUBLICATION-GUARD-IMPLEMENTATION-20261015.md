# Aevora Phase 1 — publication guard implementation note

Date: 2026-10-15  
Branch: `aevora/release-scheduler-hardening`  
Status: **Branch-only fail-closed guard added; automated publication remains unavailable. Not deployed.**

## Change summary

The release publisher now rejects an interval/weekly schedule whose persisted `auto_publish` flag is true with HTTP 423 and code `PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED`. This is a deliberate fail-closed lock: generation readiness and existing editorial/governance checks do not constitute a separately audited publication approval.

The guard reads the release schedule from the database and executes before the chapter-insert path. A source-contract test asserts the rejection marker exists and that this guard precedes chapter insertion. Publisher version: `release-publisher-v11-publication-authorization-fail-closed`.

## Additional branch-only hardening on 2026-10-15

- Added a regression scan over every TypeScript file under `supabase/functions/` to assert that `release-publisher` is the only Edge Function that directly inserts rows into `chapters`. The scan and the existing publisher/readiness contracts passed in CI run [38684318333](https://github.com/freearmy599/taleforge/actions/runs/38684318333).
- Corrected the autonomous-series runner's success response: it previously claimed `auto_publish=true` even though the readiness RPC deliberately sets `auto_publish=false`. The response now reports generation enabled, publication disabled, and separate publication approval required.
- Added a contract test tying the runner response to the readiness migration's `publication_enabled=false` and `auto_publish=false` invariants. The publisher and release-readiness contract steps passed in CI run [38684363740](https://github.com/freearmy599/taleforge/actions/runs/38684363740); the full run's disposable PostgreSQL job was still in progress when this note was prepared.

## What this change does not do

- It does not create the human publication-approval workflow or an approval ledger.
- It does not claim to solve approval revocation races at the database commit boundary.
- It does not authorize, mutate, or activate any production schedule.
- It does not change manual publication behavior for a schedule explicitly in manual mode.
- It does not deploy the function or run a production smoke test.

## Required next work

1. Review the CI run for the newest branch commit and fix any failures before treating the guard as validated.
2. Agree the authenticated human approver identity and trusted authorization source before designing approval writes.
3. Implement an append-only or otherwise tamper-resistant approval/audit record bound to series, schedule, canonical configuration snapshot, policy version, principal, reason, and decision.
4. Implement a narrowly scoped authorization RPC and least-privilege grants; reject client-controlled claims and direct table writes.
5. Enforce current approval within the same database transaction that commits publication, with documented lock ordering against revocation, lifecycle changes, and schedule configuration changes.
6. Add adversarial tests for missing/stale/mismatched approval, approval replay, duplicate/conflicting decisions, configuration invalidation, direct SQL/API-role attempts, concurrent revoke-versus-publish, and rollback on a disposable PostgreSQL fixture.
7. Rehearse Supabase-specific catalog/RLS/ACL behavior and record fresh, access-controlled inventory for the six legacy schedules. Each remains on hold until separately reviewed.

## Current release decision

**NO-GO.** Do not deploy this branch, run production migrations, enable `auto_publish`, mutate schedules, generate chapters, or publish chapters as part of this work. A passing source-contract test alone is not sufficient evidence for a production authorization boundary.
