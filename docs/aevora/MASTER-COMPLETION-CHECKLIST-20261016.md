# Aevora Master Completion Checklist
Date: 2026-10-16
Repository: `freearmy599/taleforge` (product brand: Aevora)
Working branch: `aevora/release-scheduler-hardening`

## Purpose and status rules

This is the project-wide task register for finishing Aevora, including security/reliability, autonomous story production, story quality, the reader website, Creator Studio, and the future Mythara connection. It separates **built but unverified**, **repair/integration work**, and **not started/deferred**. Presence of a file or page is not proof that a system works end to end.

- [x] Create a project-wide inventory and dependency order.
- [ ] Audit each item against current repository source, live/deployed inventory where authorized, and explicit acceptance tests.
- [ ] Update each item only when evidence exists; do not invent a project completion percentage.

## Current executive status

- **Current phase:** Phase 1 — Reliability, security, and safe publishing.
- **Automatic publishing:** **NO-GO** until the Phase 1 exit gate is satisfied and rollout is explicitly authorized.
- **Latest verified code/test CI evidence:** [run 39003585384](https://github.com/freearmy599/taleforge/actions/runs/39003585384) passed both jobs on commit [`63960047fdcf7e5cff523e1ea4e9a3e3134cb9eb`](https://github.com/freearmy599/taleforge/commit/63960047fdcf7e5cff523e1ea4e9a3e3134cb9eb). The Edge validation job passed prepared Edge type checks and source-contract tests. The disposable PostgreSQL job passed the configured readiness, reader-event integrity, trending gate, provider-state ACL, atomic throttle, public default-privilege, internal-table security, internal RPC ACL, and atomic quality-review persistence/rollback rehearsals. The quality-review candidate fences stale review snapshots with `updated_at`, preserves canonical generation-context metadata, and proves rollback when review persistence fails. This validates only the tested branch scope; it does not establish live Supabase compatibility, deployed parity, Edge Runtime behavior, or authorize rollout.
- **Branch-only candidate:** `20261016180000_atomic_gemini_provider_throttle.sql` and RPC caller changes are not production-deployed or runtime-verified.
- **Production boundary:** no production migrations/deployments, schedule changes, chapter generation/publication, or billable Supabase development branch without explicit authorization.
- **Read-only live Supabase audit (2026-10-16):** the project reports 232 applied migrations. Migration ledger entry `20261007025751 / add_taleforge_ai_provider_cooldown_state` exists, but its original SQL is not present in the current repository migration directories; do not reconstruct or claim provenance without the source artifact. Live `public.taleforge_ai_provider_state` has columns `provider`, `cooldown_until`, `consecutive_throttle_count`, `last_error`, `last_error_at`, and `updated_at`; no RLS policies were returned, and `anon` plus `authenticated` have broad table grants including `TRUNCATE`. Candidate ACL lock migration remains unapplied.
- **Read-only reader-event/trending reconciliation (2026-10-16):** live `reader_events` has identity `id`, no `event_uuid` column, and client INSERT remains allowed; the `reader-event-intake` Edge Function and its quota RPC are absent from the live inventory. Live `story_trending_scores` and `story_intelligence` views have client SELECT grants, but both use `security_invoker=true` and `reader_events` has no client SELECT policy, so real event-derived metrics are not proven exposed and may be zeroed by RLS. The branch migration gates both views; live grants remain inconsistent with that intended gate. See [reader-event intake transition gate](./PHASE1-READER-EVENT-INTAKE-TRANSITION-GATE-20261016.md).
- **Deployed release path remains unsafe:** live Edge Functions are `release-scheduler` v12, `release-publisher` v21, `generate-chapter` v59, `generation-orchestrator` v35, `review-orchestrator` v11, and `revise-chapter` v40. Read-only source inspection found no scheduler lease claim/renew/release calls. The scheduler treats only non-2xx publisher responses as failures, so a 2xx response with `success:false` can still be counted as published and schedule advancement can continue after a partial publish failure. The deployed publisher's existing-chapter idempotency path does not verify that the existing chapter status is actually `published` before returning `success:true, published:true`. Branch candidates address these classes of failure but are not deployed; automatic publishing stays NO-GO.

## Canonical system-family inventory and verification sizing (2026-10-16)

This is a planning inventory, not a claim that every system has been fully audited. The count is at the system-family level; individual Edge Functions, pages, database objects, and tests are implementation components inside these families.

**Current planning count: 38 system families**, grouped as follows:
- **10 foundation/reliability families:** authentication and internal authorization; database/RLS/grants; provider state and quota controls; AI-call guards; scheduler/leases; publisher/idempotency; publication authorization/outbox/canon sync; reader-event/trending data; operations audit/monitoring; CI/deployment/migration drift.
- **8 autonomous-production families:** series creation; Story DNA/series bible; blueprint and arc planning; chapter generation; revision/retry handling; review orchestration; continuity workers (character/world/semantic); queue recovery and production telemetry.
- **6 Originals quality families:** originality and safety; series/canon isolation; measurable editorial quality scoring; long-horizon plot/arc coherence; genre/subgenre/hybrid intelligence; titles/synopses/covers and series identity.
- **6 reader-platform families:** homepage/discovery; search/filters/collections; series pages; chapter reader; reader library/progress/bookmarks; personalization/retention plus SEO/accessibility/performance checks (grouped for planning and split into explicit acceptance checks).
- **3 Creator Studio/community families:** creator publishing workflow; author profiles/analytics; reviews/lists/discussion/moderation.
- **3 Mythara/adaptation families:** opt-in identity/rights/distribution; novel-to-manga; novel-to-anime and cross-version canon.
- **2 cross-cutting agent systems:** Clara and Chief Editor.

The 38 is a working count of major system families, not 38 independent applications or 38 completed builds. The detailed register below remains the source of truth for tasks. As the code/schema inventory becomes more complete, split or merge families transparently rather than reporting a false completion percentage.

### Verification level by family

- **Critical / release-blocking:** foundation/reliability, provider/quota safety, scheduler, publisher, publication authorization, and the controlled production loop. Requires source review, type-checks, regression contracts, isolated database rehearsal, concurrency/race tests where applicable, runtime compatibility, authorization review, rollback plan, and deployment-version reconciliation. Production rollout is a separate explicit approval.
- **High / content-quality blocking:** autonomous production and Originals quality. Requires representative end-to-end series and chapter runs in a safe environment, structured review outputs, negative/failure cases, series-isolation tests, and long-horizon checks at 50/100/200+ chapters. A quality score alone cannot guarantee every novel is excellent; low-confidence or failed checks must block release or escalate to editorial review.
- **High / reader-launch blocking:** public navigation, discovery, series pages, reader, mobile behavior, published-content boundaries, search, accessibility, SEO, and performance. Requires route/button audit, phone/tablet/desktop checks, real-data integrity, smoke tests, and checks that unpublished content is never exposed.
- **Medium-to-high / deferred until needed:** Creator Studio and community. Requires permissions, ownership/rights, moderation, abuse controls, privacy, and publication lifecycle tests before opening to users.
- **High / later integration:** Mythara and adaptations. Requires explicit opt-in and rights, provenance/versioning, canon ownership, cross-platform failure handling, and human editorial review.

### Clara and Chief Editor — role and proof requirements

- **Clara:** the project vision expects a cross-system governance/beautification agent that identifies UI and operational problems, proposes prioritized fixes, respects resource and safety limits, and does not autonomously change production without an approved path. Current design documents also describe a separate Product Designer charter. Before implementation is expanded, reconcile whether Product Designer is Clara's UI-specialist capability or a separate agent; do not build two overlapping control planes by accident. Verify authorization, proposal/evidence format, design-system consistency, accessibility/mobile review, cost limits, human approval, staged changes, rollback, and audit logging.
- **Chief Editor:** a chief-editor.html admin monitor and a production-only/deployed function have been identified in earlier inventory, but the existence of a page is not proof that the full editorial agent works. Verify admin-role enforcement server-side, live/deployed function parity, read-only behavior where intended, series/chapter scoping, actionable findings, integration with review outcomes, and that failed/missing reviews block release. Keep its monitoring role distinct from authority to publish.
- **Quality promise:** do not claim a mathematical guarantee of literary excellence. The implementable guarantee is a quality gate: every chapter must meet defined minimum criteria and pass required originality, continuity, safety, and editorial checks; failures are revised, blocked, or escalated rather than auto-published. Validate this with seeded good/bad cases and sampled human review.

## Phase 1 — Reliability, security, and safe publishing (CURRENT BLOCKER)

### A. CI, tests, and runtime
- [x] Reconcile the review error-redaction contract with the atomic RPC implementation; the updated source-contract test passed in CI run 38922139195.
- [x] Run the provider cooldown recording contract on the latest branch commit; CI run 38922139195 passed and the 11-writer atomicity contract is also included in the Edge validation source-contract suite.
- [x] Update and execute the Gemini quota-guard contract for RPC persistence and malformed persisted-counter behavior; CI run 38922139195 passed.
- [x] Expand the provider-state atomicity contract to all 11 migrated branch writers; source-contract execution passed in CI run 38922139195.
- [x] Add and run a disposable PostgreSQL provider-throttle rehearsal with explicit opt-in, refusal of Supabase URLs, an `aevora_*` database-name check, and a separate database created by CI.
- [x] Apply the candidate migration in disposable PostgreSQL and test function creation, schema fixture compatibility, effective role ACLs, invalid event input, negative-counter rejection without normalization, and safe diagnostics. Live-schema provenance and Supabase-runtime compatibility remain separate gates.
- [x] Run a 20-session concurrent quota-event rehearsal against an initially empty fixture; all 20 increments were preserved, exercising concurrent first insertion. The same rehearsal verified no shortening of an existing longer cooldown and the one-hour overload path.
- [x] Historical mixed quota/overload concurrency test passed in CI run 38929236122, but it validated the superseded shared-counter semantics. The new candidate rehearsal now separately covers quota-only escalation, stable event IDs, sequential and concurrent duplicate replay, and monotonic cooldown; latest execution is pending.
- [x] Run configured Edge Function type checks and regression contracts to green on code/test commit `4bf3c06e7377f247157a2881aced49b83b7c81f8` (CI run 38942162638); both jobs passed, including the corrected reader-event payload compatibility contract and disposable PostgreSQL readiness, reader-event integrity, trending gate, provider-state ACL/redaction, atomic throttle concurrency, public default-privilege cleanup for both object owners, and internal-table security rehearsals. This validates only the tested branch scope, not live compatibility or deployment.
- [ ] Validate Supabase Edge Runtime compatibility separately; static TypeScript checks alone are insufficient.
- [x] Reconcile the complete branch writer inventory by scanning all 21 Edge Function TypeScript entrypoints; ten direct provider-call writers plus the `generation-orchestrator` fallback were found. See [Gemini throttle caller audit](./PHASE1-GEMINI-THROTTLE-CALLER-AUDIT-20261016.md).
- [x] Implement a new branch-only event-ledger migration candidate and update the ten direct provider-call writers to supply event IDs. The orchestrator now observes child block results without a second write. The revised disposable rehearsal covers duplicate replay and quota-only escalation; it passed in CI run [38935788221](https://github.com/freearmy599/taleforge/actions/runs/38935788221), including 20 concurrent same-ID submissions counted once and 20 distinct quota events preserved.

### B. Provider-state and Gemini quota safety
- [ ] Recover authoritative provenance for live migration `20261007025751 add_taleforge_ai_provider_cooldown_state`, or finish a reviewed forward-only repair based on the verified live schema; do not fabricate migration history. The exact original migration file is absent from this branch.
- [x] Perform a read-only live catalog audit of `taleforge_ai_provider_state`: owner `postgres`; six expected columns; primary key/unique index on `provider`; RLS enabled but not forced; no table triggers or provider/cooldown routines found by the catalog query.
- [x] Confirm effective live grants: `anon` and `authenticated` can SELECT, INSERT, UPDATE, DELETE, and TRUNCATE the provider-state table and have broad column-level grants. A fresh read-only catalog query on 2026-10-16 also shows broad relation ACLs for `service_role` and broad default privileges for both `postgres` and `supabase_admin` over future public tables, sequences, and functions, including client-role grants. Candidate repair remains unapplied.
- [ ] Finish the reader/writer call-graph audit and prepare a least-privilege repair that preserves required server-side callers. Do not change production grants as part of this continuation.
- [x] Set the throttle contract: overload events do not increment or reset the quota escalation counter; they receive a minimum one-hour cooldown without shortening a longer existing cooldown. Duplicate observations must be idempotent using a stable per-provider-call event identity.
- [x] Implement the corrected semantics in new candidate migration `20261016190000_idempotent_gemini_provider_throttle.sql`: quota-only counter increments, minimum one-hour overload cooldown, monotonic expiry, fixed diagnostics, and event-ledger deduplication. The ten direct writers now send event IDs; the orchestrator no longer double-records. Source contracts and the disposable PostgreSQL concurrency/ACL rehearsal passed in CI run [38935788221](https://github.com/freearmy599/taleforge/actions/runs/38935788221). Supabase Edge Runtime compatibility, live-schema reconciliation, and deployed function parity remain open.
- [x] Migrate all ten direct provider-call owners to the shared RPC, including `character-continuity`, `world-continuity`, `arc-planner`, `blueprint-planner`, and `story-dna-planner`. Remove the orchestrator fallback writer so child provider failures are recorded once. This is branch-source evidence only; deployed parity and runtime verification remain open.
- [ ] Reconcile all deployed function versions with branch source. Read-only live inspection found `generate-chapter` v59, `generation-orchestrator` v35, and `revise-chapter` v40 still contain direct provider-state upsert paths and do not call `aevora_record_gemini_throttle`; live `continuity-review` v10, `originality-review` v9, and `safety-review` v9 also do not call the candidate RPC. The branch migrations `20261016180000_atomic_gemini_provider_throttle.sql` and `20261016190000_idempotent_gemini_provider_throttle.sql`, plus branch-only grant/default-privilege repairs, are not present in the live migration ledger, whose latest listed version is `20261010161919`.
- [x] Add regression contracts and branch guards requiring all 13 provider-state readers to fail closed when `consecutive_throttle_count` is non-integer, unsafe, or negative; CI run 38930753143 passed the source-contract suite. Deployed versions remain unchanged, so production still needs a separately authorized rollout after remaining gates.
- [ ] Replace unsafe raw provider-error persistence with allowlisted diagnostics after reviewing retention/evidence requirements; never put raw response bodies or user content into routine logs.
- [ ] Review all provider-state read paths and decide whether to use a narrow read RPC or a reviewed trusted server-role access path.
- [ ] Prepare a least-privilege matrix before changing grants. Revoke client write access only after callers and reader paths are proven compatible.
- [ ] Review owner-specific future default privileges for both `postgres` and `supabase_admin`; do not bypass role boundaries.

### C. Database, RLS, RPC, and publication boundary
- [ ] Complete relation-by-relation review of client grants, RLS policies, column privileges, views, triggers, SECURITY DEFINER functions, and default privileges.
- [ ] Preserve public/published reader SELECT paths and constrained reader-event intake; avoid blanket revokes or broad policies.
- [ ] Reconcile publication tables, uniqueness constraints, outbox trigger, and gate-trigger call graph.
- [ ] Implement and test an explicit publication authorization boundary with an auditable approval identity/record.
- [ ] Validate atomic chapter/series/schedule/outbox updates, rollback behavior, duplicate/race handling, and truthful return statuses.
- [ ] Verify publisher never reports success unless the chapter is actually published and the required state transition committed.
- [ ] Verify scheduler lease claim/renew/release, fencing, expiry, duplicate workers, and safe recovery. Branch and deployed scheduler versions have drifted.
- [ ] Prove the scheduler never advances a release cursor or activates a series after partial publication failure.
- [ ] Review each of the six legacy schedule candidates individually; keep unapproved schedules unchanged/inactive.
- [ ] Review readiness controls and autonomous-runner compatibility without enabling production schedules.

### D. Reader events, audit, and operations security
- [ ] Reconcile the reader-event intake endpoint, schema, quota RPC, feature flag, callers, and rollback path as one transition.
- [ ] Keep `window.taleForgeReaderEventIntakeEnabled = false` and current compatibility paths until the full intake path is deployed and verified together.
- [x] Fix branch compatibility payload so `event_uuid` is attached only when the intake endpoint flag is enabled; the live table lacks that column. Source contract and disposable PostgreSQL CI passed on code/test commit `4bf3c06e7377f247157a2881aced49b83b7c81f8` (run 38942162638).
- [x] Resolve the branch-only mixed-writer idempotency race by inserting/claiming the unique `reader_events` row before mutating quota buckets; this prevents a direct compatibility INSERT winning after the RPC's existence check from consuming quota. Added a disposable PostgreSQL interleaving test that pauses the RPC at a trigger, lets the direct writer claim the same UUID, and asserts `duplicate` plus zero quota hits. Static ordering and rehearsal contracts passed both CI jobs on code/test commit [`1da4c32a`](https://github.com/freearmy599/taleforge/actions/runs/38943812285). A later documentation-only commit adds the live function-default evidence; its CI run is pending. The frontend flag remains disabled and the live endpoint/schema are still absent.
- [x] Read-only live ACL/view review completed for `story_trending_scores` and `story_intelligence`: both are security-invoker views with client SELECT grants; `reader_events` has no client SELECT policy, so client-side view aggregation cannot see event rows under invoker RLS. The live aggregate RPC is absent. See [live trending view ACL review](./PHASE1-LIVE-TRENDING-VIEW-ACL-20261017.md).
- [x] Confirmed branch candidate `20261014130000_public_trending_aggregate_rpc.sql` gates both views and exposes the aggregate function only to `service_role`; browser fallback is present in branch source. Candidate validation and deployment are separate gates.
- [ ] After authorized rollout, verify actual anonymous/authenticated PostgREST output and the deployed frontend commit before claiming that event-backed public metrics are working.
- [ ] Audit the operations snapshot/control-plane audit for authorization, redaction, and accurate live-vs-branch reporting.
- [ ] Confirm queue, provider, publication, review, and scheduler telemetry cannot leak secrets, prompts, or raw provider errors.
- [ ] Document rollout order, health checks, rollback steps, and the explicit authorization gate.
- [ ] **Phase 1 exit:** same-commit CI green; disposable SQL and concurrency rehearsal green; deployed drift mapped; grants and RPCs reviewed; runtime validation complete; schedule dispositions documented; rollback reviewed. Production rollout remains a separate approval.

## Phase 2 — Autonomous production loop (build/integration and end-to-end verification)

- [ ] Inventory queue tables, producers, consumers, retry policies, stale-job recovery, attempt accounting, and idempotency.
- [ ] Verify generation job lifecycle: queued → running → reviewed → eligible → published, with truthful terminal states.
- [ ] Diagnose stuck/zero-attempt jobs using read-only evidence and prevent jobs from silently remaining queued.
- [x] Branch source audit: `generate-chapter` generation and AI quality-review paths both fail closed when provider-state lookup is unavailable, counters/timestamps are malformed, or cooldown is active; deterministic hard-validation review remains available without invoking Gemini. The repository-wide provider-state contract covers all 13 readers, and current branch source/type contracts pass CI.
- [x] Add atomic quality-review persistence candidate `20261017150000_aevora_atomic_quality_review_commit.sql`: deterministic and AI review results commit with output status in one transaction, stale `updated_at` snapshots are fenced, failed review writes roll back, retries remain idempotent, invalid scores/statuses are rejected, and browser-role EXECUTE is revoked. Disposable PostgreSQL rehearsal and Edge source-contract/type checks passed in CI run [39003244008](https://github.com/freearmy599/taleforge/actions/runs/39003244008). Branch-only; not applied to production.
- [ ] Separately verify the deployed live `generate-chapter` version contains the same quality-review guard before any deployment/rollout decision; branch validation does not prove deployed behavior.
- [ ] Verify `revise-chapter` conflict handling, revision limits, retry behavior, and successor idempotency.
- [ ] Verify review orchestration requires all required review outcomes; failed, missing, or unknown reviews block release.
- [ ] Verify continuity, originality, safety, semantic continuity, world continuity, and character continuity workers have correct inputs, auth, retry limits, and output schemas.
- [ ] Verify publication sync/outbox and canon sync retry/reconciliation without duplicate or partial state.
- [ ] Verify Chief Editor monitor is live, authorized, correctly scoped, and reports actionable conditions rather than merely logging.
- [ ] Reconcile production-only Edge Functions absent from the branch, including autonomous creation/runner, operations snapshot, Chief Editor monitor, and cover workers.
- [ ] Verify autonomous series creation: concept selection, uniqueness, series bible, planning, readiness gates, initial schedule, failure recovery, and capacity controls.
- [ ] Prove one controlled end-to-end pipeline in a safe test environment, with publication disabled or mocked. Do not use real chapter publication as a test without explicit approval.
- [ ] Add operational dashboards/alerts for stuck jobs, provider cooldown, review failures, schedule lag, publisher failures, duplicate work, and quality regressions.

## Phase 3 — Aevora Originals Factory (original story quality and sustainable output)

- [ ] Audit and verify Story DNA / series bible persistence: premise, themes, character goals, rules, power system, setting, voice, and canon.
- [ ] Verify arc planner and chapter planner produce long-range progression, pacing, hooks, foreshadowing, and payoff.
- [ ] Verify worldbuilding and continuity checks work across chapters and arcs.
- [ ] Enforce strict series isolation so characters, plot facts, arcs, and generated context never leak between Aevora series.
- [ ] Verify originality checks and safe editorial review; establish test cases for false positives and missed issues.
- [ ] Define a measurable quality rubric for prose, coherence, character development, pacing, originality, chapter hooks, and reader satisfaction.
- [ ] Establish a human/editorial sampling and escalation path for low-confidence or low-quality chapters.
- [ ] Test long-form planning and continuity at 50, 100, and 200+ chapter horizons without promising unsupported consistency.
- [ ] Implement flexible genres, subgenres, hybrid tags, and original/new genre definitions without hard-coded narrow categories.
- [ ] Verify title, synopsis, series identity, tags, and cover accurately represent each series and its unique hook.
- [ ] Verify the cover/series-image workflow, quota/cost controls, moderation, fallbacks, and visual consistency. Keep image generation optional where provider quota is unavailable.
- [ ] Define production capacity policy and safely reconcile the previously mentioned cap of eight.
- [ ] Prove quality and operations can sustain the target cadence—one chapter per active series per day and one new series per week—before enabling it broadly.

## Phase 4 — Reader-first Aevora website (novel-first launch)

### Brand, navigation, and responsive design
- [ ] Audit every route, page, button, menu, empty state, error state, and mobile layout.
- [ ] Establish a distinctive Aevora identity; do not copy Webnovel/Royal Road layouts.
- [ ] Improve premium, readable, mobile-first visual design, typography, spacing, hierarchy, contrast, and loading states.
- [ ] Hide/defer manga and anime navigation until those sections are actually supported; keep the launch focused on novels.
- [ ] Remove, hide, or wire every unused/inert button and route; verify every visible action does what it promises.
- [ ] Check accessibility: keyboard use, semantic headings, screen readers, contrast, focus states, and reduced-motion support.

### Discovery and series/chapter pages
- [ ] Audit homepage and landing pages for clear discovery paths and strong original-story hooks.
- [ ] Build/verify series detail pages: cover, title, synopsis, genre/hybrid tags, status, chapter list, release cadence, and consistent metadata.
- [ ] Build/verify chapter reader: mobile typography, chapter navigation, table of contents, theme/font controls where appropriate, and resilient loading/error behavior.
- [ ] Add search by title, author, genre, tags, and useful filters.
- [ ] Build collections such as New Releases, Trending, Rising Stories, Hidden Gems, Editor Picks, completed series, and curated theme collections.
- [ ] Add dynamic discovery and serialized anticipation without fake counts or fabricated activity.
- [ ] Verify genre taxonomy and hybrid/original categories connect correctly to search and discovery.
- [ ] Add related stories and deeper fictional-world exploration without exposing private authoring data.

### Reader library, retention, and growth
- [ ] Verify reading progress, history, bookmarks, follows, and continue-reading behavior.
- [ ] Define reader account requirements and keep sign-up friction low where safe and practical.
- [ ] Add privacy-aware recommendations based on reader behavior, with cold-start behavior and user controls.
- [ ] Design notifications/release reminders and series events with consent and frequency controls.
- [ ] Add reader collections/lists and meaningful feedback signals.
- [ ] Improve SEO metadata, canonical URLs, structured data, crawlability, and social sharing previews.
- [ ] Test mobile performance, image loading, caching, database query cost, and error recovery.
- [ ] Define reader metrics: discovery-to-read, chapter completion, return readers, follows, bookmarks, and series retention.
- [ ] Verify privacy, age-appropriate content labeling, reporting, and content safety.

## Phase 5 — Creator Studio and community (deferred until reader foundation is dependable)

- [ ] Define creator eligibility, ownership, rights, licensing, and content rules.
- [ ] Build creator dashboard and manuscript/series workspace.
- [ ] Build draft, edit, preview, submit, review, schedule, publish, unpublish, and revision workflows with permissions.
- [ ] Add author profiles, series catalogs, creator follows, and clear distinction between Aevora Originals and user-created works.
- [ ] Add creator analytics with privacy-aware reads, retention, and engagement metrics.
- [ ] Add ratings, reviews, reading lists, and discussion only with reporting, moderation, anti-spam, and abuse controls.
- [ ] Add plagiarism/originality review, safety review, appeals, and human escalation.
- [ ] Verify author/reader roles, RLS, upload limits, rate limits, and account/data deletion flows.
- [ ] Test creator publishing independently from the Aevora Originals automation pipeline.

## Phase 6 — Mythara ecosystem and adaptations (long-term/deferred)

- [ ] Define Aevora–Mythara identity, permissions, opt-in, rights, provenance, versioning, and revocation contracts.
- [ ] Design how Mythara-created novels may be distributed on Aevora only when the creator chooses.
- [ ] Build a novel-to-manga planning/script/panel workflow with visual references, continuity checks, human review, and asset tracking.
- [ ] Build a novel-to-anime development workflow with adaptation outlines, scripts/scenes, character/setting consistency, and feasibility review.
- [ ] Define canon ownership and conflict resolution across novel, manga, and anime versions.
- [ ] Keep Mythara and manga/anime expansion separate from the novel-first launch until the core reader and publishing systems are reliable.

## Cross-cutting launch and operations

- [ ] Review authentication, authorization, RLS, storage access, secrets, rate limits, abuse controls, and sensitive-data handling.
- [ ] Review cost/quota controls for every external AI and image provider; default to low-cost/free operation and never create billable resources without approval.
- [ ] Establish backup/restore and recovery procedures and verify them in a safe environment.
- [ ] Establish observability, alerts, incident runbooks, and a way to pause automation safely.
- [ ] Reconcile environment variables, secrets, deployment versions, migrations, generated types, and branch/live drift.
- [ ] Add smoke tests for core reader journeys and safe operational tests for publishing workflows.
- [ ] Verify legal/rights, privacy, retention, takedown, and content moderation policies before opening creator publishing.
- [ ] Create a launch checklist with rollback criteria and an explicit owner/approval for production changes.

## Dependency order / how we will work

1. Finish Phase 1 security and publishing gates. Do not expand production automation while this is blocked.
2. Prove Phase 2 generation/review/recovery as a controlled end-to-end pipeline.
3. Establish Phase 3 story quality and series isolation.
4. Complete Phase 4 novel-first website and reader discovery/retention.
5. Add Phase 5 Creator Studio/community after moderation and reader foundations.
6. Add Phase 6 Mythara/adaptations after rights, identity, and canon contracts are defined.

Work one bounded task at a time and update this register with evidence. Prefer completing an existing workstream over creating more audit documents. If a repository edit is refused, record the exact blocker; do not bypass repository/tool safeguards.

## Non-negotiable safety boundary

This checklist does not authorize production changes. No production deployment or migration, grant/policy changes, schedule mutations, chapter generation/publication, or billable Supabase branch without explicit authorization. Never report a system as complete solely because a file exists or a partial test passes.


### Provider throttle contract correction — 2026-10-16

The green candidate tests cited above are historical evidence for the previous implementation, not acceptance of the revised throttle semantics. The newer contract in [PHASE1-GEMINI-THROTTLE-CONTRACT-20261016.md](./PHASE1-GEMINI-THROTTLE-CONTRACT-20261016.md) supersedes the earlier ambiguous overload-count behavior. The candidate migration and its tests must be updated before the provider-state atomicity item can be closed. No production migration or function deployment is authorized by this correction.


### Event-ledger implementation update — 2026-10-16

The new candidate migration is intentionally additive and branch-only. It drops the earlier one-argument RPC signature, adds `taleforge_ai_provider_event_ledger`, and defines `aevora_record_gemini_throttle(uuid, text)`. Replays of the same UUID/class are acknowledged without another state mutation; reuse of an event ID with a different class is rejected. The shell rehearsal now includes 20 concurrent duplicate submissions and expects exactly one quota increment. No live migration or function deployment was performed. CI must pass before this candidate can be considered validated.


### Candidate validation result — 2026-10-16

CI run [38935788221](https://github.com/freearmy599/taleforge/actions/runs/38935788221) completed successfully: Edge Function type-checking and source-contract tests passed, including pipeline redaction, release readiness, provider cooldown recording, and repository-wide Gemini quota guards; the disposable PostgreSQL job also passed the idempotent throttle concurrency and safe-ACL rehearsal. This validates the branch candidate only. It does not establish Supabase Edge Runtime compatibility or authorize any live migration/deployment. Production provider-state grants and deployed function versions remain unchanged.


### Fresh live read-only reconciliation — 2026-10-16

Using the connected Supabase project's read-only list/catalog operations, confirmed 232 applied migrations; latest live migration is `20261010161919 aevora_release_scheduler_leases`. The original provider-state migration entry remains `20261007025751 add_taleforge_ai_provider_cooldown_state`; its authoritative SQL body is still not recovered. Candidate migration `20261016190000_idempotent_gemini_provider_throttle.sql` is absent from the live migration ledger, and `taleforge_ai_provider_event_ledger` is absent from the live catalog. Live Edge Function versions remain `generate-chapter` v59, `revise-chapter` v40, `generation-orchestrator` v35, `release-scheduler` v12, and `release-publisher` v21. A fresh read-only ACL query confirms RLS enabled but not forced on `taleforge_ai_provider_state`, with broad relation privileges still granted to `anon` and `authenticated`; broad default ACLs for `postgres` and `supabase_admin` remain present. These observations are read-only only; no SQL mutation, migration, function deployment, schedule change, generation, or publication was performed.


## Live ACL continuation — 2026-10-16 (latest read-only review)

- [x] Reconfirmed that live `public.reader_events` has RLS enabled but client relation ACLs include INSERT, SELECT, and TRUNCATE for `anon` and `authenticated`. There is no client SELECT policy, so row reads are blocked by RLS; TRUNCATE remains a distinct risk because it bypasses row-level policies.
- [x] Found a live reader-event relationship gap: the current INSERT policy checks that a supplied chapter is published but does not verify that it belongs to the supplied series. The branch candidate migration `20261014200000_reader_event_relationship_integrity.sql` includes the matching-series check but is not applied live.
- [x] Reconfirmed that live `reader_events` has no `event_uuid` column and that the reader-event intake function/RPC candidate remains branch-only. The browser tracker adds `event_uuid` only when the intake endpoint is explicitly enabled, preserving compatibility with the live schema while the flag is false.
- [x] Added [live reader-event ACL and relationship gap report](./PHASE1-LIVE-READER-EVENT-ACL-GAP-20261016.md).
- [x] Audited live public RPC execution: 12 non-system SECURITY INVOKER functions were found executable by client roles; no client-executable SECURITY DEFINER functions were returned by the corresponding catalog query. Internal-sensitive candidates include `get_production_buffer_plan()`, `get_story_narrative_destination(uuid)`, `taleforge_get_long_term_architecture_context(uuid)`, and mutation helpers. Trigger-only functions also have broad client EXECUTE ACLs.
- [x] Identified existing branch candidate migration `20261013110000_restrict_internal_invoker_rpc_execution.sql`, which revokes client EXECUTE for the exact 12 internal/trigger helper signatures while preserving `service_role`. The scheduler contract test checks all 12 signatures, but live ACLs remain unchanged and the migration is not in the live ledger.
- [x] Added [live public RPC execution inventory](./PHASE1-LIVE-PUBLIC-RPC-EXECUTE-INVENTORY-20261016.md). Remaining work: complete caller inventory and ensure disposable PostgreSQL tests verify effective grants and trigger behavior before any authorized rollout; do not create duplicate migrations or blanket-revoke all public functions.
- [x] Latest CI: [run 38945024731](https://github.com/freearmy599/taleforge/actions/runs/38945024731) on commit `a0970e98` passed both Edge Function type-checking/source-contract validation and disposable PostgreSQL readiness/security rehearsal. This includes the branch tree with the reader-event ACL report and public RPC inventory. Branch-only validation does not imply production rollout.
- [ ] Reconcile the full 103-table client mutation/TRUNCATE grant inventory and 91 RLS-enabled/no-policy relations against intended UI, Edge Function and trusted service-role callers. Preserve required public read/write behavior through narrowly scoped policies or allowlisted views.
- [ ] Review all 27 public SELECT policies on story-planning/intelligence tables and decide which public projections are actually required; never expose internal narrative plans merely because a row is associated with a published series.
- **Safety boundary unchanged:** no live migration, ACL/policy change, Edge Function deployment, generation/publication, schedule mutation, or billable Supabase branch was initiated by this continuation. Automatic publishing remains NO-GO.


## Base story-planning read-surface hardening — 2026-10-16

- [x] Audited live `story_arc_plan`, `story_ending_plans`, and `story_lifecycle` schema, client grants and policies. Ending conflict/resolution and lifecycle buffer/review fields are present behind public SELECT policies; the `published` policy predicate conflicts with the live `series_status_check`, while the lifecycle predicate relies on `published_at IS NOT NULL`.
- [x] Added branch-only migration `20261016220000_lock_base_story_planning_read_surfaces.sql` to remove client/public access to these raw planning tables while preserving trusted service-role access. Browser-source contract now forbids direct browser queries of all three.
- [x] Disposable PostgreSQL rehearsal passed in [CI run 38946455150](https://github.com/freearmy599/taleforge/actions/runs/38946455150), including client table/column ACL denial, policy removal, and retained service-role CRUD. The RPC/trigger ACL rehearsal passed in [CI run 38946001150](https://github.com/freearmy599/taleforge/actions/runs/38946001150).
- [ ] Review external API/client compatibility before any production rollout; candidate migrations remain unapplied live.
- **Safety boundary:** no production ACL/policy changes, migrations, deployments, generation/publication, schedule mutation, or billable Supabase branch. Automatic publishing remains NO-GO.


## Read-surface scope correction — 2026-10-16

- [x] Second-pass review found the branch-only read-lock candidate had been broader than its own policy review: it included all 41 audited tables, including 14 provisional taxonomy/reference tables whose reader/API contract was not yet confirmed.
- [x] Narrowed `20261014190000_lock_internal_story_design_read_surfaces.sql` to the 27 high-risk internal planning/intelligence tables only. The 14 provisional reference tables are explicitly excluded until their fields and intended consumers are verified.
- [x] Updated static contracts to assert both the 27-table internal lock allowlist and the 14-table exclusion list. The separate 41-table write/maintenance revoke candidate remains distinct and preserves SELECT.
- [ ] Await CI for this scope correction, then continue the table-by-table reader/API caller audit. Do not apply any candidate migration live without separate authorization and compatibility checks.


## Provisional reference taxonomy — second-pass field and caller review (2026-10-17)

- [x] Inspected live schemas for all 14 provisional reference/taxonomy tables. Several expose internal generation rules, structural weights, originality constraints, compatibility/risk reports, or series-specific design profiles even when status is `active`.
- [x] Inspected current policies: 13 tables permit SELECT for rows with status `active`; `taleforge_hybrid_story_recipes_generated` permits `validated` and `active`. Status filtering does not protect sensitive columns.
- [x] Scanned 21 Edge Function entrypoints and core browser data files; no direct references to these exact table names were found in the inspected sources. This does not rule out SQL-function/dynamic/external/future creator callers.
- [x] Added [the field/caller review](./PHASE1-REFERENCE-TAXONOMY-CALLER-AUDIT-20261017.md).
- [ ] Decide and implement a deliberate public projection for taxonomy labels/descriptions versus server-only generation rules and series-specific profiles. Do not retain raw-table reads by default and do not blanket-revoke before the remaining caller inventory.
- **Safety boundary:** read-only catalog/source audit only; no live grants, policies, rows, migrations, deployment, generation/publication, schedule mutation, or billable branch changes. Automatic publishing remains NO-GO.


## Internal taxonomy read-surface hardening — 2026-10-17

- [x] Completed read-only live schema/ACL/policy audit of all 14 provisional taxonomy/reference tables. All 14 have RLS enabled, client table SELECT grants, and a client SELECT policy; active-row filtering does not protect sensitive columns.
- [x] Confirmed the related public SECURITY DEFINER generation functions found in the catalog are not executable by `anon` or `authenticated`; their explicit service-role access is retained.
- [x] Added branch candidate `20261017100000_lock_internal_reference_taxonomy_reads.sql`, which revokes raw table and column SELECT from `PUBLIC`, `anon`, and `authenticated`, fails closed if an expected table is missing, and preserves `service_role` access.
- [x] Added a 14-table disposable PostgreSQL fixture/assertion set covering relation grants, column grants, and preservation of trusted worker access.
- [x] Candidate validated by [CI run 38950058686](https://github.com/freearmy599/taleforge/actions/runs/38950058686): Edge Function/source-contract checks and disposable PostgreSQL readiness/security rehearsal passed.
- [ ] Design and test a public taxonomy projection only when a browser/creator workflow needs it. Do not re-open raw internal tables to solve a missing UI contract.
- **Safety boundary:** the candidate migration has not been applied to live Supabase. No live grants/policies, data, Edge deployments, generation/publication, schedules, or billable branches were changed. Automatic publishing remains NO-GO.
