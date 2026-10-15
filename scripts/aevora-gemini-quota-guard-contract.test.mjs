/**
 * Repository-wide static contract for direct Gemini API callers.
 *
 * This is source-only: it never calls Gemini or Supabase and never mutates data.
 * It prevents a new direct Gemini worker from omitting the shared provider-state
 * record, fail-closed state-unavailable handling, or active-cooldown rejection.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../supabase/functions/", import.meta.url);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...await collect(child));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(child);
  }
  return files;
}

test("every direct Gemini API caller has fail-closed provider-state and cooldown guards", async () => {
  const files = await collect(root);
  const callers = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (!/generativelanguage\.googleapis\.com\/v1beta\/models\//i.test(source)) continue;
    callers.push({ path: file.pathname, source });
  }
  assert.ok(callers.length > 0, "the scan must find direct Gemini API callers");

  const failures = [];
  for (const { path, source } of callers) {
    const checks = [
      [/taleforge_ai_provider_state/.test(source), "does not read the persisted Gemini provider state"],
      [/provider_state_unavailable/.test(source), "does not fail closed when provider state is unavailable or invalid"],
      [/provider_cooldown/.test(source), "does not explicitly reject work during an active provider cooldown"],
      [/Date\.now\(\)/.test(source), "does not compare provider cooldown timestamps against the current time"],
    ];
    for (const [passed, reason] of checks) if (!passed) failures.push(`${path}: ${reason}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.ok(callers.length >= 10, `unexpectedly few direct Gemini callers were scanned: ${callers.length}`);
});


test("generate-chapter provider-state guard covers both generation and quality-review request paths", async () => {
  const source = await readFile(new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url), "utf8");
  const guardIndex = source.indexOf('.from("taleforge_ai_provider_state")');
  const generationBranchIndex = source.indexOf("if(blueprintId&&!outputId){", guardIndex);
  assert.notEqual(guardIndex, -1, "generate-chapter must load provider state");
  assert.notEqual(generationBranchIndex, -1, "chapter-generation branch must remain present after the guard");
  assert.ok(guardIndex < generationBranchIndex, "provider-state guard must run before branching between generation and output review");
  const beforeGuard = source.slice(0, guardIndex);
  const lastGenerationBranch = beforeGuard.lastIndexOf("if(blueprintId&&!outputId){");
  assert.equal(lastGenerationBranch, -1, "provider-state lookup must not be nested inside the generation-only branch");
  const guardRegion = source.slice(source.lastIndexOf("taleforge_ceo_execution_gate", guardIndex), generationBranchIndex);
  assert.match(guardRegion, /provider_state_unavailable/, "missing provider state must block all request paths");
  assert.match(guardRegion, /provider_cooldown/, "active cooldown must block all request paths");
});

test("review-orchestrator fails closed before selecting outputs when Gemini provider state is unavailable or cooling down", async () => {
  const source = await readFile(new URL("../supabase/functions/review-orchestrator/index.ts", import.meta.url), "utf8");
  const stateLookup = source.indexOf('.from("taleforge_ai_provider_state")');
  const candidateLookup = source.indexOf('.from("chapter_generation_outputs")');
  const reviewCall = source.indexOf('callFunction(supabaseUrl, serviceRoleKey, step.functionName, output.id)');
  assert.ok(stateLookup >= 0, "review-orchestrator must load persisted Gemini provider state");
  assert.ok(candidateLookup > stateLookup, "provider-state validation must precede candidate-output selection");
  assert.ok(reviewCall > stateLookup, "provider-state validation must precede every downstream review call");
  const guard = source.slice(stateLookup, candidateLookup);
  assert.match(guard, /providerStateError\s*\|\|\s*!providerState/, "missing/error state must block the review pipeline");
  assert.match(guard, /provider_state_unavailable/, "unavailable state must return the stable blocked reason");
  assert.match(guard, /provider_cooldown/, "active cooldown must return the stable blocked reason");
  assert.match(guard, /return json\([\s\S]*?503\)/, "provider-state lookup failures must return a retryable service error");
});

test("review-orchestrator stops the current output's remaining review steps on any provider throttle signal", async () => {
  const source = await readFile(new URL("../supabase/functions/review-orchestrator/index.ts", import.meta.url), "utf8");
  const throttle = source.indexOf("const providerThrottleResponse =");
  const blocked = source.indexOf("if (providerThrottleResponse)", throttle);
  const stop = source.indexOf("providerThrottleObserved = true;", blocked);
  const breakStep = source.indexOf("break;", stop);
  const genericHttpFailure = source.indexOf("if (!call.ok)", blocked);
  assert.ok(throttle >= 0 && blocked > throttle, "provider throttle response predicate must exist");
  assert.ok(stop > blocked && breakStep > stop && genericHttpFailure > breakStep,
    "provider throttle must set the global stop flag and break the current review plan before generic HTTP handling");
  const guarded = source.slice(throttle, genericHttpFailure);
  assert.match(guarded, /blocked\s*=\s*true/, "the current output must be marked blocked");
  assert.match(guarded, /callReason\s*===\s*["']provider_cooldown["']/, "nominal HTTP success with a provider block must stop remaining calls");
});
