/**
 * Static publisher security and idempotency contracts.
 *
 * These tests inspect source only; they never call Supabase or publish data.
 * Run with: node --test scripts/aevora-publisher-security-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("automated publication fails closed until separate audited authorization exists", () => {
  assert.match(publisher, /automationSchedule\.auto_publish === true[\s\S]*?PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED/);
  assert.match(publisher, /Automated publication is disabled until separate publication authorization is implemented/);
  assert.match(publisher, /Generation readiness is deliberately not publication authorization/);
  const guardIndex = publisher.indexOf("PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED");
  const existingChapterCheckIndex = publisher.indexOf(".from(\"chapters\") .select(\"*\")");
  const insertIndex = publisher.indexOf(".from(\"chapters\") .insert(chapterInsert)");
  assert.ok(guardIndex >= 0 && existingChapterCheckIndex > guardIndex,
    "the persisted auto_publish gate must run before existing-chapter/idempotent synchronization paths");
  assert.ok(insertIndex > guardIndex,
    "the persisted auto_publish gate must run before a chapter insert can occur");
  assert.match(publisher, /const automationSchedule = automationSchedules\[0\]/,
    "the gate must be based on the schedule loaded from the database, not a request-body claim");
});

test("publisher distinguishes manual schedules from automated publication authorization", () => {
  assert.match(publisher, /AUTOMATION_SCHEDULE_MISSING_OR_AMBIGUOUS/);
  assert.match(publisher, /AUTOMATION_SCHEDULE_AMBIGUOUS/);
  const manualIndex = publisher.indexOf('if (automationSchedule.schedule_mode === "manual")');
  const automatedGuardIndex = publisher.indexOf("PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED");
  assert.ok(manualIndex >= 0 && automatedGuardIndex > manualIndex,
    "manual-mode validation must remain explicit and separate from the automated-publication lock");
  const manualBranch = publisher.slice(manualIndex, automatedGuardIndex);
  assert.match(manualBranch, /MANUAL_SCHEDULE_AUTOMATION_CONFLICT/,
    "manual schedules must reject automatic flags rather than being treated as automated approvals");
  assert.match(publisher, /automationSchedule.enabled !== true \|\| automationSchedule.auto_publish !== true[\s\S]*?AUTOMATION_NOT_READY/,
    "generation-only readiness must not accidentally authorize automated publication");
});

test("publisher version identifies publication-authorization fail-closed hardening", () => {
  assert.match(publisher, /release-publisher-v11-publication-authorization-fail-closed/);
});


test("generation and scheduling workers cannot bypass the publisher with direct chapter inserts", async () => {
  const guardedPaths = [
    "../supabase/functions/generate-chapter/index.ts",
    "../supabase/functions/release-scheduler/index.ts",
    "../supabase/functions/autonomous-series-creation-runner/index.ts",
    "../supabase/functions/revise-chapter/index.ts",
  ];
  for (const relativePath of guardedPaths) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /\.from\(["']chapters["']\)\s*\.insert\s*\(/,
      `${relativePath} must not insert published chapters outside release-publisher`,
    );
  }
});


test("release-publisher is the only Edge Function that directly inserts chapter rows", async () => {
  const root = new URL("../supabase/functions/", import.meta.url);
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) await collect(child);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(child);
    }
  }
  await collect(root);
  const writers = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\.from\(["']chapters["']\)\s*\.insert\s*\(/.test(source)) {
      writers.push(file.pathname);
    }
  }
  assert.equal(writers.length, 1, `expected exactly one direct chapter insert path, found: ${writers.join(", ")}`);
  assert.match(writers[0], /supabase\/functions\/release-publisher\/index\.ts$/,
    "all chapter-row insertion must remain behind release-publisher authorization and status checks");
});

test("browser-facing source cannot bypass release-publisher with direct chapter inserts", async () => {
  const browserFiles = [
    "../404.html", "../admin.html", "../chapter.html", "../chief-editor.html",
    "../index.html", "../library.html", "../notifications.html", "../series.html",
    "../stories.html", "../story.html", "../taleforge-data.js", "../supabase-client.js",
  ];
  for (const relativePath of browserFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.doesNotMatch(
      source,
      /\.from\(["']chapters["']\)\s*\.insert\s*\(/,
      `${relativePath} must not insert chapter rows directly from browser-facing code`,
    );
  }
});


test("publication lock uses persisted schedule state rather than caller-supplied flags", () => {
  const scheduleQueryStart = publisher.indexOf('.from("release_schedules")');
  const scheduleQueryEnd = publisher.indexOf("const isAutonomousSeries", scheduleQueryStart);
  assert.ok(scheduleQueryStart >= 0 && scheduleQueryEnd > scheduleQueryStart,
    "publisher must load the schedule from the database before evaluating automation flags");
  const query = publisher.slice(scheduleQueryStart, scheduleQueryEnd);
  assert.match(query, /\.select\("id,enabled,auto_generate,auto_publish,schedule_mode,automation_ready_at"\)/);
  assert.match(query, /\.eq\("series_id", output\.series_id\)/);
  assert.doesNotMatch(query, /requestBody|body\.auto_publish|output\.auto_publish/,
    "caller-controlled flags must not replace persisted schedule state");
  const guard = publisher.indexOf("PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED");
  const insert = publisher.indexOf('.from("chapters")');
  assert.ok(guard >= 0 && insert > guard,
    "persisted schedule authorization must be checked before chapter-table operations");
});
