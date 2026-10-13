# Aevora Phase 1 — internal worker authorization (2026-10-13)

## Live caller mapping

Read-only inspection confirmed four active cron jobs invoke the internal planning/extraction endpoints:

- `taleforge-blueprint-tick` — every 15 minutes, calls `blueprint-planner`
- `taleforge-dna-tick` — every 30 minutes, calls `story-dna-planner`
- `taleforge-arc-tick` — hourly, calls `arc-planner`
- `taleforge-semantic-continuity-tick` — every 10 minutes, calls `semantic-continuity-extraction`

All four cron commands have Authorization and apikey headers configured. Header values were not retrieved. The publication canon worker also calls character/world continuity with server-side headers, and semantic extraction does the same.

## Prepared-branch hardening

The prepared branch now includes the live source plus the shared internal API-key allowlist guard and POST-only request policy for:

- `character-continuity`
- `world-continuity`
- `blueprint-planner`
- `story-dna-planner`
- `arc-planner`
- `semantic-continuity-extraction`

The guards run before request-body parsing and before privileged Supabase client creation. The explicit named-secret allowlist is preserved. These edits are branch-only; no live function was changed.

## Validation

[GitHub Actions run 38340469548](https://github.com/freearmy599/taleforge/actions/runs/38340469548) passed **54 source-contract tests, 0 failures**, and all **13 configured Edge Function type checks** on commit `2b998b154bc954584cc5866f0eca44f40469144a`.

## Remaining issue

The prepared `semantic-continuity-extraction` dry-run path still calls the queue-claim RPC and then attempts to reset the claimed row to pending. That makes dry-run operationally mutating and can race with another worker. A branch-only correction is still needed so dry-run selects a pending row read-only while only `execute=true` claims work. This change has not been made or validated yet.

No production deployment, migration, queue execution, chapter generation/publication, schedule mutation, secret access/rotation, or billable Supabase branch was initiated. Phase 1 remains open.
