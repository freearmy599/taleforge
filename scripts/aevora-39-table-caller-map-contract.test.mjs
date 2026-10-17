/**
 * Static consistency guard for the 39-table caller-map audit.
 * Does not connect to Supabase or alter live state.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const map = await readFile(
  new URL("../docs/aevora/PHASE1-39-TABLE-SOURCE-CALLER-MAP-20261017.md", import.meta.url),
  "utf8",
);
const browserClient = await readFile(new URL("../supabase-client.js", import.meta.url), "utf8");
const progress = await readFile(new URL("../reading-progress.js", import.meta.url), "utf8");

const relations = [
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
  "bookmarks", "collection_stories", "collections", "comments", "likes",
  "notifications", "profiles", "ratings", "reading_history", "recommendations",
  "story_reports",
];

test("caller map contains each of the 39 audited relations exactly as a relation row", () => {
  for (const relation of relations) {
    assert.match(map, new RegExp("\\| \`" + relation + "\` \\|"),
      "caller map missing relation row: " + relation);
  }
  assert.equal(relations.length, 39);
});

test("caller map preserves uncertainty for relations without a direct literal caller", () => {
  assert.match(map, /No direct literal call found/);
  assert.match(map, /absence of a direct `\.from\("table"\)` match is \*\*unresolved\*\*/);
  assert.match(map, /RPC implementations, SQL functions\/triggers, dynamic table names/);
});

test("caller map records live SQL-routine findings without claiming an RLS bypass or deployed fix", () => {
  assert.match(map, /64 public routines/);
  assert.match(map, /58 were SECURITY DEFINER; 6 were SECURITY INVOKER/);
  for (const routine of [
    "apply_attachment_directives(uuid)",
    "get_production_buffer_plan()",
    "get_story_narrative_destination(uuid)",
    "refresh_story_attachment_metrics(uuid)",
    "prepare_next_chapter_blueprint(uuid)",
  ]) {
    assert.ok(map.includes(routine), "live SQL caller evidence missing routine: " + routine);
  }
  assert.match(map, /not a full dependency graph/);
  assert.match(map, /does not prove an RLS bypass/);
  assert.match(map, /not present in the live migration ledger/);
});

test("caller map records the focused live relation-ACL cross-check with appropriate caveats", () => {
  assert.match(map, /six high-impact relations/);
  assert.match(map, /RLS enabled, FORCE RLS disabled, zero row policies/);
  assert.match(map, /SELECT, INSERT, UPDATE, DELETE, and TRUNCATE/);
  assert.match(map, /not proof that ordinary PostgREST row reads\/writes succeed/);
  assert.match(map, /does not prove a particular REST route can invoke TRUNCATE/);
});

test("caller map records trigger dependencies and explains direct EXECUTE revocation", () => {
  assert.match(map, /Trigger dependency check for ACL remediation/);
  assert.match(map, /taleforge_update_updated_at\(\)/);
  assert.match(map, /sync_continuity_gate\(\), sync_quality_gate\(\), and sync_story_ending_metadata\(\)/);
  assert.match(map, /client EXECUTE on a trigger function is not required/);
  assert.match(map, /updated-at trigger continues to work after direct client EXECUTE is revoked/);
});

test("reader-event browser cutover remains explicitly identified as incomplete", () => {
  assert.match(browserClient, /taleForgeReaderEventIntakeEnabled\s*=\s*false/);
  assert.match(progress, /supabase\.from\("reader_events"\)\.insert\(payload\)/);
  assert.match(map, /Known unfinished cutover/);
});
