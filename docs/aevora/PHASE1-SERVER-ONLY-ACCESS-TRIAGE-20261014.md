# Aevora Phase 1 — Server-Only Table Access Triage
Date: 2026-10-14
Status: read-only production inspection; remediation plan only. No production privileges, policies, schema, schedules, or data were changed.

## Newly confirmed public-view and underlying-policy review

A broad read-only inventory found **120 public-schema relations with grants to `anon` and/or `authenticated`**: 117 base tables and 3 views. Of the base tables, 39 have RLS enabled but no policies, and zero base tables with client grants were found with RLS disabled in this targeted inventory. The aggregate grant counts include view grants and must not be interpreted as 120 confirmed vulnerabilities. Each relation still needs classification by object type, view security mode, underlying tables, and RLS policy. RLS-enabled/no-policy tables are generally default-deny for row access, but broad grants remain unnecessary privilege and may break intended reader/writer flows.

Three names that initially appeared to have RLS disabled are actually **views** with `security_invoker=true`, not base tables:
- `public.story_intelligence`
- `public.story_trending_scores`
- `public.taleforge_system_health_snapshot`

The first two are discovery views over published series/chapters and reader-event aggregates. Their `relrowsecurity=false` is expected for views; because they are security-invoker views, access to underlying rows is governed by the caller's privileges and RLS policies. Their view grants alone do not prove the underlying data is writable or bypasses RLS. Treat them as intentional public-discovery candidates pending API exposure and view-column review, not confirmed vulnerabilities.

**A separate, concrete policy-design concern remains:** `taleforge_system_health_snapshot` selects `blocking_reason` and a JSONB `evidence` field from `taleforge_system_health`, and the current underlying table has a SELECT policy for both client roles with predicate `true`. `taleforge_system_registry` also has a public SELECT policy with predicate `true`. This may be intentional for a public status panel, but the snapshot exposes operational health/evidence fields without filtering. Review the contents and intended audience of those fields promptly. Do not query or copy row payloads during this audit.

The underlying discovery relations `series` and `chapters` have RLS enabled with public SELECT policies constrained to published/ongoing/completed content. `reader_events` has a public INSERT policy with visitor-ID length and published-content checks. These are more precise controls than the initial view-only grant snapshot suggested; their policy behavior should still be tested against the intended reader flows.

## Containment / review plan (approval required)

1. Verify the Data API exposed-schema list and any API gateway/network controls in the Supabase Dashboard. Do not send probes or mutate data to test reachability.
2. Review whether `taleforge_system_health.blocking_reason` and `evidence` contain sensitive internal diagnostics. If so, remove those columns from any public view or replace the public status view with an allowlisted projection that exposes only safe status fields.
3. Confirm `story_intelligence` and `story_trending_scores` are intended public discovery surfaces and that the security-invoker view options remain enabled.
4. Continue the relation-by-relation matrix. User-facing tables such as bookmarks, comments, profiles, likes, ratings, and reading history need intentional owner-scoped policies rather than indiscriminate server-only revocation.
5. Reconcile the missing October 13 server-only migrations separately; the finding below about outbox/metrics/schedules remains valid for those base tables.
6. Obtain owner approval before any production grant, view, or RLS changes. This inspection made no production changes.

## Confirmed high-priority finding

The connected database reports RLS enabled with zero policies on these tables:
- `public.publication_sync_outbox`
- `public.story_attachment_metrics`
- `public.release_schedules`
- `public.aevora_engineering_tasks`
- `public.aevora_engineering_decisions`

The Supabase security advisor currently reports 91 public-schema tables with RLS enabled and no policies. That advisor result is not, by itself, proof of data exposure: with RLS enabled and no applicable policies, row access is normally denied. However, the absence of policies must be evaluated alongside table grants and intended access.

A targeted `information_schema.role_table_grants` query returned table-level grants for `anon` and `authenticated` on `publication_sync_outbox`, `story_attachment_metrics`, and `release_schedules`, including SELECT, INSERT, UPDATE, and DELETE, plus other table privileges. This is inconsistent with the documented server-only access intent at the privilege layer, even though RLS currently has no policies. The finding should be treated as a privilege-hardening gap, not proof that client requests can currently read or mutate rows.

The branch already contains intended revocation migrations: `20261013090000_aevora_server_only_metrics_outbox_grants.sql` for the outbox and metrics tables, and `20261013130000_lock_internal_policyless_tables.sql` for `release_schedules` and other internal tables. A read-only query of `supabase_migrations.schema_migrations` did not find those migration versions. This is consistent with the observed live grants, but migration-history absence alone should be reconciled with the project's deployment process before deciding whether to apply anything.

## Remediation order

1. **Priority 0 — reconcile existing migration drift:** review the two already-prepared branch migrations against the live schema and migration history. If they are still the approved intended fix, arrange an explicitly authorized migration window for `20261013090000_aevora_server_only_metrics_outbox_grants.sql` and `20261013130000_lock_internal_policyless_tables.sql`. Preserve the minimum privileges required by trusted server-side execution, service-role operations, triggers, and scheduled jobs.
2. **Privilege matrix:** inventory grants for every table flagged by the advisor, grouped by schema/table/grantee/privilege. Classify each table as public-read, authenticated-user scoped, or server-only before choosing policies or grants.
3. **RLS regression tests:** add checks that the two explicitly server-only tables have RLS enabled, have no client-facing policies, and grant no table privileges to `anon` or `authenticated`. Test intended trusted-role access separately.
4. **API exposure:** verify the actual PostgREST exposed-schema list through supported project configuration. Do not infer reachability solely from SQL grants.
5. **Apply only after approval and compatibility review:** production DDL/GRANT changes are deliberately not included in this branch-only finding.

## Why not add deny-all policies instead?

No-policy RLS currently provides a default deny for row access, but explicit privilege minimization is still the correct server-only contract. Adding a policy without first resolving grants can accidentally broaden access later. Avoid broad grants and avoid indiscriminate revokes across unrelated tables.

## Dispatch correlation and freshness remain open

Cron dispatch jobs execute SQL successfully, but this does not prove the corresponding Edge Function succeeded. A recent read-only log aggregate showed events from PostgreSQL, Edge, and function-edge sources through approximately 03:56–03:58 UTC during the checked window; it did not establish request-by-request correlation or explain the previously observed pg_net response freshness gap. Do not trigger test requests or mutate live schedules to investigate. Add request-ID correlation only through a reviewed change that preserves existing payloads, headers, cadence, and side effects.

## Acceptance criteria for Phase 1

- All server-only tables have explicit least-privilege grants for client roles.
- User-facing tables have documented, ownership-aware RLS policies and automated policy tests.
- No security-advisor finding is marked resolved without confirming its intended access model.
- Scheduled dispatch success is distinguished from HTTP response success and application-level business postconditions.
- A read-only audit can identify stale telemetry without making generation, publication, or queue changes.


## Default-privilege templates — verified 2026-10-14

A fresh read-only catalog inspection found 27 `pg_default_acl` entries. These are future-object templates, not proof of current table/function exposure. The important results are:

- In `public`, both object creators `postgres` and `supabase_admin` have schema-specific default ACLs that grant `anon` and `authenticated` broad table privileges (including SELECT/INSERT/UPDATE/DELETE and other relation privileges), sequence privileges (USAGE/SELECT/UPDATE), and function EXECUTE on newly created objects.
- Similar broad client-role templates appear for objects created by `postgres` in `storage`, and by `supabase_admin` in `graphql_public` and `graphql`. Whether those schemas are exposed through the project's Data API is not verified here.
- The global defaults (namespace OID 0) observed for `supabase_admin` do **not** grant these client roles privileges in the returned ACL. The concern is the per-schema defaults above, not a blanket claim that global defaults are unsafe.
- The `auth`, `realtime`, `extensions`, and `cron` entries in this snapshot do not show grants to `anon` or `authenticated` in their returned default ACLs; preserve platform-managed configuration and do not change these templates as part of this application audit.

This creates a **future-object privilege drift risk**: a newly created table or function can inherit client grants before anyone adds a policy or reviews whether it should be server-only. It does not, by itself, make existing objects exposed, and broad defaults are not proof that every new object is reachable through PostgREST.

### Remediation approach

1. Confirm the actual Data API exposed-schema list in Supabase Dashboard/API settings, especially whether `graphql_public` or other non-public schemas are exposed. The SQL catalog does not establish this configuration.
2. Agree on an application-owned migration-owner strategy. For new Aevora server-only tables/functions, explicitly revoke client grants in the creating migration and add contract tests. Do not blindly alter defaults owned by `supabase_admin`: Supabase/platform ownership can make changes ineffective or risky.
3. For `public`, determine whether the defaults are intentional for all future objects or only public-facing ones. If least-privilege defaults are adopted, update defaults only after verifying migration roles and explicitly granting the required access on the intended public API objects.
4. Add a migration-review check that flags new server-only objects without explicit least-privilege grants. Keep the existing read-only audit for global and per-schema default ACLs.
5. No default ACL was changed, and no production migration, grant, schema exposure setting, or API configuration was modified.


## Complete effective-grant and public-policy recheck (read-only, 2026-10-14)

A fresh catalog query covered 173 relations in `public` and checked effective table privileges for `anon`, `authenticated`, and `service_role`. This is a permission metadata review; no row payloads were queried.

- 120 relations have effective grants for `anon` and/or `authenticated` (117 base tables and 3 views in the prior relation-kind breakdown).
- 39 RLS-enabled base tables have client grants but no policy rows. RLS with no policies normally denies client row access, so these 39 are not automatically confirmed data leaks; the excess grants should still be removed where the tables are server-only.
- No client-granted base table with RLS disabled appeared in this targeted inventory.
- The current catalog shows broad effective INSERT/UPDATE/DELETE as well as SELECT privileges for client roles on numerous base tables, including server/internal tables. This confirms that least-privilege table ACLs have not yet been achieved. Because inherited/default grants can complicate simple ACL interpretation, each affected table needs intended-access classification and role-based verification before a repair is proposed.
- A separate scan found **16 SELECT/ALL policies whose predicate is literally true** and includes internal or narrative-intelligence tables, including continuity reconciliation findings/runs, narrative depth plans, narrative memory snapshots, narrative thread events/progression/threads, novelty evaluations, system dependencies, system health, and system registry. These are more urgent than the 39 no-policy cases: where client SELECT grants and Data API exposure coexist, a true policy can expose rows. Treat these as **potential direct data exposure** until the intended product-public fields are explicitly distinguished from internal diagnostics and the policy is narrowed or removed.
- Existing `public.taleforge_system_health_snapshot` is a security-invoker view, but its underlying `taleforge_system_health` table has a public true SELECT policy and the view includes diagnostic fields such as blocking reason and evidence. Do not query the row contents in the audit; inspect column contracts and replace public access with an explicitly sanitized public status model if those fields are internal.
- `public.aevora_automation_job_status` is a security-definer view over `cron.job` and `cron.job_run_details`, but its ACL currently grants SELECT only to `postgres` and `service_role`; `anon` and `authenticated` do not have SELECT. Do not change it based solely on its definer setting; preserve service-only behavior and test future changes.
- The public-facing `genres` and `tags` true SELECT policies appear plausible, but the narrative/diagnostic tables above require an explicit product-publication decision. Do not treat all true policies as equally risky.

### Required next actions

1. Treat true SELECT policies on narrative snapshots/events/threads, reconciliation diagnostics, novelty evaluations, and system health/dependency registries as a priority review list.
2. For each listed relation, record intended public columns and row eligibility, then compare with actual client API queries; never use raw table reads as an audit shortcut.
3. Prepare a **branch-only** least-privilege proposal with narrow public views or sanitized aggregate RPCs where public features truly need these signals. Preserve service-role/worker paths and trigger execution.
4. Add role-based tests proving anonymous/authenticated clients can read only intentionally public material and cannot write internal tables, while trusted service paths continue to work.
5. Confirm actual Data API exposed schemas and column-level grants; re-query effective grants after any separately authorized rollout.

This is a read-only finding record. No production data, RLS policies, grants, views, functions, schema settings, cron jobs, or Edge Functions were changed. Phase 1 remains open.


## Column-level privilege verification and branch repair (read-only audit + branch-only fix, 2026-10-14)

The explicit column ACL check confirmed that the client exposure is not only a table-level grant issue:

- `taleforge_system_health_snapshot` has effective SELECT on every inspected output column for both `anon` and `authenticated`, including `blocking_reason` and `evidence`. Its underlying `taleforge_system_health` relation also has a public true SELECT policy. Treat these internal diagnostic fields as exposed through the current database access model; do not fetch row contents during audit.
- Internal narrative relations with public true policies have broad client column privileges; some, including reconciliation findings/runs, narrative depth plans, memory snapshots, thread events/progression/threads, novelty evaluations, system dependencies/health/registry, have effective client INSERT/UPDATE privileges as well as SELECT. Their row policies and current exposed-schema configuration need to be reconciled, but the ACL is plainly broader than the intended internal-only model.
- Branch migration `20261013103000_lock_internal_narrative_intelligence_tables.sql` already removes the named public policies, relation-level client grants, and separately granted column privileges for the 13 internal base tables. The audit found a gap: its separate relation-level revoke for `taleforge_system_health_snapshot` did not remove independent column-level grants.
- I fixed that gap **on the branch only** by adding a catalog-driven column-level revoke for the diagnostic view and a contract test that protects both relation- and column-level revocation. The SQL migration has not been run against production. CI is pending for the new change at the time of this update.

The intended public alternative should be a deliberately allowlisted status projection that omits internal evidence and blocking diagnostics, with only the necessary public fields and row filters. Do not grant access to the raw snapshot to preserve a UI convenience; map each UI dependency to the sanitized contract instead.

No production grants, policies, views, functions, schema settings, data, or Edge Functions were changed.


## Client write-policy cross-check (read-only, 2026-10-14)

A catalog-only scan found one client-role write policy across the public schema: the `INSERT` policy on `reader_events`. No client-role `INSERT`, `UPDATE`, `DELETE`, or `ALL` policy with a literal `true` predicate was found. This supports the distinction between broad ACLs and effective row access: RLS generally blocks writes on the no-policy tables, but excessive grants remain unnecessary and should be removed. The reader-events INSERT policy still needs chapter/series relationship enforcement and replay/spam controls.

The branch-only diagnostic-view column-grant fix and its contract test passed CI:
- Migration repair commit: `8f93cc833afe3574530312eafa9d21139a3728df`.
- Contract-test commit: `909848171577788ff98f1252d9ba4c96a09f24bb`.
- Latest audit documentation commit: `ca4fd8b3f41e6e8a0984a223349ac3a1405ac781`; GitHub Actions run `38523636057` completed successfully.

This evidence does not authorize a production rollout. The raw diagnostic view and underlying true policies remain live until a separately approved migration is applied.


## Follow-up migration syntax correction (branch-only, 2026-10-14)

During review of the diagnostic-view column-grant repair, I found that the newly inserted anonymous PL/pgSQL block had malformed dollar quoting (`DO $` / `$;`) rather than the required `DO $$` / `$$;`. The branch migration has been corrected in commit `bcdb687f45a3446210da6daebd879436fb5b926c`. I added a contract test in commit `dd0fae745955c305b33916662ef286a4080adf0c` that checks dollar-quoted block balance and rejects the malformed single-dollar form.

The syntax correction and test are on the branch only; CI for the latest commits must pass before considering the migration candidate review-ready. This is another reason the migration remains **not approved for production application**. No live database DDL was executed.


## Expanded inventory: internal-prefixed tables remain outside current lock lists (read-only, 2026-10-14)

A broader effective-privilege query found **103 base tables** with client INSERT/UPDATE/DELETE grants (plus 3 views in the earlier 106-relation total). Of these, **68 `taleforge_*` base tables** have client write grants but no client-role INSERT/UPDATE/DELETE/ALL RLS policy. This means current RLS generally blocks those writes, but broad grants violate least privilege and make future policy mistakes more consequential.

The 68-table list includes story-concept graph/state tables, narrative and genre intelligence, CEO/governance runs, system registries, novelty signatures, and other internal orchestration state. The current branch migrations cover some subsets (internal narrative intelligence, internal policyless tables, provider state, and related locks) but **do not yet prove that all 68 have been accounted for**. Do not infer completeness from a prefix alone: the final allow/deny inventory must be reconciled with actual frontend/Edge Function references and any intended public genre/trope discovery behavior.

Required next branch-only step:
1. Build a table-by-table coverage map from the 68 live names to a migration lock, an explicitly approved public API contract, or a documented exception.
2. For each table not in a lock migration, search repository references and confirm whether browser clients access it directly or only trusted workers do.
3. Prefer a reviewed explicit table list over an unbounded prefix-based dynamic revoke.
4. Add a contract test that every audited internal-only table appears in the lock migration set, and that approved public-facing tables are excluded intentionally.
5. Repeat the same exercise for the 35 other client-write-granted base tables; those include intended reader/content surfaces mixed with internal controls, so they cannot be blanket-revoked without feature compatibility checks.

No production table, policy, grant, view, function, schema setting, or data was changed during this audit. Phase 1 remains open.


## Explicit table-by-table coverage checkpoint (read-only, 2026-10-14)

Cross-checking the live list of 68 `taleforge_*` base tables with effective client write grants and no client write policy against the existing branch migration arrays found:

- **27 of 68** are covered by one of the current internal-lock candidates: `20261013103000_lock_internal_narrative_intelligence_tables.sql`, `20261013130000_lock_internal_policyless_tables.sql`, or `20261013120000_lock_ai_provider_state_table.sql`.
- **41 of 68 remain uncovered by those table-lock lists**. This is a migration coverage gap, not proof that each table should be locked without further usage review.

Uncovered table names from the live metadata inventory:

- `taleforge_advanced_chapter_plans`
- `taleforge_character_architecture`
- `taleforge_ending_architecture`
- `taleforge_genre_grammars`
- `taleforge_genre_inversion_patterns`
- `taleforge_genre_taxonomy`
- `taleforge_grammar_compatibility`
- `taleforge_hybrid_story_recipes`
- `taleforge_hybrid_story_recipes_generated`
- `taleforge_narrative_arc_layers`
- `taleforge_narrative_culture_profiles`
- `taleforge_narrative_memory_consolidations`
- `taleforge_narrative_modes`
- `taleforge_series_genre_grammar_profiles`
- `taleforge_series_genre_profiles`
- `taleforge_series_narrative_profiles`
- `taleforge_series_subgenre_profiles`
- `taleforge_story_concept_arc_characters`
- `taleforge_story_concept_arc_endings`
- `taleforge_story_concept_arc_relationships`
- `taleforge_story_concept_arc_threads`
- `taleforge_story_concept_arc_world_functions`
- `taleforge_story_concept_arcs`
- `taleforge_story_concept_candidates`
- `taleforge_story_concept_character_causality`
- `taleforge_story_concept_characters`
- `taleforge_story_concept_evaluations`
- `taleforge_story_concept_faction_causality`
- `taleforge_story_concept_factions`
- `taleforge_story_concept_relationships`
- `taleforge_story_concept_state_transitions`
- `taleforge_story_concept_world_dependencies`
- `taleforge_story_concept_world_links`
- `taleforge_story_concept_world_rules`
- `taleforge_story_concept_world_state_models`
- `taleforge_story_concept_world_state_transitions`
- `taleforge_story_concept_worlds`
- `taleforge_story_opportunities`
- `taleforge_story_specific_depth_designs`
- `taleforge_story_trope_library`
- `taleforge_subgenre_intelligence`

Next, trace each uncovered table through application/Edge Function references and classify it as internal-only, intentional public read model, or feature requiring a future owner-scoped API. For confirmed internal-only tables, add them to a separately reviewed explicit migration list and regression contract. Do not automatically lock `taleforge_genre_taxonomy`, trope-library, or genre-profile tables until their reader-facing use has been ruled out. No production changes were made.


## Read-surface classification of the 41 uncovered tables (read-only, 2026-10-14)

A follow-up catalog query found that all 41 uncovered tables currently have effective `anon` and `authenticated` SELECT grants plus SELECT RLS policies. The policies are status-filtered rather than universally true, but several expose the autonomous story-design graph: concept candidates, arcs, character/faction causality, relationships, world rules/state models, story opportunities, advanced chapter plans, and story-specific depth designs.

The current browser data module (`taleforge-data.js`) directly reads the intended reader surfaces `series`, `chapters`, `story_intelligence`, and the related `genres` relation. It does not reference these 41 `taleforge_*` relations. That lowers the evidence for a current frontend dependency, but does not alone prove no other consumer exists; worker and RPC references must be traced before revoking reads.

Branch-only migration candidate `20261014180000_revoke_unapproved_internal_client_writes.sql` revokes only client write privileges from the 41-table explicit list, including separately granted column-level INSERT/UPDATE/REFERENCES. It intentionally preserves SELECT so this write-hardening change cannot silently break a potentially intentional read contract. Regression test coverage was added in `scripts/aevora-readonly-access-audit-contract.test.mjs`.

**Security review remains open:** decide table-by-table whether the status-filtered SELECT policies are intentional public product APIs or an unintended disclosure of internal story-generation intelligence and unpublished concepts. If confirmed internal-only, a separate migration should remove client relation and column SELECT grants and drop the named SELECT policies; do not combine that read-surface decision with this write-only mitigation without an explicit compatibility review. No production DDL was executed.


## Branch-only server-side read-lock candidate added (2026-10-14)

Because the 41-table inventory has explicit status-filtered client SELECT policies and no direct references in the current browser data module, I prepared a separate migration candidate, `20261014190000_lock_internal_story_design_read_surfaces.sql`. It explicitly lists all 41 relations, enables RLS, revokes relation-level and column-level privileges from `PUBLIC`, `anon`, and `authenticated`, and drops their client-facing SELECT/ALL policies. Service-role workers retain their existing grants; the migration does not alter reader-facing `series`, `chapters`, or `genres` tables.

The earlier `20261014180000_revoke_unapproved_internal_client_writes.sql` remains as a narrower defense-in-depth step. Contract tests now assert table-list coverage, relation and column revokes, and removal of client-facing SELECT policy paths.

This is a **prepared candidate, not a production authorization decision**. Before any rollout, validate all RPC/view/Edge Function dependencies and confirm that these 41 relations are not intended as public APIs. Current browser code evidence is supportive but not a complete dependency graph. Both new migrations remain branch-only; no production DDL or deployment was performed.


## Reader-event chapter/series integrity candidate (branch-only, 2026-10-14)

Read-only inspection of the live `Public can record reader events` INSERT policy confirmed that it validates a supplied chapter as published and independently validates a supplied series as eligible, but does **not** require the chapter to belong to that series. It also permits a chapter event when `series_id` is null. Separate foreign keys do not enforce this cross-column relationship.

Branch migration candidate `20261014200000_reader_event_relationship_integrity.sql` replaces the policy so that a supplied chapter requires a non-null series and an existence check joining the published chapter to the exact supplied series; the series must remain in an eligible published lifecycle state. Series-only events remain supported, as do events with neither identifier if that is how the existing telemetry contract is used. The existing visitor-ID length check is preserved. The candidate does not change table grants or attempt to solve replay/spam abuse.

A source-level contract test checks the key policy clauses. This is not yet a database integration test: a disposable test database should exercise accepted/rejected combinations before production consideration. Replay protection, deduplication, and rate limiting remain a separate unresolved abuse-control requirement. This migration is branch-only; no production policy or data was changed.
