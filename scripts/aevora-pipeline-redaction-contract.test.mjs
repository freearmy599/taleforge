/**
 * Cross-pipeline response redaction contracts.
 * Static source checks only; does not call Supabase or trigger AI work.
 * Run with: node --test scripts/aevora-pipeline-redaction-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("semantic continuity extraction withholds downstream response bodies and errors", async () => {
  const s = await source("supabase/functions/semantic-continuity-extraction/index.ts");
  assert.ok(s.includes("semantic-continuity-extraction-v7-redacted-downstream-errors"));
  assert.ok(s.includes('error:"Continuity extraction failed; internal diagnostics were withheld."'));
  assert.ok(s.includes('const message="Continuity extraction failed; internal diagnostics were withheld."'));
  assert.equal(s.includes("data={raw:t}"), false);
  assert.equal(s.includes('throw new Error(name+" failed: "+t.slice(0,1200))'), false);
});

test("semantic continuity dry-run returns before queue-claim mutation", async () => {
  const s = await source("supabase/functions/semantic-continuity-extraction/index.ts");
  const dryRunReturn = s.indexOf('if(!execute) return new Response(JSON.stringify({success:true,version:VERSION,status:"dry_run",queue_mutated:false})');
  const queueClaim = s.indexOf('await db.rpc("taleforge_claim_continuity_queue"');
  assert.ok(dryRunReturn >= 0, "dry-run must explicitly report no queue mutation");
  assert.ok(queueClaim > dryRunReturn, "queue claim must occur only after the dry-run early return");
  assert.ok(s.includes("if(execute){"), "provider-state preflight must only gate execute mode");
});

test("generation orchestrator sanitizes downstream failures and provider diagnostics", async () => {
  const s = await source("supabase/functions/generation-orchestrator/index.ts");
  assert.ok(s.includes("generation-orchestrator-v21-retryable-provider-overload"));
  assert.ok((s.match(/\.order\("created_at",\{ascending:false\}\)\.order\("generation_attempt",\{ascending:false\}\)\.order\("id",\{ascending:false\}\)/g) || []).length === 3, "all latest-output lookups must deterministically break revision timestamp ties");
  assert.ok(s.includes('function errorMessage(_error:unknown){return "Internal orchestration diagnostics were withheld."}'));
  assert.ok(s.includes("if(!r.ok||d?.success===false){const safe:any="));
  assert.ok(s.includes('const providerTemporarilyUnavailable=g.status===503'), "temporary provider outages must be recognized as retryable");
  assert.ok(s.includes('action:providerQuotaBlocked?"provider_quota_blocked":"provider_temporarily_unavailable"'), "temporary provider outages must return claimed blueprints to ready instead of rejecting them");
  assert.ok(s.includes('const lastError=providerQuotaFailure?"Gemini quota or rate-limit response":"Gemini temporary overload response"'));
  assert.ok(s.includes('.select("cooldown_until,consecutive_throttle_count")'), "orchestrator quota recorder must read the existing cooldown");
  assert.ok(s.includes("Math.max(proposedUntil,existingUntil)"), "orchestrator quota recorder must not shorten an existing cooldown");
  assert.ok(s.includes("if(stateError||!data)"), "orchestrator cooldown persistence must fail closed when state is unavailable");
  assert.ok(s.includes("Existing Gemini cooldown timestamp is malformed; existing state was preserved."), "malformed cooldown state must not be overwritten");
  assert.ok(s.includes("if(existingUntil>Date.now()) return"), "fallback recorder must not double-count a cooldown already persisted by a downstream worker");
  assert.ok(s.includes('await recordGeminiThrottle(supabase,revisionQuotaBlocked?"Gemini HTTP 429":"Gemini HTTP 503")'), "revision provider failures must invoke the orchestration cooldown fallback");
  assert.ok(s.includes('await recordGeminiThrottle(supabase,providerQuotaBlocked?"Gemini HTTP 429":"Gemini HTTP 503")'), "generation provider failures must invoke the orchestration cooldown fallback");
  assert.ok(s.includes('g.data?.reason==="provider_temporarily_unavailable"'), "provider-state lookup failures must not be mislabeled as Gemini overloads");
  assert.equal(s.includes("if(!r.ok){const safe:any="), false);
});

test("chapter generation does not return raw governance or database exception details", async () => {
  const s = await source("supabase/functions/generate-chapter/index.ts");
  assert.ok(s.includes("governance:{authorized:governance.data?.authorized===true}"));
  assert.ok(s.includes('details:governance.error?"Internal governance diagnostics were withheld.":null'));
  assert.ok(s.includes('if(contextError||!contextResult?.context)return reply({success:false,error:"Generation context could not be verified."},500);'));
  assert.ok(s.includes('const failureMessage=providerQuotaFailure?"Gemini quota or rate limit was reached; retry after provider cooldown.":providerTemporaryFailure?"Gemini is temporarily unavailable; retry after provider cooldown.":"Generation request failed; internal diagnostics were withheld."'));
  assert.equal(s.includes("error_message:message.slice(0,1200)"), false);
  assert.ok(s.indexOf('isTrustedInternalApiKey(req.headers.get("apikey")') < s.indexOf("const body=await req.json()"), "caller authentication must precede request-body parsing");
  assert.ok(s.indexOf("const body=await req.json()") < s.indexOf("db=createClient(url,key"), "request parsing must precede privileged client creation only after authentication");
  assert.ok(s.includes("AI quality review was blocked."), "quality-review Gemini path must fail closed when provider state is unavailable");
  assert.ok(s.includes("reason:\"provider_cooldown\""), "quality-review Gemini path must honor active cooldown");
  assert.ok(s.includes("reviewProviderStateError||!reviewProviderState"), "quality-review provider-state lookup must fail closed");
  assert.ok(s.includes("reviewProviderState.cooldown_until && !Number.isFinite(new Date(reviewProviderState.cooldown_until).getTime())"), "quality-review must reject malformed cooldown timestamps");
});

test("Gemini planner and continuity workers redact failures and persist quota cooldowns", async () => {
  const functions = [
    ["arc-planner", "arc-planner-v10-fail-closed-cooldown-state"],
    ["blueprint-planner", "blueprint-planner-v12-fail-closed-cooldown-state"],
    ["character-continuity", "character-continuity-v9-fail-closed-cooldown-state"],
    ["story-dna-planner", "story-dna-planner-v8-fail-closed-cooldown-state"],
    ["world-continuity", "world-continuity-v12-fail-closed-cooldown-state"],
  ];
  for (const [name, version] of functions) {
    const s = await source("supabase/functions/" + name + "/index.ts");
    assert.ok(s.includes(version), name + " version marker missing");
    assert.ok(s.includes("async function recordGeminiQuotaCooldown("), name + " cooldown recorder missing");
    assert.ok(s.includes('last_error: isTemporaryOverload ? "Gemini temporary overload response" : "Gemini quota or rate-limit response"'), name + " stored provider diagnostics must be sanitized");
    assert.ok(s.includes('const isTemporaryOverload = message.includes("Gemini HTTP 503")'), name + " must persist temporary overloads");
    assert.ok(s.includes("const cooldownHours = isTemporaryOverload ? 1 :"), name + " must use a shorter cooldown for overloads");
    assert.ok(s.includes('.select("cooldown_until,consecutive_throttle_count")'), name + " must read the existing cooldown before updating it");
    assert.ok(s.includes("Math.max(proposedUntil, existingUntil)"), name + " must never shorten an existing cooldown");
    assert.ok(s.includes("Existing Gemini cooldown timestamp is malformed; existing state was preserved."), name + " must preserve malformed existing cooldown state");
    assert.equal(s.includes("await resp.text()"), false, name + " must not echo provider error bodies");
    assert.equal(s.includes("error:e instanceof Error?e.message:String(e)"), false, name + " must not return raw exception details");
    assert.ok(s.includes("reason:quotaFailure?\"provider_quota_blocked\""), name + " must preserve a safe quota reason");
    if (["arc-planner", "blueprint-planner", "story-dna-planner"].includes(name)) assert.ok(s.includes("invalid_cooldown_timestamp"), name + " must fail closed on malformed cooldown state");
  }
});

test("chapter-generation quota handling never shortens an existing Gemini cooldown", async () => {
  const s = await source("supabase/functions/generate-chapter/index.ts");
  assert.ok(s.includes('const QUALITY_VERSION="quality-v8-short-overload-cooldown"'));
  assert.ok(s.includes('const providerTemporaryFailure=message.includes("Gemini HTTP 503")'));
  assert.ok(s.includes('const providerCooldownFailure=providerQuotaFailure||providerTemporaryFailure'));
  assert.ok(s.includes('reason:failureReason,error:failureMessage},providerQuotaFailure?429:providerTemporaryFailure?503:500'));
  assert.ok(s.includes("existing Gemini cooldown timestamp is malformed; existing state preserved."));
  assert.ok(s.includes('select("cooldown_until,consecutive_throttle_count")'));
  assert.ok(s.includes('if(stateError||!data){'));
  assert.ok(s.includes('const until=new Date(Math.max(proposedUntil,existingUntil)).toISOString()'));
  assert.ok(s.includes('const lastError=providerQuotaFailure?"Gemini quota or rate-limit response":"Gemini temporary overload response"'));
  assert.ok(s.includes('failed to record Gemini cooldown; provider remains blocked for this request.'));
  assert.equal(s.includes('console.error("[generate-chapter] failed to record Gemini cooldown",cooldownError.message)'), false);
  assert.equal(s.includes('console.error("[generate-chapter] cooldown recording exception",String(cooldownException))'), false);
});

test("core narrative prompts use the Aevora brand", async () => {
  const promptWorkers = [
    "arc-planner",
    "blueprint-planner",
    "character-continuity",
    "continuity-review",
    "originality-review",
    "safety-review",
    "story-dna-planner",
    "world-continuity",
    "revise-chapter",
    "generate-chapter",
  ];
  for (const name of promptWorkers) {
    const worker = await source("supabase/functions/" + name + "/index.ts");
    assert.equal(worker.includes("TaleForge"), false, name + " must not use the retired product brand in prompts or messages");
    assert.ok(worker.includes("Aevora"), name + " should identify the current product brand");
  }
});

test("chapter generator fences blueprint status writes and reports reconciliation", async () => {
  const s = await source("supabase/functions/generate-chapter/index.ts");
  assert.ok(s.includes('.eq("id",b.id).eq("generation_status","generating").select("id").maybeSingle()'),
    "successful generation must not overwrite a blueprint whose claim has changed");
  assert.ok(s.includes('const{error:rejectStatusError}=await db.from("chapter_blueprints").update({generation_status:"rejected",updated_at:new Date().toISOString()}).eq("id",b.id).eq("generation_status","generating")'),
    "failed output insertion must only reject the blueprint still claimed by this generation");
  assert.ok(s.includes("blueprint_status_synced:blueprintStatusSynced"));
  assert.ok(s.includes("Chapter output was saved, but blueprint status needs safe reconciliation."));
});


test("chapter revision is authenticated, quota-guarded, and state-fenced", async () => {
  const s = await source("supabase/functions/revise-chapter/index.ts");
  assert.ok(s.includes('revision-v18-null-safe-attempt-state'), "revision version marker must be present");
  const auth = s.indexOf('isTrustedInternalApiKey(req.headers.get("apikey")');
  const body = s.indexOf("body = await req.json()");
  const governance = s.indexOf('supabase.rpc("taleforge_ceo_execution_gate"');
  const modelCall = s.indexOf("rawResponse = await callGemini");
  assert.ok(auth >= 0 && auth < body, "caller authentication must precede request-body parsing");
  assert.ok(body < governance && governance < modelCall, "governance must authorize the revision before any Gemini call");
  assert.ok(s.includes('.select("cooldown_until,consecutive_throttle_count")'), "revision must load shared Gemini provider state");
  assert.ok(s.includes('reason: "provider_state_unavailable"'), "revision must fail closed when provider state cannot be read");
  assert.ok(s.includes('reason: "invalid_cooldown_timestamp"'), "revision must fail closed on malformed cooldown timestamps");
  assert.ok(s.includes('reason: "provider_cooldown"'), "revision must respect an active Gemini cooldown");
  assert.ok(s.includes("Math.max(proposedUntil, existingUntil)"), "revision quota recorder must not shorten an existing cooldown");
  assert.ok(s.includes('last_error: "Gemini quota, rate-limit, or temporary overload response"'), "revision must store only sanitized provider diagnostics");
  assert.ok(s.includes('reason: quotaBlocked ? "provider_quota_blocked" : "provider_temporarily_unavailable"'), "revision must distinguish quota blocks from temporary provider overloads");
  assert.ok(s.includes('message.includes("Gemini HTTP 503")'), "temporary Gemini overloads must trigger cooldown persistence");
  assert.ok(s.includes('reason: quotaBlocked ? "provider_quota_blocked" : "provider_temporarily_unavailable"'), "revision quota and overload failures must have stable safe reasons");
  assert.ok(s.includes('if (originalOutput.generation_status !== "needs_revision")'), "only outputs in needs_revision state may be revised");
  assert.ok(s.includes("sourceAttempt >= MAX_REVISION_ATTEMPTS"), "revision worker must enforce the attempt limit even when called directly");
  assert.ok(s.includes('reason: "revision_attempt_limit_reached"'), "exhausted outputs must not spend more provider quota");
  assert.ok(s.includes(".eq(\"revision_of_output_id\", outputId)"), "revision must check for an existing successor");
  assert.ok(s.includes("revision_of_output_id:\noutputId"), "new revision must link to its predecessor");
  assert.ok(s.includes('.eq("id", outputId)\n.eq("generation_status", "needs_revision")'), "source transition must be fenced by its expected status");
  assert.ok(s.includes('error: "Revision failed; internal diagnostics were withheld."'), "unexpected failures must not expose raw exception details");
  assert.ok(s.includes('reviewHandoff.result = { success: parsedHandoff?.success === true }'), "review handoff must not return downstream response bodies");
  assert.equal(s.includes('throw new Error(`Gemini HTTP ${response.status}: ${responseText}`)'), false, "provider response bodies must not enter thrown errors");
  assert.ok(s.includes('words.\\n\\nCURRENT CHAPTER:\\n'), "continuation prompts must contain proper line-break escapes");
  assert.ok(s.includes('revisedContent.trim() + "\\n\\n" + continuation.trim()'), "continuation prose must be joined with actual newlines, not literal backslash sequences");
});
