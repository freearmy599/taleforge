/**
 * Provider-state grants contract.
 * Source-level checks only; this does not apply the migration or query production.
 * Run with: node --test scripts/aevora-provider-state-grants-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261013120000_lock_ai_provider_state_table.sql", import.meta.url),
  "utf8",
);

const metricsOutboxMigration = await readFile(
  new URL("../supabase/migrations/20261013090000_aevora_server_only_metrics_outbox_grants.sql", import.meta.url),
  "utf8",
);

const internalTablesMigration = await readFile(
  new URL("../supabase/migrations/20261013130000_lock_internal_policyless_tables.sql", import.meta.url),
  "utf8",
);

const narrativeMigration = await readFile(
  new URL("../supabase/migrations/20261013103000_lock_internal_narrative_intelligence_tables.sql", import.meta.url),
  "utf8",
);

test("Gemini provider state is server-side only", () => {
  assert.ok(migration.includes("ALTER TABLE public.taleforge_ai_provider_state ENABLE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("REVOKE ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated"));
  assert.ok(migration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated"), "provider-state column grants must also be revoked");
  assert.ok(migration.includes("SET last_error = CASE"), "legacy Gemini diagnostics must be classified and redacted");
  assert.ok(migration.includes("WHEN last_error ILIKE '%Gemini HTTP 503%'"), "legacy temporary-overload payloads must be sanitized");
  assert.ok(migration.includes("WHEN last_error ILIKE '%Gemini HTTP 429%'"), "legacy quota payloads must be sanitized");
  assert.ok(migration.includes("ELSE 'Gemini provider diagnostic redacted'"), "unknown legacy provider diagnostics must be redacted rather than retained");
  assert.ok(migration.includes("AND last_error NOT IN ("), "already-safe diagnostics should avoid unnecessary rewrites");
  assert.equal(/CREATE POLICY/i.test(migration), false, "internal provider state must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(migration), false, "migration must not re-grant client access");
});

test("publication outbox and attachment metrics remain server-side only", () => {
  for (const table of ["publication_sync_outbox", "story_attachment_metrics"]) {
    assert.ok(metricsOutboxMigration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`), `${table} must have RLS enabled`);
    assert.ok(metricsOutboxMigration.includes(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM PUBLIC, anon, authenticated`), `${table} must revoke all client and PUBLIC table privileges`);
  }
  assert.ok(metricsOutboxMigration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "outbox and metrics column grants must also be revoked");
  for (const table of ["publication_sync_outbox", "story_attachment_metrics"]) {
  }
  assert.equal(/CREATE POLICY/i.test(metricsOutboxMigration), false, "server-only telemetry and outbox tables must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(metricsOutboxMigration), false, "server-only tables must not re-grant client access");
});

test("internal policyless intelligence tables are server-side only", () => {
  const internalTables = [
    "automation_config",
    "chapter_blueprints",
    "chapter_generation_outputs",
    "chapter_publication_reviews",
    "chapter_reviews",
    "generation_jobs",
    "generation_settings",
    "release_schedules",
    "story_blueprints",
    "story_versions",
    "taleforge_ceo_daily_operations",
    "taleforge_ceo_incidents",
    "taleforge_ceo_repair_plans",
    "taleforge_continuity_extraction_queue",
    "taleforge_executive_reports",
    "taleforge_generation_context_snapshots",
    "taleforge_hybrid_story_engine_runs",
    "taleforge_inversion_evaluations",
    "taleforge_narrative_profile_selections",
    "taleforge_novelty_signatures",
    "taleforge_story_concept_design_runs",
    "taleforge_story_opportunity_runs",
    "taleforge_system_governance_dependencies",
    "taleforge_system_governance_registry",
    "taleforge_system_governance_runs",
  ];
  for (const table of internalTables) {
    assert.ok(internalTablesMigration.includes(table), `missing server-only grant repair for ${table}`);
  }
  assert.ok(internalTablesMigration.includes("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY"));
  assert.ok(internalTablesMigration.includes("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated"));
  assert.ok(internalTablesMigration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "internal table column grants must also be revoked");
  assert.equal(/CREATE POLICY/i.test(internalTablesMigration), false, "internal tables must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(internalTablesMigration), false, "migration must not re-grant client access");
});

test("internal narrative intelligence tables lose public read policies and client grants", () => {
  const internalTables = [
    "character_continuity_events",
    "world_continuity_events",
    "taleforge_continuity_reconciliation_findings",
    "taleforge_continuity_reconciliation_runs",
    "taleforge_narrative_depth_plans",
    "taleforge_narrative_memory_snapshots",
    "taleforge_narrative_thread_events",
    "taleforge_narrative_thread_progression",
    "taleforge_narrative_threads",
    "taleforge_novelty_evaluations",
    "taleforge_system_dependencies",
    "taleforge_system_health",
    "taleforge_system_registry",
  ];
  for (const table of internalTables) {
    assert.ok(narrativeMigration.includes(`public.${table}`), `missing internal narrative lock for ${table}`);
  }
  assert.ok(narrativeMigration.includes("REVOKE ALL PRIVILEGES ON TABLE"));
  assert.ok(narrativeMigration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "narrative internal column grants must also be revoked");
  assert.equal(/CREATE POLICY/i.test(narrativeMigration), false, "internal narrative state must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(narrativeMigration), false, "migration must not re-grant client access");
});
