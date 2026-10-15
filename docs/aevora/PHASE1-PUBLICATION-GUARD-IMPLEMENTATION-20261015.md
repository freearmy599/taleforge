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
- Added a repository-wide source-contract test that rejects direct `auto_publish=true` assignments in production Edge Functions while excluding `*.test.ts` fixtures. The corrected full CI run [38684845075](https://github.com/freearmy599/taleforge/actions/runs/38684845075) passed both Edge Function type-check/security contracts and the disposable PostgreSQL readiness/concurrency/reader-event rehearsal.
- Added a contract test tying the runner response to the readiness migration's `publication_enabled=false` and `auto_publish=false` invariants. The publisher and release-readiness contract steps passed in CI run [38684363740](https://github.com/freearmy599/taleforge/actions/runs/38684363740); the disposable PostgreSQL job also completed successfully in the full run.

## Additional verification on 2026-10-15

- Added a regression contract that checks the autonomous-series runner initializes a new schedule with `enabled=false`, `auto_generate=false`, and `auto_publish=false`, and does not request readiness until the schedule write is confirmed.
- Validation passed in [CI run 38685198646](https://github.com/freearmy599/taleforge/actions/runs/38685198646): all 40 prepared Edge Function/type-check and contract-test steps succeeded, and the disposable PostgreSQL readiness/concurrency rehearsal succeeded.
- Earlier auto-publication assignment scan attempts failed because the initial scope included SQL invariants and intentional test fixtures. The scan was narrowed to executable Edge Function sources, the SQL readiness invariant remains covered by the existing migration contract, and the corrected run passed in [38684937000](https://github.com/freearmy599/taleforge/actions/runs/38684937000). The failed exploratory runs are not treated as current validation.

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

## Gemini quota-guard audit extension

- Added `scripts/aevora-gemini-quota-guard-contract.test.mjs`, which scans every TypeScript Edge Function for direct Gemini API endpoints and requires the persisted provider-state table, explicit fail-closed state-unavailable handling, a cooldown rejection marker, and a current-time check.
- Wired the contract into `.github/workflows/aevora-edge-validation.yml`; it passed in [CI run 38686126485](https://github.com/freearmy599/taleforge/actions/runs/38686126485). Both the prepared Edge Function/type-check job and the disposable PostgreSQL readiness/concurrency/reader-event rehearsal completed successfully.
- This is a static regression net, not proof of live provider quota state or a substitute for runtime/provider integration testing. No Gemini request was made by the test.

## Publication idempotency-path regression

- Extended the publisher security contract to assert that the persisted automatic-publication lock executes before both the existing-chapter/idempotent synchronization path and a new chapter insert. This protects against an automatic schedule reporting or synchronizing publication through an early-return path.
- Validation passed in [CI run 38686233461](https://github.com/freearmy599/taleforge/actions/runs/38686233461): prepared Edge Function/type-check and source-contract tests passed, and the disposable PostgreSQL readiness/concurrency/reader-event rehearsal passed.
- The prior documentation-and-quota-audit validation also completed successfully in [CI run 38686218527](https://github.com/freearmy599/taleforge/actions/runs/38686218527).

## Browser-side chapter-write bypass check

- Extended the publisher security contract to scan browser-facing HTML/JavaScript and reject direct `.from("chapters").insert(...)` calls outside the guarded publisher path.
- The expanded source contract passed in [CI run 38686357496](https://github.com/freearmy599/taleforge/actions/runs/38686357496). Both the prepared Edge Function/type-check job and all disposable PostgreSQL readiness/concurrency/reader-event rehearsals passed.
- This check covers direct Supabase client inserts in the listed browser files; it does not replace production RLS/ACL catalog verification, which remains a release gate.

## Edge Function authorization inventory coverage

- Expanded `scripts/aevora-internal-worker-auth-contract.test.mjs` to cover the autonomous series runner's two authorization modes: scheduled mode must present the server-held service-role credential, while admin mode must validate a user session and require an admin/owner application role before creating the privileged database client.
- Added a separate contract for the read-only control-plane audit endpoint: its dedicated audit token must be configured and validated before privileged REST reads, with GET-only behavior and `Cache-Control: no-store`.
- Added an inventory assertion requiring every `supabase/functions/*/index.ts` entrypoint to be explicitly classified under one of the appropriate authorization contracts. This closes a test-coverage gap where a newly added endpoint could otherwise be omitted from the static worker list without failing CI.
- Expanded the browser credential scan to discover all root-level HTML/JavaScript files in addition to the established list, so newly added root browser assets are included automatically.
- Validation: [CI run 38689102099](https://github.com/freearmy599/taleforge/actions/runs/38689102099) passed the dedicated runner/control-plane authorization tests; [CI run 38689181875](https://github.com/freearmy599/taleforge/actions/runs/38689181875) passed explicit endpoint-classification checks; and [CI run 38689234213](https://github.com/freearmy599/taleforge/actions/runs/38689234213) passed the expanded browser-asset scan, all prepared Edge Function/type-check contracts, and disposable PostgreSQL readiness/concurrency/reader-event rehearsals.
- These are source-contract and disposable-environment checks. They do not certify live production grants or authorize deployment; production remains NO-GO.

## Default-ACL operator preflight

- Extended the reusable read-only catalog audit with a seventh query that reports whether the current SQL executor is a member of the `postgres` and `supabase_admin` roles that own relevant default ACLs. It is explicitly labeled as a preflight signal, not permission to alter defaults.
- Updated the audit contract to assert all seven statements remain read-only and that owner-membership preflight remains present.
- The first SQL-only commit exposed a stale six-statement test expectation and its CI run failed; the follow-up updated the expected count to seven, and [CI run 38689373437](https://github.com/freearmy599/taleforge/actions/runs/38689373437) passed. The initial failed run is retained as correction history, not counted as passing evidence.
- Validation passed in [CI run 38689373437](https://github.com/freearmy599/taleforge/actions/runs/38689373437), including the read-only access audit contract, prepared Edge Function/type checks, and disposable PostgreSQL readiness/concurrency/reader-event rehearsals.
- This improves evidence collection for the known `supabase_admin` default-ACL blocker; it does not repair or change any live grants. An approved operation by the appropriate owner remains required, and production rollout remains NO-GO.


## Manual-mode and scheduler rejection regression coverage

- Extended the publisher security contract to explicitly distinguish persisted manual schedules from automated schedules. Missing/ambiguous schedule state must fail closed; manual schedules are handled explicitly; conflicting automation flags on a manual schedule return `MANUAL_SCHEDULE_AUTOMATION_CONFLICT`; generation-only readiness cannot authorize automatic publication.
- The full validation passed in [CI run 38691792890](https://github.com/freearmy599/taleforge/actions/runs/38691792890), including prepared Edge Function type checks, all source-contract tests, and the disposable PostgreSQL readiness/concurrency/reader-event rehearsal.
- Added a scheduler cross-file regression that evaluates the scheduler's publication-confirmation helper and proves an authorization-lock response cannot be counted as a confirmed publication, even if the transport-level response is otherwise marked okay. Schedule advancement remains gated on confirmation of every selected publication.
- Validation passed in [CI run 38691855485](https://github.com/freearmy599/taleforge/actions/runs/38691855485), including the scheduler and publisher security contracts, all prepared Edge Function type checks, and the disposable PostgreSQL rehearsal.

These passing checks strengthen the branch-only safety net. They do not implement the missing human approval workflow, prove live Supabase grants, or authorize deployment. Production remains NO-GO.
