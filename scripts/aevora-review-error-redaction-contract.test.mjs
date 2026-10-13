/**
 * Review-function error-redaction contracts.
 * Source-level checks only: no Supabase requests or chapter operations.
 * Run with: node --test scripts/aevora-review-error-redaction-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const functions = [
  ["continuity-review", "continuity-v3-redacted-error-details"],
  ["originality-review", "originality-v3-redacted-error-details"],
  ["safety-review", "safety-v3-redacted-error-details"],
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
    assert.equal(/details:\s*\w+Error\.message/.test(source), false);
    assert.equal(/details:\s*error\.message/.test(source), false);
    assert.equal(/details:\s*error instanceof Error[\s\S]{0,100}error\.message/.test(source), false);
  });
}
