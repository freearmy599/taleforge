/**
 * Static publisher security and idempotency contracts.
 *
 * These tests inspect source only; they never call Supabase or publish data.
 * Run with: node --test scripts/aevora-publisher-security-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const publisher = await readFile(
  new URL("../supabase/functions/release-publisher/index.ts", import.meta.url),
  "utf8",
);

const idempotency = await readFile(
  new URL("../supabase/functions/release-publisher/publisher-idempotency.ts", import.meta.url),
  "utf8",
);

test("publisher idempotency requires a matching, actually published chapter", () => {
  const match = idempotency.match(/export function matchesPublishedOutput\([\s\S]*?\n\}/);
  assert.ok(match, "published-output predicate must be present");
  const helperSource = match[0].replace("export function", "function").replaceAll(": any", "").replaceAll(": boolean", "");
  const matchesPublishedOutput = runInNewContext(`${helperSource}; matchesPublishedOutput`);
  const chapter = { status: "published", series_id: "series-1", chapter_number: 7, title: "A Turning Point", content: "The door opened." };
  const output = { series_id: "series-1", chapter_number: 7, title: "A Turning Point", content: "The door opened." };
  assert.equal(matchesPublishedOutput(chapter, output), true);
  assert.equal(matchesPublishedOutput({ ...chapter, status: "draft" }, output), false);
  assert.equal(matchesPublishedOutput({ ...chapter, series_id: "series-2" }, output), false);
  assert.equal(matchesPublishedOutput({ ...chapter, chapter_number: 8 }, output), false);
  assert.equal(matchesPublishedOutput({ ...chapter, content: "Different text." }, output), false);
  assert.equal(matchesPublishedOutput({ ...chapter, title: " " }, output), false);
  assert.equal(matchesPublishedOutput({ ...chapter, chapter_number: Number.MAX_SAFE_INTEGER + 1 }, output), false);
});

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
