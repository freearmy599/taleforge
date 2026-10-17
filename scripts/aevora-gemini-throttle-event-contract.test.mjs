import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20261017180000_idempotent_gemini_throttle_event_contract.sql",
  "utf8",
);
const generator = readFileSync("supabase/functions/generate-chapter/index.ts", "utf8");

test("Gemini throttle RPC migration matches the two-argument Edge caller", () => {
  assert.match(generator, /"aevora_record_gemini_throttle",\s*\{\s*p_event_id:\s*crypto\.randomUUID\(\),\s*p_event_class:/s);
  assert.match(migration, /FUNCTION public\.aevora_record_gemini_throttle\(\s*p_event_id uuid,\s*p_event_class text\s*\)/s);
  assert.match(migration, /ALTER FUNCTION public\.aevora_record_gemini_throttle\(uuid, text\) OWNER TO postgres/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.aevora_record_gemini_throttle\(uuid, text\) TO service_role/);
});

test("Gemini throttle event is idempotent and rejects event-id class reuse", () => {
  assert.match(migration, /event_id uuid PRIMARY KEY/);
  assert.match(migration, /ON CONFLICT \(event_id\) DO NOTHING/);
  assert.match(migration, /v_existing_class IS DISTINCT FROM p_event_class/);
  assert.match(migration, /RETURN QUERY SELECT true, v_until, v_count, v_hours/);
});

test("Gemini throttle event storage remains inaccessible to client roles", () => {
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.aevora_gemini_throttle_events FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aevora_record_gemini_throttle\(uuid, text\) FROM PUBLIC, anon, authenticated/);
});
