/**
 * Review-function error-redaction contracts.
 * Source-level checks only: no Supabase requests or chapter operations.
 * Run with: node --test scripts/aevora-review-error-redaction-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const functions = [
  ["continuity-review", "continuity-v4-redacted-provider-errors"],
  ["originality-review", "originality-v4-redacted-provider-errors"],
  ["safety-review", "safety-v4-redacted-provider-errors"],
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
    assert.equal(/const errorText = await response.text\(\)/.test(source), false);
    assert.equal(/Gemini request failed \(\$\{response.status\}\): \$\{errorText\}/.test(source), false);
    assert.equal(/details:\s*\w+Error\.message/.test(source), false);
    assert.equal(/details:\s*error\.message/.test(source), false);
    assert.equal(/details:\s*error instanceof Error[\s\S]{0,100}error\.message/.test(source), false);
    if (name !== "publication-review") {
      assert.ok(source.includes("async function recordGeminiQuotaCooldown("), "quota cooldown recorder must exist");
      assert.ok(source.includes("await recordGeminiQuotaCooldown(supabase, error);"), "provider failures must record quota cooldown");
      assert.ok(source.includes('last_error: "Gemini HTTP 429 RESOURCE_EXHAUSTED"'), "stored provider diagnostics must be sanitized");
      assert.ok(source.includes('.upsert({'), "provider cooldown state must be persisted");
      assert.ok(source.includes("if (stateError || !data)"), "cooldown persistence must fail closed if prior state is unavailable");
      assert.ok(source.includes('.select("cooldown_until,consecutive_throttle_count")'), "cooldown recorder must read the existing expiry");
      assert.ok(source.includes("Math.max(proposedUntil, existingUntil)"), "concurrent quota errors must never shorten an existing cooldown");
      assert.ok(source.includes("Existing Gemini cooldown timestamp is malformed; existing state was preserved."), "malformed existing cooldown must not be overwritten");
    }
  });
}
