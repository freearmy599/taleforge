import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scheduler = await readFile("supabase/functions/release-scheduler/index.ts", "utf8");
const generationOrchestrator = await readFile("supabase/functions/generation-orchestrator/index.ts", "utf8");
const reviewOrchestrator = await readFile("supabase/functions/review-orchestrator/index.ts", "utf8");
const generateChapter = await readFile("supabase/functions/generate-chapter/index.ts", "utf8");
const publisher = await readFile("supabase/functions/release-publisher/index.ts", "utf8");
const generator = await readFile("supabase/functions/generate-chapter/index.ts", "utf8");
const readiness = await readFile("supabase/functions/release-scheduler/readiness.ts", "utf8");
const runner = await readFile("supabase/functions/autonomous-series-creation-runner/index.ts", "utf8");
const migration = await readFile("supabase/migrations/20261014210000_release_automation_readiness_gate.sql", "utf8");
const concurrencyScript = await readFile("scripts/test-aevora-readiness-concurrency.sh", "utf8");
const migrationFixture = await readFile("scripts/aevora-readiness-migration-fixture.sql", "utf8");
const migrationAssertions = await readFile("scripts/aevora-readiness-migration-assertions.sql", "utf8");

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

test("publisher rejects ambiguous schedules and automatic flags on manual schedules", () => {
  assert.match(publisher, /\.order\("id", \{ ascending: true \}\)\s*\.limit\(2\)/);
  assert.match(publisher, /if \(\(automationSchedules \?\? \[\]\)\.length > 1\)/);
  assert.match(publisher, /schedule_mode === "manual"/);
  assert.match(publisher, /auto_generate === true \|\| automationSchedule\.auto_publish === true/);
  assert.match(publisher, /MANUAL_SCHEDULE_AUTOMATION_CONFLICT/);
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
  assert.match(runner, /metadata:\s*\{\s*autonomous_creation_run_id: result\?\.run_id \?\? null/);

});

test("runner does not return raw internal exception messages", () => {
  assert.match(runner, /function errText\(_e: unknown\) \{ return "Internal runner diagnostics were withheld\."; \}/);
  assert.doesNotMatch(runner, /function errText\(e: unknown\) \{ return e instanceof Error \? e\.message/);
});

test("autonomous creation policy caps are serialized for the full creation transaction", () => {
  assert.match(migration, /create or replace function public\.taleforge_check_autonomous_creation_gate\(\s*p_opportunity_id uuid,\s*p_concept_overall_score numeric default null\s*\)[\s\S]*?from public\.taleforge_autonomous_creation_policy\s+where policy_key = 'production'\s+for update/i);
  assert.match(migration, /revoke all on function public\.taleforge_check_autonomous_creation_gate\(uuid, numeric\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.taleforge_check_autonomous_creation_gate\(uuid, numeric\) to service_role/i);
});

test("database readiness RPC is service-role-only and verifies bootstrap evidence", () => {
  assert.match(migration, /add column if not exists automation_ready_at timestamptz/i);
  assert.match(migration, /create table if not exists public\.taleforge_release_readiness_authorizations[\s\S]*?primary key \(transaction_id, schedule_id\)/i);
  assert.match(migration, /alter table public\.taleforge_release_readiness_authorizations enable row level security/i);
  assert.match(migration, /revoke all on table public\.taleforge_release_readiness_authorizations from public, anon, authenticated, service_role/i);
  assert.match(migration, /security definer\s+set search_path = ''[\s\S]*?taleforge_release_readiness_authorizations/i);
  assert.match(migration, /a\.transaction_id = pg_catalog\.pg_current_xact_id\(\)[\s\S]*?a\.schedule_id = new\.id/i);
  assert.doesNotMatch(migration, /current_setting\(['"]aevora\.release_readiness_rpc['"]/i, "caller-settable GUCs must not authorize readiness marker writes");
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/i,
    "the atomic readiness RPC itself must still require service_role");
  assert.match(migration, /lifecycle_initialized/);
  assert.match(migration, /select sl\.metadata into v_lifecycle_metadata[\s\S]*?for update/i);
  assert.match(migration, /r\.id::text = coalesce\(v_lifecycle_metadata->>'autonomous_creation_run_id', ''\)/i);
  assert.doesNotMatch(migration, /order by r\.created_at desc[\s\S]*?limit 1[\s\S]*?for update/i,
    "readiness must use the exact runner-recorded run, not whichever run is newest");
  assert.match(migration, /release_schedule_initialized/);
  assert.match(migration, /fresh audited approval is required to reactivate a previously ready series/i,
    "a revoked readiness decision must not be reused after lifecycle reactivation");
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
  assert.match(migration, /old\.automation_ready_at is not null[\s\S]*?new\.automation_ready_at is not null[\s\S]*?new\.auto_publish is distinct from old\.auto_publish[\s\S]*?taleforge_release_readiness_authorizations[\s\S]*?new\.automation_ready_at := null;[\s\S]*?new\.auto_publish := false;/i);
  assert.doesNotMatch(migration, /update public\.release_schedules\s+set automation_ready_at\s*=\s*now\(\)\s*;/i,
    "existing schedules must not be blindly backfilled as ready");
});

test("readiness RPC rejects unsafe cadence and incomplete weekly due-time configuration", () => {
  assert.match(migration, /v_schedule\.interval_hours > 168/i);
  assert.match(migration, /v_schedule\.chapters_ahead > 12/i);
  assert.match(migration, /v_schedule\.next_release_at is null/i);
  assert.match(migrationAssertions, /weekly schedule without next_release_at was activated/i);
});

test("readiness migration preserves the live enrollment interval default", () => {
  assert.match(migration, /new\.id, false, 'interval', 8, 'UTC'/i);
});

test("legacy service-role writes cannot re-enable automation without readiness", () => {
  assert.match(migration, /new\.automation_ready_at is null[\s\S]*?new\.auto_generate = true or new\.auto_publish = true[\s\S]*?new\.enabled = true and new\.schedule_mode <> 'manual'[\s\S]*?raise exception 'automation readiness is required/i);
  assert.match(migration, /before insert or update of series_id, automation_ready_at, enabled, auto_generate, auto_publish, schedule_mode, interval_hours, timezone, chapters_ahead, preferred_weekday, preferred_time on public\.release_schedules/i);
  assert.match(migration, /update public\.release_schedules\s+set enabled = false,[\s\S]*?auto_generate = false,[\s\S]*?auto_publish = false,[\s\S]*?where automation_ready_at is null/i);
  const cleanup = migration.indexOf("update public.release_schedules\nset enabled = false");
  const protectionTrigger = migration.indexOf("create trigger trg_protect_release_automation_readiness");
  assert.ok(cleanup >= 0 && protectionTrigger > cleanup,
    "legacy schedule cleanup must precede creation of the fail-closed write trigger");
  assert.match(migration, /new\.enabled = true and new\.schedule_mode <> 'manual'/i,
    "enabled manual schedules with both automatic flags false remain allowed");
  assert.doesNotMatch(migration, /current_user not in \('postgres', 'service_role'\)/i,
    "service-role callers must not bypass the atomic readiness marker setter");
});

test("readiness fixture preserves the production unique schedule invariant before fault injection", () => {
  assert.match(migrationFixture, /series_id uuid not null unique references public\.series\(id\) on delete cascade/i);
  assert.match(migrationAssertions, /Fault-injection only/i);
  assert.match(migrationAssertions, /alter table public\.release_schedules drop constraint release_schedules_series_id_key/i);
});

test("new SECURITY DEFINER trigger functions are not directly executable by API roles", () => {
  assert.match(migration, /revoke all on function public\.taleforge_protect_release_automation_readiness\(\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on function public\.taleforge_revoke_ambiguous_release_schedules\(\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /revoke all on function public\.taleforge_guard_chapter_publication_lifecycle\(\) from public, anon, authenticated, service_role/i);
  assert.match(migration, /from public\.series s[\s\S]*?where s\.id = new\.series_id[\s\S]*?for update[\s\S]*?v_series_status <> 'ongoing'/i);
});

test("ready schedules cannot be reassigned and duplicate schedules revoke readiness", () => {
  assert.match(migration, /ready or automatic release schedules cannot be reassigned to another series/i);
  assert.match(migration, /before insert or update of series_id, automation_ready_at, enabled, auto_generate, auto_publish, schedule_mode, interval_hours, timezone, chapters_ahead, preferred_weekday, preferred_time on public\.release_schedules/i);
  assert.match(migration, /create trigger trg_revoke_ambiguous_release_schedules[\s\S]*?after insert or update of series_id on public\.release_schedules/i);
  assert.match(migration, /create or replace function public\.taleforge_revoke_ambiguous_release_schedules[\s\S]*?count\(\*\)[\s\S]*?> 1[\s\S]*?automation_ready_at = null/i);
});

test("database trigger forbids automatic flags on manual schedules", () => {
  assert.match(migration, /new\.schedule_mode = 'manual'[\s\S]*?new\.auto_generate = true or new\.auto_publish = true[\s\S]*?manual schedules cannot enable automatic generation or publication/i);
});

test("schedule inserts serialize on the parent series before ambiguity checks", () => {
  assert.match(migration, /create or replace function public\.taleforge_lock_release_schedule_parent\(\)/);
  assert.match(migration, /before insert or update of series_id on public\.release_schedules[\s\S]*?execute function public\.taleforge_lock_release_schedule_parent\(\)/i);
  assert.match(migration, /from public\.series s[\s\S]*?where s\.id = new\.series_id[\s\S]*?for update/i);
  assert.match(migration, /release schedules cannot be reassigned to another series/i);
  assert.match(concurrencyScript, /Concurrent schedule writers must serialize on the parent series row/i);
  assert.match(concurrencyScript, /release schedule writer concurrency assertion passed/i);
});

test("enrollment trigger does not enable an unready schedule", () => {
  assert.match(migration, /values \(\s*new\.id, false, 'interval', 8, 'UTC',[\s\S]*?false, false, null\s*\)/i);
  assert.match(migration, /auto_generate = false,[\s\S]*?auto_publish = false,[\s\S]*?updated_at = now\(\)/i);
});


test("enrollment keeps all schedules inert unless an ongoing series has exactly one ready schedule", () => {
  const triggerStart = migration.indexOf("create or replace function public.taleforge_enroll_series_in_production()");
  const triggerEnd = migration.indexOf("create or replace function public.taleforge_mark_release_automation_ready", triggerStart);
  const trigger = migration.slice(triggerStart, triggerEnd);
  assert.ok(trigger.includes("if new.status <> 'ongoing' or schedule_count <> 1 then"));
  assert.ok(trigger.includes("elsif new.status = 'ongoing' and ready_count = 0 then"));
  assert.ok(trigger.includes("where series_id = new.id"));
  assert.match(trigger, /set enabled = false,[\s\S]*?auto_generate = false,[\s\S]*?auto_publish = false,[\s\S]*?automation_ready_at = null/i);
  assert.doesNotMatch(trigger, /schedule_mode\s*=|interval_hours\s*=|chapters_ahead\s*=/i);
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


test("targeted generation dry runs can inspect disabled schedules without invoking AI", () => {
  assert.match(generationOrchestrator, /if\(!dryRun\|\|!requestedScheduleId\)q=q\.eq\("enabled",true\)/);
  const queryGuard = generationOrchestrator.indexOf('if(!dryRun||!requestedScheduleId)q=q.eq("enabled",true)');
  const readinessGuard = generationOrchestrator.indexOf("automationReadinessDisposition(schedule.automation_ready_at,dryRun)");
  assert.ok(queryGuard >= 0 && readinessGuard > queryGuard,
    "targeted dry-run inspection must still pass through the readiness gate");
  assert.match(generationOrchestrator, /readiness_unverified_dry_run/);
});

test("direct chapter generation rejects terminal series regardless of schedule mode", () => {
  assert.match(generateChapter, /\["completed","cancelled","hiatus"\]\.includes\(s\.status\)/);
  const terminalGuard = generateChapter.indexOf('if(["completed","cancelled","hiatus"].includes(s.status))');
  const scheduleQuery = generateChapter.indexOf('from("release_schedules")', terminalGuard);
  assert.ok(terminalGuard >= 0 && scheduleQuery > terminalGuard,
    "terminal series must be rejected before any schedule/manual bypass");
});

test("direct AI quality review cannot bypass readiness for automatic schedules", () => {
  assert.match(generateChapter, /quality-review autonomous provenance lookup failed; failing closed/);
  assert.match(generateChapter, /isAutomationReady\(schedule\.automation_ready_at\)/);
  assert.match(generateChapter, /Scheduled quality review is not ready; no AI review was attempted/);
  const guard = generateChapter.indexOf("Scheduled quality review is not ready; no AI review was attempted");
  const providerCall = generateChapter.indexOf("const {data:reviewProviderState,error:reviewProviderStateError}");
  assert.ok(guard >= 0 && providerCall > guard,
    "direct quality-review readiness gate must run before provider-state lookup and Gemini invocation");
  assert.match(generateChapter, /deterministic hard-validation failures can still be recorded during a cooldown/);
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


test("scheduled review orchestration fails closed before invoking AI reviewers", () => {
  assert.match(reviewOrchestrator, /from\("release_schedules"\)/);
  assert.match(reviewOrchestrator, /taleforge_autonomous_series_creation_runs/);
  assert.match(reviewOrchestrator, /isAutomationReady\(schedule\.automation_ready_at\)/);
  assert.match(reviewOrchestrator, /Scheduled review is not ready; no AI review was attempted/);
  const readinessBlock = reviewOrchestrator.indexOf("Scheduled review is not ready; no AI review was attempted");
  const firstReviewCall = reviewOrchestrator.indexOf("callFunction(supabaseUrl, serviceRoleKey, step.functionName, output.id)");
  assert.ok(readinessBlock >= 0 && firstReviewCall > readinessBlock,
    "readiness must be verified before any review worker can be invoked");
  assert.match(reviewOrchestrator.slice(readinessBlock, firstReviewCall), /continue;/);
});


test("approved schedule cadence changes revoke readiness while next-release advancement remains allowed", () => {
  assert.match(migration, /ready schedule's cadence\/configuration is part of the approved/i);
  assert.match(migration, /new\.interval_hours is distinct from old\.interval_hours/);
  assert.match(migration, /new\.preferred_weekday is distinct from old\.preferred_weekday/);
  assert.match(migration, /new\.automation_ready_at := null;[\s\S]*?new\.enabled := false;[\s\S]*?new\.auto_generate := false;[\s\S]*?new\.auto_publish := false;/);
  assert.match(migration, /next_release_at is deliberately excluded because the scheduler advances it/i);
});

test("manual-only review and dry-run inspection remain compatible with readiness gating", () => {
  assert.match(reviewOrchestrator, /if \(!dryRun\) \{/);
  assert.match(reviewOrchestrator, /const requiresAutomation = isAutonomous \|\| schedule\.schedule_mode !== "manual" \|\|\s*schedule\.auto_generate === true \|\| schedule\.auto_publish === true/);
  assert.match(reviewOrchestrator, /if \(dryRun\) \{/);
  assert.match(reviewOrchestrator, /No review function was called and no database state was changed/);
  const dryRunBranch = reviewOrchestrator.indexOf("if (dryRun) {");
  const invocation = reviewOrchestrator.indexOf("callFunction(supabaseUrl, serviceRoleKey, step.functionName, output.id)");
  assert.ok(dryRunBranch >= 0 && invocation > dryRunBranch,
    "dry-run branch must finish before any AI review invocation");
});
