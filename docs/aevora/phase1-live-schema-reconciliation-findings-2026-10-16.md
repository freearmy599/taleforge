# Aevora Phase 1 — live schema reconciliation findings

**Observed:** 2026-10-16  
**Environment:** live Supabase catalog, read-only SQL inspection  
**Status:** findings only; no database writes performed  
**Branch:** `aevora/release-scheduler-hardening`

This record contains catalog metadata only. No application rows, secrets, prompts, or provider response bodies were queried.

## Confirmed findings

### 1. Provider-state relation exists, but client grants contradict the intended lock-down

The live relation `public.taleforge_ai_provider_state` exists, is owned by `postgres`, and has row-level security enabled. Its `provider` key is the primary key. The throttle counter is an integer and the cooldown timestamp is nullable `timestamp with time zone`. No user-defined triggers were found on this relation.

The effective table ACL inventory showed ordinary-client privileges for both `anon` and `authenticated`, including `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`. RLS does not substitute for revoking table-level privileges such as `TRUNCATE`.

The repository contains `20261013120000_lock_ai_provider_state_table.sql`, whose intended operation explicitly revokes table and column privileges from `PUBLIC`, `anon`, and `authenticated`. The live migration ledger's latest recorded migration is `20261010161919 aevora_release_scheduler_leases`, which predates this lock migration. The privilege mismatch is therefore consistent with the hardening migration not having been recorded as applied; it is not, by itself, evidence that an already-applied lock migration failed.

**Do not apply the lock migration blindly.** The migration-history gap for the table's original creation remains unresolved, and owner/default-privilege behavior still needs review. Prepare a targeted, reviewable repair and rehearse it before any separately authorized production operation.

### 2. Migration history and repository migration files are out of sync

The live migration ledger includes version `20261007025751` named `add_taleforge_ai_provider_cooldown_state`. The current hardening branch does not contain a file at the corresponding expected path/name, and its migration directory does not contain a provider-state creation migration. The branch contains later lock-down SQL, but the live ledger currently ends at `20261010161919`, before those later hardening migrations.

A follow-up repository-history check found no Git commit history for the exact expected migration path. The current `main` tree also has no migration filename matching provider/cooldown/throttle. This narrows the discrepancy but does not establish whether the migration was renamed, originated in an untracked/private source, or was created through another workflow. Search results are not a substitute for the original migration body.

This is migration-history drift, not proof that the relation was created manually. The missing original migration and the not-yet-recorded later hardening migrations are two distinct facts and must not be conflated. The original migration's origin must be established from available database/repository records before adding a new migration or editing history. Do not fabricate a historical migration or mark migrations applied to make the lists appear aligned.

### 3. Default privileges remain a separate security gate

The live default-ACL inventory shows broad defaults affecting future objects in `public` (tables, sequences, and function execution). The branch migration `20261014170000_restrict_public_default_privileges.sql` deliberately skips owner roles when the migration executor is not a member of those roles; it notes that the `postgres` owner needs a separately authorized privileged operation.

Therefore, even a successful table-specific revoke would not by itself resolve future-object defaults. Inspect each relevant owner role and effective defaults, then design a narrowly scoped and authorized correction. Do not broaden privileges or change global defaults speculatively.

### 4. Atomic provider cooldown repair is still not implemented

The provider-state inventory did not find a matching existing cooldown/throttle recording routine. The current design gate in `docs/aevora/phase1-provider-cooldown-atomicity-plan.md` remains valid: use one database-atomic operation, serialize concurrent counter increments and first insert, never shorten an existing cooldown, fail closed on invalid persisted state, and restrict execution to the intended server-side role.

The concurrency review also identifies a fallback read-modify-upsert in `generation-orchestrator`, in addition to the direct worker cooldown path. Both call paths must be included in the atomicity audit so one provider failure is not recorded twice and concurrent increments are not lost.

Do not draft a guessed function signature or deploy a migration until relation provenance and migration history are reconciled.

## Branch-only rehearsal results — 2026-10-16

The hardening branch now has disposable PostgreSQL runtime rehearsals for two distinct controls:

- **Provider-state ACL lock:** seeds broad relation-level and explicit column-level client grants, runs the existing lock migration, and asserts that `anon` and `authenticated` cannot select, insert, update, delete, truncate, reference, or trigger against provider state. It also verifies that the intended `service_role` grants remain and the fixture Gemini overload diagnostic is redacted.
- **Future-object defaults:** seeds broad global and `public`-schema default privileges for the disposable `postgres` owner, runs the default-privilege migration, creates a table, sequence, and function, and verifies that the newly created objects do not inherit the tested client grants.

Both rehearsals passed in CI run [38861905595](https://github.com/freearmy599/taleforge/actions/runs/38861905595), alongside Edge Function type-checking and Cloudflare Pages validation. These tests establish branch behavior only. They do **not** prove the live Supabase grants have changed, resolve migration-history drift, or validate defaults for an owner role the migration executor cannot administer (notably the separately gated `supabase_admin` case).

## Next safe actions

1. Reconcile the live migration ledger against all repository migrations and any available historical source for the missing provider-state creation migration.
2. Keep the live provider-state ACL discrepancy open until a separately authorized, read-only post-repair verification confirms effective relation and column privileges. Do not apply the migration blindly.
3. Inventory global and schema-level default privileges for every relevant owner role, especially `supabase_admin`, and arrange a separately authorized owner-level repair if required.
4. Implement and test the atomic cooldown operation only after the schema/history discrepancy is resolved, covering both worker and orchestrator fallback paths.
5. Re-run Edge Function type-checking, Phase 1 source contracts, disposable PostgreSQL tests, and real Supabase Edge Runtime validation.

## Safety boundary

This document does not authorize production migration, deployment, publication, generation, schedule mutation, or creation of a billable Supabase branch. No such actions were performed during this inspection.


## Follow-up verification — 2026-10-16

A second read-only catalog pass confirmed the current relation shape: `provider text NOT NULL` (primary key), `cooldown_until timestamptz NULL`, `consecutive_throttle_count integer NOT NULL DEFAULT 0`, `last_error text NULL`, `last_error_at timestamptz NULL`, and `updated_at timestamptz NOT NULL DEFAULT now()`. The only user-defined constraint is the primary key; no user-defined triggers were found. A search of ordinary SQL functions whose definitions reference this relation returned no matches, so no pre-existing database routine was found to reuse for atomic recording.

The repository branch inventory was extended beyond `main`: the four other visible branches (`feat/chief-editor-admin-runner`, `feature/aevora-design-system-v1`, `feature/blueprint-planner`, and `main`) also have no migration path matching `20261007025751`, `add_taleforge_ai_provider_cooldown_state`, or provider/cooldown SQL naming patterns. This still cannot establish whether an original migration body exists outside the visible repository branches; do not treat it as proof of manual creation.

The new two-writer atomicity gate and contract test passed in CI run [38863623400](https://github.com/freearmy599/taleforge/actions/runs/38863623400): Edge Function type-checking and the disposable PostgreSQL rehearsal both succeeded. This validates the current branch contracts and rehearsals only; it does not implement atomic cooldown recording or change live ACLs.

### Default-privilege follow-up details

A fresh catalog query enumerated schema-specific defaults in `public` for both owner roles `postgres` and `supabase_admin`. For each owner, the catalog reports `anon` and `authenticated` in default ACLs for tables (`arwdDxtm`), sequences (`rwU`), and function execution (`X`). The same ACLs include `service_role`; this evidence does not justify broadening or removing service-role access without a separate intended-access review. No global (`defaclnamespace = 0`) rows were returned by this query; the confirmed broad entries are schema-specific to `public`.

The prepared default-privilege migration intentionally skips `supabase_admin` when the executor is not a member of that role. The live inventory confirms the role-specific defaults still need to be resolved, and the live ledger still ends before migration `20261014170000`. Treat this as two gates: first determine which changes are not yet applied, then obtain an authorized operation under each owner that can change its own defaults. Do not attempt to work around role membership or run DDL against production as part of this continuation.

A direct `has_table_privilege` check independently confirmed that `anon` and `authenticated` currently have effective `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges on `public.taleforge_ai_provider_state`; `service_role` has them as expected for the current table ACL. This confirms that the live issue is effective privilege exposure, not merely an `information_schema` display artifact. Because `TRUNCATE` is not constrained by row-level security, the no-policy RLS state does not mitigate this grant. No privilege changes were made.


## Live deployed-function reconciliation — 2026-10-16

A read-only Supabase Edge Function inventory and source retrieval was compared with the hardening branch. This is source/version inspection only; no function was invoked and no deployment occurred.

| Function | Live deployed version | Hardening branch source | Material difference |
|---|---:|---|---|
| `generate-chapter` | 59 | `quality-v8-short-overload-cooldown` | Live source still includes raw Gemini response text in thrown HTTP errors, returns the caught message to the caller, logs a truncated version, and writes the message into `last_error`. The branch source removes response-body text from the thrown error and uses a redacted diagnostic. Both still have read-then-upsert cooldown recording, so the branch source is not yet atomic either. |
| `generation-orchestrator` | 35 | `generation-orchestrator-v22-provider-cooldown-hard-stop` | Live cooldown lookup treats a successful query with no provider-state row as inactive; the branch source treats a missing row as blocked/uncertain. Live fallback recording reads the counter then upserts and does not check/propagate the write error. The branch source validates state and checks write errors, but still uses a non-atomic read-modify-upsert. |
| `release-scheduler` | 12 | `release-scheduler-v17-publication-authorization-preflight` | Live deployment does not contain the branch's explicit `publication_authorization_not_implemented` preflight stop. Branch preflight remains a prepared safeguard, not a live behavior. |

### Immediate implications

1. The live generator's error handling can expose provider response-body text through function responses/logs and persist it in `last_error`. Keep the existing branch redaction change as a release requirement; do not assume it is deployed.
2. A missing `taleforge_ai_provider_state` row is not equivalent to a valid “no cooldown” state. The live orchestrator currently allows that missing-row case to appear inactive. The branch fail-closed check is an improvement but still requires the shared atomic database operation before release.
3. The live and branch cooldown writers both remain non-atomic. The branch must not be represented as having solved lost increments or first-insert races until both writers call the same rehearsed atomic operation.
4. The live scheduler and branch scheduler remain materially different. The publication-authorization preflight is branch-only; no claim is made that live automated publication is blocked by that guard.

These observations increase the urgency of the already documented blockers, but they do not authorize a production fix. Keep the migration-provenance gate in place; do not create a guessed RPC or apply DDL to production. The exact deployed versions and source were retrieved through read-only project inspection; no application rows, secrets, prompts, or provider response bodies were queried.


## Follow-up verification — migration provenance and regression gate — 2026-10-16

- CI run [38866930782](https://github.com/freearmy599/taleforge/actions/runs/38866930782) completed successfully on commit `32aaa45b0ad9a28ce9512e2f209f8f0ca230fe54`. Both jobs passed: prepared Edge Function type-checking (including the repository-wide Gemini quota-guard contract suite) and the readiness-migration rehearsal against disposable PostgreSQL. This validates the prepared branch and disposable rehearsal only; it does not apply any migration to production or validate deployed Edge Runtime behavior.
- Rechecked the migration directory on all five currently listed repository branches: `main`, `feat/chief-editor-admin-runner`, `feature/aevora-design-system-v1`, `feature/blueprint-planner`, and `aevora/release-scheduler-hardening`. None contains a migration filename mentioning provider, cooldown, or quota; only the hardening branch contains `20261013120000_lock_ai_provider_state_table.sql`.
- The main branch's complete visible migration directory contains 39 SQL migrations; its oldest tracked migration is `20261005060000_multi_series_production_profiles.sql`, and its first migration dated October 7 is `20261007043000_taleforge_system_governance.sql`. There is no tracked migration dated at or before the ledger's `20261007025751` version, so the missing source is not simply a differently named file in the current migration directory.
- Queried GitHub commit history for the expected creation-migration path `supabase/migrations/20261007025751_add_taleforge_ai_provider_cooldown_state.sql`; no commits were returned. Repository code/commit searches for the table and migration identifier also returned no matches.
- This is stronger evidence that the original creation migration is absent from the currently visible repository branches, but it does **not** establish how the live migration was authored or applied. The live migration ledger still records version `20261007025751`, while the source file and trustworthy provenance remain unavailable.
- **Gate remains closed:** do not invent a replacement creation migration, backfill migration history, or author the atomic RPC migration from assumptions. Next acceptable provenance evidence is an authorized source-of-truth copy/export of the original migration or verified deployment record from the system that applied it. Until then, continue only with branch-side contracts and read-only checks.


## Independent live migration-ledger recheck — 2026-10-16

A fresh read-only Supabase migration-list call returned **232 recorded migration entries**. The first listed entry is `20261004110313 create_taleforge_automation_cron_jobs`; the latest remains `20261010161919 aevora_release_scheduler_leases`. The target entry remains `20261007025751 add_taleforge_ai_provider_cooldown_state`. No recorded entries are dated at or after the branch's `20261013120000_lock_ai_provider_state_table.sql` migration.

This independently confirms the current ledger boundary and that the later branch lock/default-privilege migrations are not represented in the live migration list. It does not reveal the missing original migration body or prove why the ledger and repository diverged. The migration-provenance gate therefore remains closed. This was a read-only list operation; no database writes, migrations, deployments, generation, publication, or schedule changes were performed.


## Latest branch verification — 2026-10-16

CI run [38867603837](https://github.com/freearmy599/taleforge/actions/runs/38867603837) completed successfully on commit `99292e4b356f74942c80a6d7186846b79ffc0145`. Both jobs passed: prepared Edge Function type-checking with all source-contract checks, and the disposable PostgreSQL readiness/security rehearsal. The checks include provider-state grant and redaction rehearsals, provider cooldown recording contracts, and read-only schema-provenance contracts.

This is branch/test evidence only. It does not resolve the original migration source, change live table grants/default privileges, implement atomic cooldown recording, or validate deployed Edge Runtime behavior. No production writes or deployments were performed.


## Publication-boundary live catalog reconciliation — 2026-10-16

A fresh read-only catalog query inspected the targeted publication-boundary relations in `public` and `aevora_private`. It selected catalog metadata only; no application rows were read and no database writes were performed.

### Observed relation inventory

The following expected `public` relations were present, all owned by `postgres` with RLS enabled:

| Relation | Columns | Constraints | Indexes | User triggers |
|---|---:|---:|---:|---:|
| `aevora_release_scheduler_leases` | 5 | 2 | 1 | 0 |
| `chapter_blueprints` | 21 | 7 | 5 | 1 |
| `chapter_generation_outputs` | 20 | 6 | 6 | 3 |
| `chapter_publication_reviews` | 11 | 4 | 3 | 2 |
| `chapter_reviews` | 10 | 5 | 4 | 0 |
| `chapters` | 19 | 6 | 6 | 5 |
| `publication_sync_outbox` | 12 | 4 | 3 | 0 |
| `reader_events` | 7 | 5 | 4 | 0 |
| `release_schedules` | 15 | 8 | 4 | 1 |
| `series` | 28 | 6 | 6 | 2 |
| `story_blueprints` | 32 | 5 | 4 | 2 |
| `taleforge_autonomous_series_creation_runs` | 16 | 6 | 2 | 0 |

This count is a high-level inventory, not validation of the specific constraint definitions or the safety of the triggers. Those definitions, trigger-function bodies, routine ownership/settings, and effective grants still need reconciliation before a publication transaction can be designed.

### Expected objects not present in the inspected schemas

- The `aevora_private` schema was absent; consequently none of the publication-boundary relations expected there were found.
- `public.reader_event_quota_buckets` and `public.reader_event_quota_cleanup_state` were absent.

These are observations about the current live catalog, not instructions to create the schema or tables. Before changing any source contracts or designing a transactional publication RPC, reconcile these absences with tracked migrations, deployed callers, and the intended schema architecture. Do not create missing objects merely to satisfy the inventory.

### Gate update

The live inventory confirms that the core publication relations exist, but the publication-boundary migration gate remains **blocked**. Next evidence should enumerate the actual column types/defaults, exact constraint and index definitions, trigger definitions and trigger-function security settings, policies, effective table/column/routine grants, and relevant migration history. In particular, the outbox and release-schedule invariants must be verified from exact definitions rather than inferred from counts.

This was a read-only inspection. No production migration, DDL, deployment, schedule mutation, generation, or publication occurred.


## Publication-boundary effective grants — additional live finding

A separate read-only `has_table_privilege` inventory checked effective privileges for `anon`, `authenticated`, and `service_role` on the 12 present publication-boundary relations.

- `anon` and `authenticated` have no table privileges on `aevora_release_scheduler_leases` or `taleforge_autonomous_series_creation_runs` in the observed catalog.
- On the other 10 relations — `chapter_blueprints`, `chapter_generation_outputs`, `chapter_publication_reviews`, `chapter_reviews`, `chapters`, `publication_sync_outbox`, `reader_events`, `release_schedules`, `series`, and `story_blueprints` — both ordinary roles have effective `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges.
- `service_role` has those privileges on all 12 relations, consistent with the current grants but still subject to intended-access review.

This is a significant access-control finding. RLS being enabled does not constrain `TRUNCATE`, and ordinary-client `TRIGGER` privileges should not be assumed safe merely because RLS is enabled. This inventory alone does not determine the complete row-level exposure; the associated policies, views, function paths, and intended public read/write use must be assessed before designing the exact revoke/grant matrix.

**Do not run broad revokes as part of this continuation.** First reconcile intended browser access with the application call paths and existing policies, then prepare narrowly scoped table/column grants and disposable PostgreSQL tests. No privileges were changed.


## Publication-boundary trigger and policy reconciliation — 2026-10-16

A further read-only catalog pass enumerated trigger definitions, trigger-function security settings/owners, and row-level policies for the publication-boundary relations. No application rows were queried and no database writes were performed.

### Row-level policy inventory

Only three policies were present across the 11 inspected publication-boundary relations:

- chapters: SELECT for anon and authenticated, limited to published chapters whose series is ongoing or completed.
- series: SELECT for anon and authenticated, limited to series with status ongoing or completed.
- reader_events: INSERT for anon and authenticated, requiring a non-null visitor identifier of length 16–100 and, when supplied, a series that is ongoing/completed and a chapter that is published.

No policies were returned for chapter_blueprints, chapter_generation_outputs, chapter_publication_reviews, chapter_reviews, publication_sync_outbox, release_schedules, story_blueprints, or taleforge_autonomous_series_creation_runs. Combined with the previously verified effective table grants, this means the ordinary roles have broad table-level capabilities on those relations even though the current row-policy inventory does not grant them row access through RLS. That is not an adequate reason to leave the broad grants in place: TRUNCATE is not constrained by RLS, and unnecessary write/trigger privileges expand the attack surface. The intended client-facing access model should be reduced to the minimum required by actual application call paths, not by a blanket revoke that could break published reading or reader-event intake.

### Trigger and privileged-function inventory

The inspected relations have 16 user-defined triggers. The relevant publication-side trigger is chapters_publication_sync_outbox, which runs after a chapter insert or status update when the new status is published; it calls public.enqueue_publication_sync_event(). That function is SECURITY DEFINER, owned by postgres, has search_path=public, and inserts a minimal chapter_id payload into public.publication_sync_outbox with conflict handling on (chapter_id,event_type). The observed function ACL does not grant EXECUTE to anon or authenticated; trigger execution itself does not require the caller to have direct execute permission on the trigger function.

Other inspected SECURITY DEFINER trigger functions include the continuity/quality gate synchronizers, publication review gates, continuity extraction enqueue, series production enrollment, long-term narrative architecture refresh, and narrative compliance trigger. Most are owned by postgres and have explicit search_path settings. public.taleforge_trigger_narrative_compliance() is the exception: it sets an empty search path and calls public.taleforge_verify_narrative_compliance(new.id) with an explicitly schema-qualified reference. This reduces implicit object lookup in the wrapper, but the downstream function's own body, ownership, ACL, and settings still need inspection before the complete call chain can be cleared.

### Gate update

The live catalog evidence now confirms the policy inventory and key trigger entry points, but it does not yet establish that all trigger bodies and downstream privileged routines preserve the intended publication boundary. Before designing a publication transaction or changing grants, inspect the exact constraints/indexes and the full downstream security-definer call graph, especially the narrative-compliance verifier and routines called by publication triggers. Keep the production migration/deployment gate closed. No grants, policies, triggers, functions, schedules, chapters, or publication state were changed.


## Publication transaction constraint and idempotency review — 2026-10-16

A read-only catalog query retrieved exact constraint and index definitions for chapters, publication reviews, review records, the publication sync outbox, and release schedules.

- chapters enforces a unique (series_id, chapter_number), checks status against draft/review/approved/published/scheduled, and cascades chapter deletion to its series relationship.
- chapter_publication_reviews permits one row per generation_output_id and constrains decision to pending/approved/rejected/needs_revision. Its generation-output foreign key cascades on delete.
- chapter_reviews permits one row per (generation_output_id, review_type), constrains review_type to quality/continuity/originality/safety, and constrains status to pending/running/passed/needs_revision/failed.
- publication_sync_outbox has a unique (chapter_id, event_type) key, a chapter foreign key with ON DELETE CASCADE, a constrained status set (pending/processing/succeeded/failed), and a partial readiness index over pending/failed rows ordered by status and next_attempt_at.
- release_schedules enforces one schedule per series, valid schedule modes, chapters_ahead from 1 to 20, and preferred_weekday from 0 to 6 when present. Two interval constraints overlap: one requires interval_hours between 8 and 168 when non-null, while another requires it to be at least 1. The combined effective lower bound is 8 hours; the redundant check should be documented or reconciled in a future reviewed migration, not edited live during this audit.

### Transaction-design implications

The outbox uniqueness key provides a database-level deduplication boundary for a given chapter/event type, but it does not alone prove that the chapter transition, schedule advancement, review authorization, and outbox enqueue form one authorized atomic publication operation. The chapter trigger inserts the outbox record in the same database transaction as the chapter insert/status update, which is useful, but the broader publication flow still needs transaction-boundary and rollback tests. Because outbox rows cascade on chapter deletion, the publication design must also explicitly decide whether deletion is allowed after publication and how downstream sync/audit obligations survive deletion.

These definitions narrow the schema questions but do not authorize a migration or establish that the live scheduler/publisher uses the intended transaction boundary. Continue to treat production publication as blocked until the authorization, review, chapter-state, schedule, and outbox invariants are proven together in disposable PostgreSQL and the deployed Edge Runtime. No data or schema was changed.


## Privileged trigger follow-up — 2026-10-16

A read-only follow-up confirmed that public.taleforge_verify_narrative_compliance() is owned by postgres, uses SECURITY DEFINER with an empty search_path, checks for the service_role claim, and has no effective EXECUTE privilege for anon or authenticated. Its trigger wrapper also uses an empty search_path and explicitly schema-qualifies the verifier call. The publication-sync and long-term narrative routines checked are owned by postgres, have explicit search_path settings, and are not executable by anon/authenticated. The internal gate trigger routines are not executable by anon/authenticated/service_role in the observed ACL inventory.

Schema privileges were also checked: anon and authenticated have USAGE but not CREATE on public, and neither USAGE nor CREATE on taleforge_internal. service_role has no CREATE on public and no USAGE/CREATE on taleforge_internal. This reduces risk from ordinary roles creating shadow objects in these schemas, but does not clear the full SECURITY DEFINER call graph or the broad table-level grants documented above. No live privileges, functions, schemas, or data were changed.


## Deployed scheduler/publisher caller-authorization gap — 2026-10-16

Read-only retrieval of the currently deployed release-scheduler v12 and release-publisher v21 sources found that both handlers create a Supabase client with the service-role key but do not validate the incoming request's API key against a trusted internal-key allowlist or independently require the caller to be service_role. Both functions have verify_jwt enabled, which requires a valid JWT but does not, by itself, establish that the caller is a trusted internal scheduler/service. The live publisher calls taleforge_ceo_execution_gate through its service-role client; that RPC checks the role of the RPC's service-role request, not the identity of the original HTTP caller. Consequently, the governance RPC does not replace a caller-authentication check at the Edge Function boundary.

The hardening-branch scheduler and publisher add trusted internal API-key validation. The branch scheduler also stops automated publication with publication_authorization_not_implemented until authorization is enforced at the database commit boundary, and only advances a schedule after every selected publication is confirmed. The branch publisher rejects existing/racing chapter slots unless the chapter matches the expected published output and reports success only when required synchronization is confirmed. These are prepared branch safeguards, not live behavior. The live caller-authorization gap is therefore an explicit release blocker; do not deploy or enable automated publishing as part of this continuation.

No function was invoked, and no production deployment, configuration change, publication, schedule mutation, or data write was performed.


## Continuation verification — latest CI and focused ACL recheck — 2026-10-16

The latest branch workflow, [run 38868044595](https://github.com/freearmy599/taleforge/actions/runs/38868044595), completed with both jobs successful:

- **Type-check prepared Edge Functions:** all listed function type-checks and source-contract steps passed, including provider-state grants, cooldown recording, provider/publication schema provenance, internal worker authorization, and the repository-wide Gemini quota-guard contracts.
- **Disposable PostgreSQL rehearsal:** all steps passed, including readiness/concurrency, reader-event integrity and INSERT-only grants, provider-state client ACL revocation/redaction, and future-object default-privilege rehearsal.

This remains branch/disposable-database evidence only; it does not validate the live Edge Runtime, apply live ACL changes, resolve migration provenance, or make cooldown recording atomic.

A further read-only live catalog check independently reconfirmed table-level privileges for `anon` and `authenticated` on the publication-boundary relations. In the focused relation set, these roles have broad privileges on `chapter_blueprints`, `chapter_generation_outputs`, `chapter_publication_reviews`, `chapter_reviews`, `chapters`, `publication_sync_outbox`, `reader_events`, `release_schedules`, `series`, and `story_blueprints`; the scheduler lease table and autonomous-series-run table remain without those ordinary-role table grants. The policy inventory still contains only the published-read policies for `chapters` and `series`, plus the constrained `reader_events` insert policy, among the inspected publication relations. No column-specific ACL entries were returned for the focused tables; this does not remove or mitigate the table-level grants.

The confirmed next repair boundary is therefore **not** a blanket revoke. Prepare an explicit least-privilege matrix per relation and per application call path, preserve public reads of published series/chapters and the intended reader-event intake, and test the exact grants/policies against disposable PostgreSQL. Keep server-only workflow/review/output/outbox/schedule data inaccessible to ordinary roles unless a verified browser call path demonstrates a necessary narrowly scoped permission. Do not apply any production ACL change in this continuation.

No production database writes, migrations, function deployments, schedule changes, generation, or publication occurred during this verification.


## Phase 1 continuation — fresh publication catalog delta — 2026-10-16

A fresh read-only catalog pass was run after the latest successful CI. It queried only PostgreSQL catalog metadata in the live Supabase project; no application rows, secrets, chapter content, provider payloads, or credentials were selected. No writes or function invocations occurred.

### Confirmed again

- The 12 expected core relations in `public` remain present and owned by `postgres`, with RLS enabled.
- For ten internal/workflow relations — `chapter_blueprints`, `chapter_generation_outputs`, `chapter_publication_reviews`, `chapter_reviews`, `publication_sync_outbox`, `release_schedules`, `story_blueprints`, plus the public-facing `chapters`, `series`, and `reader_events` tables — both `anon` and `authenticated` have effective table-level `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges in the observed catalog.
- In that focused set, RLS is enabled on all 12 relations. Only three policies are present: published-chapter SELECT, published-series SELECT, and constrained reader-event INSERT. The other inspected relations have no policies.
- The live schema named `aevora_private` was not found. The project has an existing `taleforge_internal` schema according to the earlier read-only schema inventory; do not assume `aevora_private` is an alias or create it to satisfy the script.
- No relation named `reader_event_quota_buckets` or `reader_event_quota_cleanup_state` was found in any schema in the live catalog query. These names are therefore not merely misplaced between `public` and `aevora_private`; they are absent from the catalog at the time of this inspection.
- The live catalog includes the three lease routines `aevora_claim_release_scheduler_lease(uuid, uuid, integer)`, `aevora_renew_release_scheduler_lease(uuid, uuid, integer)`, and `aevora_release_scheduler_lease(uuid, uuid)`. They are SECURITY DEFINER, owned by `postgres`, configured with `search_path=pg_catalog, public, pg_temp`, and their observed EXECUTE ACL is limited to `postgres` and `service_role`. Their existence does not mean the live scheduler calls them; prior deployed-source inspection found that live scheduler v12 does not call the lease RPCs.

### What this changes in the Phase 1 plan

1. The publication schema inventory must explicitly account for the actual `taleforge_internal` schema and explain why it differs from the branch script's expected `aevora_private`. Treat this as a provenance/design discrepancy, not permission to rename/create schemas.
2. The two absent reader-event quota relations must be reconciled against tracked migrations and deployed reader-event callers before any code or migration is drafted. Do not create empty replacement tables solely to satisfy the audit script.
3. The broad client grants on workflow tables remain a high-priority access-control blocker. RLS does not constrain `TRUNCATE`; no-policy RLS is not a substitute for least-privilege table grants. Prepare a per-table/per-operation grant matrix that preserves only verified browser-facing reads and reader-event intake, then rehearse that exact matrix in disposable PostgreSQL.
4. Lease RPC existence narrows the scheduler blocker: the live database routines are present with server-only EXECUTE ACLs, but the deployed scheduler has not been shown to integrate them. Verify routine definitions and compare exact caller behavior before treating lease enforcement as complete.

### Status

No production changes were made. Provider-state migration provenance, owner-level default privileges, atomic cooldown recording, publication transaction authorization, least-privilege client grants, missing relation provenance, and live scheduler integration remain open gates. Automatic publication remains NO-GO.


## Live lease-routine definition review — 2026-10-16

A read-only `pg_get_functiondef` review inspected the three existing scheduler lease routines. No routine was invoked and no database state was changed.

- `aevora_claim_release_scheduler_lease(uuid, uuid, integer)` is SECURITY DEFINER, owned by `postgres`, and sets `search_path=pg_catalog, public, pg_temp`. It rejects null schedule/token inputs, bounds lease duration to 30–900 seconds, inserts a new lease or replaces an expired lease using an atomic `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE lease_expires_at <= clock_timestamp()`, and returns true only when one row was affected.
- `aevora_renew_release_scheduler_lease(uuid, uuid, integer)` validates inputs/duration and renews only when schedule ID and lease token match and the existing lease has not expired. It returns true only when one row was affected.
- `aevora_release_scheduler_lease(uuid, uuid)` deletes only when both schedule ID and lease token match and returns true only when one row was affected.
- The observed EXECUTE ACLs for these routines are limited to `postgres` and `service_role`; `anon` and `authenticated` are not granted execution.

This narrows the lease-specific issue: the database routines have token matching, bounded lease durations, expiration checks, and server-only EXECUTE ACLs. It does **not** establish end-to-end lease enforcement. The deployed `release-scheduler` v12 source previously inspected does not call the claim/renew/release routines, so concurrent scheduler invocations are not protected by these database functions until the deployed caller is safely reconciled and an authorized rollout occurs.

The prepared branch remains the place to validate lease acquisition, renewal, release in every exit/error path, and refusal to advance schedules after partial publication. Production deployment remains unauthorized and automatic publication remains NO-GO.


## Follow-up direct catalog verification — 2026-10-16

A further read-only catalog pass through the connected Supabase project confirmed the provider-state table and its key metadata directly:

- Relation owner is `postgres`; RLS is enabled and not forced.
- Columns are `provider text NOT NULL` (primary key), `cooldown_until timestamptz NULL`, `consecutive_throttle_count integer NOT NULL DEFAULT 0`, nullable `last_error text`, nullable `last_error_at timestamptz`, and `updated_at timestamptz NOT NULL DEFAULT now()`.
- The only reported constraint/index for this relation is primary key `taleforge_ai_provider_state_pkey` on `provider`.
- The targeted catalog search returned no matching routine names for provider-state, Gemini throttle, or cooldown in `public`, `extensions`, or `taleforge_internal`. This is a name-pattern inventory, not proof no differently named routine could touch the table.
- The live migration ledger still contains `20261007025751 add_taleforge_ai_provider_cooldown_state`; the latest recorded migration remains `20261010161919 aevora_release_scheduler_leases`. Neither `20261013120000` nor `20261014170000` is recorded as applied.

The direct relation ACL query again found ordinary-client grants to both `anon` and `authenticated` for SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and the PostgreSQL-version-specific `MAINTAIN` privilege. `service_role` also retains its table privileges. Do not interpret the existence of RLS as making these table grants harmless; RLS does not constrain TRUNCATE or MAINTAIN.

The default-ACL catalog query returned broad future-object defaults for both `postgres` and `supabase_admin` owners, including client table grants, sequence grants, and function EXECUTE. This reinforces that the later default-privilege migration is not reflected in the live ledger and that owner-level `supabase_admin` remediation remains a separate gate.

These checks were catalog-only SELECTs. No application rows, database writes, migrations, deployments, schedule changes, or chapter operations were performed. This evidence confirms live drift but does not resolve the missing original migration body. Keep the atomic cooldown implementation blocked until provenance is reconciled and the full authorized inventory (including column ACLs, triggers, routine definitions, and owner-specific defaults) is reviewed.


## Follow-up publication-boundary catalog verification — 2026-10-16

A direct read-only catalog pass confirmed all ten audited publication/workflow relations exist as ordinary tables owned by `postgres`, with RLS enabled and not forced:

- `chapter_blueprints` (21 columns)
- `chapter_generation_outputs` (20)
- `chapter_publication_reviews` (11)
- `chapter_reviews` (10)
- `chapters` (19)
- `publication_sync_outbox` (12)
- `reader_events` (7)
- `release_schedules` (15)
- `series` (28)
- `story_blueprints` (32)

The direct table ACL inventory again found `anon` and `authenticated` grants on **all ten** relations for SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, and PostgreSQL's `MAINTAIN` privilege. `service_role` has its own broad grants as expected for the reviewed server-side workflows. RLS being enabled does not neutralize table privileges such as TRUNCATE or MAINTAIN. This is direct relation ACL evidence; a final least-privilege decision still needs the full policy, column-ACL, and caller-path matrix. Do not perform a blanket revoke: published reader SELECT and the deliberately constrained reader-event intake need their own verified paths.

Selected live constraints reinforce the transaction design requirements:

- `chapters` and `chapter_blueprints` each have uniqueness on `(series_id, chapter_number)`.
- `chapter_publication_reviews` has one row per `generation_output_id`; `chapter_reviews` has one row per `(generation_output_id, review_type)`.
- `publication_sync_outbox` has uniqueness on `(chapter_id, event_type)`.
- `release_schedules` has both `interval_hours >= 8 AND <= 168` and another `interval_hours >= 1` check, so the effective lower bound is 8 hours when non-null.
- The `chapters` table has an AFTER INSERT/UPDATE-OF-status trigger for published rows that calls `enqueue_publication_sync_event()`, owned by `postgres` and marked SECURITY DEFINER. It also has continuity extraction, long-term architecture refresh, chapter-count, and timestamp triggers.
- `chapter_generation_outputs` and `chapter_publication_reviews` have SECURITY DEFINER gate-sync/enforcement triggers. These call paths must be inspected before changing ACLs or designing a publication transaction; the trigger name and flags alone do not prove the full safety of their function bodies.

This pass was catalog-only. It did not inspect application row content, modify grants, apply migrations, or execute publication workflows. It expands the confirmed live drift evidence but does not clear rollout. A complete reconciliation still requires the full routine bodies/search paths and policy/column ACL inventories, plus the missing provider-state migration source.
