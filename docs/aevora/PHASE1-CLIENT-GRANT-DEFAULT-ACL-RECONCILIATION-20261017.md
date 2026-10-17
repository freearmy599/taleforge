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
