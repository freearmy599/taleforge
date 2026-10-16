import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/reader-event-intake/handler.ts", import.meta.url), "utf8");
const entrypoint = await readFile(new URL("../supabase/functions/reader-event-intake/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261015120000_reader_event_intake_rpc.sql", import.meta.url), "utf8");
const rpcAssertions = await readFile(new URL("../scripts/aevora-reader-event-intake-rpc-assertions.sql", import.meta.url), "utf8");
const tracker = await readFile(new URL("../reading-progress.js", import.meta.url), "utf8");
const clientConfig = await readFile(new URL("../supabase-client.js", import.meta.url), "utf8");
const supabaseConfig = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
const rehearsal = await readFile(new URL("../scripts/test-aevora-reader-event-integrity.sh", import.meta.url), "utf8");

test("intake bounds request body and accepts POST JSON only", () => {
  assert.match(source, /MAX_BODY_BYTES = 2048/);
  assert.match(source, /req\.method !== "POST"/);
  assert.match(source, /mediaType !== "application\/json"/);
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
  assert.match(entrypoint, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(entrypoint, /createReaderEventIntakeHandler/);
  assert.match(source, /console\.error\("\[reader-event-intake\] database RPC unavailable", response\.status\)/);
  assert.doesNotMatch(source, /console\.(?:log|error|debug)\([^\n]*(?:raw|body|SERVICE_ROLE_KEY|error\.message)/i);
  assert.doesNotMatch(source, /return json\([^\n]*error\.message/i);
});

test("database RPC is atomic, fixed-search-path and unavailable to public API roles", () => {
  assert.equal(
    [...migration.matchAll(/SECURITY DEFINER\s+SET search_path = pg_catalog\s+AS \$function\$/gi)].length,
    2,
    "both SECURITY DEFINER functions must use pg_catalog-only search_path",
  );
  assert.doesNotMatch(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog\s*,/i,
    "SECURITY DEFINER search_path must not include writable application schemas");
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended\(p_event_uuid::text, 7918\)\s*\)/);
  const duplicateCheck = migration.indexOf("SELECT 1 FROM public.reader_events e WHERE e.event_uuid = p_event_uuid");
  const quotaMutation = migration.indexOf("INSERT INTO aevora_private.reader_event_quota_buckets", duplicateCheck);
  assert.ok(duplicateCheck >= 0 && quotaMutation > duplicateCheck,
    "duplicate event UUIDs must be resolved before any quota counter is mutated");
  const uniqueEventInsert = migration.indexOf(
    "INSERT INTO public.reader_events(visitor_id, event_type, series_id, chapter_id, progress_percent, event_uuid)",
    duplicateCheck,
  );
  const quotaAfterUniqueInsert = migration.indexOf("INSERT INTO aevora_private.reader_event_quota_buckets", uniqueEventInsert);
  assert.ok(uniqueEventInsert > duplicateCheck && quotaAfterUniqueInsert > uniqueEventInsert,
    "unique event insertion must precede quota mutation to make mixed direct/RPC races idempotent");
  assert.match(rehearsal, /mixed direct-writer\/RPC idempotency and no-quota-charge assertion passed/i);
  assert.match(rehearsal, /CREATE TRIGGER aevora_test_pause_rpc_reader_event_insert/);
  assert.match(rehearsal, /visitor_key_hash = md5\('visitor-rpc-mixed-race-0001'\)/,
    "disposable PostgreSQL rehearsal must prove a direct-writer winner does not charge RPC quota");
  assert.match(migration, /COALESCE\(v_hits, 0\) >= 30/);
  assert.match(migration, /COALESCE\(v_hits, 0\) >= 1000/);
  assert.match(migration, /quota_scope text NOT NULL DEFAULT/);
  assert.match(migration, /COALESCE\(v_event_daily_hits, 0\) >= 250/);
  const quotaCheckEnd = migration.indexOf("COALESCE(v_event_daily_hits, 0) >= 250");
  const firstQuotaIncrement = migration.indexOf("INSERT INTO aevora_private.reader_event_quota_buckets", quotaCheckEnd);
  assert.ok(quotaCheckEnd >= 0 && firstQuotaIncrement > quotaCheckEnd,
    "all quota buckets must be checked before any counter is incremented");
  assert.match(migration, /reader_event_quota_cleanup_state/);
  assert.match(migration, /last_cleaned_at <= v_now - interval '1 minute'/);
  assert.match(migration, /pg_try_advisory_xact_lock\(19017, 811\)/);
  assert.match(migration, /ORDER BY window_start\s+LIMIT 1000/i);
  assert.match(migration, /ON CONFLICT \(event_uuid\) WHERE event_uuid IS NOT NULL DO NOTHING/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aevora_ingest_reader_event\(text, uuid, text, uuid, uuid, integer\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.aevora_ingest_reader_event\(text, uuid, text, uuid, uuid, integer\) TO service_role/i);
  assert.match(migration, /REVOKE ALL ON TABLE aevora_private\.reader_event_quota_buckets FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /REVOKE ALL ON TABLE aevora_private\.reader_event_quota_cleanup_state FROM PUBLIC, anon, authenticated/i);
});

test("browser intake cutover is opt-in and preserves the tracker interface", () => {
  assert.match(clientConfig, /window\.taleForgeReaderEventIntakeEnabled = false/);
  assert.match(clientConfig, /window\.taleForgeSupabaseConfig/);
  assert.match(tracker, /async function track\(event_type,data=\{\}\)/);
  assert.match(tracker, /window\.taleForgeReaderEventIntakeEnabled===true/);
  assert.match(tracker, /functions\/v1\/reader-event-intake/);
  assert.match(tracker, /if\(intakeEnabled\)\{[\s\S]*?return\}const \{error\}=await supabase\.from\("reader_events"\)\.insert\(payload\)/,
    "enabled intake mode must not fall back to direct INSERT when the endpoint fails");
  assert.match(supabaseConfig, /\[functions\.reader-event-intake\]\s+verify_jwt = false/);
  assert.match(supabaseConfig, /reader-event-intake/);
});


test("privileged reader-event functions and quota tables cannot be owned by client roles", () => {
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS aevora_private/);
  assert.match(migration, /ALTER SCHEMA aevora_private OWNER TO postgres/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS aevora_private\.reader_event_quota_buckets/);
  assert.match(migration, /ALTER TABLE aevora_private\.reader_event_quota_buckets OWNER TO postgres/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS aevora_private\.reader_event_quota_cleanup_state/);
  assert.match(migration, /ALTER TABLE aevora_private\.reader_event_quota_cleanup_state OWNER TO postgres/);
  assert.match(migration, /ALTER FUNCTION public\.aevora_ingest_reader_event\(text, uuid, text, uuid, uuid, integer\) OWNER TO postgres/);
  assert.match(migration, /ALTER FUNCTION public\.aevora_prune_reader_event_quota_buckets\(\) OWNER TO postgres/);
  assert.match(rpcAssertions,
    /pg_catalog\.pg_get_userbyid\(n\.nspowner\) <> 'postgres'/,
    "private quota schema must have a trusted postgres owner");
  assert.match(rpcAssertions,
    /pg_catalog\.pg_get_userbyid\(p\.proowner\) <> 'postgres'/,
    "reader-event SECURITY DEFINER RPCs must have a trusted postgres owner");
  assert.match(rpcAssertions,
    /pg_catalog\.pg_get_userbyid\(c\.relowner\) <> 'postgres'/,
    "private quota tables must have a trusted postgres owner");
  assert.match(rpcAssertions, /DO \$rpc_public_acl_assert\$/);
  assert.match(migration, /REVOKE ALL ON SCHEMA aevora_private FROM PUBLIC, anon, authenticated/i);
  assert.match(rpcAssertions, /pg_catalog\.aclexplode\(/);
  assert.match(rpcAssertions, /pg_catalog\.acldefault\('n', n\.nspowner\)/);
  assert.match(rpcAssertions, /n\.nspname = 'aevora_private'/);
  assert.match(rpcAssertions, /acl\.grantee = 0/);
  assert.match(rpcAssertions, /acl\.privilege_type = 'EXECUTE'/);
  assert.match(rpcAssertions,
    /acl\.privilege_type IN \('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'\)/);
});

test("quota cleanup RPC is executable only by the trusted server role", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.aevora_prune_reader_event_quota_buckets\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.aevora_prune_reader_event_quota_buckets\(\) TO service_role/i);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.aevora_prune_reader_event_quota_buckets\(\)[\s\S]*?SECURITY DEFINER\s+SET search_path = pg_catalog/i);
});
