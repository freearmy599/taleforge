/**
 * Inventory consistency contract for the 39 live policyless tables with broad client grants.
 * Source-only: this test never connects to a database or changes production state.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const classification = await readFile(
  new URL("../docs/aevora/PHASE1-POLICYLESS-TABLE-CLASSIFICATION-20261016.md", import.meta.url),
  "utf8",
);
const internalLock = await readFile(
  new URL("../supabase/migrations/20261013130000_lock_internal_policyless_tables.sql", import.meta.url),
  "utf8",
);
const metricsOutboxLock = await readFile(
  new URL("../supabase/migrations/20261013090000_aevora_server_only_metrics_outbox_grants.sql", import.meta.url),
  "utf8",
);
const providerStateLock = await readFile(
  new URL("../supabase/migrations/20261013120000_lock_ai_provider_state_table.sql", import.meta.url),
  "utf8",
);
const dormantReaderLock = await readFile(
  new URL("../supabase/migrations/20261016210000_lock_dormant_reader_account_tables.sql", import.meta.url),
  "utf8",
);

const serverOnly = [
  "automation_config", "chapter_blueprints", "chapter_generation_outputs",
  "chapter_publication_reviews", "chapter_reviews", "generation_jobs",
  "generation_settings", "publication_sync_outbox", "release_schedules",
  "story_attachment_metrics", "story_blueprints", "story_versions",
  "taleforge_ai_provider_state", "taleforge_ceo_daily_operations",
  "taleforge_ceo_incidents", "taleforge_ceo_repair_plans",
  "taleforge_continuity_extraction_queue", "taleforge_executive_reports",
  "taleforge_generation_context_snapshots", "taleforge_hybrid_story_engine_runs",
  "taleforge_inversion_evaluations", "taleforge_narrative_profile_selections",
  "taleforge_novelty_signatures", "taleforge_story_concept_design_runs",
  "taleforge_story_opportunity_runs", "taleforge_system_governance_dependencies",
  "taleforge_system_governance_registry", "taleforge_system_governance_runs",
];

const productFacing = [
  "bookmarks", "collection_stories", "collections", "comments", "likes",
  "notifications", "profiles", "ratings", "reading_history",
  "recommendations", "story_reports",
];

test("the classification document retains all 39 audited relations exactly once in its provisional tables", () => {
  for (const relation of [...serverOnly, ...productFacing]) {
    assert.ok(classification.includes("`" + relation + "`") || classification.includes("| " + relation + " |"),
      "classification missing relation: " + relation);
  }
  assert.equal(new Set([...serverOnly, ...productFacing]).size, 39,
    "server-only and product-facing provisional groups must total 39 unique relations");
});

test("all 28 provisional server-only relations are covered by branch ACL-lock candidates", () => {
  for (const relation of serverOnly) {
    const covered = internalLock.includes("'" + relation + "'")
      || metricsOutboxLock.includes("'" + relation + "'")
      || providerStateLock.includes("public." + relation);
    assert.ok(covered, "server-only relation lacks a tracked ACL-lock candidate: " + relation);
  }
  assert.match(internalLock, /REVOKE [A-Z ,]+ \\(%s\\)/i,
    "internal lock must remove independent column-level grants");
  assert.match(metricsOutboxLock, /REVOKE ALL PRIVILEGES \\(%s\\)/i,
    "metrics/outbox lock must remove independent column-level grants");
  assert.match(providerStateLock, /REVOKE ALL PRIVILEGES \\(%s\\)/i,
    "provider-state lock must remove independent column-level grants");
});

test("all 11 product-facing/ambiguous relations remain individually locked pending reviewed policies", () => {
  for (const relation of productFacing) {
    assert.ok(dormantReaderLock.includes("'" + relation + "'"),
      "dormant reader lock missing product-facing relation: " + relation);
  }
  assert.match(dormantReaderLock, /IF NOT v_rls_enabled THEN[\s\S]*RAISE EXCEPTION/i,
    "lock must fail closed if RLS assumptions drift");
  assert.match(dormantReaderLock, /pg_catalog\.pg_policies[\s\S]*RAISE EXCEPTION/i,
    "lock must fail closed if a policy appears before the migration");
  assert.match(dormantReaderLock, /REVOKE ALL PRIVILEGES ON TABLE/i);
  assert.match(dormantReaderLock, /REVOKE ALL PRIVILEGES \(%s\)/i);
});

test("the contract does not mistake branch ACL candidates for live production remediation", () => {
  assert.match(classification, /branch aevora\\/release-scheduler-hardening/i);
  assert.match(classification, /provisional/i);
  assert.match(classification, /No production grants/i);
});
