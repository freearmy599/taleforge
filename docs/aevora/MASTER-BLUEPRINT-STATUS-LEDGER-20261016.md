# Aevora Master Blueprint Status Ledger
Date: 2026-10-16
Repository: `freearmy599/taleforge` (product name: Aevora)
Working branch: `aevora/release-scheduler-hardening`

## Purpose and status rules

This is the project-wide map, not just the Phase 1 engineering checklist. It tracks the product vision and separates repository evidence from end-to-end proof.

- **Verified complete**: implementation and required tests/evidence reviewed; no known blocking gap for the stated scope.
- **Partially built**: relevant code/UI/data model exists, but required behavior or integration is incomplete or not fully verified.
- **Blocked**: progress depends on missing authoritative evidence, a security/architecture decision, or an upstream task.
- **Not started / deferred**: planned work without evidence of a usable implementation.
- **Needs inventory**: prior notes indicate a system exists or is planned, but a fresh component-by-component audit is needed before assigning stronger status.

A passing CI run validates only the source and test scope named in that run. It does not prove production deployment or end-to-end production behavior. Do not assign a project-wide completion percentage until the item inventory and acceptance criteria are audited.

## Executive status

- **Current phase:** Phase 1 — Reliability, security, and safe publishing.
- **Current gate:** Production NO-GO for automatic publication and unreviewed migrations.
- **Latest observed CI:** run [38895944662](https://github.com/freearmy599/taleforge/actions/runs/38895944662) passed both prepared Edge Function/source-contract validation and disposable PostgreSQL readiness/security rehearsal. The run includes the browser workflow-table boundary regression test (step 36), provider cooldown contracts, schema-inventory parsing, client ACL/default-privilege rehearsals and other named checks; this is branch/test-environment evidence only.
- **Current branch:** `aevora/release-scheduler-hardening`; latest source/test commit `910dbbda9bad5af157f7299ef8da4fce5d5cf99f`; earlier cooldown-contract baseline `a50d456b1f668a2975f012c1e902b5e42b5c8eff`.
- **Safety boundary:** no production deployment/migration, schedule mutation, chapter generation/publication, or billable Supabase development branch without explicit authorization.

## Master phases

| Phase | Outcome | Status | Exit condition |
|---|---|---|---|
| 1. Reliability, security, safe publishing | Protect data, workers, quota, scheduling, reviews, and publication boundary | **In progress / blocked on evidence** | Resolve schema provenance and privilege gaps; implement atomic cooldown and publication boundaries; validate deployed drift, runtime behavior, schedule dispositions, rollback and authorization; obtain explicit rollout approval |
| 2. Autonomous production loop | A dependable planning-to-reviewed-release pipeline with recovery and observability | **Partially built; end-to-end proof missing** | Demonstrate a controlled full workflow, including retries/recovery and a truthful final status, without unsafe real publication |
| 3. Aevora Originals Factory | Consistently produce original, high-quality long-running series | **Partially built** | Verify series bible/Story DNA, world and character continuity, long-range arcs, chapter plans, originality/safety/editorial review, series isolation, quality metrics and sustainable release cadence |
| 4. Reader-first platform | Make Aevora a destination for readers of excellent original serialized novels | **Partially built; major work remains** | Audit and complete responsive reading UX, series/chapter pages, discovery, search, genre/hybrid taxonomy, reading progress, bookmarks/follows, SEO/accessibility/performance, and reader retention |
| 5. Creator Studio and community | Support independent authors and reader participation | **Deferred; needs inventory** | Define creator publishing/moderation model, author profiles, reviews/ratings, collections, community safety and operational controls |
| 6. Mythara ecosystem and adaptations | Connect Aevora distribution with Mythara-created fictional universes and future manga/anime adaptations | **Long-term / deferred** | Establish stable cross-platform identity, rights/consent, asset/provenance workflows, adaptation pipeline, and distribution integration |

## System-by-system ledger

### Phase 1 — security and operational reliability

| System / workstream | Status | Evidence / remaining work |
|---|---|---|
| Edge Function source/type checks and regression contracts | **Verified for current CI scope** | Run 38895944662 passed the Edge Function job; corrected cooldown contracts include malformed/overflowing persisted-counter rejection and orchestrator fail-closed assertions; branch evidence only |
| Disposable PostgreSQL readiness/security rehearsals | **Verified for current CI scope** | Run 38895944662 completed successfully, including readiness, concurrency-related, reader-event, provider/publication inventory parsing, diagnostic redaction and ACL/default-privilege rehearsals; disposable DB evidence only |
| Provider-state schema provenance | **Blocked** | Live migration ledger includes a creation version whose original migration body is missing from visible repository history; obtain authoritative original migration/deployment evidence; do not fabricate history |
| Provider-state client ACLs and future-object defaults | **Blocked / incomplete** | Table-specific and default-privilege gaps were observed in read-only audit; owner-level `supabase_admin` correction requires separate review and authorization |
| Gemini quota/cooldown guards | **Partially built** | Guards and contracts exist, but atomic persistence is not implemented; live/branch drift and missing-row behavior must be reconciled |
| Atomic cooldown recording | **Blocked on schema provenance** | Needs atomic insert/update, no lost increments, no cooldown shortening, database time, trusted server-only ACL, failure/concurrency tests |
| Scheduler leases/fencing | **Partially built on branch; production drift** | Branch contains lease handling; live scheduler source was observed without lease claim/renew calls. Deploy coordination remains unauthorized |
| Publisher status/idempotency safety | **Partially built on branch; production drift** | Branch adds strict status checks; live publisher has paths that can report success based on chapter existence rather than published status |
| Publication authorization and atomic commit boundary | **Blocked / not implemented** | Branch deliberately stops automatic publication; approval identity/ledger, authorization RPC, atomic chapter/series/schedule/outbox transaction and race/rollback tests remain |
| Readiness and autonomous runner compatibility | **Partially built; reconcile** | Readiness controls and runner contracts exist; production-only runner/function source and dependency compatibility require review |
| Legacy schedules | **Blocked pending individual disposition** | Six candidates identified in prior audit; review each separately, do not bulk-enable or mutate |
| Live-vs-branch Edge Function inventory | **Incomplete** | Prior audit found production-only functions without matching branch paths, including Chief Editor monitor, autonomous creation/runner, operations snapshot and cover workers; fingerprint, source, auth, dependencies and ownership need reconciliation |
| RLS, table grants, internal RPCs, default privileges | **Partially audited; rollout blocked** | Prior audits identified broad client grants and RLS-enabled tables without policies; complete table-by-table access-path review, avoid blanket policies/revokes |
| Reader-event intake / trending integrity | **Branch tests exist; production proof incomplete** | Disposable rehearsal and contracts cover selected integrity/ACL behaviors; deployed schema, quotas, idempotency and caller compatibility still need evidence |
| Supabase Edge Runtime validation | **Open gate** | Local/CI type checks do not substitute for approved runtime validation and deployed drift checks |
| Rollback and release approval | **Not cleared** | Must be documented and approved before production rollout |

### Phase 2 — autonomous production organization

| System | Status | Acceptance criteria still required |
|---|---|---|
| Generation queue and job lifecycle | **Partially built / needs fresh inventory** | Trace queue producers/consumers, stuck jobs, attempt accounting, idempotency and recovery; previous notes recorded a queued Chapter 22 with zero attempts, requiring a fresh read-only status check before drawing current conclusions |
| Chapter generation | **Partially built** | Fail-closed provider state, redacted errors, bounded retries, continuity/quality gates, truthful outcomes, no cross-series contamination |
| Review orchestration | **Partially built** | Required reviews enforced before any release; failed/unknown review states block; no silent skips |
| Revision worker | **Partially built** | Validate deployed-vs-branch drift, revision conflicts, attempt limits and idempotent successor behavior |
| Publication sync and canon sync | **Needs inventory / verification** | Verify outbox delivery, retries, reconciliation and no duplicate or partial state |
| Scheduler and release recovery | **Blocked by Phase 1** | Leases, truthful publisher results, no cursor advance after partial failure, safe recovery and explicit publication authorization |
| Operations monitoring / Chief Editor monitor | **Exists in deployed environment per prior audit; needs inventory** | Track all critical queues, stale work, failed reviews, schedule health, quality regressions and actionable remediation |
| Autonomous series creation | **Partially built; production-only drift to reconcile** | Verify concept selection, uniqueness, readiness, lifecycle/schedule initialization, bounded capacity, recovery and approval gates |
| Covers and series imagery | **Existing production-only cover functions noted; needs inventory** | Confirm ownership, quota/cost controls, safe generation/review, fallbacks and series identity consistency |

### Phase 3 — original novel quality

| System | Status | Acceptance criteria still required |
|---|---|---|
| Story DNA / series bible | **Partially built** | Persistent canon, premise, character motivations, themes, power-system rules and series-specific identity |
| Worldbuilding and continuity | **Partially built** | Cross-chapter and cross-arc checks; prevent facts/characters/plotlines leaking between series |
| Arc and chapter planning | **Partially built** | Long-range foreshadowing/payoff, pacing, chapter hooks, arc progression and plan-to-chapter consistency |
| Originality and safety review | **Review components exist; end-to-end quality unproven** | Enforce review gates, measure false positives/negatives, avoid derivative copying, keep content appropriate and safe |
| Quality evaluation and editorial feedback | **Needs inventory** | Defined rubric, sampled human review, reader signals, regressions, revision policy and stop-ship thresholds |
| Genre/subgenre/hybrid taxonomy | **Planned; implementation needs audit** | Flexible taxonomy for established and original genres without hard-coding a narrow set |
| Production cadence/capacity | **Target defined; not proven** | Aim for one chapter per active series per day and one new series per week, subject to quality, quota, safety and operational capacity; the previously mentioned production cap of eight needs a documented policy |

### Phase 4 — reader-first product

| System | Status | Acceptance criteria still required |
|---|---|---|
| Home/discovery experience | **Existing site; major product audit needed** | Distinctive branded design, clear discovery paths, strong hooks and fresh content |
| Reading experience | **Existing chapter/series pages; quality audit needed** | Mobile-first typography, reading controls, fast navigation, reliable progress and low friction |
| Search and discovery collections | **Needs inventory** | Search, New & Trending, Rising Stories, Hidden Gems, editor picks, curated collections and hybrid genre discovery |
| Reader accounts and library | **Needs inventory** | Reading history, bookmarks, follows, notifications and synchronized progress where appropriate |
| Recommendations/personalization | **Not verified complete** | Behavior-based recommendations with privacy-aware controls and meaningful cold-start handling |
| SEO, accessibility, performance | **Needs audit** | Crawlable series/chapter pages, metadata, keyboard/screen-reader usability, fast mobile load and resilient error states |
| Retention and reader feedback | **Needs implementation/verification** | Release anticipation, series events, safe participation, feedback loops and measurable return-reader metrics |
| Unused manga/anime navigation | **Product constraint** | Keep novel-first scope; hide or defer sections until the product is ready for them |

### Phase 5 — Creator Studio and community

| System | Status | Acceptance criteria still required |
|---|---|---|
| User-generated novel publishing | **Deferred** | Draft/editorial workflow, ownership, publishing permissions, moderation and abuse handling |
| Author profiles and discovery | **Deferred** | Author identity, catalogs, follows and clear original/creator content distinction |
| Ratings, reviews, lists and discussion | **Deferred** | Anti-abuse controls, moderation, reporting, age-appropriate safety and reader trust |
| Creator analytics | **Deferred** | Privacy-aware reads, retention and engagement metrics with sensible access controls |

### Phase 6 — Mythara and adaptation ecosystem

| System | Status | Acceptance criteria still required |
|---|---|---|
| Aevora–Mythara identity and distribution | **Deferred** | Explicit opt-in, rights/consent, provenance, versioning and reliable distribution contracts |
| Novel-to-manga workflow | **Deferred** | Adaptation outline, panel/script pipeline, visual consistency, human review and asset tracking |
| Novel-to-anime workflow | **Deferred** | Script/scene planning, character/setting consistency, production feasibility and review gates |
| Cross-platform universe management | **Deferred** | Canon ownership, continuity reconciliation, change history and conflict handling |

## Dependency order

1. Resolve Phase 1 evidence and security gates before production rollout.
2. Complete the controlled autonomous generation/review/recovery loop.
3. Prove original-story quality and series isolation.
4. Finish the novel-first reader experience and discovery/retention foundation.
5. Add creator publishing and community only after reader and operations foundations are dependable.
6. Integrate Mythara and adaptations after cross-platform rights, identity and canon workflows are designed.

**Direct live-catalog follow-up (2026-10-16):** read-only Supabase catalog queries reconfirmed the provider-state table's exact six-column shape and primary key, found broad `anon`/`authenticated` relation grants (including `TRUNCATE` and `MAINTAIN`), found broad future-object defaults for both `postgres` and `supabase_admin`, and returned no routines matching the provider-state/cooldown naming patterns. The live migration ledger still records `20261007025751 add_taleforge_ai_provider_cooldown_state` and latest `20261010161919 aevora_release_scheduler_leases`; the later provider lock/default-privilege migrations are not recorded as applied. These are catalog-only observations, not permission changes; the original migration body remains unresolved.

**Publication-boundary direct catalog follow-up (2026-10-16):** all ten audited workflow/publication tables exist, are `postgres`-owned with RLS enabled but not forced, and expose broad direct grants to `anon`/`authenticated` including `TRUNCATE` and `MAINTAIN`. Live constraints confirm uniqueness for chapter numbers, review rows, and outbox events; the published-chapter outbox trigger and several SECURITY DEFINER gate triggers need full call-graph review. This is evidence for targeted least-privilege planning, not authorization to revoke grants. Preserve reader paths and constrained reader-event intake; no live permissions were changed.

## Next actions — in order

**Latest continuation update (2026-10-16):** CI run 38895944662 is now confirmed fully green: both jobs completed successfully. The browser workflow-table boundary test passed. This improves branch regression coverage but does not close any live-schema, deployment-drift, or production authorization gate.


1. Preserve the green baseline at run 38895944662; both the prepared Edge Function/source-contract suite and disposable PostgreSQL rehearsal pass. The browser workflow-table boundary guard is included and passing.
2. Reconcile authoritative provider-state migration provenance and owner-level default privileges; do not guess at missing migration history.
3. Obtain reviewed, sanitized publication/provider catalog evidence; reconcile missing objects and production-only functions against migrations and deployed callers.
4. Design atomic cooldown and publication transactions only after schema evidence is reconciled; both cooldown writers must converge on one atomic operation.
5. Prepare and review a least-privilege grant matrix against verified browser call paths, preserving published reads and constrained reader-event intake without blanket revokes.
6. Review the six legacy schedules individually and keep unapproved schedules unchanged/inactive.
7. Add an acceptance-evidence checklist for each system above and then perform a component-by-component audit of Phases 2–4, without assuming that a file existing means the feature is complete.

## Non-negotiable safety boundary

This ledger does not authorize production actions. Do not deploy functions, apply production migrations, mutate schedules, generate or publish chapters, or create a billable Supabase branch without explicit authorization. Preserve fail-closed publication guards. Do not fabricate schema history, production state, test results or completion percentages.

**Latest continuation update (2026-10-16): relation-by-relation least-privilege matrix prepared.** The read-only catalog check found `anon` and `authenticated` each have SELECT/INSERT/UPDATE/DELETE/TRUNCATE on all 13 audited existing relations, including `story_trending_scores` and `story_intelligence` (where RLS is disabled). Exact `series`, `chapters`, and `reader_events` RLS expressions were retrieved. The proposed target matrix is recorded in [`PHASE1-LEAST-PRIVILEGE-RELATION-MATRIX-20261016.md`](PHASE1-LEAST-PRIVILEGE-RELATION-MATRIX-20261016.md). It is planning evidence only: no production permissions changed; preserve reader SELECT, keep reader-event direct INSERT until the trusted intake transition is verified, and do not use blanket revokes. This documentation commit has not been followed by a new CI run; run 38895944662 remains the latest confirmed green baseline.

**Reader-event transition gate (2026-10-16):** the live Edge Function inventory did not list `reader-event-intake`; a read-only catalog query found no `aevora_ingest_reader_event`/quota routines or `aevora_private` quota tables, and the selected reader-event migration-ledger lookup returned no rows. The reviewed branch keeps `window.taleForgeReaderEventIntakeEnabled = false`, so direct `reader_events` inserts remain the current compatibility path in branch source. Do not enable the flag or revoke direct INSERT until the endpoint, schema, quota RPC and rollback path are deployed and verified together. Details: [`PHASE1-READER-EVENT-INTAKE-TRANSITION-GATE-20261016.md`](PHASE1-READER-EVENT-INTAKE-TRANSITION-GATE-20261016.md). No production changes were made.


**Migration compatibility follow-up (2026-10-16):** CI run [38902533143](https://github.com/freearmy599/taleforge/actions/runs/38902533143) completed successfully on commit `5f4acda893e5e6076454bc81c5d407160eacfffd`; both the prepared Edge Function/source-contract job and disposable PostgreSQL rehearsal passed, including reader-event intake contracts and security/ACL rehearsals. This remains branch-only evidence. Added [`PHASE1-MIGRATION-COMPATIBILITY-NONAPPLICATION-GATE-20261016.md`](PHASE1-MIGRATION-COMPATIBILITY-NONAPPLICATION-GATE-20261016.md), which classifies the 2026-10-13–15 hardening migrations by risk and explicitly holds migrations that rewrite provider diagnostics, alter reader-event schema, expose trending aggregates, or disable/change release schedules. Do not bulk-apply these migrations. The live reader-event endpoint/RPC/schema drift remains unresolved; `supabase_admin` default privileges remain an owner-context gap; automatic publishing remains NO-GO. This update records evidence and review gates only—no production migration, grant/policy change, feature flag, schedule mutation, generation, or publication was performed.


**Provider-state atomicity follow-up (2026-10-16):** runs [38903977080](https://github.com/freearmy599/taleforge/actions/runs/38903977080), [38904025908](https://github.com/freearmy599/taleforge/actions/runs/38904025908), and [38904122156](https://github.com/freearmy599/taleforge/actions/runs/38904122156) completed successfully for the prepared branch/test scopes. Added [`PHASE1-PROVIDER-STATE-ATOMICITY-GATE-20261016.md`](PHASE1-PROVIDER-STATE-ATOMICITY-GATE-20261016.md) to record the current provider-state migration risks, unresolved original migration provenance, broad live client grants/default-privilege gaps from prior read-only audit, and the requirement to replace both `generate-chapter` and `generation-orchestrator` read-modify-upsert paths with one concurrency-tested database operation. The provider lock migration's diagnostic rewrite is explicitly held pending review; no production data or privileges were changed. The new documentation commit triggered run [38904501655](https://github.com/freearmy599/taleforge/actions/runs/38904501655), which was queued at the latest check and is not yet counted as green.


**Provider-state gate CI completion (2026-10-16):** [run 38904501655](https://github.com/freearmy599/taleforge/actions/runs/38904501655) passed on commit `09d5ef2e836dfc453a015de256b2e4193eb3ef26`, and [run 38904533738](https://github.com/freearmy599/taleforge/actions/runs/38904533738) passed on commit `2f41a8999af575ac38572c1b427a6c62c0a95417`. Both completed the Edge source-validation job and disposable PostgreSQL rehearsal. The provider atomicity gate is documented, but the production blocker remains: authoritative original migration/deployment provenance and fresh catalog evidence are required before an atomic RPC migration is safely drafted. No production changes were made. This ledger update is documentation-only and will receive its own CI run.


**Fresh live provider-state reconciliation (2026-10-16):** a new read-only Supabase migration inventory returned 232 records, latest `20261010161919 aevora_release_scheduler_leases`, with no migration versions at or after `20261011000000`. The live ledger includes `20261007025751 add_taleforge_ai_provider_cooldown_state` but not the branch provider lock migration `20261013120000` or later reader-intake/default-privilege migrations. A fresh catalog query reconfirmed the provider-state table is owned by `postgres`, has the six expected columns, RLS enabled/not forced, and broad relation-level grants to `anon`/`authenticated` including TRUNCATE and MAINTAIN where supported. Added [`PHASE1-PROVIDER-STATE-ATOMICITY-GATE-20261016.md`](PHASE1-PROVIDER-STATE-ATOMICITY-GATE-20261016.md) with this evidence. This materially confirms live/branch drift but does not resolve the missing original creation-migration source or justify applying any migration. No provider-state row values were read; no production changes were made.


## Continuation verification update (2026-10-16, latest checked runs)

The previously pending runs [38904816298](https://github.com/freearmy599/taleforge/actions/runs/38904816298) and [38904840995](https://github.com/freearmy599/taleforge/actions/runs/38904840995) have now been inspected through their job results. Both runs completed successfully: Edge Function type-check/source-contract regression suite passed, and the disposable PostgreSQL readiness/security rehearsal passed. This confirms only the named branch/test scopes. It does not resolve live provider-state ACL/default-privilege gaps, original migration provenance, deployed function drift, atomic cooldown persistence, publication authorization, or production rollout approval. Production remains NO-GO. No production changes were made.


## Provider-state caller reconciliation update (2026-10-16)

Reviewed the current branch source for `generate-chapter` and `generation-orchestrator`. Confirmed direct reads and two separate application-level read/compute/upsert cooldown writers. The chapter generator has separate fail-closed preflight checks for generation and quality review; the orchestrator's fallback recorder skips incrementing when it observes an active cooldown to avoid apparent double counting, but that is not an idempotency guarantee under concurrency. Added this source-level caller map and atomicity implications to [PHASE1-PROVIDER-STATE-ATOMICITY-GATE-20261016.md](PHASE1-PROVIDER-STATE-ATOMICITY-GATE-20261016.md).

Documentation commit: [b5c6a8d](https://github.com/freearmy599/taleforge/commit/b5c6a8db0e2edcc389b824e4248be4ecef9bf970). No workflow runs were returned for that documentation commit by the available PR-filtered workflow-run query; its CI status is therefore unverified, not failed. This is source review only and does not establish deployed-function parity. The original provider-state creation migration body remains unavailable in the checked branch. Production remains NO-GO; no production changes were made.


## Live provider-state security finding (2026-10-16 continuation)

A read-only inspection of production Supabase (`sxmbnlgufqhcwxcpcsvb`) materially escalated the provider-state gate: the live migration ledger contains the table-creation migration but not the branch's `20261013120000_lock_ai_provider_state_table` migration. Catalog ACL shows `anon`, `authenticated`, and `service_role` have broad table privileges on `public.taleforge_ai_provider_state`; RLS is enabled but not forced, and direct grants remain. Live `generate-chapter` v59 and `generation-orchestrator` v35 still use direct reads and application-level read/compute/upsert writes; the deployed generator persists truncated raw provider error text. No provider-state row values were read and no production data, schema, permissions, function deployment, or schedule was changed.

**Phase 1 gate remains BLOCKED / automated publishing NO-GO.** Next actions: recover the authoritative creation migration body from trusted history/artifacts; design and test the atomic writer and safe error-class persistence; then prepare a separate explicit security migration and verify effective grants/default privileges. Do not apply anything to production without a reviewed migration and explicit authorization. Documentation update only; CI for the resulting commit must be checked independently.


## Expanded provider-state catalog provenance (2026-10-16 continuation)

Additional read-only production catalog checks found a validated `PRIMARY KEY (provider)` and valid unique B-tree index, no user-defined triggers, no RLS policies, and no column-level ACL entries for `public.taleforge_ai_provider_state`. The earlier broad relation-level grants remain the direct client-access blocker. GitHub's commit-path history query found no tracked commit for the original table-creation migration body, despite the live migration ledger recording its version/name as applied. Default-privilege catalog output also shows broad future table grants to client roles and PUBLIC/client function EXECUTE defaults for `supabase_admin` and `postgres`; the related default-privilege repair is not confirmed applied in production.

This improves the schema-provenance record but does not complete the repair. A forward-only migration can be prepared against the verified live catalog and rehearsed on a disposable fixture; it must not be applied to production here. Do not revoke `service_role` table writes until every live writer is migrated, or workers may break. Phase 1 remains BLOCKED / automated publishing NO-GO.
