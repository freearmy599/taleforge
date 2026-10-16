/**
 * Provider cooldown recording source-contract regression.
 * Static checks only; does not call Gemini or mutate Supabase.
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
const catchStart = source.indexOf("const providerQuotaFailure=");
const catchEnd = source.indexOf('const failureReason=', catchStart);
assert.notEqual(catchStart, -1, "provider failure handling must exist");
assert.notEqual(catchEnd, -1, "provider failure handler must have a bounded end");
const handler = source.slice(catchStart, catchEnd);

test("provider-state lookup binds Supabase error to stateError", () => {
  assert.match(
    handler,
    /const\s*\{\s*data\s*,\s*error\s*:\s*stateError\s*\}\s*=\s*await\s+db\.from\("taleforge_ai_provider_state"\)/,
    "the Supabase error field must be aliased; data,stateError silently misses lookup errors",
  );
  assert.doesNotMatch(
    handler,
    /const\s*\{\s*data\s*,\s*stateError\s*\}\s*=/,
    "do not destructure a nonexistent stateError property",
  );
});

test("provider-state lookup failure preserves existing cooldown state", () => {
  assert.match(handler, /if\s*\(stateError\s*\|\|\s*!data\)/);
  assert.match(
    handler,
    /Gemini cooldown state could not be verified; existing state preserved/,
  );
  assert.match(
    handler,
    /if\s*\(cooldownError\)\s*console\.error/,
    "cooldown upsert errors must be logged rather than reported as successful",
  );
});

test("malformed or overflowing throttle counters preserve state instead of resetting escalation", () => {
  assert.match(handler, /const rawCount=data\.consecutive_throttle_count;/,
    "the persisted counter must be validated without coercion");
  assert.match(handler, /typeof rawCount!==["']number["']\|\|!Number\.isSafeInteger\(rawCount\)\|\|rawCount<0/,
    "non-numeric, negative, fractional, and unsafe counters must fail closed");
  assert.match(handler, /Gemini throttle counter is malformed; existing state preserved/,
    "malformed persisted state must not be silently reset");
  assert.match(handler, /if\(!Number\.isSafeInteger\(count\)\)/,
    "increment overflow must fail closed");
  assert.match(handler, /Gemini throttle counter would overflow; existing state preserved/,
    "overflow must preserve the prior state");
  assert.doesNotMatch(handler, /Number\(data\.consecutive_throttle_count\?\?0\)/,
    "invalid state must never be coerced to a fresh zero counter");
  const malformedGuard = handler.indexOf("Gemini throttle counter is malformed; existing state preserved");
  const upsert = handler.indexOf('.upsert({provider:"gemini"');
  assert.ok(malformedGuard >= 0 && upsert > malformedGuard,
    "malformed-state rejection must occur before any cooldown upsert");
});


test("atomicity gate explicitly covers both direct and fallback cooldown writers", () => {
  assert.match(orchestrator, /getGeminiCooldown/,
    "generation-orchestrator must retain its provider-state guard and fallback recorder");
  assert.match(orchestrator, /from\("taleforge_ai_provider_state"\)/,
    "the orchestrator fallback writer must remain in the audit scope");
  assert.match(orchestrator, /upsert\(\{provider:"gemini"/,
    "the existing fallback write path must be accounted for until replaced by the atomic RPC");
  assert.match(plan, /both.*`generate-chapter`.*`generation-orchestrator`/s,
    "the atomicity plan must explicitly cover both writers");
  assert.match(plan, /route both writers through the same atomic database operation/,
    "the release gate must require both paths to converge on one atomic operation");
});


test("orchestrator fails closed when the provider-state row is missing or unreadable", () => {
  const helperStart = orchestrator.indexOf("async function getGeminiCooldown(");
  const helperEnd = orchestrator.indexOf("\n}", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "provider-state guard helper must be present");
  const helper = orchestrator.slice(helperStart, helperEnd);
  assert.match(helper, /if\(error \|\| !data\) return \{active:true[\s\S]*?lookup_error:/,
    "missing row and lookup errors must be an active, explicitly unavailable state");
  assert.match(orchestrator, /if\(geminiCooldown\.lookup_error\)[\s\S]*?reason:"provider_state_unavailable"[\s\S]*?},503\)/,
    "entry-point lookup uncertainty must stop orchestration with a retryable 503");
  assert.match(orchestrator, /const liveCooldown=await getGeminiCooldown\(supabase\);if\(liveCooldown\.lookup_error\)[\s\S]*?action:"provider_state_unavailable"[\s\S]*?continue/,
    "each schedule must re-check state and skip when the provider state becomes uncertain");
});

test("orchestrator cooldown fallback never reports a successful write after a database write error", () => {
  const writerStart = orchestrator.indexOf("async function recordGeminiCooldown(");
  const writerEnd = orchestrator.indexOf("\n}", writerStart);
  assert.ok(writerStart >= 0 && writerEnd > writerStart, "fallback cooldown recorder must be present");
  const writer = orchestrator.slice(writerStart, writerEnd);
  assert.match(writer, /const \{error:writeError\}\s*=\s*await[\s\S]*?\.upsert\(/,
    "the fallback persistence result must capture the database write error");
  assert.match(writer, /if\(writeError\)\{[\s\S]*?return null;\}/,
    "a failed persistence attempt must not return a success-shaped cooldown result");
  assert.match(writer, /if\(existingUntil>Date\.now\(\)\) return[\s\S]*?already_active:true/,
    "the fallback writer must preserve an already-active longer cooldown");
});

test("both cooldown writers remain explicitly gated for replacement by one atomic operation", () => {
  assert.match(plan, /route both writers through the same atomic database operation/);
  assert.match(plan, /read-modify-upsert/);
  assert.match(plan, /concurrent calls must not lose increments/);
  assert.match(plan, /database error must remain an error/);
});
