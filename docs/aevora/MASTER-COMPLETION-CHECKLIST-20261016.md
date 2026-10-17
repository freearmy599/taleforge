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

- **Latest CI confirmation (2026-10-17):** [run 39011599651](https://github.com/freearmy599/taleforge/actions/runs/39011599651) and [run 39011640428](https://github.com/freearmy599/taleforge/actions/runs/39011640428) both completed successfully: Edge validation 59/59 steps and disposable PostgreSQL rehearsal 21/21 steps. These runs validate branch checks only, not live Supabase parity or production readiness.
- **Fresh live read-only parity recheck (2026-10-17):** the connected Supabase project still reports 232 migration records, latest `20261010161919 / aevora_release_scheduler_leases`; critical deployed functions remain `release-scheduler` v12, `release-publisher` v21, `generate-chapter` v59, `generation-orchestrator` v35, `review-orchestrator` v11, `publication-sync-processor` v4, and `autonomous-series-creation-runner` v6, all with `verify_jwt=true`. This confirms the branch ACL/auth work has not been deployed and the previously recorded live drift remains open. The check was metadata-only; no raw secrets or application data were retrieved.
- **ACL reconciliation workplan:** [client-grant and default-ACL reconciliation matrix](./PHASE1-CLIENT-GRANT-DEFAULT-ACL-RECONCILIATION-20261017.md) defines a relation-by-relation caller map, per-role access matrix, default-ACL provenance checks, and rehearsal gates. It is an audit plan, not an approved production change.
- **39-table ACL inventory regression guard:** [reconciliation matrix](./PHASE1-CLIENT-GRANT-DEFAULT-ACL-RECONCILIATION-20261017.md) now records the source-contract test that cross-checks the 28 provisional server-only tables and 11 dormant reader/community tables against their branch lock candidates. The browser-boundary contract also blocks direct browser queries to those 11 dormant tables. [Run 39016395105](https://github.com/freearmy599/taleforge/actions/runs/39016395105) passed Edge/source-contract validation (61/61 steps) and disposable PostgreSQL rehearsal (22/22 steps). Branch-only evidence; live ACL/default-ACL drift and rollout approval remain open.
- **Taxonomy ACL follow-up:** [internal taxonomy ACL finding](./PHASE1-TAXONOMY-ACL-FOLLOWUP-20261017.md) identified that the earlier SELECT-only lock did not remove other relation/column privileges. The branch-only forward candidate (`20261017140000_lock_internal_reference_taxonomy_client_access.sql`), static contract, disposable fixture/assertions/safety-gated runner, and CI steps are in place. [Run 39012169911](https://github.com/freearmy599/taleforge/actions/runs/39012169911) passed Edge/source-contract validation (60/60 steps) and disposable PostgreSQL rehearsal (22/22 steps), including the dedicated taxonomy ACL test. This is fixture-level branch evidence, not live-schema compatibility or rollout approval. Browser workflow-table boundary inventory now also includes these 14 relations; in [run 39012249036](https://github.com/freearmy599/taleforge/actions/runs/39012249036), Edge/source-contract validation passed 60/60 steps and the disposable PostgreSQL rehearsal passed 22/22 steps.
- **Current phase:** Phase 1 — Reliability, security, and safe publishing.
- **Automatic publishing:** **NO-GO** until the Phase 1 exit gate is satisfied and rollout is explicitly authorized.
- **Latest verified code/test CI evidence (2026-10-17 checkpoint):** [run 39010227908](https://github.com/freearmy599/taleforge/actions/runs/39010227908) passed the Edge validation suite and disposable PostgreSQL rehearsal after strengthening internal-worker auth contracts to assert fail-closed behavior, including the autonomous-series runner's assigned-key-guard pattern. The earlier [run 39007189983](https://github.com/freearmy599/taleforge/actions/runs/39007189983) remains evidence for chapter client-write ACL, internal policyless-table/RPC ACL, provider throttle concurrency, and atomic quality-review persistence/rollback checks. The same commit `cae25bdfc7494c51a4c56b7ab0e2252197255d51` also passed its Cloudflare Pages preview check. Its source-contract update adds `story_attachment_metrics` to the browser-to-workflow-table boundary inventory. Earlier checkpoints remain useful history: [run 39006140780](https://github.com/freearmy599/taleforge/actions/runs/39006140780), [run 39006219294](https://github.com/freearmy599/taleforge/actions/runs/39006219294), and [run 39006591509](https://github.com/freearmy599/taleforge/actions/runs/39006591509) passed the then-current branch checks. Most recent confirmations: [run 39010525776](https://github.com/freearmy599/taleforge/actions/runs/39010525776) passed both Edge type-checking and the disposable PostgreSQL readiness-migration rehearsal on checklist commit `5a4491e8d32540f5f539a33c09ac5954bd53e70c`. The later [run 39011127178](https://github.com/freearmy599/taleforge/actions/runs/39011127178) also passed both jobs after adding a contract that requires all 18 shared-key privileged workers to keep `verify_jwt=false` in branch config alongside handler-level internal-key validation. This validates branch configuration/source contracts only; it does not authorize a production rollout. The subsequent checklist documentation commit [run 39011219334](https://github.com/freearmy599/taleforge/actions/runs/39011219334) also passed both Edge validation and the disposable PostgreSQL rehearsal. All runs above are branch-only checks and do not establish live compatibility, deployed parity, Edge Runtime behavior, or authorize rollout. The atomic publication commit-boundary design is documented in [the 2026-10-17 proposal](./PHASE1-ATOMIC-PUBLICATION-BOUNDARY-PROPOSAL-20261017.md); it remains proposal-only, not an implemented migration or approval.
- **Branch-only candidate:** `20261016180000_atomic_gemini_provider_throttle.sql` and RPC caller changes are not production-deployed or runtime-verified.
- **Production boundary:** no production migrations/deployments, schedule changes, chapter generation/publication, or billable Supabase development branch without explicit authorization.
- **Read-only live Supabase audit (refreshed 2026-10-17):** a fresh read-only connector inventory on 2026-10-17 reconfirmed 26 active Edge Functions and 232 applied migrations; the latest ledger entry remains `20261010161919 / aevora_release_scheduler_leases`. The critical live versions remain `release-scheduler` v12, `release-publisher` v21, `generate-chapter` v59, `generation-orchestrator` v35, `review-orchestrator` v11, `publication-sync-processor` v4, and `autonomous-series-creation-runner` v6, all with gateway `verify_jwt=true`. The branch-only lease-fencing, release-readiness, provider ACL, chapter client-write revocation, and other later candidate migrations are not present in the live ledger. Migration `20261007025751 / add_taleforge_ai_provider_cooldown_state` exists in the ledger, but its original SQL is absent from current repository migration directories; do not reconstruct or claim provenance without the source artifact. A read-only catalog query confirmed that `anon` and `authenticated` retain broad table privileges (including INSERT/UPDATE/DELETE, TRUNCATE, MAINTAIN, TRIGGER and REFERENCES where applicable) on `public.chapters`, `public.taleforge_ai_provider_state`, `public.release_schedules`, `public.publication_sync_outbox`, and `public.story_attachment_metrics`. RLS is enabled on these tables; only `chapters` has a returned client-facing SELECT policy, while the other four returned no policies. A second direct ACL inventory confirmed broad explicit relation-level ACL entries for `anon` and `authenticated` (and existing `service_role` privileges) on all five tables; it found no separate per-column ACL entries on these five relations in the current catalog snapshot. Thus the query did not demonstrate successful client row writes, but the relation ACLs remain overbroad and require a reviewed migration/rollback plan. No live permissions were changed.
- **Read-only Supabase advisor snapshot (2026-10-17):** security advisor returned 91 `rls_enabled_no_policy` informational findings; these are not automatically vulnerabilities, but must be triaged against effective table/column/function grants and intended server-only access. The live ACL query independently confirmed overbroad client table grants on the five release/operational tables listed above. Performance advisor returned 68 unindexed-FK informational findings, 53 unused-index informational findings, two RLS init-plan warnings, and one duplicate-index warning. No advisor-driven schema/index changes were made; prioritize security grant/policy reconciliation first and defer performance tuning until query workload and index usage are understood.
- **Read-only reader-event/trending reconciliation (2026-10-16):** live `reader_events` has identity `id`, no `event_uuid` column, and client INSERT remains allowed; the `reader-event-intake` Edge Function and its quota RPC are absent from the live inventory. Live `story_trending_scores` and `story_intelligence` views have client SELECT grants, but both use `security_invoker=true` and `reader_events` has no client SELECT policy, so real event-derived metrics are not proven exposed and may be zeroed by RLS. The branch migration gates both views; live grants remain inconsistent with that intended gate. See [reader-event intake transition gate](./PHASE1-READER-EVENT-INTAKE-TRANSITION-GATE-20261016.md).
- **Deployed release path remains unsafe (reconfirmed by read-only Edge Function source retrieval on 2026-10-17):** live functions remain `release-scheduler` v12, `release-publisher` v21, `generate-chapter` v59, `generation-orchestrator` v35, and `review-orchestrator` v11; `revise-chapter` remains v40 from the prior inventory. The live scheduler source contains no lease claim/renew/release RPC calls, treats the publisher HTTP response without validating the full `{success,published,status,chapter_id}` contract, and can update `next_release_at` after partial publication failure. The live publisher's existing-chapter path returns `success:true, published:true` without requiring `existingChapter.status === 'published'`; its normal insert path writes the chapter before separately synchronizing output, blueprint, and series timestamp, so later synchronization failures can leave partial state. Hardened branch source is not deployed, and live migration ledger does not contain the later lease-fencing/readiness/chapter-ACL candidate migrations. Automatic publishing remains NO-GO.

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
- [x] Confirm effective live grants: `anon` and `authenticated` can SELECT, INSERT, UPDATE, DELETE, and TRUNCATE the provider-state table through broad relation-level grants. The latest direct ACL inventory found no separate per-column ACL entries on the five audited release/operational tables. A fresh read-only catalog query on 2026-10-16 also shows broad relation ACLs for `service_role` and broad default privileges for both `postgres` and `supabase_admin` over future public tables, sequences, and functions, including client-role grants. Candidate repair remains unapplied.
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


## Publication batch-integrity regression — 2026-10-17

- [x] Added scheduler source-contract tests asserting that an HTTP 2xx response alone is insufficient: the publisher response must explicitly confirm success, publication, published status, and a non-empty chapter ID.
- [x] Added a regression contract requiring schedule advancement to depend on confirmation of the complete selected batch, with partial batches, publication failures, and lease loss excluded.
- [x] Added a regression contract requiring the scheduler to re-read the persisted chapter and reject any row whose persisted status is not `published`.
- [x] Both Edge source validation and disposable PostgreSQL rehearsal passed for commit [`3e39adf`](https://github.com/freearmy599/taleforge/commit/3e39adf8c31f6422ef80eef0f39db43d115717d6) in [CI run 39004771491](https://github.com/freearmy599/taleforge/actions/runs/39004771491). The prior documentation/evidence reconciliation run [39004696278](https://github.com/freearmy599/taleforge/actions/runs/39004696278) also completed successfully.
- [ ] These static contracts and disposable-database rehearsals do not prove live scheduler/publisher behavior or close the publication-authorization gate. The scheduler still deliberately returns `publication_authorization_not_implemented` before lease claims and publisher calls for real auto-publish work.
- [ ] Still required: DB-enforced publication authorization with a trusted human approver and explicit scope/expiry/revocation semantics; verify publisher governance gate and scheduler authorization are consistent; exercise duplicate/race paths and outbox rollback in a realistic isolated integration harness; resolve the `supabase_admin` default-privilege ownership/provenance blocker without broad speculative revokes; finish schedule/lease-loss recovery cases.
- **Safety boundary unchanged:** no production migration, ACL/policy change, function deployment, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Automated publishing remains NO-GO.


## Scheduler publication and lease contracts — 2026-10-17 follow-up

- [x] CI run [39004942214](https://github.com/freearmy599/taleforge/actions/runs/39004942214) passed both Edge source validation and disposable PostgreSQL rehearsal for commit [`6d2a87b`](https://github.com/freearmy599/taleforge/commit/6d2a87b7ad874cb486f1489faaa9645b6a4f6567). The scheduler persisted-chapter contract checks that the publisher's returned chapter ID is re-read under the expected series and chapter number and must have persisted `published` status.
- [x] Confirmed source-level behavior: each automated candidate requires lease renewal before the publisher request; renewal failure marks lease loss and stops the batch; schedule advancement uses `aevora_advance_release_schedule_if_lease_owned` with the same lease token; and claimed leases are released in `finally`, with unconfirmed release surfaced as a failure action.
- [x] Added static regression contracts for lease renewal, fail-closed lease loss, lease-token-bound schedule advancement, and lease cleanup. The initial assertion mismatch was corrected in commit [`9fe0977`](https://github.com/freearmy599/taleforge/commit/9fe097730e0c6f26e0a18dded86d0845993c9fbe); [CI run 39005901330](https://github.com/freearmy599/taleforge/actions/runs/39005901330) passed both Edge source validation and disposable PostgreSQL rehearsal.
- **Scope reminder:** static contracts prove only source shape, not actual multi-worker lease races, database lock behavior, or deployed function parity. Automated publication remains blocked before lease claim until commit-boundary authorization is implemented and explicitly approved. No production changes were made.


### Lease-contract test correction — 2026-10-17

- The first CI attempt [39005838505](https://github.com/freearmy599/taleforge/actions/runs/39005838505) correctly caught a test assertion mismatch: the source uses optional chaining for both `released?.error` and `released?.data`, while the new assertion omitted the first optional-chain marker. The scheduler implementation was not changed by this correction.
- Corrected the test in commit [`9fe0977`](https://github.com/freearmy599/taleforge/commit/9fe097730e0c6f26e0a18dded86d0845993c9fbe). The corrected lease-contract suite passed both CI jobs in [run 39005901330](https://github.com/freearmy599/taleforge/actions/runs/39005901330).


### Atomic publication design artifact — 2026-10-17

- [x] Added [`PHASE1-ATOMIC-PUBLICATION-BOUNDARY-PROPOSAL-20261017.md`](PHASE1-ATOMIC-PUBLICATION-BOUNDARY-PROPOSAL-20261017.md), a proposal-only specification for a database-enforced authorization and atomic publication boundary. It defines required persisted-state checks, transaction-owned writes, race/rollback rehearsals, audit expectations, and compatibility gates without inventing an approver identity or creating a migration.
- [x] Corrected the lease-release static test assertion in commit [`9fe0977`](https://github.com/freearmy599/taleforge/commit/9fe097730e0c6f26e0a18dded86d0845993c9fbe); [run 39005901330](https://github.com/freearmy599/taleforge/actions/runs/39005901330) subsequently passed both CI jobs.
- **No production action authorized or performed.** The proposal is not an implementation and does not lift the scheduler/publisher fail-closed stops.


### Latest full Phase 1 regression rehearsal — 2026-10-17

- [x] CI run [39005976321](https://github.com/freearmy599/taleforge/actions/runs/39005976321) completed successfully for commit `b331689b78c7e9a11943187c9d6e5cf6533f72ab`: Edge type-check/source-contract job passed and disposable PostgreSQL readiness/security rehearsal passed.
- [x] The rehearsal included reader-event integrity and INSERT-only grants, trending aggregate state and closed ACLs, provider/publication schema inventory parsing, provider-state ACL and diagnostic redaction, atomic Gemini throttle concurrency, default-privilege revocation rehearsal, system-health and chapter client-write ACLs, internal policyless table grants, internal RPC EXECUTE revocation/trigger behavior, and atomic quality-review persistence/rollback.
- [x] The publication authorization stop contracts and publisher security contracts passed in the Edge job. These remain branch-only checks and do not establish live deployment parity or production ACL state.
- [ ] Remaining hard blockers: trusted human publication identity and authorization semantics; transaction-owned atomic publication and schedule advancement; live migration/function provenance reconciliation; production-vs-branch parity; reader-event browser cutover and rollback plan; resolve `supabase_admin` default-privilege ownership/provenance without speculative revokes.
- **Safety boundary unchanged:** no production migration, ACL/policy change, function deployment, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Automated publishing remains NO-GO.


### Checklist evidence refresh — latest documentation commit, 2026-10-17

- [x] Updated this checklist with the full regression rehearsal evidence and remaining blockers. The resulting documentation commit [`9354b2c`](https://github.com/freearmy599/taleforge/commit/9354b2cec088b7101122cd0d36ac09ac7dc0880f) passed [CI run 39006140780](https://github.com/freearmy599/taleforge/actions/runs/39006140780): Edge type checks/source contracts and disposable PostgreSQL security/readiness rehearsal both passed.
- [x] Reviewed the provider cooldown contract coverage: the repository-wide Gemini guard explicitly checks both generation and AI quality-review call paths in `generate-chapter`; it also checks orchestration stop behavior after provider throttles. No duplicate test was added because the existing contract already covers these paths.
- [ ] The remaining hard blockers listed above are unchanged; successful CI on the branch does not authorize live migration/deployment or automatic publication.

### Public-table maintenance ACL regression checkpoint — 2026-10-17

- [x] Added `scripts/aevora-public-table-maintenance-acl-contract.test.mjs` to verify the branch-only migration removes `MAINTAIN`, `TRUNCATE`, `TRIGGER`, and `REFERENCES` privileges from `PUBLIC`, `anon`, and `authenticated`, including column-level `REFERENCES`, without changing ordinary CRUD or trusted server-role grants.
- [x] Wired the contract into `.github/workflows/aevora-edge-validation.yml`. The first test version contained an overly broad role-token assertion; it was narrowed to the actual invariant before the final successful run.
- [x] Latest run [39007624606](https://github.com/freearmy599/taleforge/actions/runs/39007624606) passed both Edge source/type validation and disposable PostgreSQL security/readiness rehearsal for commit [`b5f1b41d`](https://github.com/freearmy599/taleforge/commit/b5f1b41dea51aa1bd916cf60e12115036c202913). Earlier integration run [39007609459](https://github.com/freearmy599/taleforge/actions/runs/39007609459) also passed.
- **Scope:** this is regression evidence for branch source and disposable PostgreSQL only. It does not establish that the candidate migration is applied in production or that production grants have changed.
- [ ] Existing release blockers remain: trusted human publication identity and authorization semantics; transaction-owned atomic publication and schedule advancement; live migration/function provenance reconciliation; production-vs-branch parity; reader-event browser cutover and rollback plan; and `supabase_admin` default-privilege ownership/provenance.
- **Safety boundary unchanged:** no production migration, ACL/policy change, function deployment, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Automated publishing remains NO-GO.


### Maintenance ACL and provider-throttle validation — 2026-10-17

- [x] Latest branch CI run [39007822163](https://github.com/freearmy599/taleforge/actions/runs/39007822163) completed successfully for commit `cfcbea5ccbaaa90702969fa3954c63dd4b712e14`: all prepared Edge Function type-checks and source-contract tests passed, including the public-table maintenance ACL contract; the disposable PostgreSQL readiness/security rehearsal also passed.
- [x] Re-checked the Gemini quota protection contracts against branch source: `generate-chapter` guards both generation and AI quality-review calls; `review-orchestrator` fails closed for missing/malformed provider state and stops remaining review calls after provider throttling; the repository-wide contract scans direct Gemini callers. This is source/test evidence, not proof of live function parity.
- [ ] No new production readiness is implied. Live ACL/migration parity, deployed scheduler/publisher parity, publication authorization identity, and transaction-owned atomic publication remain unresolved. Reader-event browser cutover and rollback, and `supabase_admin` default-privilege provenance, remain open.
- **Safety boundary unchanged:** no production migration, ACL/policy change, function deployment, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Automated publishing remains NO-GO.


### Publication authorization boundary review — 2026-10-17

- [x] Reviewed the branch publisher's request-to-write path after the passing CI run. The handler authenticates a trusted internal API key, calls `taleforge_ceo_execution_gate` for publication scope, and checks the persisted publication-review gates before loading the schedule and chapter slot.
- [ ] **Authorization semantics still require an explicit decision:** the publisher's manual-schedule branch rejects automatic flags but does not, in the inspected request/write path, bind a named human approver, an approval record scoped to this exact output, and expiry/revocation to the final database commit. The governance RPC is an additional gate, but its existence alone is not proof of the required per-publication human approval contract. Do not treat the manual branch as authorization-complete without inspecting the RPC implementation and agreeing the trusted-approver model.
- [ ] Next safe step is to trace the governance RPC's definition and grants, then specify a commit-boundary contract covering both manual and automated publication. Do not alter this behavior, create a migration, or deploy until the authorization model is explicitly approved.
- **Safety boundary unchanged:** this was source review only. No production migration, ACL/policy change, function deployment, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Automated publishing remains NO-GO.


### Live governance RPC read-only definition audit — 2026-10-17

- [x] Queried the live database catalog read-only for `public.taleforge_ceo_execution_gate(text)` and its dependency `public.taleforge_boss_evaluate(text)`. Both exist, are owned by `postgres`, are `SECURITY DEFINER`, set `search_path=public`, and their current explicit EXECUTE ACLs show only `postgres` and `service_role`. No grants or function definitions were changed.
- [x] Confirmed the CEO gate checks `auth.role()='service_role'`, constrains action scopes, and delegates to a governance-health evaluator that records a governance run and returns a readiness decision. That is a system-health/policy gate, **not a per-publication human approval record** tied to a specific output and final transaction.
- [ ] **Security/provenance follow-up:** `search_path=public` on SECURITY DEFINER functions should be reviewed against a fixed trusted path (typically `pg_catalog`) and fully qualified object references. The matching function definitions were not found in the current branch migration tree, so do not create a replacement migration by guessing provenance or overwrite the live definitions. Recover authoritative migration/source provenance first, then add a branch-only reviewed fix and regression tests if warranted.
- [ ] This read-only audit does not establish that the live RPC's entire dependency graph is safe, that current grants are identical across all environments, or that publication authorization is complete. Automatic publishing remains NO-GO.
- **Safety boundary unchanged:** only catalog SELECT queries were run for this check. No production schema/function/ACL changes, deployments, schedule mutations, chapter generation/publication, or billable Supabase branches were performed.


### Critical live Edge Function caller-authentication drift — 2026-10-17

- [x] Read-only retrieval of the currently deployed functions confirmed `release-publisher` is live at version 21 and `release-scheduler` at version 12, with `verify_jwt=true`. The deployed source retrieved for both endpoints creates a Supabase client using the service-role secret but does **not** validate the incoming `apikey` with the branch's `isTrustedInternalApiKey` guard before privileged work. JWT verification alone does not establish that the caller is a trusted internal scheduler/worker.
- [x] Live publisher also retains the older `release-publisher-v5-outbox` source marker and its existing-chapter path can return `success:true,published:true` for a chapter without validating that its status is actually `published`; the live scheduler checks only the HTTP status before appending publisher response data and may still advance a schedule after partial publication failure. These findings align with earlier production-drift evidence and are now restated together as a priority-0 rollout blocker.
- [x] Branch source includes an explicit `isTrustedInternalApiKey` guard in both scheduler and publisher before constructing/using privileged clients, and branch contracts assert the publisher authentication guard precedes service-role client creation. The current branch scheduler/publisher candidates also include lease and strict publication-confirmation checks absent from the deployed source inspected here.
- [ ] **Immediate operational decision needed from the project owner:** the live endpoints remain exposed to any caller whose request passes the platform's JWT verification unless the platform's gateway configuration imposes a stronger restriction not established by this source audit. Keep automated publishing NO-GO. Consider a controlled emergency mitigation or deployment only after explicit authorization, a reviewed rollback plan, and confirmation of the intended cron/worker API-key configuration. Do not silently deploy or change production settings.
- **Safety boundary:** this was source retrieval and read-only inspection only. No production function, configuration, schema, ACL, schedule, chapter, or billable resource was changed.


### Expanded live privileged-worker authentication drift — 2026-10-17

- [x] Extended the read-only deployed-source inventory beyond scheduler/publisher to `generate-chapter` v59, `revise-chapter` v40, `generation-orchestrator` v35, `review-orchestrator` v11, `post-publication-canon-sync` v6, `publication-sync-processor` v4, and `autonomous-series-creation-runner` v6. Each retrieved live source uses service-role credentials but did not contain the branch's shared `isTrustedInternalApiKey` guard. All these functions reported `verify_jwt=true`; that gateway setting alone does not establish a trusted internal-worker identity.
- [x] Added [the expanded live privileged-worker authentication drift report](./PHASE1-LIVE-PRIVILEGED-WORKER-AUTH-DRIFT-20261017.md), including live version/source-marker observations, the distinction between a configuration/source gap and a proven exploit, and staged remediation prerequisites.
- [x] Separately rechecked `aevora-control-plane-audit` v4, which has `verify_jwt=false` but checks its dedicated `AEVORA_AUDIT_TOKEN` before privileged reads. Preserve this separate token boundary; do not move its token into browser code.
- [ ] Treat this as a broader live-vs-branch parity blocker, not authorization to deploy every branch candidate. Reconcile the legitimate caller for each function and the required cron/worker secret configuration; plan a narrow rollout with rollback and validate legitimate invocations before any production change.
- **Safety boundary unchanged:** this was live metadata/source retrieval and branch documentation only. No production deployment, secret/configuration update, schema/ACL/policy change, schedule mutation, chapter generation/publication, or billable Supabase branch was performed. Automated publishing remains NO-GO.


### Edge gateway configuration parity for internal secret-key auth — 2026-10-17

- [x] Supabase documentation confirms that new `sb_secret_...` keys are not JWTs: they must be sent in `apikey`, and Edge Functions using them need gateway JWT verification disabled while the handler performs explicit authentication. References: [key migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), [Edge Function auth guide](https://supabase.com/docs/guides/functions/auth).
- [x] Found a branch deployment-readiness gap: `supabase/config.toml` only set `verify_jwt = false` for `reader-event-intake`, despite the internal-worker handler guard and known non-JWT cron secret-key format.
- [x] Branch-only correction in commit `ce7e0241d6dfc35c19c2d97aa8858df427c355e4`: explicit `verify_jwt = false` entries for all 18 internal workers, the dedicated-token `aevora-control-plane-audit`, and the existing public bounded `reader-event-intake` endpoint. Handler-level authentication remains mandatory; this setting alone does not authorize callers.
- [x] Added a config/source-contract test in commit `a8813ded48530e898ebb6220d17ce833297e2563`, then corrected its regex in `eebd26b25b69178896fc51f25dcfb5549e7d2f9c`.
- [x] Branch config and handler-auth contract CI passed in [run 39011127178](https://github.com/freearmy599/taleforge/actions/runs/39011127178): Edge type-check/source-contract suite and disposable PostgreSQL rehearsal both succeeded. The new regression checks every one of the 18 shared-key worker entries against explicit `verify_jwt = false` configuration while existing handler tests require explicit trusted-key validation. This remains branch-only evidence.
- [ ] Production gateway configuration remains unchanged. Any deployment must verify `SUPABASE_SECRET_KEYS` and the explicit named-key allowlist are configured as expected, test legitimate scheduled callers and rejected client-role keys, and have an approved rollback plan.


### Autonomous-series scheduled caller credential mismatch — 2026-10-17

- [x] Read-only metadata inspection of cron job 13 `taleforge-autonomous-series-creation` confirms its request references `Authorization`, has no `apikey` header reference, and uses scheduled mode. The referenced Vault credential is 41 characters, matches the `sb_secret_...` format, and is not JWT-shaped; its value was not read or returned.
- [x] The deployed runner v6 has `verify_jwt=true` and compares the scheduled Bearer token to the legacy `SUPABASE_SERVICE_ROLE_KEY`. That is incompatible with the observed new secret-key format and caller header shape. This is a confirmed credential-format mismatch, not a successful exploit or proof of the exact gateway response.
- [x] Added branch-only handler correction in commit `c444535c6ddbec005c26f18a8602751d65d5278f`: scheduled mode validates the `apikey` header through the shared fail-closed allowlist helper; admin mode continues to validate a real Supabase user session and application role before privileged client creation.
- [x] Added `verify_jwt = false` for the mixed-mode runner in branch config commit `ab6c7c7297e8e5bf1bc235e6dcd5bccba651cd5a`; handler-level scheduled-key/admin-session checks remain mandatory.
- [x] Updated the source-contract test to require the new scheduled-key guard and reject the old legacy-token comparison in commit `aea120803bd7855c068712db966f0a85059e968f`.
- [x] Added [the caller-fix runbook](./PHASE1-AUTONOMOUS-RUNNER-SECRET-KEY-CALLER-FIX-20261017.md) describing the coordinated cron header correction without exposing the raw command or credential.
- [x] Handler/config/source-contract CI passed on the combined code/test commit [`aea1208`](https://github.com/freearmy599/taleforge/commit/aea120803bd7855c068712db966f0a85059e968f): [run 39008836597](https://github.com/freearmy599/taleforge/actions/runs/39008836597). The later commits are documentation-only; their CI runs are still being monitored.
- [ ] Production cron command must be updated from secret-in-Authorization/no-apikey to secret-in-apikey only, in a coordinated, owner-approved rollout. This cannot be inferred from branch tests and has not been done.
- **Safety boundary:** no cron command, function, secret, schedule, series, chapter, or production database state was changed. Do not run actual autonomous creation as a smoke test. Production autonomous-series creation and automated publication remain NO-GO.


### Cross-cron secret-key header drift — 2026-10-17

- [x] Extended read-only metadata inspection across all active `net.http_post` cron jobs without returning raw command text, headers, request/response bodies, or secret values.
- [x] Seven jobs—generation (3), release (4), blueprint (5), Story DNA (6), arc (7), publication sync (9), and semantic continuity (10)—reference the same non-JWT `sb_secret_...` credential in both `apikey` and `Authorization`. Their live targets report `verify_jwt=true` and their inspected deployed source lacks the branch's internal-key guard. Supabase documents that new secret keys should be sent in `apikey`, not `Authorization: Bearer`; gateway rejection is a high-confidence risk, but no live HTTP response was inspected to claim a specific observed failure.
- [x] Job 13 autonomous-series creation has the same credential in `Authorization` and no `apikey` header reference; the branch handler/config/test correction and caller runbook are tracked above.
- [x] Added [the cross-cron header-drift report](./PHASE1-CRON-SECRET-KEY-HEADER-DRIFT-20261017.md), including exact job/target mapping and safe rollout prerequisites.
- [ ] Update live cron headers only in an explicitly approved coordinated rollout after deploying the guarded handlers and matching `verify_jwt=false` config. Do not disable gateway verification on the current unguarded live versions.
- **Safety boundary:** no live cron, Edge Function, key, configuration, schedule, series, chapter, or production data was changed.

- [x] Strengthened the internal-worker auth contract to require the trusted-key result to control authorization and to fail with 401/403; explicitly accommodated the autonomous-series runner's assigned-key-guard pattern. Final validation passed on commit [3984f6c](https://github.com/freearmy599/taleforge/commit/3984f6c0e603029a636eadf13b1faf1e7280f70d): [run 39010227908](https://github.com/freearmy599/taleforge/actions/runs/39010227908) completed successfully with Edge checks and disposable PostgreSQL rehearsal. This remains branch-only evidence, not proof of live deployment or approval to change cron headers.
- [x] Added the all-worker gateway/handler configuration-parity regression in commit [`4bd9b40`](https://github.com/freearmy599/taleforge/commit/4bd9b405397e517b0ac00caeedab804c5b2fbc18). It catches a future config drift where a shared-key worker re-enables gateway JWT parsing while scheduled callers use the new non-JWT secret-key format. The same commit passed [run 39011127178](https://github.com/freearmy599/taleforge/actions/runs/39011127178); live gateway config and cron headers remain unchanged.


### Additional privileged-function authentication triage — 2026-10-17

- [x] Reviewed the live source of Chief Editor monitoring, autonomous-series preflight, cover worker, cover request, cover review, and operations snapshot functions to distinguish user-session endpoints from scheduled internal workers.
- [x] Chief Editor and cover endpoints reviewed here validate a Supabase user session and admin/owner role before service-role operations; the autonomous-series creation endpoint is preflight-only. These were not mechanically classified as the same secret-key cron mismatch. Keep their gateway JWT verification and explicit human-session checks intact.
- [x] Added the triage note to the [live authentication drift report](./PHASE1-LIVE-PRIVILEGED-WORKER-AUTH-DRIFT-20261017.md), commit `a62b1b8fd156129b5a9787bc94c1155832c77a77`.
- [x] Combined handler/config/source-contract validation passed on commit [`aea1208`](https://github.com/freearmy599/taleforge/commit/aea120803bd7855c068712db966f0a85059e968f): [run 39008836597](https://github.com/freearmy599/taleforge/actions/runs/39008836597). Subsequent documentation CI [run 39008917440](https://github.com/freearmy599/taleforge/actions/runs/39008917440), [run 39008944252](https://github.com/freearmy599/taleforge/actions/runs/39008944252), and privileged endpoint triage run [39009048127](https://github.com/freearmy599/taleforge/actions/runs/39009048127) also passed. The cron-target auth-contract test was strengthened in commit [`481dae3`](https://github.com/freearmy599/taleforge/commit/481dae3aa82360134fd0bf60d80e285e4540af6f) and its CI [run 39009197051](https://github.com/freearmy599/taleforge/actions/runs/39009197051) passed; the follow-up assertion now checks the actual handler guard and gateway config for each audited cron target.
- [x] The strengthened cron-target auth contract and corrected `apikey` assertion passed in [Edge validation run 39009871649](https://github.com/freearmy599/taleforge/actions/runs/39009871649) on commit [`9da935b`](https://github.com/freearmy599/taleforge/commit/9da935b067c99c9df5513a9ce1f189c5f2c6f5c5). Both jobs passed: the disposable PostgreSQL rehearsal and the Edge source/type-check suite. The subsequent checklist-only commit also passed in [run 39009952738](https://github.com/freearmy599/taleforge/actions/runs/39009952738). This validates branch contracts only; production rollout remains a separate owner-approved gate.

### Fresh live read-only inventory and ACL recheck — 2026-10-17

- [x] Re-read live Edge Function metadata: **26 active functions**. Critical versions remain `generate-chapter` v59, `release-publisher` v21, `release-scheduler` v12, `generation-orchestrator` v35, `review-orchestrator` v11, `publication-sync-processor` v4, and `autonomous-series-creation-runner` v6. All seven still report `verify_jwt=true`; `aevora-control-plane-audit` v4 remains the separate-token endpoint with `verify_jwt=false`.
- [x] Re-read migration inventory: **232 records**, latest `20261010161919 / aevora_release_scheduler_leases`. No newer migration record appeared in this recheck.
- [x] Re-ran a read-only `information_schema`/PostgreSQL catalog privilege inventory for `chapters`, `taleforge_ai_provider_state`, `release_schedules`, `publication_sync_outbox`, and `story_attachment_metrics`. Each table still has RLS enabled but not forced, and `anon` plus `authenticated` retain broad table grants including `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER`, `REFERENCES`, and `SELECT`. This is a grant-level finding, not proof that every operation succeeds through RLS; it is sufficient to keep the ACL remediation gate open.
- [x] Broadened the read-only catalog query to all public tables: **39 tables** have RLS enabled, no row policy, and client-role grants. On every one of the 39, both `anon` and `authenticated` have explicit table grants for `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `TRIGGER`, and `REFERENCES`. The set includes server workflow/operational tables (`chapter_generation_outputs`, `chapter_reviews`, `generation_jobs`, `release_schedules`, `publication_sync_outbox`, provider state, governance and continuity queues) as well as reader-facing candidates (`bookmarks`, `collections`, `comments`, `likes`, `notifications`, `profiles`, `ratings`, `reading_history`). No-policy RLS normally denies row access rather than granting it, so this is a severe least-privilege drift signal—not proof that REST clients can read/write rows or invoke arbitrary SQL. `TRUNCATE` bypasses RLS at the PostgreSQL layer, but this query alone does not show a PostgREST path that can invoke it. Review REST exposure, effective grants, ownership policies, and server-only call graphs before designing narrow remediation; do not bulk-create policies or blanket-revoke grants.
- [x] Rechecked `pg_default_acl` for both `postgres` and `supabase_admin` as object creators in `public`: default privileges grant `anon` and `authenticated` (and `service_role`) all of `SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN` on new tables, `SELECT/UPDATE/USAGE` on new sequences, and `EXECUTE` on new functions. This is a confirmed root-cause candidate for recurring over-grants, not proof of which actor or migration introduced the settings. Do not alter default ACLs until their provenance and required app/server behavior are reconciled; a reviewed forward-only correction should address both creators and explicitly preserve only intended service-side defaults.
- [ ] No live permissions, policies, functions, migrations, cron jobs, or application data were changed. Do not apply a blanket revoke until browser read paths, ownership policies, service-role worker paths, and rollback requirements have been mapped and tested.
- **Status:** the live-vs-branch auth drift and workflow-table ACL concerns remain unresolved. Automated publishing remains **NO-GO**.

### Cron SQL-routine distinction — 2026-10-17 read-only follow-up

- [x] Rechecked cron jobs 8 (`taleforge-quality-monitor`) and 12 (`taleforge-clara-supervision`): these execute SQL routines, not Edge Function HTTP requests, so the absence of `apikey`/`Authorization` headers is not by itself a caller-auth defect. Job 8 references `aevora_monitor_stale_chapter_claims()` and `run_taleforge_quality_monitor()`; job 12 references `taleforge_ceo_supervise_v2()`.
- [x] Catalog ACL checks show these three routines are `SECURITY DEFINER`, owned by `postgres`, and executable by `service_role`/`postgres` but not `anon`/`authenticated`. `anon` and `authenticated` also lack `CREATE` on schema `public`. No raw cron command or secret value was retrieved.
- [ ] Preserve source-provenance review for these governance/monitor routines before changing them. `run_taleforge_quality_monitor()` and `taleforge_ceo_supervise_v2()` use `search_path=public`; this is not a demonstrated exploit, but their definitions and intended trusted invocation should be reconciled with repository migration history before any modification.
- **Safety boundary:** read-only catalog and cron metadata queries only; no routine, grant, cron schedule, or application data was changed.
