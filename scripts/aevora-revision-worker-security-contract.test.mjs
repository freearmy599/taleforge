/**
 * Revision-worker security and orchestration contracts.
 * Static source checks only: no Supabase calls, generation, or publication.
 * Run with: node --test scripts/aevora-revision-worker-security-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("revision worker redacts provider, governance, handoff, and exception details", async () => {
  const s = await source("supabase/functions/revise-chapter/index.ts");
  assert.ok(s.includes("revision-v17-enforce-attempt-limit"));
  assert.ok(s.includes('import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";'));
  assert.ok(s.includes('isTrustedInternalApiKey(req.headers.get("apikey"), serviceRoleKey'));
  assert.ok(s.includes('Caller must authenticate with a configured server-side Supabase API key.'));
  assert.ok(s.includes('Request body must be valid JSON.'));
  assert.ok(s.includes('success: false,\n\nmode:\n"chapter-revision",\n\nstatus:\n"revision_failed_validation"'));
  assert.ok(s.includes('failed deterministic validation.",\n}, 422);'));
  assert.ok(s.includes("failedAttemptNumber = Math.min(MAX_REVISION_ATTEMPTS"), "failed revision cycles must advance the existing attempt limit");
  assert.ok(s.includes("sourceAttempt >= MAX_REVISION_ATTEMPTS"), "the endpoint must enforce the attempt limit independently of orchestration");
  assert.ok(s.includes('reason: "revision_attempt_limit_reached"'), "exhausted revision requests must be rejected safely");
  assert.ok(s.includes('originalOutput.generation_attempt === null || originalOutput.generation_attempt === undefined'), "legacy NULL attempt counters must be matched explicitly");
  assert.ok(s.includes('failedAttemptUpdate = failedAttemptUpdate.is("generation_attempt", null)'), "failed revision attempts must advance safely for NULL counters");
  assert.ok(s.includes('failedAttemptUpdate = failedAttemptUpdate.eq("generation_attempt", sourceAttempt)'), "non-NULL attempt counters must retain compare-and-set fencing");
  assert.ok(s.includes('reason: "revision_attempt_state_unavailable"'), "failed attempt bookkeeping errors must fail closed");
  assert.equal(s.includes("`Gemini API error ${response.status}: ${responseText}`"), false);
  assert.ok(s.includes("`Gemini HTTP ${response.status}${response.status === 429 ? \" RESOURCE_EXHAUSTED\" : \"\"}`"));
  assert.ok(s.includes('last_error: "Gemini quota, rate-limit, or temporary overload response"'));
  assert.ok(s.includes('const isTemporaryOverload = message.includes("Gemini HTTP 503")'), "temporary provider overloads must persist a cooldown");
  assert.ok(s.includes("const cooldownHours = isTemporaryOverload ? 1 : Math.min(24, 6 * Math.pow(2, Math.min(count - 1, 2)))"), "temporary overloads must use a shorter cooldown than quota exhaustion");
  assert.equal((s.match(/reason: quotaBlocked \? "provider_quota_blocked" : "provider_temporarily_unavailable"/g) || []).length, 2, "both model calls must distinguish quota blocks from temporary overloads");
  assert.equal(s.includes("last_error:message.slice(0,2000)"), false);
  assert.equal(s.includes("governance:governance.data??null"), false);
  assert.equal(s.includes("details:governance.error?.message??null"), false);
  assert.equal(s.includes("catch { /* retain raw response */ }"), false);
  assert.ok(s.includes("reviewHandoff.result = { success: parsedHandoff?.success === true }"));
  assert.ok(s.includes('error: "Revision failed; internal diagnostics were withheld."'));
  assert.equal(s.includes('error: error?.message ||'), false);
});

test("revision worker fails closed on unavailable or malformed provider cooldown state", async () => {
  const s = await source("supabase/functions/revise-chapter/index.ts");
  assert.ok(s.includes("providerStateResult.error || !providerStateResult.data"));
  assert.ok(s.includes('reason: "provider_state_unavailable"'));
  assert.ok(s.includes('reason: "invalid_cooldown_timestamp"'));
  assert.ok(s.includes("cooldownUntil !== null && cooldownUntil > Date.now()"));
  assert.ok(s.includes('.select("cooldown_until,consecutive_throttle_count")'));
  assert.ok(s.includes("if (stateError || !data)"));
  assert.ok(s.includes("Math.max(proposedUntil, existingUntil)"));
  assert.ok(s.includes("Existing Gemini cooldown timestamp is malformed; existing state was preserved."));
});

test("revision worker records quota cooldowns and preserves orchestrator output contract", async () => {
  const s = await source("supabase/functions/revise-chapter/index.ts");
  const o = await source("supabase/functions/generation-orchestrator/index.ts");
  assert.ok(s.includes("recordGeminiThrottle(supabase, providerError)"));
  assert.equal((s.match(/recordGeminiThrottle\(supabase, providerError\)/g) || []).length, 2, "primary and continuation Gemini calls must both persist quota cooldowns");
  assert.ok(s.includes('reason: quotaBlocked ? "provider_quota_blocked" : "provider_temporarily_unavailable"'));
  assert.ok(s.includes('error: quotaBlocked ? "Revision paused because Gemini quota or rate limits were reached." : "Revision paused because Gemini is temporarily unavailable."'));
  assert.ok(s.includes("revision_of_output_id:"));
  assert.ok(s.includes("revised_output_id:"));
  assert.ok(s.includes("review_handoff: reviewHandoff"));
  assert.ok(s.includes('reason: "revision_source_state_invalid"'), "only needs_revision outputs may enter the revision worker");
  assert.ok(s.includes('.eq("revision_of_output_id", outputId)'), "sequential retries must detect an existing successor before spending provider quota");
  assert.ok(s.includes('.neq("generation_status", "rejected")'), "rejected successors must not permanently block retrying the source output");
  assert.ok(s.includes('reason: "revision_successor_already_exists"'), "the worker must reject duplicate revisions of the same source output");
  assert.ok(s.includes('.update({ generation_status: "rejected", updated_at: new Date().toISOString() })\n.eq("id", outputId)\n.eq("generation_status", "needs_revision")'), "successful revision must atomically move its source out of the revision backlog");
  assert.ok(s.includes('currentSource?.generation_status !== "rejected"'), "a concurrent revision winner must be distinguished from unrelated source-state changes");
  assert.ok(s.includes('reason: "revision_source_state_changed"'), "unrelated concurrent state changes must reject the uncommitted successor");
  assert.ok(s.includes('reason: "revision_blueprint_already_published"'), "released blueprints must not be revised");
  assert.ok(s.includes('.eq("generation_status", "needs_revision")\n.select("id")\n.maybeSingle()'), "revision commit must be fenced against concurrent source-state changes");
  assert.ok(!s.includes('.from(\n"chapter_blueprints"\n)\n.update({\ngeneration_status:\n"generated",'), "revision must not unconditionally regress blueprint publication state");
  assert.ok(s.includes("SELECTED REVISION STRATEGY CONTEXT:") && s.includes("${strategyContext}"), "selected revision strategy must reach the actual model prompt");
  assert.ok(o.includes('"revise-chapter"'));
  assert.ok(o.includes("revision_strategy"));
  assert.ok(o.includes("revision_priority"));
  assert.ok(o.includes("revision_targets"));
});

test("generation orchestrator exhausts revision backlog using a database-allowed status", async () => {
  const s = await source("supabase/functions/generation-orchestrator/index.ts");
  assert.ok(s.includes('update({generation_status:"rejected",updated_at:new Date().toISOString()})'));
  assert.ok(s.includes('.gte("generation_attempt",3)'));
  assert.ok(s.includes('action:"revision_exhausted",stored_status:"rejected"'));
  assert.ok(s.includes("revision_exhausted_outputs:revisionExhaustedOutputs"));
  assert.ok(s.includes('action:"would_mark_revision_exhausted",stored_status:o.generation_status'), "dry-run must report exhausted revisions without mutating them");
  assert.ok(s.includes('.from("chapter_blueprints").update({generation_status:"rejected",updated_at:new Date().toISOString()}).eq("id",o.blueprint_id).in("generation_status",["planned","ready","generated","quality_check","approved","rejected"]).neq("release_status","released")'), "exhaustion must release the blueprint for regeneration without overwriting released content");
  assert.ok(s.indexOf("blueprintRejected") < s.indexOf('const{data:exhausted,error:exhaustionError}'), "blueprint state must be reconciled before removing the exhausted output from the backlog");
  assert.ok(s.includes('blueprint_status:"rejected"'), "the result must confirm both output and blueprint terminal states");
  assert.ok(s.includes("if(dryRun){for(const o of exhaustedCandidates)revisionExhaustedOutputs.push"), "dry-run exhaustion reporting must be separate from real state writes");
  assert.equal(s.includes('generation_status:"revision_exhausted"'), false);
});

test("generation orchestrator writes only allowed chapter-blueprint statuses", async () => {
  const s = await source("supabase/functions/generation-orchestrator/index.ts");
  assert.ok(s.includes('.from("chapter_blueprints").update({generation_status:"generated",updated_at:new Date().toISOString()})'));
  assert.equal(s.includes('generation_status:no.generation_status==="needs_revision"?"needs_revision":"generated"'), false);
});

test("generation orchestrator fails visibly when a revision candidate has no actionable strategy", async () => {
  const s = await source("supabase/functions/generation-orchestrator/index.ts");
  assert.ok(s.includes("const unresolvedCandidates=candidates.filter"));
  assert.ok(s.includes('action:"revision_selection_unresolved",blocked:true,retryable:true'));
  assert.ok(s.includes("A needs_revision output had no actionable revision strategy"));
});
