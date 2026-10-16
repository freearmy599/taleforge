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
- **Latest verified CI evidence:** [run 38918201462](https://github.com/freearmy599/taleforge/actions/runs/38918201462) failed after the disposable PostgreSQL readiness rehearsal and Edge Function type-checks passed; three review error-redaction assertions failed against the then-current contract. The contract and writer-coverage tests have since changed on the branch, but no successful CI run for those later commits has been verified yet. The run did not execute the candidate atomic provider RPC migration or its SQL rehearsal.
- **Branch-only candidate:** `20261016180000_atomic_gemini_provider_throttle.sql` and RPC caller changes are not production-deployed or runtime-verified.
- **Production boundary:** no production migrations/deployments, schedule changes, chapter generation/publication, or billable Supabase development branch without explicit authorization.

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
- [x] Reconcile the review error-redaction contract with the atomic RPC implementation; source-level checks now assert the RPC, fixed diagnostics, no upsert path, and stable retry reasons. Full CI re-run is still pending.
- [ ] Run the full provider cooldown recording contract on the latest branch commit and verify all writer paths remain covered.
- [x] Update the Gemini quota-guard contract for RPC persistence and malformed persisted-counter behavior; execution on the latest commit remains pending.
- [x] Expand the provider-state atomicity contract to all 11 migrated branch writers; source-level checks pass, but full test execution and disposable SQL/concurrency rehearsal remain pending.
- [ ] Add/run a safe disposable PostgreSQL rehearsal that explicitly guards its database identity and requires a test-only opt-in marker.
- [ ] Execute the candidate migration in disposable PostgreSQL; test schema assumptions, function creation, role ownership, effective ACLs, invalid input, negative/malformed counters, and rollback.
- [ ] Add true multi-session concurrency tests: concurrent increments, simultaneous first inserts, mixed quota/overload events, and no cooldown shortening.
- [ ] Run all Edge Function type checks and regression contracts to green on the same commit.
- [ ] Validate Supabase Edge Runtime compatibility separately; static TypeScript checks alone are insufficient.

### B. Provider-state and Gemini quota safety
- [ ] Recover authoritative provenance for live migration `20261007025751 add_taleforge_ai_provider_cooldown_state`, or document the verified live schema and use a reviewed forward-only repair; do not fabricate migration history.
- [ ] Reconcile the live six-column table schema, constraints, indexes, triggers, routines, ACLs, defaults, and all direct/indirect readers and writers.
- [ ] Review atomic RPC semantics, including whether overload events should affect the quota escalation counter and how duplicate observations are counted.
- [x] Migrate all 11 identified branch writers in the current branch to the shared RPC, including `character-continuity`. This is branch-source evidence only; deployed parity and runtime verification remain open.
- [ ] Reconcile all deployed function versions with branch source. Earlier read-only inventory identified deployed direct writers `generate-chapter`, `generation-orchestrator`, and `revise-chapter`; deployed and branch inventories differ.
- [ ] Preserve fail-closed behavior for generation, quality review, planners, review workers, and orchestrators when provider state is missing, malformed, cooling down, or unreadable.
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
- [ ] Audit the operations snapshot/control-plane audit for authorization, redaction, and accurate live-vs-branch reporting.
- [ ] Confirm queue, provider, publication, review, and scheduler telemetry cannot leak secrets, prompts, or raw provider errors.
- [ ] Document rollout order, health checks, rollback steps, and the explicit authorization gate.
- [ ] **Phase 1 exit:** same-commit CI green; disposable SQL and concurrency rehearsal green; deployed drift mapped; grants and RPCs reviewed; runtime validation complete; schedule dispositions documented; rollback reviewed. Production rollout remains a separate approval.

## Phase 2 — Autonomous production loop (build/integration and end-to-end verification)

- [ ] Inventory queue tables, producers, consumers, retry policies, stale-job recovery, attempt accounting, and idempotency.
- [ ] Verify generation job lifecycle: queued → running → reviewed → eligible → published, with truthful terminal states.
- [ ] Diagnose stuck/zero-attempt jobs using read-only evidence and prevent jobs from silently remaining queued.
- [ ] Verify `generate-chapter` generation and quality-review paths both fail closed on provider-state uncertainty.
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
