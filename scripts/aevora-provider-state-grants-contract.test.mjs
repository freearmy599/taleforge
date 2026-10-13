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

const internalTablesMigration = await readFile(
  new URL("../supabase/migrations/20261013130000_lock_internal_policyless_tables.sql", import.meta.url),
  "utf8",
);

test("Gemini provider state is server-side only", () => {
  assert.ok(migration.includes("ALTER TABLE public.taleforge_ai_provider_state ENABLE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("REVOKE ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated"));
  assert.ok(migration.includes("SET last_error = 'Gemini quota or rate-limit response'"), "legacy raw provider error bodies must be sanitized when the migration is applied");
  assert.ok(migration.includes("last_error ILIKE '%RESOURCE_EXHAUSTED%'"), "legacy quota payloads must be identified before redaction");
  assert.equal(/CREATE POLICY/i.test(migration), false, "internal provider state must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(migration), false, "migration must not re-grant client access");
});

test("internal policyless intelligence tables are server-side only", () => {
  const internalTables = [
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
  assert.equal(/CREATE POLICY/i.test(internalTablesMigration), false, "internal tables must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(internalTablesMigration), false, "migration must not re-grant client access");
});
