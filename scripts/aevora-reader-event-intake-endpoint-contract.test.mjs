import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/reader-event-intake/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261015120000_reader_event_intake_rpc.sql", import.meta.url), "utf8");

test("intake bounds request body and accepts POST JSON only", () => {
  assert.match(source, /MAX_BODY_BYTES = 2048/);
  assert.match(source, /req\.method !== "POST"/);
  assert.match(source, /application\/json/);
  assert.match(source, /payload_too_large/);
  assert.match(source, /reader\.cancel\(\)/);
});

test("intake rejects unknown keys and validates event vocabulary, UUIDs and progress", () => {
  assert.match(source, /unknown_field/);
  assert.match(source, /ALLOWED_EVENTS/);
  assert.match(source, /function isUuid/);
  assert.match(source, /Number\.isInteger\(progress\)/);
  assert.match(source, /body\.event_type === "reading_progress"/);
});

test("service credentials never leave the Edge Function and diagnostics are redacted", () => {
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /console\.error\("\[reader-event-intake\] database RPC unavailable", response\.status\)/);
  assert.doesNotMatch(source, /console\.(?:log|error|debug)\([^\n]*(?:raw|body|SERVICE_ROLE_KEY|error\.message)/i);
  assert.doesNotMatch(source, /return json\([^\n]*error\.message/i);
});

test("database RPC is atomic, fixed-search-path and unavailable to public API roles", () => {
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog, public, aevora_private/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /hit_count < 30/);
  assert.match(migration, /hit_count < 1000/);
  assert.match(migration, /ON CONFLICT \(event_uuid\) WHERE event_uuid IS NOT NULL DO NOTHING/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aevora_ingest_reader_event\(text, uuid, text, uuid, uuid, integer\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.aevora_ingest_reader_event\(text, uuid, text, uuid, uuid, integer\) TO service_role/i);
  assert.match(migration, /REVOKE ALL ON TABLE aevora_private\.reader_event_quota_buckets FROM PUBLIC, anon, authenticated/i);
});

test("legacy browser tracker is not switched until rollout and rollback are separately tested", async () => {
  const tracker = await readFile(new URL("../reading-progress.js", import.meta.url), "utf8");
  assert.match(tracker, /supabase\.from\("reader_events"\)\.insert\(payload\)/);
  assert.doesNotMatch(tracker, /reader-event-intake/);
});
