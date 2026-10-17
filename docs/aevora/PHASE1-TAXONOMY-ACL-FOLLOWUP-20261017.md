# Aevora Phase 1 — Taxonomy ACL Follow-up Finding

Date: 2026-10-17  
Branch: `aevora/release-scheduler-hardening`

## Finding

The branch migration `20261017100000_lock_internal_reference_taxonomy_reads.sql` removes SELECT privileges from 14 internal taxonomy/grammar relations and their columns for `PUBLIC`, `anon`, and `authenticated`. Its intent is to keep raw genre grammar, trope recipes, inversion patterns, compatibility/risk rules, and series-specific planning profiles server-side.

However, a SELECT-only revoke does not remove other relation-level privileges that may be present on these tables, including INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, or PostgreSQL 17 MAINTAIN. RLS with no policy generally blocks row operations, but it does not itself remove these grants; TRUNCATE and structural privileges should not be left as unnecessary client grants. The live catalog audit found broad client grants on a 39-table RLS-enabled/no-policy set, so this gap should be explicitly reconciled rather than assumed covered by the SELECT lock.

## Affected relations

- `taleforge_genre_taxonomy`
- `taleforge_subgenre_intelligence`
- `taleforge_narrative_modes`
- `taleforge_story_trope_library`
- `taleforge_genre_grammars`
- `taleforge_genre_inversion_patterns`
- `taleforge_grammar_compatibility`
- `taleforge_hybrid_story_recipes`
- `taleforge_hybrid_story_recipes_generated`
- `taleforge_narrative_culture_profiles`
- `taleforge_series_genre_grammar_profiles`
- `taleforge_series_genre_profiles`
- `taleforge_series_narrative_profiles`
- `taleforge_series_subgenre_profiles`

## Proposed branch-only correction

Prepare a forward-only candidate that, for exactly these relations:
1. fails closed if any expected relation is missing;
2. revokes all relation-level privileges from `PUBLIC`, `anon`, and `authenticated`;
3. revokes independent column-level grants from those same principals;
4. does not change `service_role`, owners, policies, schema privileges, or default ACLs; and
5. is accompanied by a static source-contract test and disposable-PostgreSQL positive/negative role checks.

This should not be folded into a blanket schema-wide revoke. Verify relation kinds, ownership, and whether any current feature intentionally needs browser access before finalizing the candidate. Existing browser-to-workflow tests should also include these 14 names where appropriate.

## Verification gates

- [ ] Confirm each relation's live relation kind, owner, RLS flags, policies, and effective ACL.
- [ ] Confirm no legitimate browser/client call path requires raw taxonomy reads.
- [x] Add forward-only candidate `20261017140000_lock_internal_reference_taxonomy_client_access.sql` and source-only contract `scripts/aevora-internal-taxonomy-acl-contract.test.mjs`.
- [x] Rehearse the candidate in disposable PostgreSQL: run [39012169911](https://github.com/freearmy599/taleforge/actions/runs/39012169911) passed the dedicated taxonomy ACL rehearsal, asserting `anon` and `authenticated` lost relation-level and column-level privileges while `service_role` retained its expected privileges.
- [x] Confirm the exact candidate/test commit CI succeeded: [run 39012169911](https://github.com/freearmy599/taleforge/actions/runs/39012169911) passed Edge/source-contract validation 60/60 steps and PostgreSQL rehearsal 22/22 steps.
- [ ] Keep production unchanged unless a separate explicit approval and rollback plan are provided.

## Current status

The branch-only migration candidate, static contract, disposable fixture/assertions/safety-gated runner, and CI steps are now present. Run 39012169911 passed both the source-contract suite and the dedicated disposable PostgreSQL ACL rehearsal. This validates the tested branch fixture only, not live schema compatibility or production deployment. No production ACLs or schema were changed. Automatic publication remains **NO-GO**.
