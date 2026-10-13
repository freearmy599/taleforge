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

test("generation orchestrator sanitizes downstream failures and provider diagnostics", async () => {
  const s = await source("supabase/functions/generation-orchestrator/index.ts");
  assert.ok(s.includes("generation-orchestrator-v19-deterministic-revision-order"));
  assert.ok((s.match(/\.order\("created_at",\{ascending:false\}\)\.order\("generation_attempt",\{ascending:false\}\)\.order\("id",\{ascending:false\}\)/g) || []).length === 3, "all latest-output lookups must deterministically break revision timestamp ties");
  assert.ok(s.includes('function errorMessage(_error:unknown){return "Internal orchestration diagnostics were withheld."}'));
  assert.ok(s.includes("if(!r.ok||d?.success===false){const safe:any="));
  assert.ok(s.includes('last_error:"Gemini quota or rate-limit response"'));
  assert.equal(s.includes("if(!r.ok){const safe:any="), false);
});

test("chapter generation does not return raw governance or database exception details", async () => {
  const s = await source("supabase/functions/generate-chapter/index.ts");
  assert.ok(s.includes("governance:{authorized:governance.data?.authorized===true}"));
  assert.ok(s.includes('details:governance.error?"Internal governance diagnostics were withheld.":null'));
  assert.ok(s.includes('if(contextError||!contextResult?.context)return reply({success:false,error:"Generation context could not be verified."},500);'));
  assert.ok(s.includes('error:providerQuotaFailure?"Gemini quota or rate limit was reached; retry after provider cooldown.":"Generation request failed; internal diagnostics were withheld."'));
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
    ["arc-planner", "arc-planner-v8-aevora-brand"],
    ["blueprint-planner", "blueprint-planner-v10-aevora-brand"],
    ["character-continuity", "character-continuity-v7-aevora-brand"],
    ["story-dna-planner", "story-dna-planner-v6-aevora-brand"],
    ["world-continuity", "world-continuity-v10-aevora-brand"],
  ];
  for (const [name, version] of functions) {
    const s = await source("supabase/functions/" + name + "/index.ts");
    assert.ok(s.includes(version), name + " version marker missing");
    assert.ok(s.includes("async function recordGeminiQuotaCooldown("), name + " cooldown recorder missing");
    assert.ok(s.includes('last_error: "Gemini quota or rate-limit response"'), name + " stored error is not sanitized");
    assert.ok(s.includes('.select("cooldown_until,consecutive_throttle_count")'), name + " must read the existing cooldown before updating it");
    assert.ok(s.includes("Math.max(proposedUntil, Number.isFinite(existingUntil) ? existingUntil : 0)"), name + " must never shorten an existing cooldown");
    assert.equal(s.includes("await resp.text()"), false, name + " must not echo provider error bodies");
    assert.equal(s.includes("error:e instanceof Error?e.message:String(e)"), false, name + " must not return raw exception details");
    assert.ok(s.includes("reason:quotaFailure?\"provider_quota_blocked\""), name + " must preserve a safe quota reason");
    if (["arc-planner", "blueprint-planner", "story-dna-planner"].includes(name)) assert.ok(s.includes("invalid_cooldown_timestamp"), name + " must fail closed on malformed cooldown state");
  }
});

test("chapter-generation quota handling never shortens an existing Gemini cooldown", async () => {
  const s = await source("supabase/functions/generate-chapter/index.ts");
  assert.ok(s.includes('select("cooldown_until,consecutive_throttle_count")'));
  assert.ok(s.includes('if(stateError){'));
  assert.ok(s.includes('const until=new Date(Math.max(proposedUntil,Number.isFinite(existingUntil)?existingUntil:0)).toISOString()'));
  assert.ok(s.includes('last_error:"Gemini quota or rate-limit response"'));
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
