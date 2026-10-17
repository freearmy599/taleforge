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
      [/Number\.isSafeInteger\(/.test(source), "does not validate the persisted throttle counter as a safe integer"],
      [/Number\.isFinite\(/.test(source), "does not reject malformed cooldown timestamps"],
    ];
    for (const [passed, reason] of checks) if (!passed) failures.push(`${path}: ${reason}`);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
  assert.ok(callers.length >= 10, `unexpectedly few direct Gemini callers were scanned: ${callers.length}`);
});


test("generate-chapter scopes provider guards to generation and AI quality-review model calls", async () => {
  const source = await readFile(new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url), "utf8");
  const generationBranch = source.indexOf("if(blueprintId&&!outputId){");
  const generationGuard = source.indexOf('.from("taleforge_ai_provider_state")', generationBranch);
  const generationModelCall = source.indexOf("content=await gemini(gkey,n===1?prompt", generationBranch);
  const qualityBranch = source.indexOf("if(!outputId)return reply");
  const deterministicValidation = source.indexOf("if(issues.length)", qualityBranch);
  const qualityGuard = source.indexOf("const {data:reviewProviderState,error:reviewProviderStateError}", qualityBranch);
  const qualityModelCall = source.indexOf("ai=parseJson(await gemini(gkey,reviewPrompt,true))", qualityGuard);
  assert.ok(generationBranch >= 0 && generationGuard > generationBranch && generationModelCall > generationGuard,
    "generation provider-state guard must be inside the generation branch and precede the model call");
  assert.ok(qualityBranch > generationModelCall,
    "generation cooldown guard must not block deterministic quality-review work");
  assert.ok(deterministicValidation > qualityBranch && qualityGuard > deterministicValidation && qualityModelCall > qualityGuard,
    "quality-review provider-state guard must run after deterministic validation and before AI review");
  for (const [label, start, end] of [
    ["generation", generationGuard, generationModelCall],
    ["quality review", qualityGuard, qualityModelCall],
  ]) {
    const guard = source.slice(start, end);
    assert.match(guard, /provider_state_unavailable/, label + ": missing provider state must fail closed");
    assert.match(guard, /provider_cooldown/, label + ": active cooldown must block Gemini");
    assert.match(guard, /Number\.isSafeInteger\(/, label + ": malformed throttle counters must fail closed");
    assert.match(guard, /Number\.isFinite\(/, label + ": malformed cooldown timestamps must fail closed");
  }
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
  assert.match(guard, /Number\.isSafeInteger\(/, "review orchestration must reject malformed throttle counters");
  assert.match(guard, /Number\.isFinite\(/, "review orchestration must reject malformed cooldown timestamps");
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


test("generation-orchestrator fails closed on malformed or unsafe Gemini throttle counters", async () => {
  const source = await readFile(new URL("../supabase/functions/generation-orchestrator/index.ts", import.meta.url), "utf8");
  const helperStart = source.indexOf("async function getGeminiCooldown(");
  const helperEnd = source.indexOf("Deno.serve(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "provider-state helpers must remain present");
  const readGuard = source.slice(helperStart, helperEnd);
  assert.match(readGuard, /typeof rawCount!==["']number["']/,
    "provider-state counters must be numeric rather than silently coerced from strings");
  assert.match(readGuard, /Number\.isSafeInteger\(rawCount\)/,
    "provider-state counters must be safe integers");
  assert.match(readGuard, /rawCount<0/,
    "negative provider-state counters must block orchestration");
  assert.match(readGuard, /lookup_error:"Gemini provider-state throttle counter is invalid"/,
    "malformed provider-state counters must return the fail-closed lookup error");
  assert.match(readGuard, /active:true/,
    "malformed provider-state counters must be treated as blocked");
  assert.equal(source.includes("async function recordGeminiThrottle("), false,
    "orchestrator must not own a second provider-event writer");
  assert.equal(source.includes("aevora_record_gemini_throttle"), false,
    "orchestrator must not double-record child provider failures");
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


test("semantic continuity extraction validates Gemini state before claiming queued work", async () => {
  const source = await readFile(new URL("../supabase/functions/semantic-continuity-extraction/index.ts", import.meta.url), "utf8");
  const executeGate = source.indexOf("if(execute){");
  const stateLookup = source.indexOf('.from("taleforge_ai_provider_state")');
  const claim = source.indexOf('db.rpc("taleforge_claim_continuity_queue"');
  const childWorkerCall = source.indexOf('fetch(base+name');
  assert.ok(executeGate >= 0 && stateLookup > executeGate,
    "execute mode must validate provider state before attempting queue work");
  assert.ok(claim > stateLookup,
    "provider-state validation must precede the queue claim RPC");
  assert.ok(childWorkerCall > claim,
    "child continuity workers must only be invoked after guarded queue claim");
  const guard = source.slice(stateLookup, claim);
  assert.match(guard, /providerStateError\s*\|\|\s*!providerState/,
    "missing provider state must block queue claiming");
  assert.match(guard, /Number\.isSafeInteger\(providerState\.consecutive_throttle_count\)/,
    "unsafe throttle counters must block queue claiming");
  assert.match(guard, /invalid_cooldown_timestamp/,
    "malformed cooldown timestamps must block queue claiming");
  assert.match(guard, /provider_cooldown/,
    "active cooldown must block queue claiming");
  assert.match(guard, /cooldownUntil\s*>\s*Date\.now\(\)/,
    "cooldown must be compared with the current time");
  assert.match(source, /if\(!execute\) return new Response\([\s\S]*?status:"dry_run",queue_mutated:false/,
    "dry-run mode must remain non-mutating");
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
    assert.match(guardedRegion, /Number\.isSafeInteger\(/, `${item.path}: malformed throttle counters must fail closed`);
    assert.match(guardedRegion, /Number\.isFinite\(/, `${item.path}: malformed cooldown timestamps must fail closed`);
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
    assert.match(guardedRegion, /Number\.isSafeInteger\(/, `${path}: malformed throttle counters must fail closed`);
    assert.match(guardedRegion, /Number\.isFinite\(/, `${path}: malformed cooldown timestamps must fail closed`);
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
    assert.match(guardedRegion, /503\)/,
      `${item.reason}: blocked provider state must return a retryable service error`);
  }

  const helperStart = source.indexOf("async function getGeminiProviderBlock(");
  const helperEnd = source.indexOf("Deno.serve(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "shared provider-state helper must remain present");
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /if\s*\(error\s*\|\|\s*!data\)[\s\S]*?provider_state_unavailable/,
    "provider-state lookup errors or missing rows must fail closed");
  assert.match(helper, /Number\.isSafeInteger\(/, "revision and continuation must reject malformed throttle counters");
  assert.match(helper, /provider_cooldown/,
    "an active cooldown must block both revision and continuation calls");
  assert.match(helper, /!Number\.isFinite\(until\)[\s\S]*?invalid_cooldown_timestamp/,
    "malformed cooldown timestamps must fail closed");
});


test("generation-orchestrator treats a missing provider-state row as unavailable before parsing or processing work", async () => {
  const source = await readFile(new URL("../supabase/functions/generation-orchestrator/index.ts", import.meta.url), "utf8");
  const helperStart = source.indexOf("async function getGeminiCooldown(");
  const helperEnd = source.indexOf("Deno.serve(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "provider-state lookup helper must exist");
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /if\s*\(error\s*\|\|\s*!data\s*\)\s*return\s*\{active:true[\s\S]*?lookup_error:/,
    "query errors and a missing row must both return an active fail-closed state");
  assert.match(helper, /No Gemini provider-state row found/,
    "missing state must carry an explicit safe diagnostic rather than being treated as no cooldown");
  assert.doesNotMatch(helper, /if\s*\(error\s*\)\s*return\s*\{active:false/,
    "a missing row must never fall through to inactive/no cooldown");
  const auth = source.indexOf("isTrustedInternalApiKey(");
  const cooldown = source.indexOf("const geminiCooldown=await getGeminiCooldown(supabase)");
  const body = source.indexOf("const body=await req.json()");
  const work = source.indexOf('let q=supabase.from("release_schedules")');
  assert.ok(auth >= 0 && cooldown > auth && body > cooldown && work > body,
    "authenticate and validate provider state before parsing request or beginning orchestration work");
  const guard = source.slice(cooldown, body);
  assert.match(guard, /if\(geminiCooldown\.lookup_error\)[\s\S]*?reason:"provider_state_unavailable"[\s\S]*?503/,
    "unavailable state must return a stable retryable block before request processing");
});

test("chapter generator provider HTTP errors cannot leak provider response bodies", async () => {
  const source = await readFile(new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url), "utf8");
  const geminiStart = source.indexOf("async function gemini(");
  const geminiEnd = source.indexOf("function parseJson(", geminiStart);
  assert.ok(geminiStart >= 0 && geminiEnd > geminiStart, "Gemini request helper must exist");
  const helper = source.slice(geminiStart, geminiEnd);
  assert.match(helper, /const raw=await r\.text\(\)/, "response must still be consumed for successful JSON parsing");
  assert.match(helper, /if\(!r\.ok\)[\s\S]*?throw new Error\(\`Gemini HTTP \$\{r\.status\}[\s\S]*?\);/,
    "provider failure should throw a status-only diagnostic");
  assert.doesNotMatch(helper, /throw new Error\([^)]*(?:raw|responseText|\.text\()/,
    "raw provider response text must not enter a thrown error");
  const catchStart = source.indexOf("const providerQuotaFailure=");
  const catchEnd = source.indexOf('return reply({success:false,retryable:providerCooldownFailure', catchStart);
  assert.ok(catchStart >= 0 && catchEnd > catchStart, "bounded failure handler must exist");
  const handler = source.slice(catchStart, catchEnd);
  assert.match(handler, /const failureMessage=providerQuotaFailure\?[\s\S]*?internal diagnostics were withheld/,
    "caller response must use a safe fixed message");
  assert.doesNotMatch(handler, /error_message\s*:\s*message|error\s*:\s*message|last_error\s*:\s*message|console\.(?:error|warn)\([^\n]*message/,
    "provider exception text must not be returned, logged, or persisted");
});

test("generation-orchestrator fails closed on malformed Gemini cooldown timestamps", async () => {
  const source = await readFile(new URL("../supabase/functions/generation-orchestrator/index.ts", import.meta.url), "utf8");
  const helperStart = source.indexOf("async function getGeminiCooldown(");
  const helperEnd = source.indexOf("Deno.serve(", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "provider-state helper must remain present");
  const helper = source.slice(helperStart, helperEnd);
  assert.match(helper, /new Date\(data\.cooldown_until\)/,
    "persisted cooldown timestamps must be parsed explicitly");
  assert.match(helper, /!Number\.isFinite\(until\.getTime\(\)\)/,
    "invalid timestamps must be detected rather than treated as expired");
  assert.match(helper, /cooldown timestamp is invalid/,
    "invalid timestamps must return a stable fail-closed diagnostic");
  assert.match(helper, /if\(data\.cooldown_until && \(!until \|\| !Number\.isFinite\(until\.getTime\(\)\)\)\)\s*\{\s*return \{active:true/,
    "malformed cooldown timestamps must actively block orchestration");
});

test("every direct Gemini caller explicitly blocks a missing provider-state row", async () => {
  const cases = [
    ["../supabase/functions/generate-chapter/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/revise-chapter/index.ts", "error", "data"],
    ["../supabase/functions/continuity-review/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/originality-review/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/safety-review/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/character-continuity/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/world-continuity/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/arc-planner/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/blueprint-planner/index.ts", "providerStateError", "providerState"],
    ["../supabase/functions/story-dna-planner/index.ts", "providerStateError", "providerState"],
  ];

  for (const [path, errorName, rowName] of cases) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    const stateRead = source.indexOf('.from("taleforge_ai_provider_state")');
    assert.ok(stateRead >= 0, `${path}: provider-state query must exist`);
    const guard = source.slice(stateRead, stateRead + 2200);
    const missingRowPattern = new RegExp(`(?:${errorName}\\s*\\|\\|\\s*!\\s*${rowName}|!\\s*${rowName}\\s*\\|\\|\\s*${errorName})`);
    assert.match(guard, missingRowPattern,
      `${path}: missing provider-state rows must fail closed, not be interpreted as no cooldown`);
  }
});

test("generate-chapter quality-review path independently guards Gemini after deterministic validation", async () => {
  const source = await readFile(new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url), "utf8");
  const qualityProviderGuard = source.indexOf("const {data:reviewProviderState,error:reviewProviderStateError}");
  const reviewPrompt = source.indexOf("const reviewPrompt=", qualityProviderGuard);
  const modelCall = source.indexOf("ai=parseJson(await gemini(gkey,reviewPrompt,true))", reviewPrompt);
  const deterministicIssueBranch = source.indexOf("if(issues.length)", source.indexOf("const hard="));
  const scheduleGate = source.indexOf("const {data:qualitySchedules,error:qualityScheduleError}");
  assert.ok(deterministicIssueBranch >= 0 && qualityProviderGuard > deterministicIssueBranch,
    "deterministic hard-validation failures must be recorded without requiring Gemini availability");
  assert.ok(scheduleGate > deterministicIssueBranch && qualityProviderGuard > scheduleGate,
    "quality-review provider state must be checked after automation-readiness verification");
  assert.ok(reviewPrompt > qualityProviderGuard && modelCall > reviewPrompt,
    "quality-review provider-state validation must precede its Gemini call");
  const guard = source.slice(qualityProviderGuard, reviewPrompt);
  assert.match(guard, /reviewProviderStateError\s*\|\|\s*!reviewProviderState/,
    "missing provider state or lookup errors must block quality-review model calls");
  assert.match(guard, /Number\.isSafeInteger\(reviewProviderState\.consecutive_throttle_count\)/,
    "unsafe throttle counters must fail closed");
  assert.match(guard, /!Number\.isFinite\(new Date\(reviewProviderState\.cooldown_until\)\.getTime\(\)\)/,
    "invalid cooldown timestamps must fail closed");
  assert.match(guard, /reason:"provider_cooldown"/,
    "active cooldown must block AI quality review");
  assert.match(guard, /reason:"provider_state_unavailable"/,
    "unavailable provider state must return a stable fail-closed reason");
});

test("generate-chapter quality-review commits are atomic and fenced against concurrent output finalization", async () => {
  const source = await readFile(new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url), "utf8");
  const deterministicWrite = source.indexOf('p_review_status:"needs_revision"');
  const aiWrite = source.indexOf("p_review_status:decision");
  assert.ok(deterministicWrite >= 0 && aiWrite > deterministicWrite,
    "both deterministic and AI quality outcomes must use the atomic review commit RPC");
  assert.match(source, /db\.rpc\("aevora_commit_quality_review"/,
    "quality review and output status must be committed in one database transaction");
  assert.doesNotMatch(source, /from\("chapter_reviews"\)\.upsert/,
    "separate review upserts could leave a review row for a finalized output");
  assert.match(source, /commit\?\.committed!==true/,
    "a stale/finalized output must be rejected without persisting a review");
  assert.match(source, /score<=100/,
    "an out-of-range score must not pass quality review");
});

test("generation cooldown guard is scoped to generation so deterministic quality validation remains available", async () => {
  const source = await readFile(new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url), "utf8");
  const generationBranch = source.indexOf("if(blueprintId&&!outputId){");
  const generationGuard = source.indexOf('const {data:providerState,error:providerStateError}', generationBranch);
  const generationModelCall = source.indexOf("content=await gemini(gkey,n===1?prompt", generationBranch);
  const qualityBranch = source.indexOf("if(!outputId)return reply");
  const deterministicValidation = source.indexOf("if(issues.length)", qualityBranch);
  const qualityGuard = source.indexOf("const {data:reviewProviderState,error:reviewProviderStateError}", qualityBranch);
  const qualityModelCall = source.indexOf("ai=parseJson(await gemini(gkey,reviewPrompt,true))", qualityGuard);
  assert.ok(generationBranch >= 0 && generationGuard > generationBranch && generationModelCall > generationGuard,
    "generation requests must check provider state before any chapter-generation model call");
  assert.ok(qualityBranch > generationModelCall,
    "generation-only provider guard must not run for output quality-review requests");
  assert.ok(deterministicValidation > qualityBranch && qualityGuard > deterministicValidation && qualityModelCall > qualityGuard,
    "deterministic quality validation must remain available during cooldown while AI review stays guarded");
  assert.equal(source.indexOf('const {data:providerState,error:providerStateError}'), generationGuard,
    "there must not be a global generation provider guard before request-type dispatch");
});
