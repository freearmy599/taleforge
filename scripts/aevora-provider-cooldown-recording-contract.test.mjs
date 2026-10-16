/**
 * Provider cooldown recording source-contract regression.
 * Static checks only; does not call Gemini or query/mutate production Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url),
  "utf8",
);
const orchestrator = await readFile(
  new URL("../supabase/functions/generation-orchestrator/index.ts", import.meta.url),
  "utf8",
);
const plan = await readFile(
  new URL("../docs/aevora/phase1-provider-cooldown-atomicity-plan.md", import.meta.url),
  "utf8",
);
const migration = await readFile(
  new URL("../supabase/migrations/20261016190000_idempotent_gemini_provider_throttle.sql", import.meta.url),
  "utf8",
);

const catchStart = source.indexOf("const providerQuotaFailure=");
const catchEnd = source.indexOf("const failureReason=", catchStart);
assert.notEqual(catchStart, -1, "provider failure handling must exist");
assert.notEqual(catchEnd, -1, "provider failure handler must have a bounded end");
const handler = source.slice(catchStart, catchEnd);



test("direct generation worker routes quota and overload events through the shared atomic RPC", () => {
  assert.ok(handler.includes('db.rpc("aevora_record_gemini_throttle",{p_event_id:crypto.randomUUID(),p_event_class:providerQuotaFailure?"quota":"overload"})'),
    "the direct worker must use the atomic database operation");
  assert.ok(handler.includes("result?.recorded!==true"),
    "RPC errors or unexpected results must not be treated as a successful recording");
  assert.ok(handler.includes("Gemini cooldown persistence failed; this request remains blocked"),
    "failed cooldown recording must be explicitly surfaced in safe diagnostics");
  assert.equal(handler.includes(".upsert("), false,
    "the direct worker must not retain a read-modify-upsert cooldown path");
  assert.equal(handler.includes('from("taleforge_ai_provider_state")'), false,
    "the direct worker's error path must not read provider state before writing");
});

test("generation orchestrator fallback uses the same atomic RPC", () => {
  assert.equal(orchestrator.includes('rpc("aevora_record_gemini_throttle"'), false,
    "the orchestrator must not double-record child provider events");
  assert.ok(orchestrator.includes("Child workers own provider-event persistence"), "single-writer ownership must be explicit");
});

test("orchestrator still fails closed when provider state is missing or unreadable", () => {
  const helperStart = orchestrator.indexOf("async function getGeminiCooldown(");
  const helperEnd = orchestrator.indexOf("\n}", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "provider-state guard helper must be present");
  const helper = orchestrator.slice(helperStart, helperEnd);
  assert.ok(helper.includes("if(error || !data) return {active:true"),
    "missing row and lookup errors must be an active state");
  assert.ok(helper.includes("lookup_error:"),
    "provider-state uncertainty must be explicitly classified");
  assert.ok(orchestrator.includes('reason:"provider_state_unavailable"'),
    "entry-point lookup uncertainty must stop orchestration");
  assert.ok(orchestrator.includes("const liveCooldown=await getGeminiCooldown(supabase);"),
    "each schedule must re-check provider state");
});

test("atomic cooldown migration has safe diagnostics, monotonic expiry, and server-only execution", () => {
  assert.ok(migration.includes("CREATE OR REPLACE FUNCTION public.aevora_record_gemini_throttle("));
  assert.ok(migration.includes("p_event_id uuid"));
  assert.ok(migration.includes("ON CONFLICT (event_id) DO NOTHING"));
  assert.ok(migration.includes("RETURN QUERY SELECT true, true"));
  assert.ok(migration.includes("ON CONFLICT (provider) DO UPDATE"));
  assert.ok(migration.includes("WHEN p_event_class = 'quota' THEN current_state.consecutive_throttle_count + 1"));
  assert.ok(migration.includes("ELSE current_state.consecutive_throttle_count"));
  assert.ok(migration.includes("GREATEST(") && migration.includes("current_state.cooldown_until"));
  assert.ok(migration.includes("WHERE current_state.consecutive_throttle_count >= 0"));
  assert.ok(migration.includes("RAISE EXCEPTION 'provider state counter is malformed'"));
  assert.ok(migration.includes("Gemini quota or rate-limit response"));
  assert.ok(migration.includes("Gemini temporary overload response"));
  assert.ok(migration.includes("REVOKE ALL ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) FROM PUBLIC"));
  assert.ok(migration.includes("FROM anon, authenticated"));
  assert.ok(migration.includes("GRANT EXECUTE ON FUNCTION public.aevora_record_gemini_throttle(uuid, text) TO service_role"));
  assert.ok(migration.includes("Atomically deduplicates a Gemini provider-call event"));
});

test("atomicity plan records both writers and preserves the production evidence gate", () => {
  assert.ok(plan.includes("generate-chapter") && plan.includes("generation-orchestrator"));
  assert.ok(plan.includes("route both writers through the same atomic database operation"));
  assert.ok(plan.includes("missing original provider-state migration body"));
  assert.ok(plan.includes("does not authorize production deployment"));
});
