import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runner = await readFile(new URL("./test-aevora-trending-state.sh", import.meta.url), "utf8");
const workflow = await readFile(new URL("../.github/workflows/aevora-edge-validation.yml", import.meta.url), "utf8");
const fixture = await readFile(new URL("./aevora-trending-state-fixture.sql", import.meta.url), "utf8");
const assertions = await readFile(new URL("./aevora-trending-state-assertions.sql", import.meta.url), "utf8");

test("trending rehearsal requires an explicit disposable database opt-in", () => {
  assert.ok(runner.includes(': "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"'));
  assert.match(runner, /AEVORA_DISPOSABLE_TRENDING_REHEARSAL/);
  assert.match(runner, /I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(runner, /Refusing to run trending integration rehearsal/);
});

test("trending rehearsal applies the fixture, branch migration, and runtime assertions in order", () => {
  const fixtureAt = runner.indexOf("aevora-trending-state-fixture.sql");
  const migrationAt = runner.indexOf("20261014130000_public_trending_aggregate_rpc.sql");
  const assertionAt = runner.indexOf("aevora-trending-state-assertions.sql");
  assert.ok(fixtureAt >= 0 && migrationAt > fixtureAt && assertionAt > migrationAt);
  assert.match(fixture, /GRANT INSERT ON TABLE public\.reader_events TO anon, authenticated/i);
  assert.doesNotMatch(fixture, /GRANT ALL PRIVILEGES ON TABLE public\.reader_events TO anon, authenticated/i);
  assert.match(assertions, /has_table_privilege\('anon','public\.reader_events','SELECT'\)/i);
  assert.match(assertions, /has_table_privilege\('authenticated','public\.story_intelligence','SELECT'\)/i);
});

test("CI invokes the rehearsal only against its named disposable PostgreSQL database", () => {
  const stepStart = workflow.indexOf("- name: Rehearse trending aggregate state and closed ACLs");
  assert.ok(stepStart >= 0, "workflow must include the trending aggregate rehearsal step");
  const step = workflow.slice(stepStart, stepStart + 1200);
  assert.match(step, /postgresql:\/\/postgres:postgres@localhost:5432\/aevora_trending_test/);
  assert.match(step, /AEVORA_DISPOSABLE_TRENDING_REHEARSAL: I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(step, /CREATE DATABASE aevora_trending_test/);
  assert.match(step, /bash scripts\/test-aevora-trending-state\.sh/);
  assert.doesNotMatch(step, /supabase\.co|production/i);
});
