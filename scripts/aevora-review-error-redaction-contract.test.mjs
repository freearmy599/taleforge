/**
 * Review-function error-redaction contracts.
 * Source-level checks only: no Supabase requests or chapter operations.
 * Run with: node --test scripts/aevora-review-error-redaction-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const functions = [
  ["continuity-review", "continuity-v9-redacted-provider-state"],
  ["originality-review", "originality-v9-redacted-provider-state"],
  ["safety-review", "safety-v9-redacted-provider-state"],
  ["publication-review", "publication-v2-redacted-error-details"],
];

for (const [name, version] of functions) {
  const source = await readFile(
    new URL("../supabase/functions/" + name + "/index.ts", import.meta.url),
    "utf8",
  );

  test(name + " redacts database and provider exception details", () => {
    assert.ok(source.includes(version), "redaction version marker must be present");
    assert.ok(source.includes("Internal review diagnostics were withheld."));
    if (name !== "publication-review") {
      assert.ok(source.includes('console.error("[quota-guard] Gemini provider state unavailable; failing closed.")'), "provider-state lookup logs must be sanitized");
      assert.equal(source.includes("providerStateError?.message"), false, "database exception details must not enter review-worker logs");
    }
    assert.equal(/const errorText = await response.text\(\)/.test(source), false);
    assert.equal(/Gemini request failed \(\$\{response.status\}\): \$\{errorText\}/.test(source), false);
    assert.equal(/details:\s*\w+Error\.message/.test(source), false);
    assert.equal(/details:\s*error\.message/.test(source), false);
    assert.equal(/details:\s*error instanceof Error[\s\S]{0,100}error\.message/.test(source), false);
    if (name !== "publication-review") {
      assert.ok(source.includes('const providerOverloaded = providerMessage.includes("Gemini HTTP 503")'), "temporary provider overload must be classified safely");
      assert.ok(source.includes('reason: quotaFailure ? "provider_quota_blocked" : providerOverloaded ? "provider_temporarily_unavailable" : "review_failed"'), "review errors must expose a stable safe retry reason");
      assert.ok(source.includes('quotaFailure ? 429 : providerOverloaded ? 503 : 502'), "review endpoint must preserve provider retry status");
    }
    if (name !== "publication-review") {
      assert.ok(source.includes("async function recordGeminiQuotaCooldown("), "quota cooldown recorder must exist");
      assert.ok(source.includes("await recordGeminiQuotaCooldown(supabase, error);"), "provider failures must record quota cooldown");
      assert.ok(source.includes('last_error: isTemporaryOverload ? "Gemini temporary overload response" : "Gemini HTTP 429 RESOURCE_EXHAUSTED"'), "stored provider diagnostics must be sanitized");
      assert.ok(source.includes('const isTemporaryOverload = message.includes("Gemini HTTP 503")'), "temporary overloads must persist cooldowns");
      assert.ok(source.includes("const cooldownHours = isTemporaryOverload ? 1 :"), "temporary overload cooldown must be shorter than quota cooldown");
      assert.ok(source.includes('.upsert({'), "provider cooldown state must be persisted");
      assert.ok(source.includes("if (stateError || !data)"), "cooldown persistence must fail closed if prior state is unavailable");
      assert.ok(source.includes('.select("cooldown_until,consecutive_throttle_count")'), "cooldown recorder must read the existing expiry");
      assert.ok(source.includes("Math.max(proposedUntil, existingUntil)"), "concurrent quota errors must never shorten an existing cooldown");
      assert.ok(source.includes("Existing Gemini cooldown timestamp is malformed; existing state was preserved."), "malformed existing cooldown must not be overwritten");
      assert.ok(
        source.includes("!Number.isFinite(cooldownTimestamp)") ||
        source.includes("!Number.isFinite(new Date(providerState.cooldown_until).getTime())"),
        "review must reject malformed non-empty cooldown timestamps before calling Gemini",
      );
    }
  });
}

const orchestrator = await readFile(
  new URL("../supabase/functions/review-orchestrator/index.ts", import.meta.url),
  "utf8",
);

const reviseChapter = await readFile(
  new URL("../supabase/functions/revise-chapter/index.ts", import.meta.url),
  "utf8",
);

test("revision rechecks Gemini provider state before every model call", () => {
  assert.ok(reviseChapter.includes("async function getGeminiProviderBlock("));
  assert.ok(reviseChapter.includes('return {reason:"provider_state_unavailable"}'));
  assert.ok(reviseChapter.includes('reason:"invalid_cooldown_timestamp"'));
  assert.ok(reviseChapter.includes('reason:"provider_cooldown"'));
  const primaryCall = reviseChapter.indexOf("rawResponse = await callGemini(");
  const primaryGuard = reviseChapter.lastIndexOf("await getGeminiProviderBlock(supabase)", primaryCall);
  assert.ok(primaryGuard >= 0 && primaryCall - primaryGuard < 1000, "each main revision attempt must recheck provider state immediately before Gemini");
  const continuationCall = reviseChapter.indexOf("continuation = cleanGeminiOutput(await callGemini(");
  const continuationGuard = reviseChapter.lastIndexOf("await getGeminiProviderBlock(supabase)", continuationCall);
  assert.ok(continuationGuard >= 0 && continuationCall - continuationGuard < 1000, "each continuation request must recheck provider state immediately before Gemini");
  assert.ok(reviseChapter.indexOf("if(providerBlock)") > primaryGuard);
  assert.ok(reviseChapter.indexOf("if(continuationProviderBlock)") > continuationGuard);
});

test("review orchestrator blocks all review calls when provider state is unavailable, malformed, or cooling down", () => {
  assert.ok(orchestrator.includes('const VERSION = "review-orchestrator-v5-stop-on-provider-throttle"'));
  assert.ok(orchestrator.includes('.from("taleforge_ai_provider_state")'));
  assert.ok(orchestrator.includes('if (providerStateError || !providerState)'));
  assert.ok(orchestrator.includes('reason: "provider_state_unavailable"'));
  assert.ok(orchestrator.includes('new Date(providerState.cooldown_until).getTime()'));
  assert.ok(orchestrator.includes('reason: "provider_cooldown"'));
  assert.ok(orchestrator.includes('reason: "provider_state_unavailable"'));
  assert.ok(orchestrator.includes("no review model calls were made"));
  assert.ok(orchestrator.includes("no review model calls were made."));
  const guardStart = orchestrator.indexOf('.from("taleforge_ai_provider_state")');
  const requestParse = orchestrator.indexOf("let body: unknown;");
  const reviewCalls = orchestrator.indexOf("for (const output of outputs ?? [])");
  assert.ok(guardStart >= 0 && requestParse > guardStart && reviewCalls > requestParse,
    "provider-state and cooldown gates must run before request processing and review orchestration");
  assert.ok(orchestrator.includes("if (providerThrottleObserved)"),
    "a provider throttle observed mid-run must stop further review model calls");
  const throttleGuard = orchestrator.indexOf("if (providerThrottleResponse)");
  const throttleStop = orchestrator.indexOf("providerThrottleObserved = true;", throttleGuard);
  const throttleBreak = orchestrator.indexOf("break;", throttleStop);
  const genericFailure = orchestrator.indexOf("if (!call.ok)", throttleGuard);
  assert.ok(throttleGuard >= 0 && throttleStop > throttleGuard && throttleBreak > throttleStop && genericFailure > throttleBreak,
    "provider-throttle signals must stop remaining review steps for the current output before generic HTTP handling");
  assert.ok(orchestrator.slice(throttleGuard, genericFailure).includes("blocked = true"),
    "current output must be marked blocked when a provider throttle is observed");

});
