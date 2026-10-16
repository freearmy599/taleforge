# Aevora Phase 1 — complete policyless-table classification (read-only)
Date: 2026-10-16
Branch: aevora/release-scheduler-hardening
Connected project: sxmbnlgufqhcwxcpcsvb
Scope: public ordinary/partitioned tables with RLS enabled and zero policies

## Evidence and current state

A fresh read-only catalog query returned exactly **91 public tables with RLS enabled and zero policies**:
- **39/91** have client relation-level grants and/or column grants; all 39 also have relation-level client TRUNCATE in the current catalog.
- **52/91** have no effective anon/authenticated relation privileges and no client column grants in this query.
- The 39 broad-grant relations have the same effective relation-level SELECT/INSERT/UPDATE/DELETE/TRUNCATE flags for both anon and authenticated. Because these tables have no RLS policies, normal row operations are denied by RLS; TRUNCATE is not governed by row policies and remains a material least-privilege concern.
- These are live catalog observations, not evidence that every action is reachable through the Data API. Do not equate a grant with a successful PostgREST request.
- Table ownership was postgres for all rows inspected. RLS was enabled and not forced for these rows.

This document classifies the **intended access model provisionally from table names, existing branch migration allowlists, and product semantics**. It does not certify client workflows. Confirm actual application and Edge Function call sites before making any CRUD/policy changes.

## A. Policyless tables with client grants: server-only candidate (28)

These names describe automation, generated content, moderation/review, scheduling, internal state, telemetry, or governance. Recommended target: server-only; no anon/authenticated policies; remove relation-level and column-level client privileges; preserve trusted service access only where required.

| Table | Provisional classification | Rationale / next check |
|---|---|---|
| automation_config | Server-only | Automation control/config; inspect all callers before lock migration |
| chapter_blueprints | Server-only | Planning artifacts; check generation orchestrator and planner service-role usage |
| chapter_generation_outputs | Server-only | Generation output staging |
| chapter_publication_reviews | Server-only | Publication gate/review state |
| chapter_reviews | Server-only | Automated quality/review records; verify no editor UI direct CRUD |
| generation_jobs | Server-only | Queue/job state; generation worker callers |
| generation_settings | Server-only | Runtime configuration; verify no settings UI writes directly |
| publication_sync_outbox | Server-only | Transactional publication sync queue |
| release_schedules | Server-only | Publishing scheduler state; use guarded RPC/worker only |
| story_attachment_metrics | Server-only | Internal telemetry |
| story_blueprints | Server-only | Series planning/blueprint state |
| story_versions | Server-only | Internal version/rollback ledger; confirm editor access pattern |
| taleforge_ai_provider_state | Server-only | Provider quota/cooldown diagnostics |
| taleforge_ceo_daily_operations | Server-only | Agent operations state |
| taleforge_ceo_incidents | Server-only | Internal incident records |
| taleforge_ceo_repair_plans | Server-only | Internal repair workflow |
| taleforge_continuity_extraction_queue | Server-only | Background processing queue |
| taleforge_executive_reports | Server-only | Internal agent reports |
| taleforge_generation_context_snapshots | Server-only | Generation context snapshots |
| taleforge_hybrid_story_engine_runs | Server-only | Internal planning run records |
| taleforge_inversion_evaluations | Server-only | Internal originality/inversion evaluation |
| taleforge_narrative_profile_selections | Server-only pending caller proof | Internal selection output; verify if any author-facing UI reads it |
| taleforge_novelty_signatures | Server-only | Originality/reuse signals |
| taleforge_story_concept_design_runs | Server-only | Internal design pipeline run history |
| taleforge_story_opportunity_runs | Server-only | Internal discovery/selection pipeline run history |
| taleforge_system_governance_dependencies | Server-only | Internal governance graph |
| taleforge_system_governance_registry | Server-only | Internal system registry |
| taleforge_system_governance_runs | Server-only | Internal governance execution history |


## B. Policyless tables with client grants: product-facing or ambiguous (11)

Do **not** apply the internal-table blanket revoke to these without checking app routes, auth ownership columns, and desired public behavior. Their current no-policy state means RLS blocks normal client row access despite grants, so they are likely broken or intentionally reserved for server-mediated workflows.

| Table | Provisional intended model | Required verification before any policy/CRUD change |
|---|---|---|
| bookmarks | Authenticated owner-scoped CRUD | Confirm user_id/owner column and client data access path |
| collection_stories | Owner-scoped association CRUD | Confirm collection ownership joins prevent cross-user access |
| collections | Owner-scoped CRUD; possibly public curated collections | Confirm ownership and public/private distinction |
| comments | Authenticated create; controlled public read; owner/moderator update/delete | Verify moderation, visibility, and author identity rules |
| likes | Authenticated owner-scoped insert/delete; aggregate read as intended | Confirm uniqueness and owner identity |
| notifications | Authenticated owner-scoped read/update | Confirm recipient ownership and service-side inserts |
| profiles | Authenticated owner-scoped update; safe public profile read | Confirm private columns and public profile projection |
| ratings | Authenticated owner-scoped create/update; public aggregate/read as intended | Confirm ownership and rating visibility |
| reading_history | Authenticated owner-scoped CRUD | Confirm user_id ownership and retention rules |
| story_reports | User report submission + restricted moderation/read | Confirm report intake, confidentiality, and moderator workflow |
| recommendations | Ambiguous; likely server-generated / per-user read surface | Confirm whether the table is user-visible or entirely internal before classification |

The count of 11 product-facing/ambiguous rows above plus the 28 server-only candidates equals the 39 policyless relations with client grants. Classification is intentionally provisional.

## C. Policyless tables with no effective client grants: 52

These are already inaccessible to anon/authenticated by the inspected relation/column ACL checks. Keep them server-only unless a specific product workflow proves a need for a client API. Do not add policies merely to remove the “zero policies” finding.

- aevora_cover_jobs
- aevora_engineering_decisions
- aevora_engineering_events
- aevora_engineering_tasks
- aevora_issue_registry
- aevora_release_scheduler_leases
- aevora_repair_policies
- aevora_repair_runs
- aevora_repair_verification_audit
- taleforge_autonomous_creation_orchestrator_runs
- taleforge_autonomous_creation_policy
- taleforge_autonomous_series_creation_runs
- taleforge_autonomous_series_expansion_runs
- taleforge_autonomous_story_selection_runs
- taleforge_catalog_balance_intelligence
- taleforge_ceo_profile
- taleforge_ceo_root_cause_analyses
- taleforge_ceo_supervision_snapshots
- taleforge_chapter_strategy_directives
- taleforge_chapter_value_architecture
- taleforge_consequence_architecture
- taleforge_cross_series_pattern_intelligence
- taleforge_discovery_intelligence
- taleforge_faction_agency_architecture
- taleforge_long_term_narrative_architecture
- taleforge_multidimensional_quality_gates
- taleforge_mystery_graph
- taleforge_narrative_compliance_reports
- taleforge_narrative_simulation_gates
- taleforge_nested_arc_architecture
- taleforge_opportunity_intelligence_feedback
- taleforge_pacing_intelligence
- taleforge_payoff_ledger
- taleforge_personalization_learning_runs
- taleforge_platform_intelligence
- taleforge_platform_strategy_runs
- taleforge_power_progression_architecture
- taleforge_reader_behavior_events
- taleforge_reader_feedback_signals
- taleforge_reader_personalization_profiles
- taleforge_recommendation_candidate_sets
- taleforge_revision_regression_checks
- taleforge_revision_selections
- taleforge_serialization_intelligence
- taleforge_series_grammar_interactions
- taleforge_series_narrative_modules
- taleforge_series_narrative_strategies
- taleforge_story_concept_mechanics
- taleforge_system_checks
- taleforge_system_observability
- taleforge_system_observations
- taleforge_world_simulation_architecture


## Live schema evidence for the 11 product-facing/ambiguous candidates

A verbose, read-only Supabase table-schema inspection confirmed these owner/relationship columns:

| Table | Relevant columns observed | Policy design implication |
|---|---|---|
| profiles | `id`, `username`, `display_name`, `bio`, `avatar_url`, `role` | `id` is the referenced profile identity. The `role` check explicitly allows `reader`, `creator`, and `admin`; a generic owner UPDATE policy is unsafe unless role escalation is independently prevented. Prefer column-safe profile updates and a trusted role-assignment path. Public profile reads should expose only intended fields. |
| bookmarks | `user_id`, `story_id` | Owner check on `user_id = auth.uid()`; insert must enforce the same identity; confirm duplicate semantics. |
| collections | `creator_id`, `is_public` | Creator-owned writes; reads must distinguish public collections from private creator-owned collections. |
| collection_stories | `collection_id`, `story_id` | Ownership must be derived through the referenced collection's `creator_id`, not supplied by the caller. Public reads depend on the collection's `is_public`. |
| comments | `user_id`, `story_id`, `parent_comment_id`, `content`, `status` | Public reads should be limited to visible/approved comments; author writes must not allow caller-controlled moderation status. Moderator status changes need a trusted path. |
| likes | `user_id`, `story_id` | Owner-scoped creation/removal; prevent caller from acting as another user. |
| notifications | `user_id`, `is_read` | Recipient-scoped reads and read-state updates; creation should remain trusted/server-side unless a specific workflow requires otherwise. |
| ratings | `user_id`, `story_id`, `rating` | Owner-scoped rating writes; validate allowed rating range and avoid trusting client-supplied aggregate counters. |
| reading_history | `user_id`, `story_id`, `progress_percent`, `completed`, `last_read_at` | Owner-scoped CRUD; validate progress bounds and avoid client-controlled server timestamps if they affect ranking or analytics. |
| story_reports | `reporter_id`, `story_id`, `comment_id`, `reason`, `details`, `status`, `resolved_at` | Reporter may submit a report, but report contents and moderation status should not be broadly readable or caller-updatable. Status/resolution require trusted moderation. |
| recommendations | `user_id`, `story_id`, `score`, `reason` | Treat as server-generated until proven otherwise; users should not write scores or recommendation reasons. Read access should be scoped to the recipient if this is a user-specific table. |

Foreign keys observed in the catalog connect these relations to `profiles`, `stories`, `collections`, and `comments` as expected. This narrows policy design but does not prove that `profiles.id` is populated from `auth.uid()` in every existing auth path; verify the frontend sign-up/profile trigger and deployed callers before writing policies.

**Priority:** resolve the `profiles.role` escalation path and owner-scoped policies for bookmarks, collections, collection_stories, comments, likes, notifications, ratings, reading_history, and story_reports before claiming the reader MVP's account/community surfaces are secure and functional.

## D. Migration review findings

1. `20261013090000_aevora_server_only_metrics_outbox_grants.sql`, `20261013120000_lock_ai_provider_state_table.sql`, and `20261013130000_lock_internal_policyless_tables.sql` collectively cover the 28-row provisional server-only candidate list above (25 in the internal-lock list, plus the two metrics/outbox tables and provider-state table). Before treating this as rollout-ready, verify every service-role caller and note that the provider-state migration also updates legacy diagnostic data; it is not ACL-only.
2. `20261014180000_revoke_unapproved_internal_client_writes.sql` targets 41 `taleforge_*` relations and removes writes, but deliberately leaves reads. Its list must be compared with this inventory and caller evidence; do not treat internal-prefix alone as sufficient justification to revoke intended client access.
3. The broad-grant user-facing candidates in section B currently have no policies. The correct fix is not to leave them open; it is to design and test ownership/moderation policies and then verify each workflow. Do not invent a generic `auth.uid()` policy without confirming the owner column and relational constraints.
4. `20261016200000_revoke_client_table_maintenance_privileges.sql` is a narrow candidate that removes TRUNCATE/TRIGGER/REFERENCES but intentionally leaves ordinary CRUD grants; it does not solve missing RLS policies or the 39-table ACL issue by itself.
5. `20261016203000_revoke_client_maintenance_default_privileges.sql` addresses only future maintenance privileges in the public schema and is not a replacement for a full, owner-aware default-ACL review.
6. `20261014170000_restrict_public_default_privileges.sql` remains blocked for production consideration until its global/default ACL behavior and owner authorization semantics are redesigned and tested.

## E. Next safe steps

1. Inspect frontend source and deployed Edge Function callers for the 11 ambiguous/product-facing tables.
2. Inspect every internal candidate table's actual caller paths and verify the service-role key is never used in browser code.
3. Add regression tests for expected access models: user A cannot read/write user B's data; public reads expose only intended fields; internal tables deny anon/authenticated at relation and column levels; service-role operations continue to work.
4. Rehearse on disposable PostgreSQL and verify actual Supabase/Data API behavior in an approved non-production environment before applying anything.
5. Keep production automatic publishing NO-GO until scheduler lease integration, publisher status confirmation, quota guard parity, and security ACL work are deployed and verified under explicit authorization.

## Safety statement

This document is a read-only audit artifact. No production table privileges, policies, migrations, functions, schedules, chapter generation, or publication were changed. No Supabase development branch was created.
