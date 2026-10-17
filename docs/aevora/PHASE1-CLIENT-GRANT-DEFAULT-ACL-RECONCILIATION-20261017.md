# Aevora Phase 1 — Client-Grant and Default-ACL Reconciliation Matrix

Date: 2026-10-17  
Repository: `freearmy599/taleforge`  
Branch: `aevora/release-scheduler-hardening`

## Status and safety boundary

**Audit plan only. No production ACL or schema change is authorized by this document.** The 2026-10-17 read-only catalog audit found 39 tables in schema `public` with RLS enabled, no row policies, and explicit grants to both `anon` and `authenticated`. It also found broad default privileges for both `postgres` and `supabase_admin` as creators in `public`. This is a least-privilege drift signal and a likely contributor to recurring grants; it is not proof that client row access succeeds or that a specific migration caused the drift.

The five previously prioritized relations are `chapters`, `taleforge_ai_provider_state`, `release_schedules`, `publication_sync_outbox`, and `story_attachment_metrics`. The broader 39-table set must be regenerated from the live catalog at the next authorized read-only audit; do not hardcode a stale list as the source of truth.

## Reconciliation sequence

1. **Capture the effective ACL inventory.** For each `public` relation, record relation kind, owner, RLS and FORCE RLS flags, policy count and policy commands, explicit relation grants, column-level grants, sequence grants, and whether the relation is a table, partition, view, or materialized view.
2. **Map actual callers before deciding grants.** Search all Edge Function entrypoints, web/client code, SQL routines, triggers, cron jobs, and migrations for each relation. Record each caller's identity (browser `anon`, user `authenticated`, `service_role`, owner/definer routine, or unknown), operation, required columns, and whether the call path is deployed/live or branch-only.
3. **Classify purpose.** Assign exactly one provisional category per relation: public read surface; authenticated user-owned data; user-generated community data; internal workflow/queue; privileged configuration/provider state; audit/telemetry; dormant/unwired feature; or unresolved. Category is a hypothesis until supported by source and runtime evidence.
4. **Define the minimum grant/policy contract.** For each table, write the expected operations for `anon`, `authenticated`, `service_role`, and owner/definer routines. Do not add a policy merely to make a no-policy table usable. A server-only table should remain server-only; a reader-facing table needs explicit ownership/scope rules and tests.
5. **Reconcile default ACL provenance.** Inspect checked-in migration history and any recoverable source artifacts for both creator roles, `postgres` and `supabase_admin`. Compare `pg_default_acl` against the intended baseline and current migration behavior. Do not guess which actor introduced the defaults. A candidate correction must address both creators, specify future tables/sequences/functions separately, preserve only reviewed grants, and be tested against objects created by each role in disposable PostgreSQL.
6. **Prepare narrow remediation candidates.** Group changes only when intended behavior and rollback are identical. Prefer object-scoped revokes/policies over schema-wide blanket changes. Include exact before/after effective privileges and a rollback that restores only the reviewed prior state.
7. **Rehearse and verify.** Test permitted and denied operations under the actual client roles, including RLS row-scope tests, direct REST access, function EXECUTE privileges, column grants, sequence usage, and `TRUNCATE` exposure. Verify that service-side workflows still work. Run concurrent/failure tests where writes affect workflow state.
8. **Separate branch validation from production rollout.** Passing CI is not proof of deployed compatibility. Any live migration, ACL change, cron edit, Edge deploy, chapter generation/publication, or paid/billable environment requires separate explicit authorization and a rollback plan.

## Minimum inventory fields

| Field | Required evidence |
|---|---|
| Relation and kind | Exact schema-qualified catalog name and relation kind |
| Owner | Current catalog owner; do not infer from migration authorship |
| RLS | `relrowsecurity` and `relforcerowsecurity` |
| Policies | Name, command, roles, USING and WITH CHECK predicates |
| ACL | Effective privileges and explicit ACL entries per client/server role |
| Column ACL | Column-level grants, if any |
| Default ACL | Creator role, object type, grantee, privilege list |
| Callers | Source file/function, SQL routine, cron or UI caller |
| Purpose | Reader-facing, user-owned, internal, privileged, telemetry, dormant, unresolved |
| Intended access | Explicit per-role operation matrix with rationale |
| Tests | Positive, negative, cross-user, unauthenticated, concurrency and rollback as applicable |
| Deployment parity | Branch evidence plus separately verified live version/schema evidence |
| Decision | Keep, revoke, add scoped policy, defer, or unresolved; reviewer and rationale |

## Immediate priority groups

### P0 — privileged workflow and publication safety

Start with `release_schedules`, `publication_sync_outbox`, `story_attachment_metrics`, `taleforge_ai_provider_state`, generation/review/continuity queues, chapter-generation outputs, and any RPCs that can advance workflow or publish. Keep client roles denied unless a proven browser feature requires a tightly scoped operation. Ensure browser-facing APIs cannot bypass the intended workflow boundary.

### P1 — reader-facing and user-owned data

Evaluate `chapters`, `bookmarks`, `collections`, `comments`, `likes`, `notifications`, `profiles`, `ratings`, and `reading_history` individually. Do not assume they all need the same policy. Public chapter reads must exclude drafts/unpublished content; user-owned records must be scoped to the authenticated user; community actions need moderation and abuse boundaries.

### P2 — dormant, reference, and telemetry objects

Check taxonomy/reference tables, cover/series design tables, reader-event/trending tables, and dormant account/feature tables. Confirm whether a feature is wired into the deployed website before exposing it. Preserve a disabled feature's safe state rather than granting access in anticipation of future use.

## Branch-only inventory regression guard — 2026-10-17

A source-contract test now keeps the 39-row provisional classification synchronized with the three branch ACL-lock candidates for the 28 server-only rows and the dormant-reader lock for the 11 product-facing/ambiguous rows:

- `scripts/aevora-policyless-acl-inventory-contract.test.mjs` checks that the classification has all 39 names, all 28 server-only candidates are represented by the expected branch migration set, and all 11 dormant reader/community tables remain individually locked pending a reviewed policy contract.
- `scripts/aevora-browser-workflow-table-boundary.test.mjs` now includes the same 11 dormant reader/community tables in its forbidden direct-browser query inventory. It continues to allow the deliberate published-series/chapter reads and reader-event intake seam.
- The contract is wired into `.github/workflows/aevora-edge-validation.yml`.

Verification: [CI run 39016395105](https://github.com/freearmy599/taleforge/actions/runs/39016395105) passed Edge/source-contract validation (**61/61 steps**) and disposable PostgreSQL rehearsal (**22/22 steps**). This is branch evidence only; it does not validate live REST behavior, prove all service-role callers, resolve default-ACL provenance, or authorize a production rollout.

## Acceptance gate

This audit item is complete only when:
- the live 39-table result is regenerated and each relation has a caller/purpose/access decision or is explicitly marked unresolved;
- both creator roles' default ACLs have authoritative provenance or a reviewed forward-only correction plan;
- candidate SQL has positive and negative role tests plus disposable-PostgreSQL rehearsal;
- the resulting effective privileges are checked after migration in the rehearsal environment;
- CI is green for the exact candidate commit; and
- live rollout remains blocked until separately approved.

## Current conclusion

Do not apply a blanket `REVOKE`, create broad policies, or change default privileges based solely on the current findings. The next safe deliverable is the source-to-table caller map and per-role access matrix, followed by narrowly scoped, tested candidates. Automated publishing remains **NO-GO** and production remains unchanged.


## Live governance relations — added 2026-10-17

These four relations are now explicitly tracked in the reconciliation matrix after the live read-only governance-gate audit. This is a provisional decision record, not permission to change production.

| Relation | Live catalog evidence | Provisional intended client access | Required caller evidence / status |
|---|---|---|---|
| `public.taleforge_system_governance_registry` | RLS enabled, not forced; broad explicit relation grants to `anon`, `authenticated`, and `service_role`; no policy returned in the inspected policy query | No direct client mutation; no client read unless a documented product/API caller is established | Map evaluator and any other SQL/Edge/operational callers; recover authoritative migration/source; unresolved |
| `public.taleforge_system_governance_dependencies` | RLS enabled, not forced; broad explicit relation grants to `anon`, `authenticated`, and `service_role`; no policy returned in the inspected policy query | No direct client mutation or read absent an evidenced requirement | Map evaluator and any other SQL/Edge/operational callers; recover authoritative migration/source; unresolved |
| `public.taleforge_system_governance_runs` | RLS enabled, not forced; broad explicit relation grants to `anon`, `authenticated`, and `service_role`; no policy returned in the inspected policy query | No direct client mutation or read; preserve required trusted evaluator writes | Verify all readers/writers and audit-retention needs; recover authoritative migration/source; unresolved |
| `public.taleforge_system_health` | RLS enabled, not forced; broad explicit relation grants to client roles; one client SELECT policy was returned; no client write policy was returned | At most scoped/read-only access if a real browser use is confirmed; no client mutation | Find exact health-widget/browser caller and validate response sensitivity; preserve evaluator access; unresolved |

The table above intentionally does not claim that client writes currently succeed: relation grants and RLS policies are separate enforcement layers, and no write attempt was made. The existing health SELECT policy should not be removed or widened until its actual caller and returned fields are reviewed.

### Default ACL dependency

The live catalog separately confirms that both `postgres` and `supabase_admin` have schema-scoped defaults in `public` granting broad table privileges to `anon` and `authenticated`, sequence `SELECT/UPDATE/USAGE`, and function `EXECUTE`. The creator-role dimension must remain in the matrix: object-scoped ACL repairs alone do not correct future-object defaults. The current executor lacks the authorized `supabase_admin` owner path, so any default-ACL correction remains blocked until an approved operator route and disposable rehearsal exist.

Evidence: [governance gate dependency and ACL follow-up](./PHASE1-GOVERNANCE-GATE-DEPENDENCY-ACL-FOLLOWUP-20261017.md); [read-only catalog query](./phase1-publication-schema-provenance.sql).

Acceptance for these four relations remains open until source provenance and caller mapping are reviewed, role-by-role access is agreed, positive/negative tests pass in a disposable database, and CI validates the exact candidate. No live grants or policies have been changed.


## Governance lineage dependency — 2026-10-17

Before applying any grant correction to the four governance relations, resolve the tracked-versus-live schema mismatch documented in [the governance schema lineage recheck](./PHASE1-GOVERNANCE-SCHEMA-LINEAGE-20261017.md). The tracked migration defines `taleforge_system_registry` and `taleforge_system_dependencies`; live inspection reports the similarly named `taleforge_system_governance_registry` and `taleforge_system_governance_dependencies`, plus `taleforge_system_governance_runs` without a defining CREATE TABLE statement in the inspected migration. Similar names are not enough to prove identity.

**Gate:** no ACL migration candidate should be drafted against these objects until the authoritative source/history and object lineage are recovered. Existing matrix entries remain provisional; no live grants or policies have been changed.
