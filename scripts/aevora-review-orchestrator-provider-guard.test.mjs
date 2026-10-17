import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/review-orchestrator/index.ts", import.meta.url), "utf8");

test("review orchestrator fails closed before request processing when Gemini state is unavailable", () => {
  const auth = source.indexOf("isTrustedInternalApiKey(");
  const stateRead = source.indexOf('.from("taleforge_ai_provider_state")');
  const requestBody = source.indexOf("body = await req.json()");
  assert.ok(auth >= 0 && stateRead > auth && requestBody > stateRead,
    "authenticate and verify persisted provider state before parsing or processing work");
  const guard = source.slice(stateRead, requestBody);
  assert.match(guard, /providerStateError \|\| !providerState/,
    "lookup error or missing row must fail closed");
  assert.match(guard, /reason: "provider_state_unavailable"/,
    "unavailable provider state must have a stable blocked reason");
  assert.match(guard, /}, 503\)/,
    "unavailable provider state must return retryable service-unavailable");
  assert.match(guard, /no review model calls were made/,
    "response must make clear no review workers were called");
});

test("review orchestrator rejects malformed provider counters and timestamps", () => {
  const stateRead = source.indexOf('.from("taleforge_ai_provider_state")');
  const requestBody = source.indexOf("body = await req.json()");
  const guard = source.slice(stateRead, requestBody);
  assert.match(guard, /Number\.isSafeInteger\(providerState\.consecutive_throttle_count\)/);
  assert.match(guard, /providerState\.consecutive_throttle_count < 0/);
  assert.match(guard, /!Number\.isFinite\(new Date\(providerState\.cooldown_until\)\.getTime\(\)\)/);
  assert.match(guard, /reason: "provider_state_unavailable"/);
});

test("review orchestrator stops the current and subsequent outputs after any provider throttle signal", () => {
  const loop = source.indexOf("for (const output of outputs ?? [])");
  const earlyStop = source.indexOf("if (providerThrottleObserved)", loop);
  const reviewCall = source.indexOf("await callFunction(supabaseUrl, serviceRoleKey, step.functionName, output.id)", loop);
  const throttleCheck = source.indexOf("if (providerThrottleResponse)", reviewCall);
  const stopFlag = source.indexOf("providerThrottleObserved = true", throttleCheck);
  assert.ok(loop >= 0 && earlyStop > loop && reviewCall > earlyStop,
    "subsequent outputs must be blocked after a throttle");
  assert.ok(throttleCheck > reviewCall && stopFlag > throttleCheck,
    "the current review plan must set a run-wide stop flag immediately after a provider block");
  const predicate = source.slice(reviewCall, throttleCheck);
  assert.match(predicate, /callReason === "provider_state_unavailable"/,
    "provider-state blocks returned by child workers must be treated as throttle signals");
  assert.match(predicate, /callReason === "provider_cooldown"/);
  const throttleRegion = source.slice(throttleCheck, source.indexOf("if (!call.ok)", throttleCheck));
  assert.match(throttleRegion, /blocked = true/);
  assert.match(throttleRegion, /break/);
});
