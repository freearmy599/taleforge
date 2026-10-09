# Aevora Public Website Audit — Initial Pass

Date: 2026-10-09
Scope: repository source inspection of `index.html`, `stories.html`, and `README.md`. This is a source-level audit, not a browser screenshot, accessibility automation, or production verification.

## Findings

### 1. Brand is not yet unified
- Home title/metadata still say TaleForge and use the canonical `https://taleforge.pages.dev/`.
- Explore title says `Explore — TaleForge`.
- Homepage design tokens use near-black and gold; Explore repeats the gold palette separately.
- The newly defined Aevora direction uses midnight navy, cyan, and restrained violet. Integration must happen deliberately; do not simply replace colors in one file and leave the other pages inconsistent.
- README is only a short project tagline and does not describe the current app or deployment.

### 2. Styles are duplicated between pages
- Home and Explore define their own root variables and navigation styles.
- Shared tokens and components should move toward `assets/aevora-design-system.css`, with page-specific styles kept separate until migrated and verified.
- Do not remove existing page styles until parity has been checked at desktop and mobile widths.

### 3. Discovery needs trustworthy information architecture
- The Explore page has a search field, filters, and story cards. These are useful foundations.
- Home includes a featured story and release/discovery sections.
- Any trending, popularity, rating, author, or update labels must be based on real data. If data is missing, use honest editorial shelves or hide the metric.
- Avoid repeated titles across every shelf; make each shelf's purpose distinct.
- Search, filters, clear/reset behavior, and empty states need end-to-end testing against actual story data.

### 4. Mobile behavior is partially considered, but not verified
- Both pages include responsive CSS breakpoints.
- A source-level media query is not proof that navigation, card grids, search, and reading controls work well on actual phone widths.
- Test 360px, 390px, 768px, 1024px, and wide desktop layouts; inspect horizontal overflow, tap target size, text wrapping, sticky navigation, and keyboard/focus behavior.

### 5. Reader and series experience must preserve publication rules
- Series and chapter pages must show only publicly published content to anonymous/public readers.
- Chapter ordering must be contiguous and respect the release scheduler.
- Planned chapters must not appear as published chapters.
- Reading progress, bookmarks, ratings, views, and reader personalization must not be faked or hard-coded.
- The current audit did not inspect every reader route or validate Supabase policies; those are explicit follow-up tasks.

### 6. Metadata and accessibility need a unified review
- Home includes description and Open Graph metadata, but the canonical domain must be confirmed before changing it.
- Check unique page titles/descriptions, canonical URLs, heading order, image alt text, focus indicators, contrast, and semantic button/link behavior.
- Avoid adding a new external font or image dependency without considering load performance and fallback behavior.

## Priority order

1. Confirm the production domain and Aevora/TaleForge transition rules before changing canonical metadata.
2. Integrate shared design tokens on a separate branch, one page at a time.
3. Rework Home/Discover hierarchy and shelves.
4. Rework Explore search/filter/results states.
5. Audit the series detail and chapter reader against the real data model and release protections.
6. Add browser-level viewport, accessibility, and functional checks before merging.

## Current change in this branch

- Added `assets/aevora-design-system.css` with semantic tokens, shared component foundations, responsive grid utilities, reader typography, focus states, and reduced-motion support.
- The stylesheet is intentionally not linked to existing pages yet. This avoids an unreviewed site-wide visual change and allows a page-by-page migration.
- No database, scheduler, generation, release, or publication code was changed.
