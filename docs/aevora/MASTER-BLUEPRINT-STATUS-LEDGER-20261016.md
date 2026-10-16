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
- **Latest observed CI:** run [38878784189](https://github.com/freearmy599/taleforge/actions/runs/38878784189) passed both prepared Edge Function/source-contract validation and disposable PostgreSQL readiness/security rehearsal. This includes the corrected provider cooldown recording contracts and malformed-counter source checks; it is branch/test-environment evidence only.
- **Current branch:** `aevora/release-scheduler-hardening`; latest verified regression commit `a50d456b1f668a2975f012c1e902b5e42b5c8eff` (latest ledger update is documentation-only).
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
| Edge Function source/type checks and regression contracts | **Verified for current CI scope** | Run 38878784189 passed the Edge Function job; corrected cooldown contracts now include malformed/overflowing persisted-counter rejection and orchestrator fail-closed assertions; branch evidence only |
| Disposable PostgreSQL readiness/security rehearsals | **Verified for current CI scope** | Run 38878784189 completed successfully, including readiness, concurrency-related, reader-event and ACL rehearsals; disposable DB evidence only |
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

## Next actions — in order

1. Preserve the green baseline at run 38878784189; the corrected cooldown regression contracts and disposable PostgreSQL rehearsal both pass.
2. Reconcile authoritative provider-state migration provenance and owner-level default privileges; do not guess at missing migration history.
3. Obtain reviewed, sanitized publication/provider catalog evidence; reconcile missing objects and production-only functions against migrations and deployed callers.
4. Design atomic cooldown and publication transactions only after schema evidence is reconciled; both cooldown writers must converge on one atomic operation.
5. Prepare and review a least-privilege grant matrix against verified browser call paths, preserving published reads and constrained reader-event intake without blanket revokes.
6. Review the six legacy schedules individually and keep unapproved schedules unchanged/inactive.
7. Add an acceptance-evidence checklist for each system above and then perform a component-by-component audit of Phases 2–4, without assuming that a file existing means the feature is complete.

## Non-negotiable safety boundary

This ledger does not authorize production actions. Do not deploy functions, apply production migrations, mutate schedules, generate or publish chapters, or create a billable Supabase branch without explicit authorization. Preserve fail-closed publication guards. Do not fabricate schema history, production state, test results or completion percentages.
