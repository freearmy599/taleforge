import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const scheduler = await readFile("supabase/functions/release-scheduler/index.ts", "utf8");
const generationOrchestrator = await readFile("supabase/functions/generation-orchestrator/index.ts", "utf8");
const reviewOrchestrator = await readFile("supabase/functions/review-orchestrator/index.ts", "utf8");
const generateChapter = await readFile("supabase/functions/generate-chapter/index.ts", "utf8");
const reviseChapter = await readFile("supabase/functions/revise-chapter/index.ts", "utf8");
const providerStateGuardFunctions = await Promise.all([
  "supabase/functions/generation-orchestrator/index.ts",
  "supabase/functions/generate-chapter/index.ts",
  "supabase/functions/review-orchestrator/index.ts",
  "supabase/functions/revise-chapter/index.ts",
  "supabase/functions/continuity-review/index.ts",
  "supabase/functions/originality-review/index.ts",
  "supabase/functions/safety-review/index.ts",
  "supabase/functions/arc-planner/index.ts",
  "supabase/functions/blueprint-planner/index.ts",
  "supabase/functions/character-continuity/index.ts",
  "supabase/functions/semantic-continuity-extraction/index.ts",
  "supabase/functions/story-dna-planner/index.ts",
  "supabase/functions/world-continuity/index.ts",
].map((path) => readFile(path, "utf8")));
const publisher = await readFile("supabase/functions/release-publisher/index.ts", "utf8");
const generator = await readFile("supabase/functions/generate-chapter/index.ts", "utf8");
const readiness = await readFile("supabase/functions/release-scheduler/readiness.ts", "utf8");
const runner = await readFile("supabase/functions/autonomous-series-creation-runner/index.ts", "utf8");
const migration = await readFile("supabase/migrations/20261014210000_release_automation_readiness_gate.sql", "utf8");
const leaseMigration = await readFile("supabase/migrations/20261012183000_aevora_release_scheduler_lease_foundation.sql", "utf8");
const leaseFencingMigration = await readFile("supabase/migrations/20261012190000_aevora_atomic_scheduler_lease_fencing.sql", "utf8");
const defaultPrivilegesMigration = await readFile("supabase/migrations/20261014170000_restrict_public_default_privileges.sql", "utf8");
const maintenancePrivilegeMigration = await readFile("supabase/migrations/20261016200000_revoke_client_table_maintenance_privileges.sql", "utf8");
const maintenanceDefaultMigration = await readFile("supabase/migrations/20261016203000_revoke_client_maintenance_default_privileges.sql", "utf8");
const publicationAuthorizationDesign = await readFile("docs/aevora/PHASE1-PUBLICATION-AUTHORIZATION-DESIGN-20261014.md", "utf8");
const rolloutPlan = await readFile("docs/aevora/PHASE1-PRODUCTION-ROLLOUT-SEQUENCE-20261014.md", "utf8");
const legacyDispositionRegister = await readFile("docs/aevora/PHASE1-LEGACY-SCHEDULE-DISPOSITION-REGISTER-20261014.md", "utf8");
const concurrencyScript = await readFile("scripts/test-aevora-readiness-concurrency.sh", "utf8");
const migrationFixture = await readFile("scripts/aevora-readiness-migration-fixture.sql", "utf8");
const migrationAssertions = await readFile("scripts/aevora-readiness-migration-assertions.sql", "utf8");
const rollbackScript = await readFile("scripts/aevora-readiness-rollback.sql", "utf8");
const rollbackAssertions = await readFile("scripts/aevora-readiness-rollback-assertions.sql", "utf8");
const migrationTestRunner = await readFile("scripts/test-aevora-readiness-migration.sh", "utf8");
const rollbackTestRunner = await readFile("scripts/test-aevora-readiness-rollback.sh", "utf8");
const migrationWorkflow = await readFile(".github/workflows/aevora-edge-validation.yml", "utf8");
const concurrencyTestRunner = await readFile("scripts/test-aevora-readiness-concurrency.sh", "utf8");
const readerEventTestRunner = await readFile("scripts/test-aevora-reader-event-integrity.sh", "utf8");
const productionPreflight = await readFile("scripts/aevora-production-rollout-preflight.sql", "utf8");

test("scheduler lease RPCs use hardened search paths and deny direct client execution", () => {
  for (const migrationSource of [leaseMigration, leaseFencingMigration]) {
    assert.match(migrationSource, /SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog/);
    assert.doesNotMatch(migrationSource, /SET search_path\s*=\s*public\s*(?:,|$)|SET search_path\s*=\s*pg_catalog\s*,\s*public/i);
    assert.match(migrationSource, /REVOKE ALL ON FUNCTION public\.aevora_[a-z_]+\([^;]*\) FROM PUBLIC, anon, authenticated/i);
    assert.match(migrationSource, /GRANT EXECUTE ON FUNCTION public\.aevora_[a-z_]+\([^;]*\) TO postgres, service_role/i);
  }
  assert.match(leaseMigration, /pg_catalog\.make_interval/);
  assert.match(leaseMigration, /FROM public\.aevora_release_scheduler_leases/);
  assert.match(leaseFencingMigration, /UPDATE public\.release_schedules/);
  assert.match(leaseFencingMigration, /UPDATE public\.story_lifecycle/);
});

test("public default-privilege cleanup is schema-scoped, owner-aware, and fails closed", () => {
  assert.match(defaultPrivilegesMigration, /ARRAY\['postgres', 'supabase_admin'\]/);
  assert.match(defaultPrivilegesMigration, /executor_is_superuser/);
  assert.match(defaultPrivilegesMigration, /pg_catalog\.pg_has_role\(current_user, owner_role, 'MEMBER'\)/);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated/);
  assert.match(defaultPrivilegesMigration, /global table or sequence client defaults exist/);
  assert.match(defaultPrivilegesMigration, /RAISE EXCEPTION 'executor cannot administer default privileges/);
  assert.doesNotMatch(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(defaultPrivilegesMigration, /REVOKE EXECUTE ON FUNCTIONS/i,
    "function EXECUTE defaults require a separate owner/schema impact review");
  assert.doesNotMatch(defaultPrivilegesMigration, /IN SCHEMA (?:storage|graphql_public|graphql|realtime)/i, "managed schemas must not be swept into the public-schema repair");
});

test("client table maintenance ACL repair preserves ordinary CRUD", () => {
  assert.match(maintenancePrivilegeMigration, /c\.relkind IN \('r', 'p'\)/);
  assert.match(maintenancePrivilegeMigration, /REVOKE MAINTAIN, TRUNCATE, TRIGGER, REFERENCES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(maintenancePrivilegeMigration, /REVOKE REFERENCES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(maintenancePrivilegeMigration, /REVOKE[^;]*(?:SELECT|INSERT|UPDATE|DELETE)/i);
});

test("future client maintenance defaults are schema-scoped and fail closed", () => {
  assert.match(maintenanceDefaultMigration, /IN SCHEMA public REVOKE MAINTAIN, TRUNCATE, TRIGGER, REFERENCES ON TABLES FROM PUBLIC, anon, authenticated/);
  assert.match(maintenanceDefaultMigration, /defaclnamespace = 0/);
  assert.match(maintenanceDefaultMigration, /global table maintenance defaults exist/);
  assert.match(maintenanceDefaultMigration, /executor cannot administer default privileges/);
  assert.doesNotMatch(maintenanceDefaultMigration, /REVOKE ALL PRIVILEGES ON TABLES/);
});

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

test("scheduler only accepts an explicit, identified published result from the publisher", () => {
  const start = scheduler.indexOf("function isConfirmedPublicationResponse(");
  const end = scheduler.indexOf("\nconst corsHeaders", start);
  assert.ok(start >= 0 && end > start, "publication response predicate must be a self-contained helper");
  const helperSource = scheduler.slice(start, end).replaceAll(":any", "").replaceAll(":boolean", "");
  const isConfirmed = runInNewContext(`${helperSource}; isConfirmedPublicationResponse`);
  const validResponse = { ok: true };
  assert.equal(isConfirmed(validResponse, { success: true, published: true, status: "published", chapter_id: "chapter-1" }), true);
  assert.equal(isConfirmed(validResponse, { success: true, published: true, status: "draft", chapter_id: "chapter-1" }), false);
  assert.equal(isConfirmed(validResponse, { success: true, published: true, status: "published", chapter_id: "" }), false);
  assert.equal(isConfirmed(validResponse, { success: false, published: true, status: "published", chapter_id: "chapter-1" }), false);
  assert.equal(isConfirmed({ ok: false }, { success: true, published: true, status: "published", chapter_id: "chapter-1" }), false);
  const dbConfirm = scheduler.indexOf('from("chapters")', scheduler.indexOf("const responseConfirmed="));
  const publishedPush = scheduler.indexOf("published.push(", dbConfirm);
  const advancement = scheduler.indexOf('rpc("aevora_advance_release_schedule_if_lease_owned"');
  assert.ok(dbConfirm > scheduler.indexOf("const responseConfirmed="), "database confirmation must follow the publisher response");
  assert.ok(publishedPush > dbConfirm && advancement > publishedPush, "the scheduler must confirm chapter status before counting success or advancing the schedule");
  assert.match(scheduler, /confirmedChapter\.status!=="published"/);
});

test("scheduler renews and releases its lease, and advances only after every publication is confirmed", () => {
  const claim = scheduler.indexOf('rpc("aevora_claim_release_scheduler_lease"');
  const renew = scheduler.indexOf('rpc("aevora_renew_release_scheduler_lease"');
  const publisherCall = scheduler.indexOf('fetch(url+"/functions/v1/release-publisher"');
  const release = scheduler.indexOf('rpc("aevora_release_scheduler_lease"');
  const finallyBlock = scheduler.lastIndexOf("}finally{");
  const allConfirmed = scheduler.indexOf("const allSelectedConfirmed =");
  const advanceGuard = scheduler.indexOf("if(!dryRun && nextRelease && allSelectedConfirmed)");
  const advance = scheduler.indexOf('rpc("aevora_advance_release_schedule_if_lease_owned"');
  assert.ok(claim >= 0 && renew > claim && publisherCall > renew, "lease must be claimed and renewed before publication");
  assert.ok(allConfirmed > publisherCall && advanceGuard > allConfirmed && advance > advanceGuard, "schedule advancement must be gated on full batch confirmation");
  assert.match(scheduler.slice(allConfirmed, advanceGuard), /attemptedCount===publishCount/);
  assert.match(scheduler.slice(allConfirmed, advanceGuard), /published\.length===publishCount/);
  assert.match(scheduler.slice(allConfirmed, advanceGuard), /!publicationFailed && !leaseLost/);
  assert.ok(finallyBlock >= 0 && release > finallyBlock, "a claimed lease must be released from the finally path");
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

test("generation readiness never authorizes automatic publication", () => {
  const rpcStart = migration.indexOf("create or replace function public.taleforge_mark_release_automation_ready");
  const rpcEnd = migration.indexOf("revoke all on function public.taleforge_mark_release_automation_ready", rpcStart);
  const readinessRpc = migration.slice(rpcStart, rpcEnd);
  assert.match(readinessRpc, /auto_generate = true,[\s\S]*?auto_publish = false,/,
    "generation readiness may enable generation but must leave publication disabled");
  assert.match(readinessRpc, /'auto_publication_enabled', false,[\s\S]*?'publication_approval_required', true/,
    "the audit snapshot must explicitly record that publication approval is still required");
  assert.match(readinessRpc, /'publication_enabled', false,[\s\S]*?'publication_approval_required', true/,
    "the RPC response must clearly separate generation readiness from publication authorization");
  assert.doesNotMatch(readinessRpc, /auto_publish = true/,
    "generation readiness must never enable auto-publication as a side effect");
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

test("AI quality review fails closed when Gemini provider cooldown state is missing, malformed, or active", () => {
  const providerGuard = generateChapter.indexOf("const {data:reviewProviderState,error:reviewProviderStateError}");
  const geminiReviewCall = generateChapter.indexOf("parseJson(await gemini(gkey,reviewPrompt,true))");
  assert.ok(providerGuard >= 0 && geminiReviewCall > providerGuard,
    "quality-review provider-state guard must precede the Gemini review call");
  assert.match(generateChapter, /reviewProviderStateError\|\|!reviewProviderState/);
  assert.match(generateChapter, /Number\.isFinite\(new Date\(reviewProviderState\.cooldown_until\)\.getTime\(\)\)/);
  assert.match(generateChapter, /reason:"provider_state_unavailable".*AI quality review was blocked/s);
  assert.match(generateChapter, /reason:"provider_cooldown".*AI quality review was skipped to protect quota/s);
  const guardBlock = generateChapter.slice(providerGuard, geminiReviewCall);
  assert.match(guardBlock, /return reply\(/);
  assert.match(guardBlock, /new Date\(reviewProviderState\.cooldown_until\)\.getTime\(\)>Date\.now\(\)/);
});

test("revision worker fails closed before revision processing when Gemini provider state is unsafe", () => {
  const providerGuard = reviseChapter.indexOf('const providerStateResult = await supabase');
  const requestParsing = reviseChapter.indexOf('body = await req.json()');
  const revisionLoop = reviseChapter.indexOf('for (\nlet attempt = 1;');
  assert.ok(providerGuard >= 0 && requestParsing > providerGuard && revisionLoop > providerGuard,
    "revision provider-state guard must run before request processing and the revision loop");
  const guardBlock = reviseChapter.slice(providerGuard, requestParsing);
  assert.match(guardBlock, /providerStateResult\.error \|\| !providerStateResult\.data/);
  assert.match(guardBlock, /reason: "provider_state_unavailable"/);
  assert.match(guardBlock, /Number\.isFinite\(cooldownUntil\)/);
  assert.match(guardBlock, /reason: "invalid_cooldown_timestamp"/);
  assert.match(guardBlock, /reason: "provider_cooldown"/);
  assert.match(guardBlock, /return jsonResponse\([\s\S]*?503\)/);
  const modelCall = reviseChapter.indexOf('await callGemini(geminiApiKey, prompt');
  assert.ok(modelCall > requestParsing,
    "Gemini revision call must occur only after the fail-closed provider-state guard");
});

test("review orchestrator fails closed before any reviewer call when provider state is unsafe", () => {
  const providerGuard = reviewOrchestrator.indexOf(".from(\"taleforge_ai_provider_state\")");
  const requestParsing = reviewOrchestrator.indexOf("body = await req.json()");
  const firstReviewCall = reviewOrchestrator.indexOf("callFunction(supabaseUrl, serviceRoleKey, step.functionName, output.id)");
  assert.ok(providerGuard >= 0 && requestParsing > providerGuard && firstReviewCall > providerGuard,
    "provider-state guard must execute before request-driven review orchestration");
  const guardBlock = reviewOrchestrator.slice(providerGuard, requestParsing);
  assert.match(guardBlock, /providerStateError \|\| !providerState/);
  assert.match(guardBlock, /Number\.isFinite\(new Date\(providerState\.cooldown_until\)\.getTime\(\)\)/);
  assert.match(guardBlock, /reason: "provider_state_unavailable"/);
  assert.match(guardBlock, /reason: "provider_cooldown"/);
  assert.match(guardBlock, /return json\([\s\S]*?503\)/);
  assert.match(guardBlock, /return json\([\s\S]*?429\)/);
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


test("disposable readiness migration harness rehearses rollback and stays fail-closed", () => {
  assert.match(migrationTestRunner, /aevora-readiness-migration-assertions\.sql/);
  assert.match(migrationTestRunner, /aevora-readiness-rollback\.sql/);
  assert.match(migrationTestRunner, /aevora-readiness-rollback-assertions\.sql/);
  assert.match(migrationTestRunner, /AEVORA_DISPOSABLE_MIGRATION_REHEARSAL/);
  assert.match(migrationTestRunner, /Refusing migration rehearsal against a Supabase URL/);
  assert.match(migrationTestRunner, /aevora_readiness/);
  assert.match(migrationTestRunner, /database_url_without_query=.*DATABASE_URL/);
  assert.match(migrationTestRunner, /database_name=.*database_url_without_query/);
  assert.match(concurrencyTestRunner, /database_name=.*database_url_without_query/);
  assert.match(readerEventTestRunner, /database_name=.*database_url_without_query/);
  assert.match(migrationWorkflow, /AEVORA_DISPOSABLE_MIGRATION_REHEARSAL: I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(concurrencyTestRunner, /AEVORA_DISPOSABLE_CONCURRENCY_REHEARSAL/);
  assert.match(concurrencyTestRunner, /Refusing readiness concurrency rehearsal against a Supabase URL/);
  assert.match(readerEventTestRunner, /AEVORA_DISPOSABLE_READER_EVENT_REHEARSAL/);
  assert.match(readerEventTestRunner, /Refusing reader-event integrity rehearsal against a Supabase URL/);
  assert.match(migrationWorkflow, /AEVORA_DISPOSABLE_CONCURRENCY_REHEARSAL: I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(migrationWorkflow, /AEVORA_DISPOSABLE_READER_EVENT_REHEARSAL: I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(rollbackScript, /set enabled = false, auto_generate = false, auto_publish = false/);
  const failClosedCommit = rollbackScript.indexOf("commit;");
  const rollbackDdl = rollbackScript.indexOf("drop trigger if exists trg_guard_chapter_publication_lifecycle");
  assert.ok(failClosedCommit >= 0 && rollbackDdl > failClosedCommit,
    "fail-closed schedule shutdown must commit before rollback DDL can fail");
  assert.match(rollbackScript, /drop table if exists public\.taleforge_release_readiness_authorizations/);
  assert.match(rollbackScript, /drop column if exists automation_ready_at/);
  assert.match(rollbackScript, /grant execute on function public\.taleforge_check_autonomous_creation_gate\(uuid, numeric\) to public/);
  assert.match(rollbackAssertions, /fixture baseline creation-gate EXECUTE grant was not restored/);
  assert.match(rollbackAssertions, /fixture baseline function SECURITY DEFINER property was not restored/);
  assert.match(rollbackAssertions, /fixture baseline function search_path setting was not restored/);
  assert.match(rollbackAssertions, /rollback re-enabled a schedule without independent approval evidence/);
  assert.match(rollbackTestRunner, /AEVORA_DISPOSABLE_ROLLBACK_REHEARSAL/);
  assert.match(rollbackTestRunner, /Refusing rollback rehearsal against a Supabase URL/);
  assert.match(rollbackTestRunner, /aevora_readiness/);
});


test("chapter revision fails closed before Gemini when provider state is unavailable, malformed, or cooling down", () => {
  assert.match(reviseChapter, /from\("taleforge_ai_provider_state"\)/);
  assert.match(reviseChapter, /providerStateResult\.error \|\| !providerStateResult\.data/);
  assert.match(reviseChapter, /reason: "provider_state_unavailable"/);
  assert.match(reviseChapter, /reason: "invalid_cooldown_timestamp"/);
  assert.match(reviseChapter, /reason: "provider_cooldown"/);
  assert.match(reviseChapter, /no model call was made/);
  const stateRead = reviseChapter.indexOf("const providerStateResult = await supabase");
  const stateTableRead = reviseChapter.indexOf('from("taleforge_ai_provider_state")', stateRead);
  const unsafeStateReturn = reviseChapter.indexOf('reason: "provider_state_unavailable"', stateRead);
  const requestParse = reviseChapter.indexOf("body = await req.json()");
  const modelCall = reviseChapter.indexOf("await callGemini(");
  assert.ok(stateRead >= 0 && stateTableRead > stateRead && unsafeStateReturn > stateTableRead,
    "the request-level provider-state read and fail-closed response must precede request processing");
  assert.ok(requestParse > unsafeStateReturn && modelCall > requestParse,
    "all provider-state fail-closed checks must precede the Gemini call");
  assert.match(reviseChapter.slice(stateRead, modelCall), /Number\.isFinite\(cooldownUntil\)/);
  assert.match(reviseChapter.slice(stateRead, modelCall), /cooldownUntil > Date\.now\(\)/);
});

test("chapter revision records Gemini 429/503 cooldowns through the shared atomic RPC", () => {
  assert.match(reviseChapter, /async function recordGeminiThrottle/);
  assert.match(reviseChapter, /message\.includes\("Gemini HTTP 503"\)/);
  assert.match(reviseChapter, /message\.includes\("Gemini HTTP 429"\)/);
  assert.match(reviseChapter, /aevora_record_gemini_throttle/);
  assert.match(reviseChapter, /result\?\.recorded !== true/);
  assert.match(reviseChapter, /Gemini cooldown could not be persisted/);
  assert.doesNotMatch(reviseChapter, /Math\.max\(proposedUntil, existingUntil\)/);
  assert.match(reviseChapter, /invalid_cooldown_timestamp/);
  assert.match(reviseChapter, /Number\.isFinite\(until\)/);
});


test("provider-block detector recognizes nested review-worker blocks without classifying ordinary review failures", () => {
  const helperStart = generationOrchestrator.indexOf("function containsProviderBlock(");
  const helperEnd = generationOrchestrator.indexOf("\nasync function transitionBlueprintStatus", helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart, "provider-block helpers must be present as a self-contained source segment");
  const helperSource = generationOrchestrator.slice(helperStart, helperEnd)
    .replaceAll(":any", "")
    .replaceAll(":boolean", "");
  const helpers = runInNewContext(`${helperSource}; ({ containsProviderBlock, isProviderBlockResult })`);
  assert.equal(helpers.isProviderBlockResult({
    ok: false, status: 422, data: { success: false, results: [
      { blocked: true, steps: [{ http_status: 200, result: { reason: "provider_state_unavailable" } }] },
    ] },
  }), true, "nested provider-state blocks must stop later schedules");
  assert.equal(helpers.isProviderBlockResult({
    ok: false, status: 422, data: { success: false, results: [
      { blocked: true, steps: [{ http_status: 200, result: { decision: "rejected", score: 42 } }] },
    ] },
  }), false, "ordinary quality/review failures must not be misclassified as provider blocks");
  assert.equal(helpers.isProviderBlockResult({ ok: false, status: 503, data: { error: "temporarily unavailable" } }), true);
  assert.equal(helpers.isProviderBlockResult({ ok: true, status: 200, data: { success: true } }), false);
});

test("generation and review orchestration stop further AI work after a provider throttle even if cooldown persistence fails", () => {
  assert.match(generationOrchestrator, /let providerThrottleObserved=false;for\(const schedule of ordered\)\{if\(providerThrottleObserved\)/);
  assert.match(generationOrchestrator, /action:"provider_throttle_observed"/);
  assert.match(generationOrchestrator, /const generated=\[\];for\(const b of missing\)\{if\(providerThrottleObserved\)\{generated\.push\(\{chapter_number:b\.chapter_number,action:"provider_throttle_observed"/);
  assert.equal(generationOrchestrator.includes("await recordGeminiThrottle"), false, "orchestrator must not double-record a child provider failure");
  assert.ok(generationOrchestrator.includes("Child revise-chapter already records this provider-call event"), "revision child owns provider-event persistence");
  assert.match(generationOrchestrator, /function isProviderBlockResult\(result:any\):boolean/);
  assert.match(generationOrchestrator, /function containsProviderBlock\(value:any,depth=0\):boolean/);
  assert.match(generationOrchestrator, /Object\.values\(value\)\.some\(\(nested\)=>containsProviderBlock\(nested,depth\+1\)\)/);
  assert.match(generationOrchestrator, /depth>7/);
  assert.match(generationOrchestrator, /const revisionProviderBlock=isProviderBlockResult\(revise\);if\(!revise\.ok\|\|revisionProviderBlock\)/);
  assert.match(generationOrchestrator, /if\(isProviderBlockResult\(recovery\)\)providerThrottleObserved=true/);
  assert.ok(generationOrchestrator.includes('if(providerThrottleObserved){rr.push({output_id:c.id,action:"provider_throttle_observed"'), "revision loop must stop after a prior provider block");
  assert.ok(generationOrchestrator.includes('if(handoff){review=handoff;if(isProviderBlockResult'), "revision review handoffs must preserve provider-block state");
  assert.match(generationOrchestrator, /if\(isProviderBlockResult\(x\)\)providerThrottleObserved=true/);
  assert.match(generationOrchestrator, /action:reviewProviderBlocked\?"generated_review_blocked":reviewAfterGeneration\?\(review\?\.ok\?"generated_and_reviewed":"generated_review_failed"\):"generated"/);
  assert.match(generationOrchestrator, /blocked:reviewProviderBlocked,retryable:reviewProviderBlocked/);
  assert.match(generationOrchestrator, /const providerStateBlocked=\["provider_state_unavailable","provider_cooldown","invalid_cooldown_timestamp"\]/);
  assert.match(generationOrchestrator, /if\(!g\.ok\|\|isProviderBlockResult\(g\)\)/);
  assert.ok(generationOrchestrator.includes("Child generate-chapter already records this provider-call event"), "generation child owns provider-event persistence");
  assert.match(generationOrchestrator, /providerQuotaBlocked\|\|providerTemporarilyUnavailable\|\|providerStateBlocked/);
  assert.match(generationOrchestrator, /action:providerStateBlocked\?"provider_state_blocked"/);
  assert.match(reviewOrchestrator, /let providerThrottleObserved = false;/);
  assert.match(reviewOrchestrator, /if \(providerThrottleObserved\) \{\s*results\.push\(\{ output_id: output\.id, chapter_number: output\.chapter_number, action: "provider_throttle_observed"/);
  assert.match(reviewOrchestrator, /const callReason = \(call\.data as Record<string, unknown> \| null\)\?\.reason/);
  assert.match(reviewOrchestrator, /call\.status === 429/);
  assert.match(reviewOrchestrator, /callReason === "provider_state_unavailable"/);
  assert.match(reviewOrchestrator, /callReason === "provider_cooldown"/);
  assert.match(reviewOrchestrator, /callReason === "invalid_cooldown_timestamp"/);
  assert.match(reviewOrchestrator, /const callReason = \(call\.data as Record<string, unknown> \| null\)\?\.reason[\s\S]*?if \(!call\.ok\)/,
    "provider blocks must be classified before the HTTP-success branch so one output cannot trigger further AI calls for later outputs");
  assert.match(reviewOrchestrator, /providerThrottleObserved = true;/);
});


test("publication authorization remains a separate, unimplemented release gate", () => {
  assert.match(publicationAuthorizationDesign, /Status: design proposal only; not implemented or deployed/i);
  assert.match(publicationAuthorizationDesign, /authenticated human approver identity and authorization source/i);
  assert.match(publicationAuthorizationDesign, /revocation\/configuration changes must invalidate authorization/i);
  assert.match(publicationAuthorizationDesign, /No current branch artifact provides a separately audited publication-approval workflow/i);
  assert.match(rolloutPlan, /auto_publish=false/i);
  assert.match(rolloutPlan, /for every series/i);
  assert.match(rolloutPlan, /publication-authorization-design-20261014\.md/i);
  const readinessStart = migration.indexOf("create or replace function public.taleforge_mark_release_automation_ready");
  const readinessEnd = migration.indexOf("revoke all on function public.taleforge_mark_release_automation_ready", readinessStart);
  assert.doesNotMatch(migration.slice(readinessStart, readinessEnd), /auto_publish = true/i);
  assert.doesNotMatch(migration, /create or replace function public\.taleforge_authorize_release_publication/i,
    "no publication approval RPC may appear before its principal and threat model are agreed");
});


test("legacy schedule disposition register keeps all six rows on hold without inventing identity or approval", () => {
  assert.match(legacyDispositionRegister, /six legacy schedule disposition register/i);
  assert.match(legacyDispositionRegister, /Evidence template only — no schedule is approved/i);
  assert.equal((legacyDispositionRegister.match(/\| Legacy row [A-F] \|/g) ?? []).length, 6);
  assert.equal((legacyDispositionRegister.match(/HOLD — no automation approval/g) ?? []).length, 6);
  assert.match(legacyDispositionRegister, /not a mapping to database row order/i);
  assert.match(legacyDispositionRegister, /Pending fresh inventory/);
  assert.match(legacyDispositionRegister, /pending originality is not a pass/i);
  assert.match(legacyDispositionRegister, /publication authorization is distinct from generation authorization/i);
  assert.match(legacyDispositionRegister, /does not authorize a migration, grant change, deployment, cron mutation, schedule update, generation, or publication/i);
});


test("production rollout preflight is read-only and redacts cron command contents", () => {
  assert.match(productionPreflight, /BEGIN TRANSACTION READ ONLY/i);
  assert.match(productionPreflight, /COMMIT;/i);
  assert.match(productionPreflight, /enabled_nonmanual_schedules_without_readiness/);
  assert.match(productionPreflight, /succeeded_runs_24h/);
  assert.match(productionPreflight, /dry_run_mode/);
  assert.match(productionPreflight, /anon_can_direct_insert/);
  assert.match(productionPreflight, /authenticated_can_direct_insert/);
  assert.match(productionPreflight, /anon_insert_policy_present/);
  assert.match(productionPreflight, /authenticated_insert_policy_present/);
  assert.match(productionPreflight, /server_timestamp_trigger_installed/);
  assert.match(productionPreflight, /trg_reader_event_server_timestamp/);
  assert.doesNotMatch(productionPreflight, /t\.tgname = 'taleforge_force_reader_event_client_timestamp'/);
  assert.match(productionPreflight, /event_uuid_unique_index_installed/);
  assert.doesNotMatch(productionPreflight, /SELECT\s+j\.command/i);
  const executableSql = productionPreflight.split("\n")
    .filter((line) => !line.trim().startsWith("--") && !line.trim().startsWith("\\"))
    .join("\n");
  assert.doesNotMatch(executableSql,
    /^\s*(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|CALL)\b/im,
    "the rollout preflight must not mutate production state");
});

test("production rollout runbook requires pause, exact baseline, leaf-first order, and fail-closed recovery", () => {
  assert.match(rolloutPlan, /Gate A evidence/i);
  assert.match(rolloutPlan, /production-specific recovery procedure/i);
  assert.match(rolloutPlan, /Pause all invocation sources identified in preflight/i);
  assert.match(rolloutPlan, /Confirm no in-flight generation, review, or publication worker remains active/i);
  const stage2Start = rolloutPlan.indexOf("### Stage 2");
  const stage2End = rolloutPlan.indexOf("### Stage 3", stage2Start);
  const stage2 = rolloutPlan.slice(stage2Start, stage2End);
  const publisherOrder = stage2.indexOf("1. \\`release-publisher\\`");
  const generatorOrder = stage2.indexOf("2. \\`generate-chapter\\` and \\`revise-chapter\\`");
  const reviewWorkersOrder = stage2.indexOf("3. AI review workers");
  const reviewOrchestratorOrder = stage2.indexOf("4. \\`review-orchestrator\\`");
  const generationOrchestratorOrder = stage2.indexOf("5. \\`generation-orchestrator\\`");
  const runnerOrder = stage2.indexOf("6. \\`autonomous-series-creation-runner\\`");
  const schedulerOrder = stage2.indexOf("7. \\`release-scheduler\\`");
  assert.ok(publisherOrder >= 0 && generatorOrder > publisherOrder &&
    reviewWorkersOrder > generatorOrder && reviewOrchestratorOrder > reviewWorkersOrder &&
    generationOrchestratorOrder > reviewOrchestratorOrder && runnerOrder > generationOrchestratorOrder &&
    schedulerOrder > runnerOrder, "rollout must deploy guarded leaf functions before orchestration and scheduler");
  assert.match(rolloutPlan, /keep all invocation sources paused until the entire set is verified/i);
  assert.match(rolloutPlan, /Do not use a production invocation as an unreviewed smoke test/i);
  assert.match(rolloutPlan, /Recovery must first leave all automation disabled/i);
  assert.match(rolloutPlan, /If any precondition is missing, stop before migration/i);
  assert.match(rolloutPlan, /Production deployment, migration, schedule changes, generation, and publication remain unauthorized/i);
});


test("rollback harness requires explicit disposable opt-in and executes fail-closed restore assertions", () => {
  for (const runner of [migrationTestRunner, rollbackTestRunner]) {
    assert.match(runner, /DATABASE_URL must point to a disposable PostgreSQL database/);
    assert.match(runner, /I_UNDERSTAND_THIS_IS_DISPOSABLE/);
    assert.match(runner, /Refusing rollback rehearsal against a Supabase URL|Refusing migration rehearsal against a Supabase URL/);
    assert.match(runner, /database URL must identify an explicitly named aevora_readiness disposable database/);
    assert.match(runner, /psql .*aevora-readiness-migration-fixture\.sql/);
    assert.match(runner, /psql .*20261014210000_release_automation_readiness_gate\.sql/);
    assert.match(runner, /psql .*aevora-readiness-rollback\.sql/);
    assert.match(runner, /psql .*aevora-readiness-rollback-assertions\.sql/);
  }
  assert.match(rollbackScript, /Commit the fail-closed state separately/i);
  assert.match(rollbackScript, /set enabled = false, auto_generate = false, auto_publish = false/i);
  assert.match(rollbackAssertions, /all schedules remain disabled/i);
  assert.match(rollbackAssertions, /baseline creation-gate function body was not restored/i);
  assert.match(rollbackAssertions, /fixture baseline release_schedules grants were not restored/i);
});


test("autonomous creation response reflects generation-only readiness", () => {
  assert.match(migration, /'publication_enabled', false/);
  assert.match(migration, /'publication_approval_required', true/);
  assert.match(migration, /auto_generate = true,\s*auto_publish = false/);
  assert.match(runner, /release_schedule:\s*\{[^}]*auto_generate:\s*true,\s*auto_publish:\s*false,\s*automation_ready:\s*true,\s*publication_approval_required:\s*true/);
  assert.match(runner, /Automated publication remains disabled until separate audited publication authorization is implemented/);
  assert.doesNotMatch(runner, /release_schedule:\s*\{[^}]*auto_publish:\s*true/);
});


test("Edge Functions never enable automated publication by assignment", async () => {
  const root = new URL("../supabase/functions/", import.meta.url);
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) await collect(child);
      else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(child);
    }
  }
  await collect(root);
  const violations = [];
  const enableAssignment = /\bauto_publish\s*:\s*true\b|\bauto_publish\s*(?<![=!<>])=\s*true\b(?!\s*=)/g;
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(enableAssignment)) {
      const line = source.slice(0, match.index).split("\n").length;
      violations.push(`${file.pathname}:${line}`);
    }
  }
  assert.deepEqual(violations, [],
    "automated publication must remain disabled until a separately audited publication-authorization boundary exists; SQL migration invariants are tested separately");
});


test("autonomous runner keeps a new schedule inert until the readiness RPC confirms bootstrap", () => {
  const scheduleStart = runner.indexOf("const scheduleValues = {");
  const scheduleEnd = runner.indexOf("};", scheduleStart);
  const scheduleBlock = runner.slice(scheduleStart, scheduleEnd);
  assert.match(scheduleBlock, /enabled:\s*false/);
  assert.match(scheduleBlock, /auto_generate:\s*false/);
  assert.match(scheduleBlock, /auto_publish:\s*false/);
  assert.match(scheduleBlock, /schedule_mode:\s*"interval"/);
  const writeIndex = runner.indexOf("const scheduleWrite = existingSchedule");
  const confirmedIndex = runner.indexOf("if (scheduleWrite.error || !scheduleWrite.data?.id)", writeIndex);
  const readinessIndex = runner.indexOf('db.rpc("taleforge_mark_release_automation_ready"', writeIndex);
  assert.ok(writeIndex >= 0 && confirmedIndex > writeIndex && readinessIndex > confirmedIndex,
    "readiness must not be requested until the disabled schedule write is confirmed");
  assert.match(runner, /readinessResult\?\.ready !== true/);
  assert.match(runner, /auto_publication_enabled:\s*false/);
});


test("every Gemini provider-state reader fails closed on malformed throttle counters", () => {
  assert.equal(providerStateGuardFunctions.length, 13);
  for (const source of providerStateGuardFunctions) {
    assert.match(source, /Number\.isSafeInteger\((?:[^)]*consecutive_throttle_count|rawCount)\)/);
    assert.match(source, /(?:consecutive_throttle_count|rawCount)\s*<\s*0/);
  }
});


test("internal reference taxonomy raw reads are revoked while trusted workers retain access", () => {
  const migration = read("supabase/migrations/20261017100000_lock_internal_reference_taxonomy_reads.sql");
  const expectedTables = [
    "taleforge_genre_taxonomy",
    "taleforge_subgenre_intelligence",
    "taleforge_narrative_modes",
    "taleforge_story_trope_library",
    "taleforge_genre_grammars",
    "taleforge_genre_inversion_patterns",
    "taleforge_grammar_compatibility",
    "taleforge_hybrid_story_recipes",
    "taleforge_hybrid_story_recipes_generated",
    "taleforge_narrative_culture_profiles",
    "taleforge_series_genre_grammar_profiles",
    "taleforge_series_genre_profiles",
    "taleforge_series_narrative_profiles",
    "taleforge_series_subgenre_profiles",
  ];
  for (const table of expectedTables) assert.ok(migration.includes(`'${table}'`), `missing read lock for ${table}`);
  assert.match(migration, /REVOKE SELECT ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE SELECT \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /required taxonomy relation.*is missing; refusing partial read-surface lock/);
  assert.doesNotMatch(migration, /GRANT .* TO anon|GRANT .* TO authenticated/i);
});
