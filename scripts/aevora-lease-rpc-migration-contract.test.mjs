/**
 * Source-only security contract for scheduler lease RPC migrations.
 * These checks do not connect to Supabase or apply migrations.
 * Run with: node --test scripts/aevora-lease-rpc-migration-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const foundation = await readFile(
  new URL("../supabase/migrations/20261012183000_aevora_release_scheduler_lease_foundation.sql", import.meta.url),
  "utf8",
);
const fencing = await readFile(
  new URL("../supabase/migrations/20261012190000_aevora_atomic_scheduler_lease_fencing.sql", import.meta.url),
  "utf8",
);

function functionBody(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `missing migration definition for ${name}`);
  const end = source.indexOf("$function$;", start);
  assert.ok(end > start, `unterminated function definition for ${name}`);
  return source.slice(start, end + "$function$;".length);
}

test("lease table is not client-accessible", () => {
  assert.match(foundation, /CREATE TABLE IF NOT EXISTS public\.aevora_release_scheduler_leases/);
  assert.match(foundation, /ALTER TABLE public\.aevora_release_scheduler_leases ENABLE ROW LEVEL SECURITY/);
  assert.match(foundation, /REVOKE ALL ON TABLE public\.aevora_release_scheduler_leases FROM PUBLIC, anon, authenticated/);
  assert.match(foundation, /GRANT ALL ON TABLE public\.aevora_release_scheduler_leases TO postgres, service_role/);
});

test("all lease RPCs are SECURITY DEFINER with a fixed safe search_path", () => {
  const definitions = [
    [foundation, "aevora_claim_release_scheduler_lease"],
    [foundation, "aevora_renew_release_scheduler_lease"],
    [foundation, "aevora_release_scheduler_lease"],
    [fencing, "aevora_advance_release_schedule_if_lease_owned"],
    [fencing, "aevora_activate_story_lifecycle_if_lease_owned"],
  ];
  for (const [source, name] of definitions) {
    const body = functionBody(source, name);
    assert.match(body, /LANGUAGE plpgsql[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog/,
      `${name} must use SECURITY DEFINER with a fixed search_path`);
  }
});

test("lease RPC execution is revoked from client roles and granted only to trusted server roles", () => {
  const expectations = [
    [foundation, "aevora_claim_release_scheduler_lease(uuid, uuid, integer)"],
    [foundation, "aevora_renew_release_scheduler_lease(uuid, uuid, integer)"],
    [foundation, "aevora_release_scheduler_lease(uuid, uuid)"],
    [fencing, "aevora_advance_release_schedule_if_lease_owned(uuid, uuid, timestamptz, timestamptz)"],
    [fencing, "aevora_activate_story_lifecycle_if_lease_owned(uuid, uuid, uuid, timestamptz)"],
  ];
  for (const [source, signature] of expectations) {
    assert.ok(source.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated`),
      `${signature}: public and client EXECUTE must be revoked`);
    assert.ok(source.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO postgres, service_role`),
      `${signature}: only trusted server roles should receive EXECUTE`);
  }
});

test("lease claim cannot steal a live lease and renewal requires the matching unexpired token", () => {
  const claim = functionBody(foundation, "aevora_claim_release_scheduler_lease");
  const renew = functionBody(foundation, "aevora_renew_release_scheduler_lease");
  assert.match(claim, /ON CONFLICT \(schedule_id\) DO UPDATE[\s\S]*?WHERE public\.aevora_release_scheduler_leases\.lease_expires_at <= clock_timestamp\(\)/);
  assert.match(claim, /GET DIAGNOSTICS affected = ROW_COUNT;[\s\S]*?RETURN affected = 1/);
  assert.match(renew, /WHERE schedule_id = p_schedule_id[\s\S]*?AND lease_token = p_lease_token[\s\S]*?AND lease_expires_at > clock_timestamp\(\)/);
  assert.match(renew, /GET DIAGNOSTICS affected = ROW_COUNT;[\s\S]*?RETURN affected = 1/);
});

test("schedule advancement locks and validates the live lease before writing exactly one schedule row", () => {
  const advance = functionBody(fencing, "aevora_advance_release_schedule_if_lease_owned");
  assert.match(advance, /FROM public\.aevora_release_scheduler_leases[\s\S]*?FOR UPDATE/);
  assert.match(advance, /v_lease_token <> p_lease_token/);
  assert.match(advance, /v_lease_expires_at <= clock_timestamp\(\)/);
  assert.match(advance, /UPDATE public\.release_schedules[\s\S]*?WHERE id = p_schedule_id/);
  assert.match(advance, /GET DIAGNOSTICS v_affected = ROW_COUNT;[\s\S]*?RETURN v_affected = 1/);
});

test("lifecycle activation binds schedule to series and only transitions preparing rows", () => {
  const activate = functionBody(fencing, "aevora_activate_story_lifecycle_if_lease_owned");
  assert.match(activate, /FROM public\.aevora_release_scheduler_leases[\s\S]*?FOR UPDATE/);
  assert.match(activate, /v_lease_token <> p_lease_token/);
  assert.match(activate, /v_lease_expires_at <= clock_timestamp\(\)/);
  assert.match(activate, /FROM public\.release_schedules[\s\S]*?WHERE id = p_schedule_id AND series_id = p_series_id[\s\S]*?FOR UPDATE/);
  assert.match(activate, /UPDATE public\.story_lifecycle[\s\S]*?WHERE series_id = p_series_id[\s\S]*?AND lifecycle_status = 'preparing'/);
  assert.match(activate, /GET DIAGNOSTICS v_affected = ROW_COUNT;[\s\S]*?RETURN v_affected = 1/);
});


test("schedule advancement rejects null identifiers and non-forward release timestamps", () => {
  const advance = functionBody(fencing, "aevora_advance_release_schedule_if_lease_owned");
  assert.match(advance, /IF p_schedule_id IS NULL OR p_lease_token IS NULL[\s\S]*?OR p_next_release_at IS NULL OR p_last_release_at IS NULL[\s\S]*?OR p_next_release_at <= p_last_release_at THEN[\s\S]*?RETURN false/);
  assert.match(advance, /UPDATE public\.release_schedules[\s\S]*?WHERE id = p_schedule_id/);
});

test("lifecycle activation rejects null inputs and never activates a different series", () => {
  const activate = functionBody(fencing, "aevora_activate_story_lifecycle_if_lease_owned");
  assert.match(activate, /IF p_schedule_id IS NULL OR p_lease_token IS NULL[\s\S]*?OR p_series_id IS NULL OR p_reviewed_at IS NULL THEN[\s\S]*?RETURN false/);
  assert.match(activate, /FROM public\.release_schedules[\s\S]*?WHERE id = p_schedule_id AND series_id = p_series_id[\s\S]*?FOR UPDATE/);
  assert.match(activate, /UPDATE public\.story_lifecycle[\s\S]*?WHERE series_id = p_series_id[\s\S]*?AND lifecycle_status = 'preparing'/);
});


test("lease claim and renewal enforce bounded lease durations", () => {
  for (const name of ["aevora_claim_release_scheduler_lease", "aevora_renew_release_scheduler_lease"]) {
    const body = functionBody(foundation, name);
    assert.match(body, /IF p_lease_seconds IS NULL OR p_lease_seconds < 30 OR p_lease_seconds > 900 THEN[\s\S]*?RAISE EXCEPTION/);
  }
});

test("lease release deletes only the row matching both schedule and lease token", () => {
  const release = functionBody(foundation, "aevora_release_scheduler_lease");
  assert.match(release, /DELETE FROM public\.aevora_release_scheduler_leases[\s\S]*?WHERE schedule_id = p_schedule_id AND lease_token = p_lease_token/);
  assert.match(release, /GET DIAGNOSTICS affected = ROW_COUNT;[\s\S]*?RETURN affected = 1/);
  assert.match(release, /SET search_path = pg_catalog/);
});
