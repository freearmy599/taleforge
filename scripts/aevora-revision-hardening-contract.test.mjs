/**
 * Aevora revision-worker hardening contracts.
 * Static source checks only; this does not call Supabase, invoke Gemini, or run migrations.
 * Run with: node --test scripts/aevora-revision-hardening-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("revision worker fails closed when Gemini cooldown state cannot be verified", async () => {
  const s = await source("supabase/functions/revise-chapter/index.ts");
  assert.ok(s.includes('const REVISION_VERSION = "revision-v15-temporary-provider-cooldown";'));
  assert.ok(s.includes('.select("cooldown_until,consecutive_throttle_count")'));
  assert.ok(s.includes("providerStateResult.error || !providerStateResult.data"));
  assert.ok(s.includes('reason: "provider_state_unavailable"'));
  assert.ok(s.includes('reason: "invalid_cooldown_timestamp"'));
  assert.ok(s.includes('reason: "provider_cooldown"'));
  assert.ok(s.includes("no model call was made."));
});

test("revision worker records monotonic cooldowns for Gemini quota errors and temporary overloads", async () => {
  const s = await source("supabase/functions/revise-chapter/index.ts");
  assert.ok(s.includes('!message.includes("Gemini HTTP 503")'), "503 overloads must enter cooldown persistence");
  assert.ok(s.includes('!message.includes("Gemini HTTP 429")'));
  assert.ok(s.includes('!message.includes("RESOURCE_EXHAUSTED")'));
  assert.ok(s.includes("Math.max(proposedUntil, existingUntil)"), "a concurrent failure must not shorten a longer cooldown");
  assert.ok(s.includes("Existing Gemini cooldown timestamp is malformed; existing state was preserved."));
  assert.ok(s.includes('last_error: "Gemini quota, rate-limit, or temporary overload response"'));
  assert.equal(s.includes('throw new Error(`Gemini HTTP ${response.status}: ${responseText}`)'), false);
  assert.equal(s.includes('throw new Error(`Gemini HTTP ${response.status}: ${raw}`)'), false);
  assert.equal(s.split('reason: quotaBlocked ? "provider_quota_blocked" : "provider_temporarily_unavailable"').length - 1, 2,
    "both initial revision and continuation calls must handle quota and overload responses");
});

test("revision source and successor checks prevent revisioning arbitrary or already-revised outputs", async () => {
  const s = await source("supabase/functions/revise-chapter/index.ts");
  assert.ok(s.includes('originalOutput.generation_status !== "needs_revision"'));
  assert.ok(s.includes('.eq("revision_of_output_id", outputId)'));
  assert.ok(s.includes('reason: "revision_successor_already_exists"'));
  assert.ok(s.includes('revision_of_output_id:\noutputId'));
  assert.ok(s.includes('generation_status:\n"generated"'));
});

test("revision successor migration protects one non-rejected successor and preserves published conflicts for manual review", async () => {
  const s = await source("supabase/migrations/20261013140000_aevora_revision_successor_idempotency.sql");
  assert.ok(s.includes("HAVING count(*) > 1"));
  assert.ok(s.includes("Multiple published revision successors exist; reconcile them manually before applying the unique index"));
  assert.ok(s.includes("CREATE UNIQUE INDEX IF NOT EXISTS chapter_generation_outputs_revision_successor_unique"));
  assert.ok(s.includes("AND generation_status <> 'rejected'"));
});

test("generation orchestrator still routes revision work through revise-chapter", async () => {
  const s = await source("supabase/functions/generation-orchestrator/index.ts");
  assert.ok(s.includes('"revise-chapter"'));
  assert.ok(s.includes("revision_required"));
  assert.ok(s.includes("revision_of_output_id"));
});
