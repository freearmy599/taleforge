import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scheduler = await readFile("supabase/functions/release-scheduler/index.ts", "utf8");
const publisher = await readFile("supabase/functions/release-publisher/index.ts", "utf8");
const readiness = await readFile("supabase/functions/release-scheduler/readiness.ts", "utf8");

test("scheduler fails closed on a missing readiness marker before publisher invocation", () => {
  assert.match(scheduler, /automationReadinessDisposition\(schedule\.automation_ready_at,dryRun\)/);
  const guard = scheduler.indexOf('if(readinessDisposition!=="ready")');
  const publisherCall = scheduler.indexOf('fetch(url+"\/functions\/v1\/release-publisher"');
  assert.ok(guard >= 0, "scheduler must contain the readiness guard");
  assert.ok(publisherCall > guard, "readiness guard must precede any publisher invocation");
  assert.match(scheduler.slice(guard, publisherCall), /continue;/);
});

test("publisher independently checks non-manual schedule readiness", () => {
  assert.match(publisher, /import \{ isAutomationReady \} from "\.\.\/release-scheduler\/readiness\.ts";/);
  assert.match(publisher, /from\("release_schedules"\)/);
  assert.match(publisher, /automation_ready_at/);
  assert.match(publisher, /AUTOMATION_NOT_READY/);
  const guard = publisher.indexOf("AUTOMATION_NOT_READY");
  const insert = publisher.indexOf('.from("chapters")\n .insert(chapterInsert)');
  assert.ok(guard >= 0, "publisher must reject unready automation");
  assert.ok(insert > guard, "publisher readiness guard must precede chapter insertion");
});

test("readiness marker parser rejects absent and malformed values", () => {
  assert.match(readiness, /typeof value !== "string"/);
  assert.match(readiness, /Number\.isFinite\(timestamp\)/);
});
