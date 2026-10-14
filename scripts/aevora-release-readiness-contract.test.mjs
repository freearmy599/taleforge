import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scheduler = await readFile("supabase/functions/release-scheduler/index.ts", "utf8");
const generationOrchestrator = await readFile("supabase/functions/generation-orchestrator/index.ts", "utf8");
const generateChapter = await readFile("supabase/functions/generate-chapter/index.ts", "utf8");
const publisher = await readFile("supabase/functions/release-publisher/index.ts", "utf8");
const generator = await readFile("supabase/functions/generate-chapter/index.ts", "utf8");
const readiness = await readFile("supabase/functions/release-scheduler/readiness.ts", "utf8");
const runner = await readFile("supabase/functions/autonomous-series-creation-runner/index.ts", "utf8");
const migration = await readFile("supabase/migrations/20261014210000_release_automation_readiness_gate.sql", "utf8");

test("scheduler fails closed on a missing readiness marker before publisher invocation", () => {
  assert.match(scheduler, /automationReadinessDisposition\(schedule\.automation_ready_at,dryRun\)/);
  const guard = scheduler.indexOf('if(readinessDisposition!=="ready")');
  const publisherCall = scheduler.indexOf('fetch(url+"\/functions\/v1\/release-publisher"');
  assert.ok(guard >= 0, "scheduler must contain the readiness guard");
  const leaseClaim = scheduler.indexOf('rpc("aevora_claim_release_scheduler_lease"');
  assert.ok(leaseClaim > guard, "unready schedules must be rejected before any lease claim");
  assert.ok(publisherCall > guard, "readiness guard must precede any publisher invocation");
  assert.match(scheduler.slice(guard, publisherCall), /continue;/);
});

test("publisher independently checks non-manual schedule readiness", () => {
  assert.match(publisher, /import \{ isAutomationReady \} from "\.\.\/release-scheduler\/readiness\.ts";/);
  assert.match(publisher, /from\("release_schedules"\)/);
  assert.match(publisher, /automation_ready_at/);
  assert.match(publisher, /AUTOMATION_NOT_READY/);
  assert.match(publisher, /taleforge_autonomous_series_creation_runs/);
  assert.match(publisher, /AUTOMATION_SCHEDULE_MISSING_OR_AMBIGUOUS/);
  const guard = publisher.indexOf("AUTOMATION_NOT_READY");
  const insert = publisher.indexOf("const chapterInsert =");
  assert.ok(guard >= 0, "publisher must reject unready automation");
  assert.ok(insert > guard, "publisher readiness guard must precede chapter insertion");
});

test("direct generation cannot bypass unready or missing autonomous schedules", () => {
  assert.match(generator, /taleforge_autonomous_series_creation_runs/);
  assert.match(generator, /isAutonomousSeries\s*&&\s*\(seriesSchedules\?\?\[\]\)\.length\s*!==\s*1/);
  assert.match(generator, /schedule\.auto_generate!==true/);
  assert.match(generator, /schedule\.schedule_mode!=="manual"\|\|schedule\.auto_generate===true/);
  assert.match(generator, /isAutomationReady\(schedule\.automation_ready_at\)/);
  assert.match(generator, /Scheduled generation is not ready/);
  const guard = generator.indexOf("const {data:seriesSchedules");
  const contextBuild = generator.indexOf('rpc("taleforge_build_generation_context"');
  assert.ok(guard >= 0 && contextBuild > guard, "schedule readiness must be checked before generation context/provider work");
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
  const rpcStart = migration.indexOf("create or replace function public.taleforge_mark_release_automation_ready");
  const rpcEnd = migration.indexOf("revoke all on function public.taleforge_mark_release_automation_ready", rpcStart);
  const readinessRpc = migration.slice(rpcStart, rpcEnd);
  const seriesLock = readinessRpc.indexOf("where s.id = v_series_id");
  const lifecycleLock = readinessRpc.indexOf("from public.story_lifecycle sl");
  const scheduleLock = readinessRpc.indexOf("select rs.* into v_schedule");
  assert.ok(seriesLock >= 0 && lifecycleLock > seriesLock && scheduleLock > lifecycleLock,
    "readiness RPC must lock series, lifecycle, then schedule in enrollment-trigger order");
  assert.match(readinessRpc, /where rs\.id = p_schedule_id\s+and rs\.series_id = v_series\.id\s+for update/i);
  assert.match(migration, /series must have exactly one release schedule before readiness/i);
  assert.match(migration, /update public\.release_schedules\s+set enabled = false,[\s\S]*?auto_generate = false,[\s\S]*?auto_publish = false,[\s\S]*?where automation_ready_at is null/i);
  assert.doesNotMatch(migration, /update public\.release_schedules\s+set automation_ready_at\s*=\s*now\(\)\s*;/i,
    "existing schedules must not be blindly backfilled as ready");
});

test("readiness migration preserves the live enrollment interval default", () => {
  assert.match(migration, /new\.id, false, 'interval', 8, 'UTC'/i);
});

test("legacy service-role writes cannot re-enable a schedule without readiness", () => {
  assert.match(migration, /new\.automation_ready_at is null[\s\S]*?new\.enabled = true[\s\S]*?new\.auto_generate = true[\s\S]*?new\.auto_publish = true[\s\S]*?raise exception 'automation readiness is required/i);
  assert.match(migration, /before insert or update of automation_ready_at, enabled, auto_generate, auto_publish on public\.release_schedules/i);
  assert.match(migration, /update public\.release_schedules\s+set enabled = false,[\s\S]*?auto_generate = false,[\s\S]*?auto_publish = false,[\s\S]*?where automation_ready_at is null/i);
});

test("enrollment trigger does not enable an unready schedule", () => {
  assert.match(migration, /values \(\s*new\.id, false, 'interval', 8, 'UTC',[\s\S]*?false, false, null\s*\)/i);
  assert.match(migration, /auto_generate = false,[\s\S]*?auto_publish = false,[\s\S]*?updated_at = now\(\)/i);
});


test("unready ongoing enrollment disables automation without rewriting schedule preferences", () => {
  const triggerStart = migration.indexOf("elsif new.status = 'ongoing' and ready_at is null then");
  const triggerEnd = migration.indexOf("end if;", triggerStart);
  assert.ok(triggerStart >= 0 && triggerEnd > triggerStart);
  const triggerBranch = migration.slice(triggerStart, triggerEnd);
  assert.match(triggerBranch, /set enabled = false,[\s\S]*?auto_generate = false,[\s\S]*?auto_publish = false/i);
  assert.doesNotMatch(triggerBranch, /schedule_mode\s*=|interval_hours\s*=|chapters_ahead\s*=/i);
});

test("completed series are terminal at scheduler, generation, and publisher boundaries", () => {
  assert.match(scheduler, /\["draft","cancelled","hiatus","completed"\]\.includes\(series\.status\)/);
  assert.match(generationOrchestrator, /series\.status!=="ongoing"/);
  assert.match(generateChapter, /requiresAutomation&&\(s\.status!=="ongoing"/);
  assert.match(publisher, /series\.status === "completed"/);
  assert.match(publisher, /\["draft", "cancelled", "hiatus", "completed"\]\.includes\(currentSeries\.status\)/);
});


test("scheduled generation is blocked before cooldown, review, or generation work when unready", () => {
  assert.match(generationOrchestrator, /automationReadinessDisposition\(schedule\.automation_ready_at,dryRun\)/);
  const readinessGuard = generationOrchestrator.indexOf("automationReadinessDisposition(schedule.automation_ready_at,dryRun)");
  const providerCheck = generationOrchestrator.indexOf("getGeminiCooldown(supabase)", readinessGuard);
  assert.ok(readinessGuard >= 0 && providerCheck > readinessGuard,
    "readiness must be checked before provider-state checks and downstream AI work");
  assert.match(generationOrchestrator.slice(readinessGuard, providerCheck), /continue/);
});


test("direct chapter generation rejects terminal series regardless of schedule mode", () => {
  assert.match(generateChapter, /\["completed","cancelled","hiatus"\]\.includes\(s\.status\)/);
  const terminalGuard = generateChapter.indexOf('if(["completed","cancelled","hiatus"].includes(s.status))');
  const scheduleQuery = generateChapter.indexOf('from("release_schedules")', terminalGuard);
  assert.ok(terminalGuard >= 0 && scheduleQuery > terminalGuard,
    "terminal series must be rejected before any schedule/manual bypass");
});

test("direct chapter generation cannot bypass readiness for automatic schedules", () => {
  assert.match(generateChapter, /from\("release_schedules"\)/);
  assert.match(generateChapter, /taleforge_autonomous_series_creation_runs/);
  assert.match(generateChapter, /isAutomationReady\(schedule\.automation_ready_at\)/);
  assert.match(generateChapter, /schedule\.auto_generate!==true/);
  assert.match(generateChapter, /Scheduled generation is not ready; no chapter generation was attempted/);
  assert.match(generateChapter, /requiresAutomation&&\(s\.status!=="ongoing"/);
  const guard = generateChapter.indexOf("Scheduled generation is not ready; no chapter generation was attempted");
  const contextBuild = generateChapter.indexOf('rpc("taleforge_build_generation_context"');
  assert.ok(guard >= 0 && contextBuild > guard,
    "direct-generation readiness guard must run before context build and provider call");
});
