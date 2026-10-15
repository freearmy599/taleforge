/**
 * Contract tests for the public trending aggregate RPC.
 * Source-only: no database, network, or production side effects.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../supabase/migrations/20261014130000_public_trending_aggregate_rpc.sql",
  import.meta.url,
);
const migration = await readFile(migrationUrl, "utf8");

test("public trending RPC is a narrowly scoped SECURITY DEFINER with fixed search_path", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.get_public_story_trending_scores\(\)/i);
  assert.match(migration, /LANGUAGE\s+sql\s+STABLE\s+SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*pg_catalog/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON FUNCTION public\.get_public_story_trending_scores\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_public_story_trending_scores\(\) TO anon, authenticated, service_role/i);
  assert.match(migration, /WITH\s*\(security_invoker\s*=\s*true\)/i);
});

test("public result exposes aggregate metrics, never visitor identifiers or raw events", () => {
  const signature = migration.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i)?.[1];
  assert.ok(signature, "function must declare an explicit return shape");
  assert.doesNotMatch(signature, /visitor_id|chapter_id|event_type|progress_percent/i);
  assert.match(signature, /trending_score\s+numeric/i);
  assert.match(signature, /opens\s+bigint/i);
  assert.match(signature, /completions\s+bigint/i);
  assert.match(signature, /follows\s+bigint/i);
  assert.match(signature, /bookmarks\s+bigint/i);
  assert.doesNotMatch(migration, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.reader_events\s+TO\s+anon|GRANT\s+SELECT\s+ON\s+TABLE\s+public\.reader_events\s+TO\s+authenticated/i);
});

test("trending counts are bounded to valid public series and published chapter events", () => {
  assert.match(migration, /WHERE\s+s\.status\s*=\s*ANY\s*\(ARRAY\['ongoing'::text,\s*'completed'::text\]\)/i);
  assert.match(migration, /re\.created_at\s*>\s*pg_catalog\.now\(\)\s*-\s*interval\s+'30 days'/i);
  assert.match(migration, /c\.status\s*=\s*'published'/i);
  assert.match(migration, /eligible_series\.status\s+IN\s*\('ongoing',\s*'completed'\)/i);
  assert.match(migration, /ORDER BY\s+re\.created_at\s+DESC,\s+re\.id\s+DESC/i);
});

test("discovery views grant public read-only access without public write privileges", () => {
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.story_trending_scores, public\.story_intelligence\s+FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT SELECT ON TABLE public\.story_trending_scores, public\.story_intelligence\s+TO anon, authenticated/i);
  assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL PRIVILEGES)\s+ON\s+TABLE\s+public\.(?:story_trending_scores|story_intelligence)\s+TO\s+(?:PUBLIC|anon|authenticated)/i);
});
