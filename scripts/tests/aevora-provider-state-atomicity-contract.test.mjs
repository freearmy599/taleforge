import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../../supabase/migrations/20261016180000_atomic_gemini_provider_throttle.sql");
const writers = [
  ["generate-chapter", read("../../supabase/functions/generate-chapter/index.ts")],
  ["generation-orchestrator", read("../../supabase/functions/generation-orchestrator/index.ts")],
  ["revise-chapter", read("../../supabase/functions/revise-chapter/index.ts")],
  ["continuity-review", read("../../supabase/functions/continuity-review/index.ts")],
  ["originality-review", read("../../supabase/functions/originality-review/index.ts")],
  ["safety-review", read("../../supabase/functions/safety-review/index.ts")],
  ["character-continuity", read("../../supabase/functions/character-continuity/index.ts")],
  ["blueprint-planner", read("../../supabase/functions/blueprint-planner/index.ts")],
  ["story-dna-planner", read("../../supabase/functions/story-dna-planner/index.ts")],
  ["arc-planner", read("../../supabase/functions/arc-planner/index.ts")],
  ["world-continuity", read("../../supabase/functions/world-continuity/index.ts")],
];

test("atomic RPC is SECURITY DEFINER with a fixed search_path", () => {
  assert.match(migration, /SECURITY DEFINER/i);
  assert.match(migration, /SET search_path = pg_catalog, public/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aevora_record_gemini_throttle\(text\) FROM PUBLIC/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aevora_record_gemini_throttle\(text\) FROM anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.aevora_record_gemini_throttle\(text\) TO service_role/i);
});

test("RPC accepts only fixed event classes and fixed diagnostics", () => {
  assert.match(migration, /p_event_class NOT IN \('quota', 'overload'\)/);
  assert.match(migration, /Gemini quota or rate-limit response/);
  assert.match(migration, /Gemini temporary overload response/);
  assert.doesNotMatch(migration, /p_last_error|p_error_message|p_raw_error/i);
});

test("database operation increments atomically and never shortens cooldown", () => {
  assert.match(migration, /ON CONFLICT \(provider\) DO UPDATE/i);
  assert.match(migration, /current_state\.consecutive_throttle_count \+ 1/);
  assert.match(migration, /GREATEST\(/);
  assert.match(migration, /WHERE current_state\.consecutive_throttle_count >= 0/);
});

for (const [name, source] of writers) {
  test(`${name} uses the approved RPC and has no direct provider-state writes`, () => {
    assert.match(source, /\.rpc\(\s*["']aevora_record_gemini_throttle["']/);
    assert.doesNotMatch(source, /from\(["']taleforge_ai_provider_state["']\)\s*\.(?:upsert|insert|update|delete)\s*\(/);
    assert.doesNotMatch(source, /last_error\s*:/);
  });
}

test("caller code treats missing RPC confirmation as persistence failure", () => {
  for (const [name, source] of writers) {
    assert.match(source, /recorded\s*!==\s*true/, `${name} must not assume persistence succeeded`);
  }
});
