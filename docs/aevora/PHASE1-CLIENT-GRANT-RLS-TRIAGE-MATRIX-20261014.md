# Aevora Phase 1 — Client-Granted, RLS-Enabled Tables: Triage Matrix
Date: 2026-10-14
Status: read-only production metadata review; branch-only triage. No production changes.

## Scope and interpretation

This note supplements `PHASE1-SERVER-ONLY-ACCESS-TRIAGE-20261014.md`. It inventories metadata only: relation name/type, RLS enabled state, policy count, and whether `PUBLIC`, `anon`, or `authenticated` has table-level privileges. It does not read table rows or prove a request can reach a relation through PostgREST. Verify the actual Data API exposed schemas separately.

**RLS enabled + no policies ordinarily denies row access, but broad table grants remain an unnecessary-privilege problem.** Do not call every such table an exposure. Conversely, do not assume the app is functioning correctly just because RLS denies access: user-facing features can silently fail when their tables have no intended policies.

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

## Compatibility gate: public system-health status view

The prepared narrative-internals migration drops public read policies on `taleforge_system_health` and `taleforge_system_registry` and revokes client table privileges. The existing `taleforge_system_health_snapshot` is a `security_invoker=true` view over internal health state; it therefore may become unavailable to anonymous/authenticated callers when that migration is applied. That is safer than exposing unrestricted `blocking_reason` and JSONB `evidence`, but could break an intentional public status panel. Do not apply this migration until the intended audience is confirmed. If a public status panel is required, design and test a separate minimal allowlisted projection (only safe status fields, no diagnostic evidence) with explicit view security and grants; do not simply restore broad access to the underlying health table.

## Additional finding: per-column grants

A follow-up metadata-only query confirmed separate column-level grants on `publication_sync_outbox`, `story_attachment_metrics`, and `release_schedules` for both `anon` and `authenticated` (SELECT, INSERT, UPDATE, and REFERENCES on multiple columns). Similar grants were also observed on internal tables including `generation_jobs`, `automation_config`, and `taleforge_ai_provider_state`. The original branch migrations revoked relation-level grants but did not explicitly revoke separately granted column privileges. Those two branch migrations have now been updated to revoke both relation-level and all existing per-column privileges for their server-only target tables. This is a source change only; it has not been applied to production. Because the existing migration versions are absent from live migration history, the updated migration source can address the drift when an approved migration is eventually applied. If either original migration is applied before this corrected source is used, a new follow-up migration would be required to clear residual column grants.

The live query was metadata-only and returned aggregate counts, not column names or row payloads. Keep the client-facing table candidates separate from this internal-table fix: do not revoke user-facing tables until intended access behavior and app usage are confirmed.

## Safe remediation workflow

1. Trace application usage for each user-facing candidate before designing policies.
2. Mark each relation as public-read, anonymous-write with validation, authenticated owner-scoped, trusted-server-only, or unused/deprecated.
3. For trusted-server-only relations, revoke unnecessary client privileges while preserving service-role, owner, trigger, and scheduled-function behavior. Check table-level and column-level grants, sequences, functions, and default privileges.
4. For reader-facing relations, add only narrowly scoped policies and tests for anonymous, user A, user B, and trusted server access. Include negative cross-owner cases.
5. Add migration contract tests for the intended grant/policy matrix; do not treat the Supabase advisor's no-policy count as a vulnerability count.
6. Verify Data API exposed schemas in Dashboard/API configuration. Do not run live probes or synthetic writes as part of this read-only phase.
7. Run CI against the branch. Production migration, GRANT/REVOKE, policy/view changes, queue/schedule edits, generation, and publication remain outside this task without explicit approval.

## Phase 1 exit conditions added

- Every client-granted, RLS-enabled/no-policy table has an explicit intended access classification.
- User-facing candidates have tested ownership/publication policies, or are documented as unused and removed from client call sites.
- Server-only candidates have least-privilege client grants, validated against live role behavior before deployment.
- Public status projections expose only deliberately allowlisted fields; `blocking_reason` and JSONB `evidence` require explicit audience review.
- SQL cron dispatch, HTTP response, Edge Function result, and durable business postcondition are correlated without persisting credentials, prompts, or story content.
