/**
 * Internal worker authorization contracts.
 * Static source checks only; does not call Supabase or deploy any function.
 * Run with: node --test scripts/aevora-internal-worker-auth-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workers = [
  "arc-planner",
  "blueprint-planner",
  "character-continuity",
  "continuity-review",
  "generate-chapter",
  "generation-orchestrator",
  "originality-review",
  "post-publication-canon-sync",
  "publication-review",
  "publication-sync-processor",
  "release-publisher",
  "release-scheduler",
  "review-orchestrator",
  "revise-chapter",
  "safety-review",
  "semantic-continuity-extraction",
  "story-dna-planner",
  "world-continuity",
];

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("every privileged Edge worker authenticates before parsing input or creating clients", async () => {
  for (const name of workers) {
    const s = await source("supabase/functions/" + name + "/index.ts");
    const serve = s.indexOf("Deno.serve");
    assert.ok(serve >= 0, name + " must expose an Edge handler");
    const handler = s.slice(serve);
    const guard = handler.indexOf("isTrustedInternalApiKey(");
    assert.ok(guard >= 0, name + " must call the shared internal API-key guard");
    const bodyParse = handler.search(/(?:await\s+)?(?:req|request)\.json\s*\(/);
    if (bodyParse >= 0) {
      assert.ok(guard < bodyParse, name + " must authenticate before parsing request JSON");
    }
    const clientInit = handler.search(/createClient\s*\(/);
    if (clientInit >= 0) {
      assert.ok(guard < clientInit, name + " must authenticate before creating a privileged database client");
    }
    assert.match(handler, /req\.method\s*!==?\s*["']POST["']/, name + " must reject non-POST requests (apart from CORS preflight)");
  }
});

test("the shared internal API-key allowlist fails closed", async () => {
  const s = await source("supabase/functions/_shared/internal-api-key.ts");
  assert.ok(s.includes("if (!presentedApiKey) return false"));
  assert.ok(s.includes("if (!secretKeysJson || !allowedSecretKeyNamesCsv) return false"));
  assert.ok(s.includes("if (allowedNames.size === 0) return false"));
  assert.ok(s.includes("if (!parsed || typeof parsed !== \"object\" || Array.isArray(parsed)) return false"));
  assert.ok(s.includes("allowedNames.has(name) && typeof value === \"string\""));
  assert.ok(s.includes("return false;"), "malformed secret configuration must never default to trust");
  assert.equal(/allowedNames\.size\s*===\s*0\s*\)\s*return\s*true/.test(s), false);
});
