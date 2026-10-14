# Aevora Phase 1 — Client-Granted, RLS-Enabled Tables: Triage Matrix
Date: 2026-10-14
Status: read-only production metadata review; branch-only triage. No production changes.

## Scope and interpretation

This note supplements `PHASE1-SERVER-ONLY-ACCESS-TRIAGE-20261014.md`. It inventories metadata only: relation name/type, RLS enabled state, policy count, and whether `PUBLIC`, `anon`, or `authenticated` has table-level privileges. It does not read table rows or prove a request can reach a relation through PostgREST. Verify the actual Data API exposed schemas separately.

**RLS enabled + no policies ordinarily denies row access, but broad table grants remain an unnecessary-privilege problem.** Do not call every such table an exposure. Conversely, do not assume the app is functioning correctly just because RLS denies access: user-facing features can silently fail when their tables have no intended policies.

## Snapshot count

The latest targeted read-only query returned **39 base tables** with RLS enabled, zero policies, and table-level grants to `anon` and/or `authenticated`. The triage below separates **11 reader-facing candidates** from **28 internal/control-plane candidates** by apparent purpose; this is a working classification based on names and known architecture, not a substitute for tracing app usage. The prepared server-only migration set targets the 28 internal candidates and deliberately does not revoke the 11 reader-facing candidates until their intended behavior is confirmed.

## Priority classifications

### A. User-facing candidates requiring product-flow and ownership review

The live metadata query found these names with RLS enabled, zero policies, and grants to `anon` and/or `authenticated`:

- Reader interaction: `bookmarks`, `comments`, `likes`, `ratings`, `reading_history`, `collections`, `collection_stories`, `profiles`, `notifications`, `story_reports`
- Recommendation/user experience: `recommendations`

These names suggest user-facing behavior, but the names alone do not establish current app usage or intended anonymous behavior. For each, inspect client call sites and product requirements, then define owner-scoped RLS policies (and narrow grants) only for intended operations. Do not add a blanket policy. For example, private reading history and bookmarks should be scoped to their owner; public comments/ratings need explicit published-content checks, moderation rules, and appropriate insert/update/delete ownership controls.

### B. Internal control-plane, generation, review, and scheduling tables

The same metadata pattern also appears on internal-looking relations, including:

- `automation_config`, `generation_jobs`, `generation_settings`
- `chapter_blueprints`, `chapter_generation_outputs`, `chapter_publication_reviews`, `chapter_reviews`, `story_blueprints`, `story_versions`
- `publication_sync_outbox`, `story_attachment_metrics`, `release_schedules`
- `taleforge_ai_provider_state`, `taleforge_ceo_daily_operations`, `taleforge_ceo_incidents`, `taleforge_ceo_repair_plans`, `taleforge_continuity_extraction_queue`, `taleforge_executive_reports`, `taleforge_generation_context_snapshots`, `taleforge_hybrid_story_engine_runs`, `taleforge_inversion_evaluations`, `taleforge_narrative_profile_selections`, `taleforge_novelty_signatures`, `taleforge_story_concept_design_runs`, `taleforge_story_opportunity_runs`, `taleforge_system_governance_dependencies`, `taleforge_system_governance_registry`, `taleforge_system_governance_runs`

This is a triage list, not a complete inventory or an assertion that all names are confirmed in-scope for revocation. Compare against current migration sources, triggers, RPCs, Edge Function use, and actual table owners. The two existing branch migrations cover the explicitly identified server-only telemetry/outbox tables and a selected set of internal tables; they are not yet present in live migration history per the preceding audit. Do not deploy them until compatibility and migration drift are reviewed and owner approval is given.

### C. RLS enabled, no policies, but no client table grants observed

A further group of internal relations had no table-level grants to `PUBLIC`, `anon`, or `authenticated` in the targeted metadata result. Keep them in the inventory, but avoid unnecessary DDL; validate inherited/schema/function paths and the actual exposed-schema configuration before drawing conclusions.

## Privilege severity clarification

The metadata query showed the same broad table-level privilege set on the client-granted, RLS-enabled/no-policy base tables: `DELETE`, `INSERT`, `REFERENCES`, `SELECT`, `TRIGGER`, `TRUNCATE`, and `UPDATE` for both `anon` and `authenticated`. RLS does not filter `TRUNCATE` or table-level `REFERENCES`/trigger privileges. That does **not** prove an anonymous REST request can invoke each operation: PostgREST exposure and API operation support are separate gates, and no live write/probe was performed. Still, this is a strong least-privilege finding for the internal tables. The prepared branch migrations now revoke relation-level and column-level privileges from `PUBLIC`, `anon`, and `authenticated` for the server-only target lists; they have not been applied to production.

The schema-specific default ACL inventory also showed `MAINTAIN` alongside ordinary table privileges for future objects granted to `anon` and `authenticated`, under both `postgres` and `supabase_admin` default-ACL owners. Duplicate-looking rows represent distinct owner-scoped default ACL entries. This is a future-object template, not proof that every existing table has `MAINTAIN`; the repeatable audit now reports the ACL owner to make that distinction clear. Global/default-privilege changes remain a separate reviewed decision because they can affect future object behavior.

## Compatibility gate: public system-health status view

The prepared narrative-internals migration drops public read policies on `taleforge_system_health` and `taleforge_system_registry` and revokes client table privileges. The existing `taleforge_system_health_snapshot` is a `security_invoker=true` view over internal health state; it therefore may become unavailable to anonymous/authenticated callers when that migration is applied. That is safer than exposing unrestricted `blocking_reason` and JSONB `evidence`, but could break an intentional public status panel. Do not apply this migration until the intended audience is confirmed. If a public status panel is required, design and test a separate minimal allowlisted projection (only safe status fields, no diagnostic evidence) with explicit view security and grants; do not simply restore broad access to the underlying health table.

## Correction: explicit column grants not confirmed

The earlier `information_schema.role_column_grants` result was initially interpreted as evidence of independent column grants. A full public-schema catalog check of `pg_attribute.attacl` found **zero explicit column ACL entries** for `PUBLIC`, `anon`, or `authenticated` across public tables, partitioned tables, views, and materialized views. In this project, the information-schema results reflect effective privileges from relation-level grants; they do not establish separately stored column ACLs.

The confirmed finding is broad **relation-level** grants plus schema-specific default ACLs for future objects. The prepared migrations retain column-level `REVOKE ALL PRIVILEGES` statements as defensive cleanup; these are harmless when no explicit column ACL exists. No production change was made. The repeatable audit SQL has been corrected to inspect `pg_attribute.attacl` directly.

## Public-policy predicate cross-check

A separate metadata-only scan found 16 unrestricted client-facing `SELECT` policy rows across 15 tables where the policy predicate is literally `true`. Thirteen of those tables are internal narrative/continuity/system state covered by the prepared narrative-internals migration; `genres` and `tags` are the two remaining tables and appear to be intended public catalogs, subject to normal product confirmation. The same scan found **no** client-facing `INSERT`, `UPDATE`, or `ALL` policy with a literal `true` check/using predicate. This is a narrow predicate check, not proof that all nontrivial policies are correct or that the Data API exposes these relations.

## Safe remediation workflow

1. Trace application usage for each user-facing candidate before designing policies.
2. Mark each relation as public-read, anonymous-write with validation, authenticated owner-scoped, trusted-server-only, or unused/deprecated.
3. For trusted-server-only relations, revoke unnecessary client privileges while preserving service-role, owner, trigger, and scheduled-function behavior. Check table-level and column-level grants, sequences, functions, and default privileges.
4. For reader-facing relations, add only narrowly scoped policies and tests for anonymous, user A, user B, and trusted server access. Include negative cross-owner cases.
5. Add migration contract tests for the intended grant/policy matrix; do not treat the Supabase advisor's no-policy count as a vulnerability count.
6. Re-run the metadata-only inventory using [`phase1-readonly-access-audit.sql`](./phase1-readonly-access-audit.sql); it covers relation grants, explicit per-column ACLs, default ACLs for future objects, and client-executable public functions without reading application rows.
7. Verify Data API exposed schemas in Dashboard/API configuration. Do not run live probes or synthetic writes as part of this read-only phase.
8. Run CI against the branch. Production migration, GRANT/REVOKE, policy/view changes, queue/schedule edits, generation, and publication remain outside this task without explicit approval.

## Phase 1 exit conditions added

- Every client-granted, RLS-enabled/no-policy table has an explicit intended access classification.
- User-facing candidates have tested ownership/publication policies, or are documented as unused and removed from client call sites.
- Server-only candidates have least-privilege client grants, validated against live role behavior before deployment.
- Public status projections expose only deliberately allowlisted fields; `blocking_reason` and JSONB `evidence` require explicit audience review.
- SQL cron dispatch, HTTP response, Edge Function result, and durable business postcondition are correlated without persisting credentials, prompts, or story content.


## Confirmed reader-feature tables still need policy design

A fresh read-only metadata query confirmed that all 11 reader-feature candidates below currently have RLS enabled, zero policies, and broad table-level grants to both `anon` and `authenticated`:

- `bookmarks`
- `collection_stories`
- `collections`
- `comments`
- `likes`
- `notifications`
- `profiles`
- `ratings`
- `reading_history`
- `recommendations`
- `story_reports`

A static call-site scan of the current branch found no direct Supabase `.from(...)` or `.rpc(...)` calls targeting these 11 table names in the 15 top-level browser HTML/JS files or the 28 Edge Function TypeScript sources. The current `reading-progress.js` instead stores follows, bookmarks, and reading history in browser-local storage. This is evidence that the tables may be legacy or not wired into the current UI, **not** proof they are safe to drop: catalog metadata still shows foreign keys on all 11 tables and timestamp triggers on `collections`, `comments`, `profiles`, and `ratings`. A broader migration/RPC/deployment dependency review is still required before classifying any as unused.
 
The read-only routine-definition scan found one stored `SECURITY DEFINER` verifier, `taleforge_verify_reader_progress()`, that reads `reading_history`; other name matches were not direct table reads/writes under the catalog query. The proposed migration leaves all tables, triggers, foreign keys, and routines in place and revokes only direct client table privileges, so this stored verifier remains a dependency to preserve and regression-test.
 
The relation ACL catalog also shows explicit `service_role` table privileges on all 11, separate from the client-role entries. The prepared lock migration revokes only `PUBLIC`, `anon`, and `authenticated`; it does not revoke the trusted `service_role` grants.
 
For these tables, no-policy RLS ordinarily denies row operations, so this is not evidence that reader data is currently exposed. However, the granted privilege set also includes `TRUNCATE`, `TRIGGER`, and `REFERENCES`, which are not normal reader-client needs and are not constrained by row policies in the same way as SELECT/INSERT/UPDATE/DELETE. A branch-only migration, `supabase/migrations/20261014100000_lock_unwired_reader_feature_tables.sql`, now enables RLS and revokes relation-level and explicit column-level client privileges on these 11 tables without adding policies or deleting tables/data. This is a conservative containment proposal based on the call-site scan; it remains subject to checking migration/RPC/trigger dependencies and any separately deployed clients. It has not been applied to production. If these features are wired later, add a specific access contract and owner-isolation tests before granting any access.


## Current frontend call-site check: local reader features, not account-backed tables

A source review of `reading-progress.js`, `library.html`, `notifications.html`, and `taleforge-data.js` found that the current reader-facing library stores follows, bookmarks, reading progress, and history in browser `localStorage`. The updates page explicitly states that account-backed notifications are not yet implemented; it reads published chapters and derives followed stories from local state. The shared data layer reads published `series` and `chapters` plus the discovery views, and the reader event tracker writes to `reader_events`. Repository code search did not identify calls to the `bookmarks`, `comments`, `likes`, `ratings`, `reading_history`, `collections`, `collection_stories`, `profiles`, `notifications`, `story_reports`, or `recommendations` tables.

This suggests these eleven relations may be legacy/future-schema tables rather than live APIs in the current static frontend. Treat that as a **call-site finding, not final proof of unused status**: verify all Edge Functions, RPCs, triggers, scheduled jobs, and any separately deployed client before marking each table unused. The branch-only migration removes direct client privileges as a reversible least-privilege containment step while retaining tables, foreign keys, triggers, and existing data. Before production rollout, validate those dependencies and ensure any future reader features introduce narrowly scoped policies/grants instead of restoring broad client access.


## Additional read-only findings — reader-event intake and status view

A metadata-only recheck confirmed that `public.reader_events` has an INSERT-only RLS policy for `anon` and `authenticated`, but the relation grants those roles the broader table privilege set, including SELECT, UPDATE, DELETE, TRUNCATE, TRIGGER, and REFERENCES. RLS governs row operations but does not replace least-privilege table grants. The branch-only migration `20261014150000_reader_events_insert_only.sql` now revokes all direct privileges from `PUBLIC`, `anon`, and `authenticated`, clears any explicit column ACLs defensively, and restores only table-level INSERT for the two client roles. It leaves the existing INSERT policy and all trusted `service_role` grants intact. This migration has not been applied to production.

The public identity sequences `aevora_engineering_events_id_seq` and `reader_events_id_seq` are owned by `postgres` and are attached to columns marked as identity columns. Their direct client sequence privileges are unnecessary for ordinary identity inserts. A separate branch-only migration revokes those direct sequence privileges from client roles while preserving trusted `service_role` access.

The `taleforge_system_health_snapshot` view's schema includes `blocking_reason` and JSONB `evidence`, which may contain internal operational diagnostics. The branch narrative-internals migration now also revokes direct client privileges on this view, pending a decision about whether a public status panel is required. If one is required, create a separate allowlisted projection that excludes diagnostic evidence and test it explicitly; do not restore direct access to the internal health tables or this diagnostic-bearing view.

## Additional policy review: status-gated internal-looking tables

A broader read-only policy inventory found additional client-role SELECT policies on internal-looking tables whose predicates restrict rows to statuses such as `published` or `active`. Examples include chapter continuity/quality checks, chapter continuity snapshots, story ending reviews, story continuity state, story identity/lifecycle, narrative memory consolidation, advanced chapter plans, and quality alerts. These are **not** equivalent to the unconditional-`true` policies addressed by the narrative-internals migration, and their predicates alone do not prove either exposure or safety.

Before Phase 1 sign-off, classify each table's columns and current client call sites. Published-status gating may be appropriate for worldbuilding data intentionally shown to readers, but internal review scores, continuity diagnostics, memory snapshots, and quality alerts may need a separate public projection or no direct client access. No row contents were queried. Do not revoke these policies in bulk; preserve intended worldbuilding/discovery features and remove only fields that are not part of the reader-facing contract.

## Public content/catalog table-level privileges

A static scan of the current browser HTML/JS found direct Supabase table calls only to `series`, `chapters`, `stories`, `story_intelligence`, `story_trending_scores`, and INSERTs to `reader_events`; no browser `.rpc()` calls were found. The live policies for `series`, `chapters`, and `stories` are SELECT-only and status-gated; `genres`, `tags`, and `story_tags` also have SELECT-only policies. The prepared `20261014160000_limit_public_content_tables_to_select.sql` revokes broad table and per-column privileges from `PUBLIC`, `anon`, and `authenticated` on those six base tables, then grants SELECT only. It preserves service-role grants and existing RLS policy behavior. This remains branch-only.
