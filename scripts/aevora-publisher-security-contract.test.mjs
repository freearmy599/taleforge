/**
 * Static publisher security and idempotency contracts.
 *
 * These tests inspect source only; they never call Supabase or publish data.
 * Run with: node --test scripts/aevora-publisher-security-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publisher = await readFile(
  new URL("../supabase/functions/release-publisher/index.ts", import.meta.url),
  "utf8",
);

test("publisher exception details are not returned by the shared diagnostic helper", () => {
  assert.match(publisher, /function getErrorMessage\(_error: unknown\): string\s*\{\s*return "Internal publication diagnostics were withheld\.";/);
  assert.doesNotMatch(publisher, /function getErrorMessage\([^)]*\)[\s\S]{0,400}?return\s+(?:error\.message|String\(\s*\(error as)/);
});

test("governance gate response does not expose its raw payload or exception message", () => {
  assert.match(publisher, /governance:\{authorized:governance\.data\?\.authorized===true\}/);
  assert.doesNotMatch(publisher, /governance:governance\.data\?\?null/);
  assert.doesNotMatch(publisher, /details:governance\.error\?\.message/);
});

test("existing chapter is accepted only when it matches the requested published output", () => {
  assert.match(publisher, /if \(!matchesPublishedOutput\(existingChapter, output\)\)/);
  assert.match(publisher, /if \(!matchesPublishedOutput\(racedChapter, output\)\)/);
  assert.match(publisher, /existing_status:\s*existingChapter\.status/);
  assert.match(publisher, /existing_status:\s*racedChapter\.status/);
});

test("publisher rechecks approval immediately before inserting a chapter", () => {
  assert.match(publisher, /currentOutput\.generation_status !== "approved"/);
  assert.match(publisher, /currentReview\.decision !== "approved"/);
  assert.match(publisher, /currentBlueprint\.series_id !== output\.series_id/);
});

test("publisher cannot report full success when synchronization is incomplete", () => {
  assert.match(publisher, /success: canonSyncResult\.confirmed && synchronizationWarnings\.length === 0/);
  assert.match(publisher, /success: canonSyncResult\.confirmed && raceSynchronizationWarnings\.length === 0/);
});

test("publisher version identifies diagnostic-redaction hardening", () => {
  assert.match(publisher, /release-publisher-v10-redacted-publication-diagnostics/);
});
