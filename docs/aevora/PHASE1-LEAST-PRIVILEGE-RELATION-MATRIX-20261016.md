# Aevora Phase 1 — Least-Privilege Relation Matrix (2026-10-16)

Status: **proposal/evidence record only**. This document is not a migration and grants no authorization to change production. Read-only catalog inspection only; no database changes, deployment, schedule changes, generation, or publication were performed.

Branch: `aevora/release-scheduler-hardening`  
Live project reviewed: `sxmbnlgufqhcwxcpcsvb`

## 1. Direct live privilege evidence

A read-only `has_table_privilege` inventory on 2026-10-16 found that `anon` and `authenticated` each have SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER and `MAINTAIN` on all 13 existing relations in the audit query. The same inventory returned those privileges for `service_role` as expected for the trusted service role; this does not establish which individual functions need every privilege:

- `taleforge_ai_provider_state`
- `chapter_blueprints`
- `chapter_generation_outputs`
- `chapter_publication_reviews`
- `chapter_reviews`
- `chapters`
- `publication_sync_outbox`
- `reader_events`
- `release_schedules`
- `series`
- `story_blueprints`
- `story_trending_scores`
- `story_intelligence`

For the ten workflow/publication tables plus provider state, RLS is enabled but not forced. Eight internal workflow tables have no RLS policies; `chapters`, `series`, and `reader_events` each have one policy. The two optional enrichment relations `story_trending_scores` and `story_intelligence` have RLS disabled in the live catalog and broad client privileges. These are excessive client grants, but this audit does not assert that each grant is reachable through a particular HTTP/API path. RLS does not govern `TRUNCATE`, and ordinary row-level policies are not a substitute for removing unneeded relation privileges.

## 2. Exact current reader policies

- `series`: SELECT for `anon, authenticated` where status is `ongoing` or `completed`.
- `chapters`: SELECT for `anon, authenticated` where chapter status is `published` and an associated series exists with status `ongoing` or `completed`.
- `reader_events`: INSERT for `anon, authenticated` with a non-null visitor ID of length 16–100; an optional series ID must reference an ongoing/completed series; an optional chapter ID must reference a published chapter. This policy is not a rate limiter, proof of identity, or substitute for server-side event validation.

## 3. Proposed target matrix — not applied

| Relation group | `anon` target | `authenticated` target | Trusted server target / compatibility notes |
|---|---|---|---|
| `series` | SELECT only, constrained by the published-series policy | SELECT only, same policy | Keep trusted writes for lifecycle, creation, scheduling and publication callers after exact call-path review. |
| `chapters` | SELECT only, constrained by the published-chapter + eligible-series policy | SELECT only, same policy | Keep trusted generation/publisher/trigger operations; do not grant browser writes. Verify views/joins and trigger behavior before rollout. |
| `reader_events` | INSERT only only while the current direct-browser path remains active and validated; no SELECT/UPDATE/DELETE/TRUNCATE | Same compatibility condition | Preferred end state is constrained Edge Function intake + server-only quota/idempotency RPC. Do not revoke direct INSERT until deployed endpoint, feature flag, CORS, validation, rate limiting, idempotency, and rollback are verified together. Never expose raw event SELECT merely to support aggregates. |
| `taleforge_ai_provider_state` | No privileges | No privileges | Server-only access through reviewed Edge Functions/atomic RPC. Provenance and atomicity remain unresolved; do not invent an RPC or apply DDL yet. |
| `chapter_blueprints`, `chapter_generation_outputs`, `chapter_publication_reviews`, `chapter_reviews`, `publication_sync_outbox`, `release_schedules`, `story_blueprints` | No privileges | No privileges | Keep only required trusted service-role/function/trigger access after each caller and transaction path is mapped. No client policies should be added just to compensate for excessive grants. |
| `story_trending_scores`, `story_intelligence` | Prefer no direct access until reviewed aggregate/read surface is defined; if intentionally public, grant SELECT only through a reviewed RLS-protected view/table design | Same | Current browser callers treat these as optional enrichment and degrade gracefully. A prepared migration intentionally gates them pending trusted intake/abuse controls. Accept reduced trending/enrichment rather than broad unaudited writes. |
| Any other relation | No assumption based on name alone | No assumption based on name alone | Inventory live callers, policies, and trusted operations before classification. |

**Do not use a single blanket REVOKE script.** Apply a table-by-table migration only after confirming PostgREST exposure, role inheritance, views, RPCs, triggers, Edge Function service-role usage, deployed frontend commit, and exact rollout order.

## 4. Role and transaction boundaries to verify

1. `series` and `chapters` are core reader paths. Retain SELECT policies and grants for published content.
2. Internal workflow/control tables are not in the reviewed reader-page call paths. Admin/Chief Editor pages call `chief-editor-monitor`, `autonomous-series-creation`, and `aevora-operations-snapshot`; those deployed implementations lack matching source in the reviewed branch and need fingerprints plus server-side role checks.
3. Scheduler, publisher, series runner, and publication triggers require trusted server operations. Branch scheduler deliberately blocks auto-publication until a real authorization/commit boundary exists; preserve this fail-closed behavior.
4. The chapter status trigger inserts a minimal publication-sync outbox event transactionally with the chapter status transition, but this alone does not prove the whole publication workflow is atomic or authorized.
5. `reader_events` direct insert remains active in branch source because `window.taleForgeReaderEventIntakeEnabled = false`. The tested `reader-event-intake` handler is not proof the deployed endpoint is enabled or that the live frontend uses it.

## 5. Default privileges: separate unresolved owner-level task

The live default-ACL inventory showed broad future table grants for `anon` and `authenticated`, sequence grants for both roles, and function EXECUTE grants for both roles for objects created by each of `postgres` and `supabase_admin`. No global default-ACL rows were returned.

- Prepare reviewed default-privilege corrections separately for each object owner.
- The `supabase_admin` owner-level change may require owner membership or authorized execution as that role. Do not bypass role membership or assume a `postgres`-owned default-privilege statement affects `supabase_admin` objects.
- Review existing functions separately: default ACLs affect future objects and do not retroactively repair existing routine EXECUTE ACLs.
- Verify grants on sequences, functions, schemas, views and materialized views as well as tables.
- Re-run catalog evidence after an approved change; do not treat an RLS-enabled table with no policy as adequately secured if direct grants remain unnecessarily broad.

## 6. Rollout acceptance checklist

- [ ] Confirm deployed browser assets match the reviewed branch.
- [ ] Inventory every live relation, view, materialized view, RPC and exposed schema used by browser and server callers.
- [ ] Confirm exact RLS policy expressions and effective privileges for both client roles.
- [ ] Confirm server-side authorization for admin/Chief Editor operations independently of UI role checks.
- [ ] Decide and test whether optional trending/intelligence remains gated.
- [ ] Validate reader-event endpoint availability, payload constraints, rate limits, idempotency, CORS, quota behavior and feature-flag transition before removing direct INSERT.
- [ ] Review all trusted service-role and trigger operations plus transaction/rollback behavior.
- [ ] Prepare owner-specific existing-grant and default-privilege migrations, including `supabase_admin`, with explicit rollback.
- [ ] Run disposable PostgreSQL regression/rehearsal tests and approved Edge Runtime validation.
- [ ] Obtain explicit production rollout approval; verify post-change catalog and user-facing reader paths.

## 7. Gate and baseline

Production remains **NO-GO** for automatic publication and unreviewed permission migrations. Provider-state migration provenance, atomic cooldown recording, full publication authorization/transaction boundary, deployed function drift, legacy schedule dispositions, runtime validation and rollback approval remain open.

Latest confirmed green CI baseline in the current ledger: run [38895944662](https://github.com/freearmy599/taleforge/actions/runs/38895944662). It validates only its named branch/disposable-test scope; later documentation commits are not themselves runtime or production evidence.

**No production permissions were changed by this audit.**
