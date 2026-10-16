# Aevora Phase 1 — deployed throttle parity and default ACL review
Date: 2026-10-16
Branch: aevora/release-scheduler-hardening

## Validation checkpoint

CI run 38936093165 passed both jobs: Edge Function type/source-contract checks and disposable PostgreSQL rehearsal. This is branch-only validation, not production deployment evidence.

## Read-only deployed source inspection

Live Edge Function versions inspected:
- generate-chapter v59
- revise-chapter v40
- continuity-review v10
- originality-review v9
- safety-review v9
- generation-orchestrator v35
- character-continuity v5
- world-continuity v9
- arc-planner v11
- blueprint-planner v13
- story-dna-planner v7

None calls `aevora_record_gemini_throttle`. Three deployed functions retain direct read/modify/upsert throttle writers:
- generate-chapter v59 directly increments and persists the counter on quota errors.
- revise-chapter v40 directly upserts cooldown state and stores provider error text up to 2,000 characters.
- generation-orchestrator v35 retains a fallback read/modify/upsert and stores provider error text up to 2,000 characters.

The other eight inspected deployed functions read provider state for cooldown checks but do not call the candidate RPC. The branch intentionally differs from production; candidate code is not deployed parity.

## Default-privilege migration blocker

The branch migration `20261014170000_restrict_public_default_privileges.sql` uses unqualified `ALTER DEFAULT PRIVILEGES FOR ROLE ... REVOKE` statements. These modify global defaults for the owner role, not only the `public` schema. In particular, removing global `PUBLIC EXECUTE` defaults for functions may change access behavior for future functions in other schemas owned by the same role. A contract that only checks for the absence of explicit `IN SCHEMA storage/graphql/realtime` statements does not prove the migration is scoped to public.

The migration also emits a NOTICE and skips an owner role when the executor cannot administer it. That lets the migration finish while part of the objective remains unmet. The live executor's authority over `supabase_admin` must be established independently; a disposable test running with stronger privileges does not prove production execution will behave the same way.

**Disposition:** keep this migration branch-only. Before rollout, inventory global and per-schema default ACLs, identify managed-schema requirements, define intended future-object grants, and make the rehearsal fail if a required owner-level change is skipped. Do not simply remove global revokes without testing the inherited `PUBLIC` privileges they are meant to address.

## Required gates

1. Recover authoritative source for migration `20261007025751 / add_taleforge_ai_provider_cooldown_state`.
2. Map all live server-role readers/writers and required grants before changing table ACLs.
3. Redesign and rehearse default-privilege repair with global-versus-schema-specific behavior and owner permissions explicitly tested.
4. Validate Supabase Edge Runtime compatibility and deployed-version parity.
5. Obtain explicit authorization before any live migration, permission change, or function deployment.

No production SQL mutation, migration, deployment, schedule mutation, generation, publication, or billable Supabase branch was performed. Automatic publishing remains **NO-GO**.
