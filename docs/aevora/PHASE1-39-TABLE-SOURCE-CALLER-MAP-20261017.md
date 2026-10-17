# Aevora Phase 1 — 39-table source-to-caller map (2026-10-17)

## Scope and confidence

Branch: `aevora/release-scheduler-hardening`. This is a **static source inventory**, not a live permission decision. I inspected the 39 names in `PHASE1-POLICYLESS-TABLE-CLASSIFICATION-20261016.md` against the checked-in browser entry pages/shared JS and the 21 Edge Function entrypoints. The call sites below are direct literal table references found in the source, with line numbers at the time of this scan. RPC implementations, SQL functions/triggers, dynamic table names, indirect imported modules, deployed source differences, and other callers may add paths; absence of a direct `.from("table")` match is **unresolved**, not proof of no use.

The live read-only catalog finding remains: 39 public relations have RLS enabled, zero policies, and broad relation/column grants to both client roles. No production state was changed. Do not apply a blanket ACL change from this map.

## Browser surface observed

| Source | Direct database access observed | Boundary interpretation |
|---|---|---|
| `taleforge-data.js` | `series` (lines 17, 22), `chapters` (lines 37, 52), `story_intelligence` (line 36) | Published-series/chapter reads are the intended reader surface; confirm RLS/policies restrict rows to published content. |
| `index.html` | `chapters` (line 73) | Read-only aggregate for rising stories; query filters to published rows. |
| `stories.html` | `story_trending_scores` (line 23) | Read-only trending view; verify view security/underlying permissions separately. |
| `chapter.html` | `chapters` (line 159) | Direct read is constrained to `status = 'published'`; review underlying policy/series visibility predicate. |
| `notifications.html` | `chapters` (lines 34, 38) | Read-only published-chapter update feed; follows/bookmarks are local. |
| `reading-progress.js` | `reader_events` direct insert fallback (line 27) when `window.taleForgeReaderEventIntakeEnabled !== true` | **Known unfinished cutover:** `supabase-client.js:18` currently sets the flag to false, so browser telemetry can still insert directly. The bounded `reader-event-intake` path exists, but enabling it is a separate reviewed rollout decision. |
| `reading-progress.js` | `follows`, `bookmarks`, `reading_history` are stored in browser `localStorage` | These names are local client concepts, not direct queries to the corresponding database tables in the inspected path. |
| `library.html`, `series.html` | Follow/bookmark state through `window.taleForgeProgress` | No direct Supabase queries to `bookmarks`, `collections`, `likes`, `comments`, `profiles`, `ratings`, `notifications`, `reading_history`, `story_reports`, or `recommendations` were found in the inspected browser files. These features appear dormant/server-mediated or not yet wired; verify all source and route paths before a policy decision. |

## Per-relation direct caller inventory

Line numbers refer to the branch source at the scan time. “No direct literal call found” means the table needs RPC/SQL/migration and transitive-call inspection; it is not an authorization to remove its grants.

| Relation | Direct caller evidence in branch | Provisional access decision / next check |
|---|---|---|
| `automation_config` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect SQL routines/triggers and migration-defined configuration readers. |
| `chapter_blueprints` | `generate-chapter/index.ts:69,124,127,155`; `revise-chapter/index.ts:596`; `generation-orchestrator/index.ts:12,63,65,91`; `continuity-review/index.ts:379`; `safety-review/index.ts:320`; `publication-review/index.ts:251`; `release-publisher/index.ts:89,103,150,153`; `blueprint-planner/index.ts:85,150` | Server-only candidate; preserve only trusted worker/service access. |
| `chapter_generation_outputs` | `generate-chapter/index.ts:118,136`; `revise-chapter/index.ts:522,566,1089,1183,1260,1269,1276`; `generation-orchestrator/index.ts:64,65,87,88,91`; `review-orchestrator/index.ts:184`; `continuity-review/index.ts:249,885`; `originality-review/index.ts:310,829`; `safety-review/index.ts:268,681`; `publication-review/index.ts:116,712`; `release-scheduler/index.ts:255,388`; `release-publisher/index.ts:34,89,119,149,153` | Server-only candidate; publication state must remain guarded. |
| `chapter_publication_reviews` | `publication-review/index.ts:668`; `release-scheduler/index.ts:285,406`; `release-publisher/index.ts:34,130` | Server-only candidate; trusted review and publisher only. |
| `chapter_reviews` | `revise-chapter/index.ts:663`; `generation-orchestrator/index.ts:72`; `review-orchestrator/index.ts:281`; `continuity-review/index.ts:848`; `originality-review/index.ts:792`; `safety-review/index.ts:644`; `publication-review/index.ts:379` | Server-only candidate; verify no direct editor UI path exists. |
| `generation_jobs` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect orchestration RPCs, triggers, and admin monitor RPCs. |
| `generation_settings` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; check whether settings UI is RPC-mediated. |
| `publication_sync_outbox` | `release-publisher/index.ts:6,15`; `publication-sync-processor/index.ts:24,31,44,74,89` | Server-only candidate; transactional outbox access only. |
| `release_schedules` | `generate-chapter/index.ts:76,210`; `generation-orchestrator/index.ts:49`; `review-orchestrator/index.ts:226`; `release-scheduler/index.ts:59`; `release-publisher/index.ts:40`; `autonomous-series-creation-runner/index.ts:128,139,140`; `aevora-control-plane-audit/index.ts:73` | Server-only candidate; scheduler/publisher mutation should use guarded workflow and lease/commit checks. |
| `story_attachment_metrics` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only telemetry candidate; inspect ingestion RPCs/triggers and any dynamic SQL. |
| `story_blueprints` | `continuity-review/index.ts:331`; `originality-review/index.ts:366` | Server-only candidate; inspect planner/SQL writers and confirm no author UI direct access. |
| `story_versions` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect revision/rollback RPCs and triggers. |
| `taleforge_ai_provider_state` | `generate-chapter/index.ts:53,239`; `revise-chapter/index.ts:356,458`; `generation-orchestrator/index.ts:32`; `review-orchestrator/index.ts:104`; `continuity-review/index.ts:195`; `originality-review/index.ts:262`; `safety-review/index.ts:220`; `blueprint-planner/index.ts:118`; `story-dna-planner/index.ts:69`; `arc-planner/index.ts:78`; `character-continuity/index.ts:83`; `world-continuity/index.ts:82`; `semantic-continuity-extraction/index.ts:26`; `aevora-control-plane-audit/index.ts:72` | Privileged state; preserve server-only access and complete live ACL reconciliation. |
| `taleforge_ceo_daily_operations` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect Clara/CEO SQL routines and scheduled jobs. |
| `taleforge_ceo_incidents` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect governance/incident SQL routines. |
| `taleforge_ceo_repair_plans` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect repair RPCs and scheduled routines. |
| `taleforge_continuity_extraction_queue` | `semantic-continuity-extraction/index.ts:142` | Server-only queue; trusted worker only. |
| `taleforge_executive_reports` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect reporting RPCs and admin monitor. |
| `taleforge_generation_context_snapshots` | `generate-chapter/index.ts:200` | Server-only candidate; generation context is not a browser API. |
| `taleforge_hybrid_story_engine_runs` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect planning RPCs/dynamic writers. |
| `taleforge_inversion_evaluations` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect originality/inversion routines. |
| `taleforge_narrative_profile_selections` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate pending author-facing caller proof; inspect planner RPCs. |
| `taleforge_novelty_signatures` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect originality/reuse SQL routines. |
| `taleforge_story_concept_design_runs` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect concept-design routines and creator UI. |
| `taleforge_story_opportunity_runs` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect autonomous creation orchestration RPCs. |
| `taleforge_system_governance_dependencies` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect governance functions and triggers. |
| `taleforge_system_governance_registry` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect governance functions and triggers. |
| `taleforge_system_governance_runs` | No direct literal call found in the 21 Edge entrypoints/browser source scan | Server-only candidate; inspect governance functions and triggers. |
| `bookmarks` | No direct Supabase query found in inspected browser sources; bookmark data currently uses `reading-progress.js` localStorage | Do not create DB policy just to make dormant DB feature work. Verify all routes/SQL before locking/revoking. |
| `collection_stories` | No direct Supabase query found in inspected browser sources | Dormant/unclear; verify all route/SQL callers before access changes. |
| `collections` | No direct Supabase query found in inspected browser sources | Dormant/unclear; verify all route/SQL callers before access changes. |
| `comments` | No direct Supabase query found in inspected browser sources | Dormant/unclear; verify all route/SQL callers before access changes. |
| `likes` | No direct Supabase query found in inspected browser sources | Dormant/unclear; verify all route/SQL callers before access changes. |
| `notifications` | No direct Supabase query found in inspected browser sources; `notifications.html` builds a published-chapter feed from `chapters` | Account-backed notification table appears unwired; do not confuse UI page name with DB table use. |
| `profiles` | No direct Supabase query found in inspected browser sources | Dormant/unclear; verify authentication and profile projections before policy design. |
| `ratings` | No direct Supabase query found in inspected browser sources | Dormant/unclear; verify all route/SQL callers before access changes. |
| `reading_history` | No direct Supabase query found in inspected browser sources; history is currently localStorage-backed in `reading-progress.js` | Database feature appears unwired; verify all route/SQL callers before policy design. |
| `recommendations` | No direct Supabase query found in inspected browser sources; client recommendations are computed locally from followed genres | Ambiguous/dormant; determine if table is server-generated or intended reader surface. |
| `story_reports` | No direct Supabase query found in inspected browser sources | Dormant/unclear; verify moderation/report intake routes and SQL routines before policy design. |

## Live SQL-routine reference audit — read-only catalog snapshot (2026-10-17)

A second read-only query compared the 39 audited relation names against public.pg_proc.prosrc and checked effective EXECUTE privileges. This is a literal source-text match, not a full dependency graph: dynamic SQL, indirect calls, triggers, views, and dependencies through other functions can be missed or over-attributed.

- 64 public routines contained at least one literal match to a name in the 39-relation set.
- 58 were SECURITY DEFINER; 6 were SECURITY INVOKER.
- All 64 reported service_role executable in the snapshot.
- Four of the matched routines were executable by both anon and authenticated: apply_attachment_directives(uuid), get_production_buffer_plan(), get_story_narrative_destination(uuid), and refresh_story_attachment_metrics(uuid).
- prepare_next_chapter_blueprint(uuid) was also client-executable and delegates to apply_attachment_directives(uuid), although its own source body does not literally mention a relation from the 39-name list.
- The branch candidate 20261013110000_restrict_internal_invoker_rpc_execution.sql revokes direct client EXECUTE from these and the other identified client-executable invoker/trigger/scoring routines. It is not present in the live migration ledger, so do not treat its protections as deployed.

**Priority interpretation:** the four directly matched client-executable routines warrant explicit negative-call and trusted-worker regression tests. They are SECURITY INVOKER, not SECURITY DEFINER; the catalog query does not prove an RLS bypass. Their behavior remains bounded by the caller's relation privileges and applicable RLS. Keep the candidate unapplied until disposable tests prove direct client RPC denial, trigger behavior remains intact, and trusted worker paths still function.

## Focused live relation-ACL cross-check — read-only (2026-10-17)

A separate effective-privilege query rechecked six high-impact relations referenced by internal workflow routines: chapter_blueprints, chapter_generation_outputs, publication_sync_outbox, release_schedules, story_attachment_metrics, and story_blueprints. Every relation in this sample had RLS enabled, FORCE RLS disabled, zero row policies, and effective table privileges for both anon and authenticated covering SELECT, INSERT, UPDATE, DELETE, and TRUNCATE.

This is stronger evidence of overbroad ACL configuration than a raw explicit-grant listing, but it is not proof that ordinary PostgREST row reads/writes succeed: with RLS enabled and no applicable policy, row operations are normally denied. TRUNCATE is not governed by RLS; the audit confirms the role privilege but does not prove a particular REST route can invoke TRUNCATE. Keep these relations server-only unless a reviewed feature contract proves otherwise, and do not apply blanket production revokes without an approved plan.

## Next evidence required

1. Map the 28 server-only candidates through every SQL function, trigger, view, migration, and scheduled job, including SECURITY DEFINER call chains and dynamic SQL.
2. Map the 11 product-facing/ambiguous relations through all route files and SQL routines; only then approve a table-specific policy or retain a server-only lock.
3. For the live project, regenerate the effective ACL inventory (relation grants, column grants, sequences, policies, owners, RLS/FORCE RLS, relation kind) and compare against the branch migration rehearsal.
4. Investigate `reader_events` direct browser fallback separately. The bounded intake function is implemented, but the current browser flag remains false. Do not switch live intake or change cron/deployment without explicit approval and rollback preparation.
5. Investigate default ACL provenance for both `postgres` and `supabase_admin`; this static caller scan does not identify the migration/actor that introduced those defaults.

**Conclusion:** This narrows the caller investigation and shows that the 11 reader/community tables are not direct browser CRUD dependencies in the inspected pages today. It does not prove they are unused throughout SQL or deployed functions. Production remains unchanged and automated publishing remains **NO-GO**.
