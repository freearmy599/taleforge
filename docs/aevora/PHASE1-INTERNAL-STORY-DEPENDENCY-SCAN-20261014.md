# Aevora Phase 1 — Internal story-design read-surface dependency scan
Date: 2026-10-14

Status: read-only production catalog inspection. No production DDL, data, grants, policies, Edge Functions, or schedules were changed.

## Scope

This pass checks the 41 relations listed in `20261014190000_lock_internal_story_design_read_surfaces.sql` against catalog-tracked view dependencies and textual references in public-schema function bodies. It is a preliminary dependency scan, not a complete proof that the read-lock candidate is rollout-safe.

## Findings

- Catalog dependency lookup found no views/materialized views that directly depend on the 41 relations.
- A text scan of public-schema function source found many references to these relations in the autonomous story-design, genre/narrative intelligence, chapter-planning, and verification pipelines.
- Every matched function in the scan was marked `SECURITY DEFINER`; the effective privilege check returned `anon EXECUTE = false`, `authenticated EXECUTE = false`, and `service_role EXECUTE = true` for each matched function. This supports the design that these tables are consumed by trusted server-side workers, not direct client RPC calls.
- Examples of matched worker functions include `taleforge_autonomous_create_series`, `taleforge_design_story_concept`, `taleforge_design_concept_arcs`, `taleforge_design_concept_world`, `taleforge_build_generation_context`, `taleforge_build_advanced_chapter_plans`, and `taleforge_resolve_narrative_grammar`.
- The scan does not detect all dynamic SQL, external Edge Function queries, trigger behavior, or dependencies in other schemas. A substring match may also be a false positive if a table name occurs in comments or unrelated literals.

## Decision

This evidence is **supportive but not sufficient** to approve the read-lock candidate. The matched functions are service-role-only at the database EXECUTE boundary, but the remaining checks must cover:
1. Trigger functions and trigger timing on public/reader-facing tables that may indirectly call into the story-design pipeline.
2. All repository Edge Function source and scheduled SQL references, including dynamic query builders.
3. Whether any intentional product feature depends on direct client reads of genre taxonomy, trope library, or profile tables.
4. A disposable-database integration test confirming service-role worker functions still operate after client grants and client SELECT policies are removed.

The candidate remains branch-only and Phase 1 remains open. No production migration was run.


## Repository Edge Function direct-reference follow-up (read-only, 2026-10-14)

A source scan of the branch's 28 Edge Function/shared TypeScript files looked for literal references to the 41 relations. The only direct literal relation hit was `taleforge_advanced_chapter_plans` in `supabase/functions/revise-chapter/index.ts`. That worker initializes its Supabase client with `SUPABASE_SERVICE_ROLE_KEY` (or the legacy service-role secret) and validates the trusted internal API key before work; the proposed migrations revoke privileges only from `PUBLIC`, `anon`, and `authenticated`, preserving service-role access. No Edge Function source contained a literal `reader_events` reference in this scan.

This narrows the direct client-source dependency risk, but does not close the rollout gate: string-built table names, SQL in migrations/cron, database triggers, dynamic SQL, external clients, and intentional client access to taxonomy/profile data still require review. The scan is source-level and does not prove runtime compatibility after revokes. The candidate remains branch-only.


## Trigger and dynamic-SQL follow-up (read-only, 2026-10-14)

- A catalog scan of non-internal triggers found no trigger function whose source text directly references any of the 41 candidate relations.
- A line-oriented scan of public-schema SECURITY DEFINER function bodies found no standalone PL/pgSQL `EXECUTE` or `RETURN QUERY EXECUTE` statements in the scanned functions. This reduces the risk of table names being assembled through obvious dynamic SQL, but does not prove absence of indirect/dynamic access outside public-schema function bodies.
- Effective schema privilege checks report `CREATE = false` for both `anon` and `authenticated` on `public`; this limits client ability to create shadow objects in that schema. The check does not replace the recommendation to keep trusted schemas first and `pg_temp` last in SECURITY DEFINER search paths.

The dependency scan remains supportive, not a complete disposable-database compatibility test. No production changes were made.


## Exact live function/trigger recheck (read-only, 2026-10-14)

A fresh catalog scan of all public-schema function bodies against the exact 41-relation list returned 53 matched function overloads. All 53 are `SECURITY DEFINER`, owned by `postgres`; effective EXECUTE checks returned zero for `anon`, zero for `authenticated`, and 53 for `service_role`. None of the 53 functions is currently attached as a non-internal trigger function. The catalog scan also found no dependent public views/materialized views in the earlier dependency check.

This materially reduces the direct-trigger and client-RPC compatibility risks for removing ordinary-client access to these tables. It does not eliminate risks from other schemas, cron SQL, dynamically constructed relation names, direct external clients, or application features not represented in this repository. SECURITY DEFINER does not by itself make a function safe; owners, search paths, dynamic SQL, data returned, and service-role caller behavior remain in the broader Phase 1 function review.

**Disposition:** the read-lock migration has stronger supporting dependency evidence, but it is still not approved for production. A disposable-database replay with representative service-role worker calls and client-role denial tests remains a required gate.


## SECURITY DEFINER search-path nuance (read-only, 2026-10-14)

Among the 53 functions matched to the 41 internal relations, 11 use `search_path=public`; a focused body scan found no standalone dynamic `EXECUTE`, `RETURN QUERY EXECUTE`, or `format(...)` call in those matched functions. Effective schema checks also show `CREATE = false` for both `anon` and `authenticated` on `public`. These facts reduce common object-shadowing and dynamic-SQL concerns, but the current function search paths remain a hardening opportunity: before modifying these established worker functions, inspect all unqualified relation/type/function references and dependency behavior, then test any fixed-path replacement in isolation. Do not apply a blanket function rewrite during the table-lock rollout.


## Broader public SECURITY DEFINER inventory checkpoint (read-only, 2026-10-14)

A fresh catalog aggregate across the full `public` schema returned 134 SECURITY DEFINER overloads:

- 69 have a configured `search_path` mentioning `public`.
- 14 have a configured `search_path` mentioning `pg_temp` (overlapping the preceding group is possible).
- 65 use an explicitly empty configured search path (`search_path=""`).
- Zero were effectively executable by `anon` or `authenticated` in this catalog snapshot.
- An initial broad text filter marked two bodies as possible dynamic-SQL matches, but follow-up inspection showed the matches were lexical false positives (function-name/ordinary `format(...)` use); the focused scan found no standalone PL/pgSQL `EXECUTE` statement or `RETURN QUERY EXECUTE` in the public-schema SECURITY DEFINER bodies checked.

This is inventory evidence, not a certification that all 134 functions are safe. An empty search path is often a useful hardening posture only when relation/type/function references are correctly schema-qualified; paths mentioning `public` or `pg_temp` require function-specific review. Continue in risk order: inspect bodies with `public`/temporary schemas in their path, confirm all object references and caller-role checks, review return data and side effects, and test changes in an isolated database. Do not change function definitions or ACLs wholesale based on this aggregate.

No function was invoked and no production data, schema, or permissions were changed.


## Trigger-driven side-effect audit checkpoint (read-only, 2026-10-14)

A fresh catalog inspection enumerated enabled, non-internal triggers whose functions are SECURITY DEFINER and whose configured search path includes `public` or an internal schema. The relevant functions are owned by `postgres`; ordinary client roles cannot execute these trigger functions directly, but trigger side effects still occur as part of the triggering table write.

### Release-critical finding: series status changes activate release automation

The live `trg_enroll_series_in_production` trigger fires after INSERT or UPDATE OF `status` on `public.series`. Its SECURITY DEFINER function `public.taleforge_enroll_series_in_production()`:

- Creates a `story_lifecycle` row if one does not exist.
- Creates a `release_schedules` row if missing.
- When `NEW.status = 'ongoing'`, enables the schedule and sets both `auto_generate = true` and `auto_publish = true`.
- When the status becomes `completed`, `hiatus`, or `cancelled`, disables schedule automation.

This is a consequential implicit side effect: changing a series to `ongoing` is not merely a content-status change; it can turn on automatic generation and publication. Any autonomous runner or publisher repair must therefore treat the series status update and the trigger-created/enabled schedule as one release-critical operation. Tests must assert the expected schedule state for every status transition and prove a failed creation/review/activation path cannot leave an unintended enabled auto-publish schedule. Do not assume a handler's later schedule write is the only schedule mutation.

### Other trigger observations

- `chapters_publication_sync_outbox` enqueues one `post_publication_canon_sync` event for published chapter inserts/status updates, with conflict suppression on `(chapter_id,event_type)`.
- `trg_taleforge_enqueue_continuity` queues continuity extraction when a chapter becomes published.
- `trg_taleforge_refresh_long_term_architecture` invokes long-term narrative architecture refresh after a chapter becomes published.
- Quality/continuity gate triggers on generation outputs and publication reviews write review/check rows or downgrade an approval when the minimum quality/continuity checks are missing or failing.

These triggers use schema-qualified table references in the inspected definitions. That reduces dependence on name resolution, but is not a substitute for testing trigger behavior and transactional rollback in isolation. The catalog inspection did not execute any trigger or modify a row.

### Required isolated tests

1. Insert a draft series: lifecycle/schedule defaults must be correct and automation must remain disabled.
2. Transition draft → ongoing: verify whether enabling both auto-generation and auto-publication is explicitly intended and approved by the release policy.
3. Simulate a runner failure after status update but before follow-up bookkeeping: confirm the transaction boundary prevents a partially activated series or document the recovery invariant.
4. Transition ongoing → hiatus/completed/cancelled: verify schedule, generation, and publication flags are disabled atomically.
5. Ensure client roles cannot directly invoke trigger functions or mutate protected schedule rows outside approved paths.
6. Verify publication gate/outbox/continuity triggers are idempotent across repeated status updates and rollback correctly if downstream writes fail.

**Disposition:** the automatic `auto_publish = true` transition is a release gate requiring explicit policy confirmation and isolated regression coverage. No production changes were made.
