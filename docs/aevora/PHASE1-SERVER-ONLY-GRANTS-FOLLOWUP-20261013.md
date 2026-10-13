# Aevora Phase 1 — server-only grants follow-up (2026-10-13)

## Read-only production findings

- A read-only query of `information_schema.role_table_grants` confirmed that both `anon` and `authenticated` currently have broad table-level privileges (including SELECT, INSERT, UPDATE, and DELETE) on `public.publication_sync_outbox` and `public.story_attachment_metrics`.
- The `publication_sync_outbox` snapshot previously contained 40 events, all `succeeded`; the active `taleforge-publication-sync` cron runs every five minutes. Cron header values were not retrieved.
- A read-only query of `supabase_migrations.schema_migrations` returned no rows for migration versions `20261013090000` or `20261013100000`. Therefore this branch migration has not been recorded as applied under those versions. The production grants query is the direct evidence that client-role privileges remain.

## Prepared-branch change only

Canonical migration: `20261013090000_aevora_server_only_metrics_outbox_grants.sql`.

It enables RLS if each table exists and revokes table privileges from `PUBLIC`, `anon`, and `authenticated` for both server-only tables. It creates no client-facing policies and does not revoke the existing `service_role` privileges.

A duplicate follow-up migration was removed from the repair branch; the contract test now validates the canonical migration only. No migration was applied to production.

## Validation

The most recent successful CI run before this cleanup was [run 38342939683](https://github.com/freearmy599/taleforge/actions/runs/38342939683), with **59 source-contract tests passed and 0 failed** on commit `53fe999d38de6e300a7b479e4d0459582c28d9ba`. The latest cleanup commit requires a fresh run before it can be considered validated.

Source-contract tests do not replace a staging integration check. Phase 1 remains open.

## Required before any separately authorized rollout

- Confirm the canonical migration against current production migration history and re-check the exact privileges after rollout.
- Check downstream server-role access paths before revoking client privileges; no public policies should be added for these internal tables.
- Keep the migration unapplied until explicit production-change authorization is given.
