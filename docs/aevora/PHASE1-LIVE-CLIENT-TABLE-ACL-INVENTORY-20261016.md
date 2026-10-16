# Aevora Phase 1 — live client table privilege inventory
Date: 2026-10-16
Branch: aevora/release-scheduler-hardening
Scope: read-only PostgreSQL catalog audit

## Summary of live public-schema table ACLs

A read-only catalog aggregation across ordinary and partitioned public tables returned:
- 91 tables with RLS enabled and zero policies.
- 39 of those policyless RLS tables also have client relation-level mutation grants.
- 103 tables with relation-level TRUNCATE granted to anon and/or authenticated.
- 103 tables with relation-level INSERT, UPDATE, or DELETE granted to anon and/or authenticated.

These are ACL inventory counts, not proof that every action is callable through PostgREST: RLS denies ordinary row operations on policyless tables, and API routing imposes additional constraints. However, RLS does not protect against TRUNCATE, and the broad grants violate least privilege. They must not be treated as harmless merely because policies are absent.

## Confirmed examples

The live ACL query explicitly found the following internal tables with RLS enabled, zero policies, and client SELECT/write/TRUNCATE relation grants:
- automation_config
- chapter_blueprints
- chapter_generation_outputs
- chapter_publication_reviews
- chapter_reviews
- generation_jobs
- generation_settings
- publication_sync_outbox
- release_schedules
- story_attachment_metrics
- story_blueprints
- story_versions
- taleforge_ai_provider_state
- several CEO, continuity, narrative-intelligence, and governance tables

The exact examples above are a subset, not a complete inventory. A follow-up must export the full table-by-table grant and policy matrix and classify each table as public read, user-owned CRUD, server-only, or explicitly approved RPC surface.

## Branch migration relationship

The branch contains targeted candidates:
- `20261013090000_aevora_server_only_metrics_outbox_grants.sql` revokes relation and column grants for `publication_sync_outbox` and `story_attachment_metrics`.
- `20261013120000_lock_ai_provider_state_table.sql` revokes relation and column grants for the provider-state table.
- `20261013130000_lock_internal_policyless_tables.sql` locks a finite list of internal policyless tables.
- `20261014180000_revoke_unapproved_internal_client_writes.sql` removes write privileges from a separate internal-prefixed inventory.

These are branch candidates, not live repairs. Live migration history ends at 2026-10-10, so these October 13–16 candidates are not applied to the connected production project. The live grants for the three specifically audited server-only tables remain broad.

## Safe next work

1. Produce a complete read-only inventory of all public tables with client grants, RLS status, policy count, column-level grants, and table owner.
2. Compare every table against tracked migration history and deployed app/Edge Function call sites.
3. Preserve explicitly intended user-facing operations; do not apply a blanket revoke across all 103 tables without classifying them.
4. For server-only tables, revoke both relation-level and column-level grants from PUBLIC, anon, and authenticated; keep no client policies and retain only required trusted server access.
5. Rehearse the exact migration set on disposable PostgreSQL, including assertions that client roles cannot TRUNCATE, write, or read server-only tables and that approved reader workflows still work.
6. Roll out only after provenance, owner/default ACL behavior, Supabase runtime validation, and explicit authorization.

No production grants, default privileges, migrations, Edge Functions, schedules, chapters, or publications were changed during this audit. Automatic publishing remains NO-GO.
