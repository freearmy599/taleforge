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
  assert.ok(s.includes("revision-v12-redacted-fail-closed-cooldown"));
  assert.ok(s.includes('import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";'));
  assert.ok(s.includes('isTrustedInternalApiKey(req.headers.get("apikey"), serviceRoleKey'));
  assert.ok(s.includes('Caller must authenticate with a configured server-side Supabase API key.'));
  assert.ok(s.includes('Request body must be valid JSON.'));
  assert.ok(s.includes('success: false,\n\nmode:\n"chapter-revision",\n\nstatus:\n"revision_failed_validation"'));
  assert.ok(s.includes('failed deterministic validation.",\n}, 422);'));
  assert.equal(s.includes("`Gemini API error ${response.status}: ${responseText}`"), false);
  assert.ok(s.includes("`Gemini HTTP ${response.status}${response.status === 429 ? \" RESOURCE_EXHAUSTED\" : \"\"}`"));
  assert.ok(s.includes('last_error: "Gemini quota or rate-limit response"'));
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
  assert.ok(s.includes('reason: "provider_quota_blocked"'));
  assert.ok(s.includes("revision_of_output_id:"));
  assert.ok(s.includes("revised_output_id:"));
  assert.ok(s.includes("review_handoff: reviewHandoff"));
  assert.ok(s.includes("SELECTED REVISION STRATEGY CONTEXT:\\n${strategyContext}"), "selected revision strategy must reach the actual model prompt");
  assert.ok(o.includes('"revise-chapter"'));
  assert.ok(o.includes("revision_strategy"));
  assert.ok(o.includes("revision_priority"));
  assert.ok(o.includes("revision_targets"));
});
