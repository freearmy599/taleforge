import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scheduler = await readFile("supabase/functions/release-scheduler/index.ts", "utf8");
const publisher = await readFile("supabase/functions/release-publisher/index.ts", "utf8");
const readiness = await readFile("supabase/functions/release-scheduler/readiness.ts", "utf8");
const runner = await readFile("supabase/functions/autonomous-series-creation-runner/index.ts", "utf8");
const migration = await readFile("supabase/migrations/20261014210000_release_automation_readiness_gate.sql", "utf8");

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
  const insert = publisher.indexOf("const chapterInsert =");
  assert.ok(guard >= 0, "publisher must reject unready automation");
  assert.ok(insert > guard, "publisher readiness guard must precede chapter insertion");
});

test("readiness marker parser rejects absent and malformed values", () => {
  assert.match(readiness, /typeof value !== "string"/);
  assert.match(readiness, /Number\.isFinite\(timestamp\)/);
});


test("autonomous runner keeps schedule inert until audited bootstrap and atomic readiness succeed", () => {
  const inertWrite = runner.indexOf("enabled: false, schedule_mode: \"interval\"");
  const auditUpdate = runner.indexOf(".update({ pipeline_snapshot:");
  const readinessCall = runner.indexOf('rpc("taleforge_mark_release_automation_ready"');
  assert.ok(inertWrite >= 0, "runner must prepare a disabled schedule");
  assert.ok(auditUpdate > inertWrite, "bootstrap audit must follow the disabled schedule write");
  assert.ok(readinessCall > auditUpdate, "readiness RPC must run only after audit update");
  assert.match(runner.slice(auditUpdate, readinessCall), /if \(auditError\)/);
});

test("runner does not return raw internal exception messages", () => {
  assert.match(runner, /function errText\(_e: unknown\) \{ return "Internal runner diagnostics were withheld\."; \}/);
  assert.doesNotMatch(runner, /function errText\(e: unknown\) \{ return e instanceof Error \? e\.message/);
});

test("database readiness RPC is service-role-only and verifies bootstrap evidence", () => {
  assert.match(migration, /add column if not exists automation_ready_at timestamptz/i);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/i);
  assert.match(migration, /lifecycle_initialized/);
  assert.match(migration, /release_schedule_initialized/);
  assert.match(migration, /automation_ready_at = coalesce\(automation_ready_at, now\(\)\)/);
  assert.match(migration, /revoke all on function public\.taleforge_mark_release_automation_ready\(uuid\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.taleforge_mark_release_automation_ready\(uuid\) to service_role/i);
  assert.match(migration, /p\.policy_key = 'production'[\s\S]*?p\.enabled = true/i);
  assert.match(migration, /story lifecycle must exist before readiness/i);
  assert.match(migration, /release schedule configuration is invalid/i);
  assert.doesNotMatch(migration, /update public\.release_schedules\s+set automation_ready_at\s*=\s*now\(\)\s*;/i,
    "existing schedules must not be blindly backfilled as ready");
});

test("enrollment trigger does not enable an unready schedule", () => {
  assert.match(migration, /values \(\s*new\.id, false, 'interval', 24, 'UTC',[\s\S]*?false, false, null\s*\)/i);
  assert.match(migration, /auto_generate = false,[\s\S]*?auto_publish = false,[\s\S]*?updated_at = now\(\)/i);
});


test("completed series are terminal at both scheduler and publisher boundaries", () => {
  assert.match(scheduler, /\["draft","cancelled","hiatus","completed"\]\.includes\(series\.status\)/);
  assert.match(publisher, /series\.status === "completed"/);
  assert.match(publisher, /\["draft", "cancelled", "hiatus", "completed"\]\.includes\(currentSeries\.status\)/);
});
