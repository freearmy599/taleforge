/**
 * Static security contracts for the public reader-event intake boundary.
 * The disposable PostgreSQL rehearsal separately executes the SQL behavior.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../supabase/migrations/", import.meta.url);
async function readMigration(name) {
  return readFile(new URL(name, root), "utf8");
}
const insertOnly = await readMigration("20261014150000_reader_events_insert_only.sql");
const relationship = await readMigration("20261014200000_reader_event_relationship_integrity.sql");
const idempotency = await readMigration("20261014220000_reader_event_idempotency_key.sql");
const timestamp = await readMigration("20261014230000_reader_event_server_timestamp.sql");

test("reader event intake is INSERT-only for ordinary API roles", () => {
  assert.match(insertOnly, /REVOKE ALL PRIVILEGES ON TABLE public\.reader_events FROM PUBLIC, anon, authenticated/i);
  assert.match(insertOnly, /GRANT INSERT ON TABLE public\.reader_events TO anon, authenticated/i);
  assert.doesNotMatch(insertOnly, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.reader_events\s+TO\s+(?:PUBLIC|anon|authenticated)/i);
});

test("reader events must reference eligible public series and matching published chapters", () => {
  assert.match(relationship, /FOR INSERT\s+TO anon, authenticated\s+WITH CHECK/i);
  assert.match(relationship, /visitor_id IS NOT NULL\s+AND length\(visitor_id\) BETWEEN 16 AND 100/i);
  assert.match(relationship, /series_id IS NOT NULL/i);
  assert.match(relationship, /s\.id = reader_events\.series_id\s+AND s\.status IN \('ongoing', 'completed'\)/i);
  assert.match(relationship, /c\.id = reader_events\.chapter_id\s+AND c\.series_id = reader_events\.series_id\s+AND c\.status = 'published'/i);
});

test("event idempotency is optional but unique when a client key is supplied", () => {
  assert.match(idempotency, /ADD COLUMN IF NOT EXISTS event_uuid uuid/i);
  assert.match(idempotency, /CREATE UNIQUE INDEX IF NOT EXISTS reader_events_event_uuid_uidx\s+ON public\.reader_events \(event_uuid\)\s+WHERE event_uuid IS NOT NULL/i);
  assert.match(idempotency, /does not authenticate visitor identity or stop spam using fresh UUIDs/i);
});

test("client timestamps are replaced at the server boundary with a fixed search_path", () => {
  assert.match(timestamp, /RETURNS trigger\s+LANGUAGE plpgsql\s+SET search_path = pg_catalog/i);
  assert.match(timestamp, /IF current_user IN \('anon', 'authenticated'\) THEN\s+NEW\.created_at := statement_timestamp\(\);/i);
  assert.match(timestamp, /REVOKE ALL ON FUNCTION public\.taleforge_force_reader_event_client_timestamp\(\)\s+FROM PUBLIC, anon, authenticated/i);
  assert.match(timestamp, /BEFORE INSERT ON public\.reader_events\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.taleforge_force_reader_event_client_timestamp\(\)/i);
});
