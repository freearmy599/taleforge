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


test("generation-orchestrator stops revision and generation AI calls after any provider throttle signal", async () => {
  const source = await readFile(new URL("../supabase/functions/generation-orchestrator/index.ts", import.meta.url), "utf8");
  assert.match(source, /let providerThrottleObserved\s*=\s*false/, "orchestrator must track provider throttle state");
  assert.match(source, /if\(providerThrottleObserved\)\{results\.push\(\{schedule_id:schedule\.id,series_id:schedule\.series_id,action:"provider_throttle_observed"/,
    "a throttle in one series must block subsequent series");
  const revisionLoop = source.indexOf("for(const c of actionableCandidates)");
  const revisionCall = source.indexOf('invokeFunction(supabaseUrl,key,"revise-chapter"', revisionLoop);
  assert.ok(revisionLoop >= 0 && revisionCall > revisionLoop, "revision loop and AI call must exist");
  assert.ok(source.indexOf("if(providerThrottleObserved)", revisionLoop) < revisionCall,
    "revision AI call must be guarded by the run-wide throttle flag");
  const generationLoop = source.indexOf("for(const b of missing)");
  const generationCall = source.indexOf('invokeFunction(supabaseUrl,key,"generate-chapter"', generationLoop);
  assert.ok(generationLoop >= 0 && generationCall > generationLoop, "generation loop and AI call must exist");
  assert.ok(source.indexOf("if(providerThrottleObserved)", generationLoop) < generationCall,
    "generation AI call must be guarded by the run-wide throttle flag");
  assert.match(source, /if\(revisionProviderBlock\)providerThrottleObserved=true/,
    "revision provider-block responses must stop later AI work");
  assert.match(source, /if\(reviewProviderBlocked\)providerThrottleObserved=true/,
    "review provider-block responses must stop later AI work");
});


test("generation-orchestrator hard-stops non-dry-run work during an active Gemini cooldown", async () => {
  const source = await readFile(new URL("../supabase/functions/generation-orchestrator/index.ts", import.meta.url), "utf8");
  const cooldownRead = source.indexOf("const geminiCooldown=await getGeminiCooldown(supabase)");
  const activeGuard = source.indexOf("if(geminiCooldown.active&&!dryRun)return response");
  const scheduleQuery = source.indexOf('let q=supabase.from("release_schedules")');
  const deterministicRefresh = source.indexOf("await refreshDeterministicIntelligence(supabase)");
  assert.ok(cooldownRead >= 0, "orchestrator must read persisted provider cooldown");
  assert.ok(activeGuard > cooldownRead, "active cooldown must be checked after provider state is loaded");
  assert.ok(scheduleQuery > activeGuard, "active cooldown must stop before schedule selection");
  assert.ok(deterministicRefresh > activeGuard, "active cooldown must stop before deterministic intelligence refresh mutations");
  const guard = source.slice(activeGuard, scheduleQuery);
  assert.match(guard, /reason:"provider_cooldown"/, "active cooldown must return a stable blocked reason");
  assert.match(guard, /503\)/, "active cooldown must return a retryable service-unavailable status");
  assert.match(guard, /!dryRun/, "read-only dry runs may continue to report diagnostic state");
  assert.match(source, /provider_cooldown:providerCooldownNote/, "dry-run diagnostics must expose the persisted cooldown state");
});


test("review workers validate provider state before invoking Gemini", async () => {
  const cases = [
    {
      path: "../supabase/functions/continuity-review/index.ts",
      call: "aiReview = await callGemini(geminiApiKey, prompt);",
    },
    {
      path: "../supabase/functions/originality-review/index.ts",
      call: "aiReview = await callGemini(",
    },
    {
      path: "../supabase/functions/safety-review/index.ts",
      call: "aiReview = await callGemini(",
    },
  ];

  for (const item of cases) {
    const source = await readFile(new URL(item.path, import.meta.url), "utf8");
    const stateGuard = source.lastIndexOf('.from("taleforge_ai_provider_state")');
    const invocation = source.indexOf(item.call);
    assert.ok(stateGuard >= 0, `${item.path}: persisted provider-state guard must exist`);
    assert.ok(invocation > stateGuard,
      `${item.path}: provider-state validation must occur before the review invokes Gemini`);
    const guardedRegion = source.slice(stateGuard, invocation);
    assert.match(guardedRegion, /provider_state_unavailable/,
      `${item.path}: provider-state uncertainty must block the review`);
    assert.match(guardedRegion, /provider_cooldown/,
      `${item.path}: active cooldown must block the review`);
  }
});

test("direct Gemini workers validate provider state before issuing their model request", async () => {
  const cases = [
    ["../supabase/functions/character-continuity/index.ts", "const resp=await fetch(`https://generativelanguage.googleapis.com"],
    ["../supabase/functions/world-continuity/index.ts", "const resp=await fetch(`https://generativelanguage.googleapis.com"],
    ["../supabase/functions/arc-planner/index.ts", "const resp=await fetch(`https://generativelanguage.googleapis.com"],
    ["../supabase/functions/blueprint-planner/index.ts", "const resp=await fetch(`https://generativelanguage.googleapis.com"],
    ["../supabase/functions/story-dna-planner/index.ts", "const resp=await fetch(`https://generativelanguage.googleapis.com"],
  ];

  for (const [path, requestMarker] of cases) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const stateGuard = source.lastIndexOf('.from("taleforge_ai_provider_state")');
    const request = source.indexOf(requestMarker);
    assert.ok(stateGuard >= 0, `${path}: persisted provider-state guard must exist`);
    assert.ok(request > stateGuard,
      `${path}: provider-state validation must precede the direct Gemini request`);
    const guardedRegion = source.slice(stateGuard, request);
    assert.match(guardedRegion, /provider_state_unavailable/,
      `${path}: provider-state uncertainty must block the request`);
    assert.match(guardedRegion, /provider_cooldown/,
      `${path}: active cooldown must block the request`);
  }
});

test("revise-chapter rechecks provider availability immediately before both revision and continuation model calls", async () => {
  const source = await readFile(new URL("../supabase/functions/revise-chapter/index.ts", import.meta.url), "utf8");
  const cases = [
    {
      guard: "const providerBlock = await getGeminiProviderBlock(supabase);",
      call: "rawResponse = await callGemini(geminiApiKey, prompt",
      reason: "Revision",
    },
    {
      guard: "const continuationProviderBlock = await getGeminiProviderBlock(supabase);",
      call: "continuation = cleanGeminiOutput(await callGemini(geminiApiKey, continuationPrompt",
      reason: "Continuation",
    },
  ];

  for (const item of cases) {
    const guard = source.indexOf(item.guard);
    const call = source.indexOf(item.call, guard);
    assert.ok(guard >= 0, `${item.reason}: provider-state check must exist`);
    assert.ok(call > guard, `${item.reason}: provider-state check must precede its Gemini call`);
    const guardedRegion = source.slice(guard, call);
    assert.match(guardedRegion, /if\s*\(\s*(?:providerBlock|continuationProviderBlock)\s*\)/,
      `${item.reason}: blocked provider state must branch before the model call`);
    assert.match(guardedRegion, /provider_state_unavailable/,
      `${item.reason}: unknown provider state must fail closed`);
    assert.match(guardedRegion, /provider_cooldown/,
      `${item.reason}: active cooldown must block the model call`);
    assert.match(guardedRegion, /503\)/,
      `${item.reason}: blocked provider state must return a retryable service error`);
  }

  const helperStart = source.indexOf("async function getGeminiProviderBlock(");
  const helperEnd = source.indexOf("async function recordGeminiThrottle(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "shared provider-state helper must remain present");
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /if\s*\(error\s*\|\|\s*!data\)[\s\S]*?provider_state_unavailable/,
    "provider-state lookup errors or missing rows must fail closed");
  assert.match(helper, /!Number\.isFinite\(until\)[\s\S]*?invalid_cooldown_timestamp/,
    "malformed cooldown timestamps must fail closed");
});
