# Aevora Phase 1 — server-only grants follow-up (2026-10-13)

## Read-only production findings

- A read-only query of `information_schema.role_table_grants` confirmed that both `anon` and `authenticated` currently have broad table-level privileges (including SELECT, INSERT, UPDATE, and DELETE) on `public.publication_sync_outbox` and `public.story_attachment_metrics`.
- A separate read-only catalog query confirmed RLS is enabled and there are zero policies on both tables. That is good row-policy posture, but the unnecessary table grants should still be revoked so these tables are not directly exposed to client roles.
- The `publication_sync_outbox` snapshot previously contained 40 events, all `succeeded`; the active `taleforge-publication-sync` cron runs every five minutes. Cron header values were not retrieved.
- A read-only query of `supabase_migrations.schema_migrations` returned no rows for migration versions `20261013090000` or `20261013100000`. Therefore this branch migration has not been recorded as applied under those versions. The production grants query is the direct evidence that client-role privileges remain.

## Prepared-branch change only

Canonical migration: `20261013090000_aevora_server_only_metrics_outbox_grants.sql`.

It enables RLS if each table exists and revokes table privileges from `PUBLIC`, `anon`, and `authenticated` for both server-only tables. It creates no client-facing policies and does not revoke the existing `service_role` privileges.

A duplicate follow-up migration was removed from the repair branch; the contract test now validates the canonical migration only. No migration was applied to production.

## Validation

The latest successful CI run [38344611237](https://github.com/freearmy599/taleforge/actions/runs/38344611237) passed **62 source-contract tests, 0 failed**, with all configured Edge Function type checks successful on commit `9b15088e52e3b9658d0fc9c62dc87579990d1393`.

Source-contract tests do not replace a staging integration check. Phase 1 remains open.

## Required before any separately authorized rollout

- Confirm the canonical migration against current production migration history and re-check the exact privileges after rollout.
- Check downstream server-role access paths before revoking client privileges; no public policies should be added for these internal tables.
- Keep the migration unapplied until explicit production-change authorization is given.
