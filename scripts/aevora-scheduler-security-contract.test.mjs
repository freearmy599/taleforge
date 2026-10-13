/**
 * Scheduler response-redaction contracts.
 * Source-only checks: no Supabase calls, generation, or publication.
 * Run with: node --test scripts/aevora-scheduler-security-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../supabase/functions/release-scheduler/index.ts", import.meta.url),
  "utf8",
);

test("scheduler version records diagnostic redaction", () => {
  assert.match(source, /release-scheduler-v15-redacted-diagnostics/);
});

test("scheduler exception helper never returns provider or database exception text", () => {
  assert.match(source, /function message\(_e: unknown\)\{ return "Internal scheduler diagnostics were withheld\."; \}/);
  assert.doesNotMatch(source, /function message\([^)]*\)\s*\{\s*return\s+e instanceof Error\s*\?\s*e\.message/);
});

test("publisher response body is not echoed into scheduler result payloads", () => {
  assert.match(source, /details:"Publisher response body was withheld\."/);
  assert.doesNotMatch(source, /details:\s*d\s*[,}]/);
});

test("scheduler keeps lease ownership and publication confirmation checks", () => {
  assert.match(source, /aevora_claim_release_scheduler_lease/);
  assert.match(source, /aevora_renew_release_scheduler_lease/);
  assert.match(source, /aevora_release_scheduler_lease/);
  assert.match(source, /aevora_advance_release_schedule_if_lease_owned/);
  assert.match(source, /d\.success===true && d\.published===true/);
  assert.match(source, /confirmedChapter\.status!=="published"/);
});
