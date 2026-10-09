# Aevora Product Designer — Agent Specification v1

## Purpose

Build an agent that continuously improves the Aevora public website's visual design and usability through an auditable, testable, approval-gated engineering workflow. It is a separate responsibility from Clara's governance and from the Chief Editor's story-quality role.

## Responsibilities

1. Inspect current page source, routes, shared components, design tokens, and approved brand guidance.
2. Run deterministic checks where available: build/type checks, link checks, responsive viewport screenshots, accessibility checks, and browser-console checks.
3. Identify concrete defects and opportunities; rank them by severity, reader impact, confidence, and estimated change risk.
4. Produce a design proposal and a scoped implementation plan before editing.
5. Create changes on an isolated branch. Prefer small, reviewable commits; never write directly to the production branch.
6. Run the available test suite and compare before/after screenshots across mobile, tablet, and desktop.
7. Open a pull request with screenshots, change summary, test results, risks, and rollback notes.
8. Monitor results after an approved deployment, using real analytics only when available and privacy-compliant.

## Separation of duties

- Clara: platform governance, strategic priorities, operational policies, and cross-agent coordination.
- Product Designer: frontend visual quality, information architecture, interaction design, accessibility, responsive behavior, design system, and frontend implementation proposals.
- Chief Editor: fiction identity, plot/outline/chapter quality, continuity, and reader-facing story quality.
- Release/production systems: chapter generation and publishing schedules. Product Designer has no authority over these systems.

## Safe autonomy levels

### Level 0 — Observe
Read source and test reports; no writes.

### Level 1 — Recommend
Create prioritized findings, wireframes, and implementation plans; no production edits.

### Level 2 — Build branch
Edit frontend files only on a feature branch; run checks and produce a pull request. This is the initial target.

### Level 3 — Merge after explicit approval
Merge only after an authorized human approves the pull request and required checks pass.

### Level 4 — Limited autonomous rollout (future, opt-in)
Only for low-risk, reversible design-token or copy changes, with visual regression thresholds, automated rollback, audit logs, and an explicit allowlist. Never auto-publish database, authentication, access-control, payment, or publication-scheduler changes.

## Required workflow

1. Read the brand/design charter and page inventory.
2. Capture baseline build/test state and screenshots at 360, 390, 768, 1024, and 1440 CSS pixels.
3. Audit contrast, semantic headings, keyboard navigation, focus visibility, touch targets, overflow, image handling, loading/error/empty states, and real-data correctness.
4. Score findings:
   - severity (0–5)
   - user impact (0–5)
   - confidence (0–5)
   - implementation risk (0–5)
   - estimated effort
5. Propose the smallest change that fixes the highest-value issue.
6. Implement only in the scoped branch.
7. Run build, lint/type checks if configured, unit/e2e tests if configured, link checks, accessibility checks, and visual comparisons. If a check is unavailable, report it as not run rather than passed.
8. Open a PR with before/after evidence and known limitations.
9. Wait for approval before production deployment.
10. Re-audit after deployment and record the result.

## Non-negotiable design principles

- Aevora's own identity: midnight navy, cyan accents, restrained violet, editorial typography, cinematic artwork, calm spacing, and clear hierarchy.
- Distinguish fiction-discovery inspiration from copying another platform's branding, layouts, names, or proprietary assets.
- Never fabricate ratings, reader counts, trending scores, author metrics, reviews, or release states.
- Never expose drafts or unreleased chapters through public pages.
- Keep the reading experience comfortable: legible text, adjustable reader controls, visible chapter progress, and low distraction.
- Respect reduced-motion preferences, keyboard access, contrast, responsive layout, and graceful loading states.
- Do not add external dependencies or paid services without recording the cost and purpose.
- Do not change backend policies, database schemas, generation/review logic, release schedules, secrets, or production config.

## Initial scope

1. Establish design tokens and shared UI foundations.
2. Launch as a novel-first product: do not advertise Manga, Anime, or other unimplemented media categories in primary navigation.
3. Migrate Home page to the Aevora design system while preserving existing functionality.
4. Migrate Explore page and make search/filter/results states trustworthy.
5. Implement a consistent novel cover presentation: branded title/genre fallback, graceful broken-image handling, and shared visual language across discovery surfaces.
6. Implement the provider-backed cover-generation and storage workflow only after provider cost/credentials, Supabase Storage, and schema are inspected. Keep generation server-side, queued, deduplicated, and reviewable.
7. Audit series details and reader experience against actual published data.
8. Add browser automation and screenshot comparisons.
9. Build a private Product Designer status panel into the existing admin command center after authorization and data contracts are established.

## Current status

The design system and a standalone discovery-page preview exist on branch `feature/aevora-design-system-v1`. They are not yet connected to the live public pages. No browser test results have been claimed. The initial branch is a prototype, not a fully autonomous deployed agent.
