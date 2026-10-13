# Aevora Phase 1 — audit checkpoint (2026-10-13)

## Latest verified branch validation

Repair branch: `aevora/release-scheduler-hardening`

Latest successful workflow observed: [run 38342939683](https://github.com/freearmy599/taleforge/actions/runs/38342939683), commit `53fe999d38de6e300a7b479e4d0459582c28d9ba`. Source-contract tests: **59 passed, 0 failed**. The configured Edge Function type-check workflow completed successfully. Two preceding failures were caused by an overly strict source-contract assertion for the continuity-review guard; the assertion was corrected and the later runs passed.

## Additional quota protection confirmed on the branch

- `generate-chapter` checks provider state in both generation and quality-review paths and fails closed for missing/error state or malformed cooldown timestamps.
- `generation-orchestrator` validates cooldown timestamps, fails closed on missing/invalid provider state before orchestration, and rechecks before each schedule.
- `continuity-review`, `originality-review`, and `safety-review` now reject malformed non-empty cooldown timestamps rather than treating invalid dates as expired.
- Regression tests cover malformed cooldown state, and semantic continuity dry-run now returns before queue-claim mutation.
- Continuity handlers and the recovered semantic extraction worker have branch-only internal caller guards; no production deployment was made.

## Remaining confirmed drift / rollout blockers

- Live Supabase `revise-chapter` v40 is not present at the expected path in the repair branch, even though `generation-orchestrator` invokes it using the server key. The live handler has POST-only handling and provider-state lookup, but the audited source did not show a shared handler-level internal-key guard and did not reject malformed cooldown timestamps. It must be recovered into a manageable, normalized repository source file, patched, and type-checked before any rollout. Do not claim this path is fixed.
- Live handlers still have gateway JWT verification enabled. Branch-level internal-key checks are defense in depth, not proof of production protection until deployed and caller paths are verified.
- Safe end-to-end scheduler/publisher/outbox verification remains pending; do not invoke live jobs just to test.
- The previously documented chapter-number gaps, approved generation outputs lacking publication-review rows, stale schedule, and table-by-table RLS/grant review remain open.
- Existing RLS-enabled tables without policies need individual access-path review. Do not add blanket policies to silence the audit.

## Safety boundary

This checkpoint and its source changes are repository-only. No production function was deployed or edited; no migrations, live schedule changes, chapter generation, or publication were performed. No billable Supabase development branch was created.
