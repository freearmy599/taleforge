# Aevora Phase 1 — server-only grants follow-up (2026-10-13)

## Read-only production findings

- `publication_sync_outbox` has row-level security enabled and no client policies, but ordinary client roles still held unnecessary table-level grants.
- The `taleforge-publication-sync` cron job is active on a five-minute schedule and has both Authorization and apikey headers configured. Header values were not retrieved.
- The outbox snapshot contained 40 events, all with status `succeeded`.

## Prepared-branch change only

Migration `20261013090000_aevora_server_only_metrics_outbox_grants.sql` enables RLS and revokes table privileges from `PUBLIC`, `anon`, and `authenticated` for `publication_sync_outbox` and `story_attachment_metrics` if each table exists. It intentionally creates no client-facing policies and leaves server-role grants untouched.

No migration was applied to production.

## Validation

[GitHub Actions run 38339879515](https://github.com/freearmy599/taleforge/actions/runs/38339879515) passed 52 source-contract tests and all seven configured Edge Function type checks on commit `79df0234e2466e11c8c9db142d3dba12ab7fb320`.

The CI read allowlist was updated after the first run exposed that the new migration file was not included in the test's explicit read permissions. The corrected run passed.

## Remaining verification

- Exact live privileges for `story_attachment_metrics` have not been verified.
- The prepared migration must be checked against production migration history before any separately authorized rollout.
- Source-contract tests are not production integration proof. Phase 1 remains open.
