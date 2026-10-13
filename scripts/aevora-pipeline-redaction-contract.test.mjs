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
  assert.ok(s.includes("generation-orchestrator-v16-redacted-diagnostics"));
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
  assert.ok(s.includes('last_error:providerQuotaFailure?"Gemini quota or rate-limit response":"Generation failure; internal diagnostics withheld"'));
  assert.equal(s.includes("error_message:message.slice(0,1200)"), false);
});

test("Gemini planner and continuity workers redact failures and persist quota cooldowns", async () => {
  const functions = [
    ["arc-planner", "arc-planner-v6-redacted-quota-guard"],
    ["blueprint-planner", "blueprint-planner-v8-redacted-quota-guard"],
    ["character-continuity", "character-continuity-v6-redacted-quota-guard"],
    ["story-dna-planner", "story-dna-planner-v4-redacted-quota-guard"],
    ["world-continuity", "world-continuity-v9-redacted-quota-guard"],
  ];
  for (const [name, version] of functions) {
    const s = await source("supabase/functions/" + name + "/index.ts");
    assert.ok(s.includes(version), name + " version marker missing");
    assert.ok(s.includes("async function recordGeminiQuotaCooldown("), name + " cooldown recorder missing");
    assert.ok(s.includes('last_error: "Gemini quota or rate-limit response"'), name + " stored error is not sanitized");
    assert.equal(s.includes("await resp.text()"), false, name + " must not echo provider error bodies");
    assert.equal(s.includes("error:e instanceof Error?e.message:String(e)"), false, name + " must not return raw exception details");
  }
});
