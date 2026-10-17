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
  const authorizationStopIndex = publisher.indexOf("Publication blocked until trusted approval is implemented.");
  assert.ok(manualIndex >= 0 && authorizationStopIndex >= 0 && manualIndex < authorizationStopIndex,
    "manual schedule classification must be followed by the trusted-approval stop");
  const manualBranch = publisher.slice(manualIndex, publisher.indexOf("/* * -------------------------------------------------- * 5. Validate series status"));
  assert.match(manualBranch, /MANUAL_SCHEDULE_AUTOMATION_CONFLICT/,
    "manual schedules must still reject automatic flags rather than being treated as automated approvals");
  assert.match(publisher.slice(Math.max(0, authorizationStopIndex - 700), authorizationStopIndex),
    /not per-chapter human approval/,
    "manual schedule flags must not substitute for approval of the exact output");
  assert.match(publisher, /automationSchedule.enabled !== true \|\| automationSchedule.auto_publish !== true[\s\S]*?AUTOMATION_NOT_READY/,
    "generation-only readiness must not accidentally authorize automated publication");
});

test("publisher version identifies publication-authorization fail-closed hardening", () => {
  assert.match(publisher, /release-publisher-v12-manual-and-automatic-authorization-stop/);
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


test("publisher fails closed when schedule or autonomous-provenance state cannot be read", () => {
  const scheduleError = publisher.indexOf("if (automationScheduleError)");
  const provenanceError = publisher.indexOf("if (autonomousRunError)");
  const authorizationGate = publisher.indexOf("PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED");
  const chapterTableAccess = publisher.indexOf('.from("chapters")');
  assert.ok(scheduleError >= 0 && provenanceError > scheduleError,
    "both persisted schedule and autonomous provenance lookups must have explicit error handling");
  assert.ok(authorizationGate > provenanceError && chapterTableAccess > authorizationGate,
    "state lookup errors must be rejected before the authorization decision and any chapter-table path");
  const scheduleFailure = publisher.slice(scheduleError, provenanceError);
  const provenanceFailure = publisher.slice(provenanceError, authorizationGate);
  assert.match(scheduleFailure, /retryable:\s*true[\s\S]*?Could not verify release automation readiness[\s\S]*?503/);
  assert.match(provenanceFailure, /retryable:\s*true[\s\S]*?Could not verify autonomous-series provenance[\s\S]*?503/);
  assert.match(publisher, /function getErrorMessage\(_error: unknown\): string\s*\{\s*return "Internal publication diagnostics were withheld\.";/,
    "lookup failures must not expose raw database/provider diagnostics");
});


test("publisher requires a trusted internal API key before creating its service-role client", () => {
  assert.match(publisher, /import \{ isTrustedInternalApiKey \} from "\.\.\/\_shared\/internal-api-key\.ts";/);
  const guard = publisher.indexOf("if (!isTrustedInternalApiKey(");
  const client = publisher.indexOf("const supabase = createClient(");
  assert.ok(guard >= 0 && client > guard, "internal caller authentication must precede service-role client creation");
  assert.match(publisher, /Caller must authenticate with a configured server-side Supabase API key/);
  assert.match(publisher, /\}, 401\);/);
});

test("automated-publication stop precedes every publisher mutation and synchronization call", () => {
  const handlerStart = publisher.indexOf("Deno.serve(");
  const guardIndex = publisher.indexOf("PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED", handlerStart);
  assert.ok(handlerStart >= 0 && guardIndex > handlerStart,
    "the authorization stop must be inside the request handler");

  // Ignore helper definitions outside the request handler: these operations
  // execute only when their call sites are reached.
  const handler = publisher.slice(handlerStart);
  const guardOffset = guardIndex - handlerStart;
  const mutationPatterns = [
    /\.from\(["']series["']\)\s*\.update\s*\(/g,
    /\.from\(["']chapter_generation_outputs["']\)\s*\.update\s*\(/g,
    /\.from\(["']chapter_blueprints["']\)\s*\.update\s*\(/g,
    /\.from\(["']chapters["']\)\s*\.insert\s*\(/g,
    /ensureCanonSyncOutboxEvent\(supabase,/g,
  ];
  for (const pattern of mutationPatterns) {
    for (const match of handler.matchAll(pattern)) {
      assert.ok(match.index > guardOffset,
        `publication mutation/synchronization call ${pattern} must remain after the automated-publication stop`);
    }
  }
});

test("publication authorization stop returns an explicit non-success lock response", () => {
  const guard = publisher.indexOf('code: "PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED"');
  assert.ok(guard >= 0, "the stable publication authorization stop must remain present");
  const statementStart = publisher.lastIndexOf("return jsonResponse(", guard);
  const statementEnd = publisher.indexOf(");", guard);
  assert.ok(statementStart >= 0 && statementEnd > guard,
    "authorization stop must return a structured response");
  const response = publisher.slice(statementStart, statementEnd + 2);
  assert.match(response, /success:\s*false/);
  assert.match(response, /code:\s*"PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED"/);
  assert.match(response, /\},\s*423\)/,
    "unimplemented authorization must be reported as a locked operation, not success");
  const chapterAccess = publisher.indexOf('.from("chapters")', guard);
  assert.ok(chapterAccess > statementEnd,
    "the locked response must occur before any chapter-table access");
});


test("release-publisher is the only Edge Function allowed to mutate chapter rows", async () => {
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

  const mutators = [];
  const chapterMutation = /\.from\(["'](?:public\.)?chapters["']\)\s*\.(?:insert|update|upsert|delete)\s*\(/g;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (chapterMutation.test(source)) mutators.push(file.pathname.replaceAll("\\", "/"));
    chapterMutation.lastIndex = 0;
  }
  assert.equal(mutators.length, 1,
    `expected exactly one direct chapter-row mutation path, found: ${mutators.join(", ")}`);
  assert.match(mutators[0], /supabase\/functions\/release-publisher\/index\.ts$/,
    "chapter insert/update/upsert/delete operations must remain behind release-publisher's authorization and status checks");
});
