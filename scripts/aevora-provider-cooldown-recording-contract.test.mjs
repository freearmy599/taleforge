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
  new URL("../supabase/migrations/20261016180000_atomic_gemini_provider_throttle.sql", import.meta.url),
  "utf8",
);

const catchStart = source.indexOf("const providerQuotaFailure=");
const catchEnd = source.indexOf("const failureReason=", catchStart);
assert.notEqual(catchStart, -1, "provider failure handling must exist");
assert.notEqual(catchEnd, -1, "provider failure handler must have a bounded end");
const handler = source.slice(catchStart, catchEnd);

const orchestratorWriterStart = orchestrator.indexOf("async function recordGeminiThrottle(");
const orchestratorWriterEnd = orchestrator.indexOf("\\n}", orchestratorWriterStart);
assert.ok(orchestratorWriterStart >= 0 && orchestratorWriterEnd > orchestratorWriterStart,
  "orchestrator throttle recorder must exist");
const orchestratorWriter = orchestrator.slice(orchestratorWriterStart, orchestratorWriterEnd);

test("direct generation worker routes quota and overload events through the shared atomic RPC", () => {
  assert.match(handler, /db\\.rpc\\("aevora_record_gemini_throttle",\\{p_event_class:providerQuotaFailure\\?"quota":"overload"\\}\\)/,
    "the direct worker must use the atomic database operation");
  assert.match(handler, /result\\?\\.recorded!==true/,
    "RPC errors or unexpected results must not be treated as a successful recording");
  assert.match(handler, /Gemini cooldown persistence failed; this request remains blocked/,
    "failed cooldown recording must be explicitly surfaced in safe diagnostics");
  assert.doesNotMatch(handler, /\\.upsert\\(/,
    "the direct worker must not retain a read-modify-upsert cooldown path");
  assert.doesNotMatch(handler, /from\\("taleforge_ai_provider_state"\\)/,
    "the direct worker's error path must not read provider state before writing");
});

test("generation orchestrator fallback uses the same atomic RPC", () => {
  assert.match(orchestratorWriter, /supabase\\.rpc\\("aevora_record_gemini_throttle",\\{p_event_class:providerQuotaFailure\\?"quota":"overload"\\}\\)/,
    "the orchestrator must converge on the same atomic operation");
  assert.match(orchestratorWriter, /result\\?\\.recorded!==true/,
    "the orchestrator must reject an unsuccessful RPC result");
  assert.match(orchestratorWriter, /return null/,
    "the orchestrator must not report a successful write after persistence failure");
  assert.doesNotMatch(orchestratorWriter, /\\.upsert\\(/,
    "the orchestrator writer must not retain a read-modify-upsert cooldown path");
  assert.doesNotMatch(orchestratorWriter, /from\\("taleforge_ai_provider_state"\\)/,
    "the fallback recorder must not perform its own provider-state read");
});

test("orchestrator still fails closed when provider state is missing or unreadable", () => {
  const helperStart = orchestrator.indexOf("async function getGeminiCooldown(");
  const helperEnd = orchestrator.indexOf("\\n}", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "provider-state guard helper must be present");
  const helper = orchestrator.slice(helperStart, helperEnd);
  assert.match(helper, /if\\(error \\|\\| !data\\) return \\{active:true[\\s\\S]*?lookup_error:/,
    "missing row and lookup errors must be an active, explicitly unavailable state");
  assert.match(orchestrator, /if\\(geminiCooldown\\.lookup_error\\)[\\s\\S]*?reason:"provider_state_unavailable"[\\s\\S]*?\\},503\\)/,
    "entry-point lookup uncertainty must stop orchestration with a retryable 503");
  assert.match(orchestrator, /const liveCooldown=await getGeminiCooldown\\(supabase\\);if\\(liveCooldown\\.lookup_error\\)[\\s\\S]*?action:"provider_state_unavailable"[\\s\\S]*?continue/,
    "each schedule must re-check state and skip when provider state becomes uncertain");
});

test("atomic cooldown migration has safe diagnostics, monotonic expiry, and server-only execution", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\\.aevora_record_gemini_throttle\\(p_event_class text\\)/);
  assert.match(migration, /ON CONFLICT \\(provider\\) DO UPDATE/);
  assert.match(migration, /consecutive_throttle_count = current_state\\.consecutive_throttle_count \\+ 1/);
  assert.match(migration, /GREATEST\\([\\s\\S]*?current_state\\.cooldown_until/);
  assert.match(migration, /WHERE current_state\\.consecutive_throttle_count >= 0/);
  assert.match(migration, /RAISE EXCEPTION 'provider state counter is malformed'/);
  assert.match(migration, /Gemini quota or rate-limit response/);
  assert.match(migration, /Gemini temporary overload response/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\\.aevora_record_gemini_throttle\\(text\\) FROM PUBLIC/);
  assert.match(migration, /FROM anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\\.aevora_record_gemini_throttle\\(text\\) TO service_role/);
  assert.match(migration, /not idempotent across duplicate calls/);
});

test("atomicity plan records both writers and preserves the production evidence gate", () => {
  assert.match(plan, /both.*`generate-chapter`.*`generation-orchestrator`/s);
  assert.match(plan, /route both writers through the same atomic database operation/);
  assert.match(plan, /schema provenance/);
  assert.match(plan, /does not authorize production deployment/);
});
