# Aevora Phase 1 — Provisional Reference-Taxonomy Read Review

**Date:** 2026-10-17  
**Scope:** Read-only live Supabase catalog review and branch source scan. No ACL or policy changes.

## Finding

The 14 tables previously provisionally classified as public taxonomy/reference data cannot yet be considered safe to expose as raw tables. All 14 have a client-readable SELECT policy limited to `active`, except `taleforge_hybrid_story_recipes_generated`, which allows `validated` or `active`. That status filter limits rows, not fields. The schemas include internal rule sets, structural weights, originality constraints, compatibility/risk analysis, and series-specific planning profiles.

## Risk groups

- **Potentially publishable taxonomy labels, but raw rows still need projection:** `taleforge_genre_taxonomy`, `taleforge_subgenre_intelligence`, `taleforge_narrative_modes`, and `taleforge_story_trope_library`. Besides names/descriptions, schemas include structural rules, pacing/character/worldbuilding rules, originality constraints, or inversion patterns.
- **Generation recipe and evaluation internals:** `taleforge_genre_grammars`, `taleforge_genre_inversion_patterns`, `taleforge_grammar_compatibility`, `taleforge_hybrid_story_recipes`, `taleforge_hybrid_story_recipes_generated`, and `taleforge_narrative_culture_profiles`. Their columns include escalation/payoff rules, anti-patterns, composability, conflict/resolution rules, risk profiles, architecture rules, and detailed narrative/cultural pattern libraries.
- **Series-specific design state:** `taleforge_series_genre_grammar_profiles`, `taleforge_series_genre_profiles`, `taleforge_series_narrative_profiles`, and `taleforge_series_subgenre_profiles`. These include `series_id`, profile/version lineage, structural weights, rationale, selection signals, originality constraints, and compatibility reports. Active status alone does not establish that these internals should be reader-visible.

## Caller audit

A source scan of the current branch found no direct references to these 14 exact table names in the 21 deployed Edge Function `index.ts` sources, or in the inspected public browser files (`index.html`, `stories.html`, `story.html`, `chapter.html`, `series.html`, `library.html`, `supabase-client.js`, `taleforge-data.js`). This is evidence that there is no direct caller in those inspected files, not proof that no dynamic SQL, SQL function, future creator flow, or external client depends on them. The product has a planned rich genre/hybrid/original-genre system, so removing access without mapping that intended contract could still break future creator workflows.

## Decision

1. **Do not keep raw-table SELECT access merely because a row is active.**
2. **Do not blanket-revoke these 14 tables yet.** Complete the database-function, trigger, external-client, and creator-workflow inventory first.
3. If browser/creator use is required, expose narrow, explicit projections (for example genre key, display name, parent/family, and a reviewed public description) through dedicated views or RPCs. Keep structural weights, evaluation rationale, risk/compatibility internals, prompt-like rules, and series-specific profile state server-side unless each field is deliberately approved for disclosure.
4. Add disposable PostgreSQL tests for anonymous/authenticated access to approved public fields and denial of internal columns/raw tables. Verify service-role worker access remains intact.
5. Keep the existing 27-table internal-design lock and the separate 41-table write/maintenance hardening as distinct decisions.

## Safety boundary

This report records catalog and source evidence only. It does not modify live policies, grants, rows, migrations, Edge Functions, release schedules, or publication state. Automatic publishing remains NO-GO.


## Branch-only containment candidate — 2026-10-17

- Added `supabase/migrations/20261017100000_lock_internal_reference_taxonomy_reads.sql`. It fails closed if any of the 14 expected relations is missing, revokes raw relation-level and column-level SELECT from `PUBLIC`, `anon`, and `authenticated`, and deliberately preserves `service_role` access. It does not drop or rewrite the existing RLS policies; without SELECT grants those policies do not expose raw rows.
- Added a disposable fixture that simulates active-row SELECT policies plus relation and column grants for all 14 tables. Assertions verify anonymous/authenticated raw SELECT is gone, service-role SELECT remains, and the fixture policies remain present.
- The complete disposable PostgreSQL readiness/security rehearsal passed in [CI run 38950058686](https://github.com/freearmy599/taleforge/actions/runs/38950058686); the Edge Function/type/source-contract job also passed. The first attempt exposed a test-harness-only mistake (`read` was undefined in the Node test); that was corrected to use the file's existing async `readFile` API before the passing run.
- This remains a candidate, not a production change. The intended public taxonomy projection is still unbuilt; before exposing genre labels/descriptions to browsers or creator tools, create explicit reviewed views/RPCs with only approved fields and test them separately.
