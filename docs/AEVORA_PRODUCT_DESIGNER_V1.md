# Aevora Product Designer — v1 Charter

## Purpose

The Aevora Product Designer is the platform's design-governance and experience-improvement system. Its job is to keep the public product visually coherent, readable, accessible, mobile-friendly, fast, and recognizably Aevora as new features and content are added.

It is not allowed to make unreviewed production changes to the public site. Version 1 produces proposals, design tokens, page specifications, component rules, and review findings. Code changes are staged and verified before release.

## Brand direction

- Brand: Aevora — an original home for serialized fiction and fictional worlds.
- Visual tone: cinematic, premium, immersive, literary, contemporary.
- Core palette: deep midnight navy/charcoal, cool cyan/teal accents, restrained indigo/violet for discovery and interactive states, warm ivory text.
- Typography: distinctive editorial serif for story titles and display headings; clean sans-serif for navigation, metadata, controls, and long-form UI.
- Imagery: story-specific covers and world art with consistent crops, legible overlays, useful alt text, and fallbacks. Never rely on artwork alone to convey a title or action.
- Avoid copying another platform's exact layout, labels, assets, color signatures, character profiles, or interaction patterns. Learn from general product patterns and build a distinct Aevora system.
- Avoid fabricated metrics such as views, ratings, popularity, author followers, or chapter counts. Show only real data; use clearly marked previews for design demos.

## Product experience principles

1. Story-first discovery: titles, hooks, genre, update status, and next action are immediately clear.
2. Immersive reading: typography, line length, spacing, contrast, progress, chapter navigation, and reader preferences take priority over decorative UI.
3. Fictional-world depth: series pages can connect characters, locations, factions, timelines, artifacts, and lore without overwhelming first-time readers.
4. Reader trust: distinguish published chapters from planned chapters; explain release cadence honestly; never imply a draft is live.
5. Progressive complexity: casual readers see a simple path to reading; deeper worldbuilding and community tools appear when relevant.
6. Responsive by design: mobile is a first-class experience, not a squeezed desktop layout.
7. Accessible interaction: keyboard support, visible focus, semantic controls, sufficient contrast, reduced-motion support, and descriptive image text.
8. Performance: avoid unnecessary large assets, layout shifts, heavy animations, and scripts that delay reading.
9. Coherence: shared components, spacing, type scales, states, and design tokens across all public pages.
10. Originality: Aevora's visual identity must be recognizable even when story artwork changes.

## Core public page architecture

### Home / Discover
- Featured original series with a strong hook and clear Read action.
- Continue Reading only when a real reader session/progress record exists.
- Trending and Rising shelves based on real, documented signals; no invented rankings.
- Latest Releases with published timestamps and real update status.
- Genre and mood discovery.
- New-to-Aevora collection and editor-selected collections.
- Personalized recommendations only when there is enough legitimate reader data; otherwise use transparent editorial or popularity-based shelves.
- Community and creator entry points should not crowd out reading.

### Explore
- Search across title, subtitle, summary, genre, themes, and eligible world/character metadata.
- Filters for genre, status, length, update cadence, tone, and content suitability when data exists.
- Sorts must be explicit and reproducible.
- Helpful empty states and clear reset controls.
- Avoid duplicating the same story across every shelf without a reason.

### Series detail
- Cover and optional cinematic banner.
- Original title, subtitle/hook, synopsis, genres, status, update cadence, and real progress.
- Primary Read/Continue Reading action.
- Chapters list with honest lock/publish states.
- Overview, characters, world/lore, reviews, and series metadata.
- Spoiler-aware character and lore content.
- Clear creator/AI-assistance disclosure where required by platform policy.

### Reader
- Focused reading column with a comfortable measure and line-height.
- Chapter title, actual publication date, and reading-time estimate when computed.
- Previous/next controls that respect publication state.
- Adjustable text size, theme, and line spacing; remember preferences only with an appropriate mechanism.
- Reading progress and library/bookmark controls.
- No unrelated sidebar content that breaks immersion on narrow screens.
- Reader must never expose unpublished chapter text to public clients.

### Character and world profiles
- Strong identity and biography; role, motivations, traits, relationships, affiliations, timeline events, and relevant appearances.
- Popularity, rankings, fans, or likes only if the product actually measures them and prevents obvious abuse.
- Community-added traits or reactions need moderation and abuse controls.
- Keep fictional-character data distinct from real-person data.
- Avoid sexualized presentation of minor characters; maintain age-appropriate presentation and content safeguards.

### Library and account
- Continue reading, saved series, reading history, notification preferences, and account controls.
- Clear privacy and deletion controls where applicable.
- Empty states explain the benefit and offer a meaningful next action.

### Creator / author surfaces
- Creator profile, published works, update consistency, and world links.
- Do not invent follower counts or creator rankings.
- Creation workflows should separate draft, reviewed, scheduled, and published states.

## Design system deliverables

- Semantic color tokens for background, surface, raised surface, text, muted text, border, focus, success, warning, and error.
- Type scale for display, heading, body, metadata, and reader text.
- Spacing, radius, shadow, content-width, grid, and breakpoint tokens.
- Shared components: navigation, search, buttons, badges, story card, cover frame, shelf, filters, tabs, chapter row, progress bar, empty state, skeleton, modal, toast, reader controls, and accessibility focus state.
- States: default, hover, focus, pressed, disabled, loading, empty, error, and success.
- Responsive specifications for phone, tablet, laptop, and wide desktop.

## Product Designer workflow

1. Inspect the current repository and list pages, shared styles, data dependencies, and responsive behavior.
2. Identify the highest-impact issues by user journey, not by aesthetic preference alone.
3. Produce a proposal with screenshots/mockups or clear component/page specifications and explain the rationale.
4. Check brand consistency, accessibility, content integrity, responsive behavior, performance, SEO, and data authenticity.
5. Stage code changes in a branch or isolated files; never overwrite a working public page without a recoverable baseline.
6. Run static checks and manual viewport checks; verify navigation and real data bindings.
7. Present a change summary and known limitations for approval.
8. After release, monitor errors, reading completion, search success, and page performance; avoid optimizing solely for clicks.

## Governance and authority

- Product Designer: visual system, interaction design, consistency, usability, and experience audits.
- Chief Editor: story quality, series identity, chapter plans, continuity, and reader-facing editorial presentation.
- Clara: governance, safety, resource limits, production policy, and cross-system oversight.
- Admin: review proposals, approve deployments, and roll back changes.

These roles should communicate through explicit structured findings, not through unrestricted direct database writes.

## Review rubric (proposal)

Score each dimension from 0–5 and provide evidence:
- Brand coherence
- Information hierarchy
- Readability and accessibility
- Mobile usability
- Navigation and task completion
- Real-data integrity
- Performance and resilience
- Originality and distinctiveness

A low score must produce actionable findings. The overall average must not override a critical failure such as inaccessible controls, fabricated public metrics, broken primary navigation, or exposure of unpublished content.

## Safe implementation order

1. Audit current public pages and mobile behavior.
2. Establish tokens and shared components without changing production data or generation schedules.
3. Improve Home/Discover and Explore.
4. Improve Series Detail and Reader.
5. Add character/world profiles when supported by actual schema and content.
6. Add a protected Product Designer panel in the existing admin session, not a separate weaker login.
7. Add proposal review, visual regression checks, and rollback guidance before any autonomous design deployment.

## Current-state caution

This document defines the target architecture. It does not assert that these features are implemented. The current repository contains static HTML pages and existing Supabase-connected workflows; every planned feature must be checked against actual code and schema before being represented as live.
