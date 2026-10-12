import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
import { nextWeeklyRelease } from "./weekly-schedule.ts";
import { resolveNextIntervalRelease } from "./interval-schedule.ts";
import { inspectPublishedChapterHistory } from "./published-history.ts";
import { qualifyReviewedOutputs, matchesPublishedChapterOutput } from "./review-qualified-outputs.ts";
import { matchesPublishedOutput } from "../release-publisher/publisher-idempotency.ts";
import { isPublishableGenerationStatus } from "../release-publisher/publisher-output-status.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const publishedHistoryUrl = new URL("./published-history.ts", import.meta.url);
const reviewQualifiedOutputsUrl = new URL("./review-qualified-outputs.ts", import.meta.url);
const schedulerUrl = new URL("./index.ts", import.meta.url);
const leaseFencingMigrationUrl = new URL("../../migrations/20261012190000_aevora_atomic_scheduler_lease_fencing.sql", import.meta.url);
const weeklyScheduleUrl = new URL("./weekly-schedule.ts", import.meta.url);
const publisherUrl = new URL("../release-publisher/index.ts", import.meta.url);
const publisherIdempotencyUrl = new URL("../release-publisher/publisher-idempotency.ts", import.meta.url);
const publisherOutputStatusUrl = new URL("../release-publisher/publisher-output-status.ts", import.meta.url);
const generationOrchestratorUrl = new URL("../generation-orchestrator/index.ts", import.meta.url);
const reviewOrchestratorUrl = new URL("../review-orchestrator/index.ts", import.meta.url);

Deno.test("scheduler only inspects disabled schedules for a targeted dry run", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const queryStart = source.indexOf("const buildScheduleQuery=()=>{");
  const queryEnd = source.indexOf("const schedules:any[]=[];", queryStart);
  const query = source.slice(queryStart, queryEnd);
  assert(queryStart >= 0 && queryEnd > queryStart, "schedule query builder must exist");
  assert(query.includes('if(!dryRun || !scheduleId) q=q.eq("enabled",true);'),
    "real runs and unscoped dry runs must filter to enabled schedules");
  assert(query.indexOf('if(!dryRun || !scheduleId) q=q.eq("enabled",true);') < query.indexOf('if(scheduleId) q=q.eq("id",scheduleId);'),
    "enabled-schedule policy must be established before explicit ID scoping");
  assert(query.includes("if(!dryRun && !scheduleId) q=q.eq(\"auto_publish\",true);"),
    "unscoped real runs must stay limited to auto-publish schedules");
  assert(source.includes("if(!dryRun && schedule.auto_publish){"),
    "dry runs must not acquire a lease even when inspecting a disabled schedule");
});

Deno.test("scheduler dry-run skips lease mutation and releases only a claimed lease", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes("if(!dryRun && schedule.auto_publish){\n        let leaseClaim:any=null;"), "only enabled auto-publish schedules may claim a real-run lease");
  assert(source.includes("if(leaseClaimed){"), "conditional lease release guard missing");
  assert(!source.includes('if(dryRun){\n        const leaseClaim'), "dry-run lease claim must not exist");
  assert(source.includes("catch(leaseClaimError)"), "lease claim transport exceptions must be isolated to one schedule");
  assert(source.includes("catch(scheduleError)"), "unexpected schedule errors must not abort the remaining due-schedule batch");
  assert(source.includes("catch(releaseError)"), "lease release transport exceptions must be reported without aborting the batch");
});

Deno.test("scheduler lease RPC names and arguments match the live prerequisite contract", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('supabase.rpc("aevora_claim_release_scheduler_lease",{'), "claim RPC name must remain aligned");
  assert(source.includes('supabase.rpc("aevora_renew_release_scheduler_lease",{'), "renew RPC name must remain aligned");
  assert(source.includes('supabase.rpc("aevora_release_scheduler_lease",{'), "release RPC name must remain aligned");
  assert(source.includes("p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180"), "claim/renew lease argument names must remain aligned");
  const releaseCall = source.indexOf('supabase.rpc("aevora_release_scheduler_lease",{');
  assert(releaseCall >= 0 && source.indexOf("p_schedule_id:schedule.id,p_lease_token:leaseToken", releaseCall) > releaseCall,
    "release must be scoped to the schedule and exact lease token");
  assert(source.includes("if(leaseClaimed){"), "release must be conditional on an acquired lease");
});

Deno.test("scheduler rejects malformed explicit schedule IDs before query scoping", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const parseBody = source.indexOf("let body:any;");
  const rawId = source.indexOf("const rawScheduleId=body.schedule_id;");
  const invalidGuard = source.indexOf('typeof rawScheduleId!=="string" || rawScheduleId.trim().length===0');
  const normalizedId = source.indexOf('const scheduleId=typeof rawScheduleId==="string"?rawScheduleId.trim():null;');
  const queryBuilder = source.indexOf("const buildScheduleQuery=()=>{");
  assert(parseBody >= 0 && rawId > parseBody, "request body must be parsed before reading the explicit schedule ID");
  assert(invalidGuard > rawId && normalizedId > invalidGuard, "explicit IDs must be validated and normalized before query construction");
  assert(queryBuilder > normalizedId, "query scoping must follow explicit schedule ID validation");
  assert(source.includes('error:"Request body must be valid JSON."'), "malformed JSON must not degrade into an unscoped scheduler run");
  assert(source.includes('body===null || typeof body!=="object" || Array.isArray(body)'), "scheduler request must be a JSON object, not null or an array");
  assert(source.includes('error:"Request body must be a JSON object."'), "non-object request bodies must receive a clear client error");
  assert(source.includes('error:"schedule_id must be a non-empty string when provided."'), "invalid explicit IDs must receive a clear client error");
  assert(!source.includes("rawScheduleId!==undefined && rawScheduleId!==null"), "explicit null IDs must not silently degrade into unscoped batch runs");
  assert(source.includes('body.dry_run!==undefined && typeof body.dry_run!=="boolean"'), "dry_run must be explicitly boolean when supplied");
  assert(source.includes('error:"dry_run must be a boolean when provided."'), "invalid dry_run values must receive a clear client error");
  assert(source.indexOf('body.dry_run!==undefined && typeof body.dry_run!=="boolean"') < source.indexOf("const dryRun=body.dry_run===true;"),
    "dry_run validation must precede execution-mode selection");
  assert(source.includes("if(scheduleId) q=q.eq(\"id\",scheduleId);"), "a normalized valid ID must scope the query");
});

Deno.test("scheduler validates caller and request before any database query or lease side effect", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const authGuard = source.indexOf("if(!isTrustedInternalApiKey(");
  const createClient = source.indexOf("const supabase=createClient(");
  const parseBody = source.indexOf("let body:any;");
  const malformedJsonGuard = source.indexOf('error:"Request body must be valid JSON."');
  const objectGuard = source.indexOf('body===null || typeof body!=="object" || Array.isArray(body)');
  const scheduleQuery = source.indexOf("const buildScheduleQuery=()=>{");
  const firstDatabaseRead = source.indexOf('supabase.from("release_schedules")');
  const leaseClaim = source.indexOf('supabase.rpc("aevora_claim_release_scheduler_lease"');
  assert(authGuard >= 0 && authGuard < createClient, "caller authentication must precede client initialization");
  assert(parseBody > createClient && malformedJsonGuard > parseBody, "request parsing must follow authentication and reject malformed JSON");
  assert(objectGuard > parseBody && scheduleQuery > objectGuard, "request shape validation must finish before query construction");
  assert(firstDatabaseRead > objectGuard && leaseClaim > objectGuard, "invalid request bodies must be rejected before database reads or lease claims");
  assert(source.indexOf('error:"schedule_id must be a non-empty string when provided."') < firstDatabaseRead,
    "invalid explicit schedule IDs must be rejected before database access");
  assert(source.indexOf('error:"dry_run must be a boolean when provided."') < firstDatabaseRead,
    "invalid dry_run values must be rejected before database access");
});

Deno.test("generation orchestrator fails closed when Gemini provider state is unavailable or malformed", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  const helperStart = source.indexOf("async function getGeminiCooldown(");
  const helperEnd = source.indexOf("\n }", helperStart);
  const helper = source.slice(helperStart, helperEnd >= 0 ? helperEnd : helperStart + 2000);
  assert(helper.includes("if(error || !data)"), "provider-state lookup errors and missing rows must both fail closed");
  assert(helper.includes("lookup_error:"), "unavailable provider state must expose an internal diagnostic reason");
  assert(helper.includes("Number.isFinite(until.getTime())"), "malformed cooldown timestamps must fail closed");
  const initialLookup = source.indexOf("geminiCooldown=await getGeminiCooldown(supabase)");
  const unavailableGuard = source.indexOf("if(geminiCooldown.lookup_error)", initialLookup);
  const requestParse = source.indexOf("const body=await req.json()", initialLookup);
  const intelligenceRefresh = source.indexOf("refreshDeterministicIntelligence(supabase)", initialLookup);
  assert(initialLookup >= 0 && unavailableGuard > initialLookup, "initial provider state must be checked");
  assert(requestParse > unavailableGuard && intelligenceRefresh > unavailableGuard,
    "unavailable provider state must stop orchestration before request processing and planning refresh");
  assert(source.includes('reason:"provider_state_unavailable"'), "provider-state failure must be explicitly reported as retryable and blocked");
  assert(source.includes('},503)}const body=await req.json().catch(()=>null)'), "provider-state failure must return HTTP 503 before orchestration continues");
});

Deno.test("generation orchestrator rejects malformed scope and mode inputs before schedule queries", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  const initialLookup = source.indexOf("geminiCooldown=await getGeminiCooldown(supabase)");
  const parseBody = source.indexOf("const body=await req.json().catch(()=>null)", initialLookup);
  const objectGuard = source.indexOf('body===null||typeof body!=="object"||Array.isArray(body)', parseBody);
  const scheduleQuery = source.indexOf('let q=supabase.from("release_schedules")', objectGuard);
  assert(parseBody > initialLookup && objectGuard > parseBody, "malformed JSON and non-object bodies must be rejected after provider-state protection");
  assert(source.includes('error:"Request body must be valid JSON object."'), "malformed requests must not degrade into unscoped generation runs");
  assert(source.includes('for(const field of ["series_id","schedule_id"] as const)'), "explicit scope identifiers must be validated");
  assert(source.includes('field+" must be a non-empty string when provided."'), "null, blank, and non-string scope IDs must be rejected");
  assert(source.includes('body.dry_run!==undefined&&typeof body.dry_run!=="boolean"'), "dry_run must be boolean when provided");
  assert(source.includes('body.review_after_generation!==undefined&&typeof body.review_after_generation!=="boolean"'), "review_after_generation must be boolean when provided");
  assert(scheduleQuery > objectGuard, "schedule queries must follow request validation");
});

Deno.test("generation orchestrator dry-run avoids known database mutations", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  assert(source.includes('const intelligenceRefresh=dryRun?{ok:true,report:{gemini_used:false,content_generation_performed:false,skipped:"dry_run_read_only"}}:await refreshDeterministicIntelligence(supabase);'),
    "dry-run must skip deterministic intelligence refresh RPCs that write state");
  assert(source.includes('const advancedPlanBuildResult=dryRun?{data:null,error:null}:await supabase.rpc("taleforge_build_advanced_chapter_plans"'),
    "dry-run must not build or upsert advanced chapter plans");
  assert(source.includes('if(!dryRun)for(const o of [...latest.values()].filter((o)=>o.generation_status==="needs_revision"'),
    "dry-run must not mutate exhausted revision statuses");
  assert(source.includes('if(!dryRun){for(const c of candidates){const sel=await supabase.rpc("taleforge_select_revision_strategy"'),
    "dry-run must not invoke the revision-selection RPC that inserts or updates selections");
  assert(source.includes('else if(candidates.length){const{data:storedSelections,error:storedSelectionsError}=await supabase.from("taleforge_revision_selections").select('),
    "dry-run should use existing revision selections through read-only lookup");
  assert(source.includes("read_only:dryRun"), "response must declare whether the diagnostic run was read-only");
  assert(source.includes('mutations_skipped:dryRun?["deterministic_intelligence_refresh","advanced_chapter_plan_build","revision_exhaustion_updates","revision_strategy_selection"]:[]'),
    "read-only dry-run must report which mutations were skipped");
});

Deno.test("review orchestrator rejects malformed or unscoped request values before output queries", async () => {
  const source = await Deno.readTextFile(reviewOrchestratorUrl);
  const parseBody = source.indexOf("let body: unknown;");
  const objectGuard = source.indexOf("body === null || typeof body !== \"object\" || Array.isArray(body)");
  const fieldGuard = source.indexOf('for (const field of ["output_id", "series_id"] as const)');
  const dryRunGuard = source.indexOf('request.dry_run !== undefined && typeof request.dry_run !== "boolean"');
  const outputQuery = source.indexOf('let outputQuery = supabase');
  assert(parseBody >= 0 && objectGuard > parseBody, "malformed JSON and non-object request bodies must be rejected");
  assert(source.includes('error: "Request body must be valid JSON."'), "malformed JSON must not become an unscoped review batch");
  assert(source.includes('error: "Request body must be a JSON object."'), "request body must be an object");
  assert(fieldGuard > objectGuard && dryRunGuard > fieldGuard, "scope and execution-mode validation must precede query construction");
  assert(source.includes('field + " must be a non-empty string when provided."'), "explicit null, blank, and non-string IDs must be rejected");
  assert(outputQuery > dryRunGuard, "output queries must follow all request validation");
  assert(source.includes('request.dry_run === true'), "only an explicit boolean true may enable dry-run mode");
});

Deno.test("review orchestrator fails closed when Gemini cooldown timestamp is malformed", async () => {
  const source = await Deno.readTextFile(reviewOrchestratorUrl);
  const invalidTimestampGuard = source.indexOf('!Number.isFinite(new Date(providerState.cooldown_until).getTime())');
  const invalidResponse = source.indexOf('reason: "provider_state_unavailable"', invalidTimestampGuard);
  const responseEnd = source.indexOf('}, 503);', invalidTimestampGuard);
  const activeCooldownGuard = source.indexOf('providerState?.cooldown_until && new Date(providerState.cooldown_until).getTime() > Date.now()');
  assert(invalidTimestampGuard >= 0, "malformed non-empty cooldown timestamps must be detected");
  assert(invalidResponse > invalidTimestampGuard && responseEnd > invalidTimestampGuard,
    "malformed cooldown state must return a retryable fail-closed response");
  assert(activeCooldownGuard > invalidTimestampGuard, "timestamp validation must precede active-cooldown comparison");
  assert(source.includes("no review model calls were made."), "malformed provider state must block all review model calls");
});

Deno.test("review orchestrator reports active Gemini cooldown as HTTP 429", async () => {
  const source = await Deno.readTextFile(reviewOrchestratorUrl);
  const cooldownGuard = source.indexOf('} else if (providerState?.cooldown_until && new Date(providerState.cooldown_until).getTime() > Date.now())');
  const responseStart = source.indexOf('return json({', cooldownGuard);
  const responseEnd = source.indexOf('}, 429);', responseStart);
  assert(cooldownGuard >= 0 && responseStart > cooldownGuard, "active provider cooldown must return a blocked response");
  assert(responseEnd > responseStart, "active provider cooldown must use HTTP 429 so callers do not treat it as successful review");
  assert(source.slice(responseStart, responseEnd).includes('success: false'), "blocked cooldown must not be represented as a successful review");
  assert(source.slice(responseStart, responseEnd).includes('blocked: true') && source.slice(responseStart, responseEnd).includes('retryable: true'),
    "cooldown response must be explicitly blocked and retryable");
});

Deno.test("scheduler pages schedules and approved outputs in stable order", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('return q.order("id",{ascending:true});'), "schedule ID ordering missing");
  assert(source.includes("buildScheduleQuery().range(offset,offset+499)"), "schedule paging missing");
  assert(source.includes('.order("chapter_number",{ascending:true})\n          .order("created_at",{ascending:false})\n          .order("id",{ascending:true})\n          .range(offset,offset+499)'), "approved output ordering/paging missing");
});

Deno.test("scheduler passes raw interval configuration to the strict resolver", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes("resolveNextIntervalRelease(processingCompletedAt,schedule.interval_hours)"),
    "scheduler must pass the original interval value so strict string validation cannot be bypassed");
  assert(!source.includes("const hours=Number(schedule.interval_hours)"),
    "scheduler must not coerce malformed interval strings before validation");
});

Deno.test("interval release resolver rejects overflow and non-advancing timestamps", () => {
  const base = new Date("2026-10-12T12:00:00.000Z");
  assert(resolveNextIntervalRelease(base, 24).toISOString() === "2026-10-13T12:00:00.000Z",
    "a valid 24-hour interval should resolve exactly");
  assert(resolveNextIntervalRelease(base, "0.5").toISOString() === "2026-10-12T12:30:00.000Z",
    "numeric database interval values should resolve");
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e308, 1e-100, null, undefined, true, false, [], {}, "", "   ", "0x10", "0b10", "0o10", "1_0", "not-a-number"]) {
    let threw = false;
    try { resolveNextIntervalRelease(base, invalid); } catch { threw = true; }
    assert(threw, "invalid, overflowing, or non-advancing intervals must fail closed");
  }
  let invalidBase = false;
  try { resolveNextIntervalRelease(new Date(Number.NaN), 24); } catch { invalidBase = true; }
  assert(invalidBase, "an invalid base timestamp must fail closed");

  let overflowedBase = false;
  try { resolveNextIntervalRelease(new Date(8.64e15 - 1000), 1); } catch { overflowedBase = true; }
  assert(overflowedBase, "an interval beyond JavaScript's supported date range must fail closed");
});

Deno.test("scheduler validates interval arithmetic before side effects and reuses safe resolver", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('import { resolveNextIntervalRelease } from "./interval-schedule.ts"'),
    "scheduler must use the tested interval resolver");
  const preflight = source.indexOf("resolveNextIntervalRelease(now,schedule.interval_hours)");
  const lifecycleRead = source.indexOf('from("story_lifecycle")');
  assert(preflight >= 0 && preflight < lifecycleRead,
    "invalid interval deadlines must be rejected before lifecycle or publication processing");
  assert(source.includes("resolveNextIntervalRelease(new Date(latestReleaseMs),schedule.interval_hours)"),
    "cooldown arithmetic must reject overflow instead of accidentally bypassing the cooldown");
  assert(source.includes("resolveNextIntervalRelease(processingCompletedAt,schedule.interval_hours)"),
    "next-release scheduling must pass raw interval configuration through the same strict resolver");
  assert(source.includes("const processingCompletedAt=new Date();"), "next interval deadline must use processing-completion time");
  assert(!source.includes("resolveNextIntervalRelease(base>now?base:now,schedule.interval_hours)"), "stale invocation time must not anchor the next interval deadline");
  assert(source.includes("nextWeeklyRelease(processingCompletedAt,Number(schedule.preferred_weekday)"), "weekly deadline must share the completion-time anchor");
  assert(source.includes("last_release_at:processingCompletedAt.toISOString()"), "last release timestamp must reflect processing completion, not invocation start");
  assert(!source.includes("new Date(latestReleaseMs+Number(schedule.interval_hours)*3600000)"),
    "raw interval arithmetic must not bypass validation");
});

Deno.test("weekly schedule uses validated IANA timezone and DST-aware wall time", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const helper = await Deno.readTextFile(weeklyScheduleUrl);
  assert(source.includes('String(schedule.timezone??"UTC")'), "schedule timezone is not passed to weekly resolver");
  assert(source.includes('import { nextWeeklyRelease } from "./weekly-schedule.ts"'), "scheduler must use the directly tested weekly resolver");
  assert(helper.includes('/^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/'), "strict wall-time validation regex missing");
  assert(helper.includes("matchingWallTimeCandidates"), "DST fold/gap resolver missing");
  assert(source.indexOf("Validate scheduling configuration before any publication side effect.") < source.indexOf('from("story_lifecycle")'), "schedule preflight must precede publication setup");
  assert(!source.includes("nextRelease=now;"), "activation must not trigger an immediate extra release batch");
  assert(source.includes("nextRelease=nextWeeklyRelease(processingCompletedAt,Number(schedule.preferred_weekday)"),
    "weekly next-release deadline must be recomputed after processing so a long batch cannot persist an already-expired slot");
});

Deno.test("weekly resolver handles normal timezone conversion, DST gaps, and both sides of DST folds", () => {
  const india = nextWeeklyRelease(new Date("2026-10-10T12:00:00Z"), 0, "09:00", "Asia/Kolkata");
  assert(india.toISOString() === "2026-10-11T03:30:00.000Z", "India wall time should convert to the correct UTC instant");

  const springGap = nextWeeklyRelease(new Date("2026-03-07T17:00:00Z"), 0, "02:30", "America/New_York");
  assert(springGap.toISOString() === "2026-03-15T06:30:00.000Z", "nonexistent spring-forward wall time should defer to the next valid week");

  const fallFoldBefore = nextWeeklyRelease(new Date("2026-10-31T16:00:00Z"), 0, "01:30", "America/New_York");
  assert(fallFoldBefore.toISOString() === "2026-11-01T05:30:00.000Z", "before a fall-back fold, choose its first future occurrence");

  const fallFoldBetween = nextWeeklyRelease(new Date("2026-11-01T05:45:00Z"), 0, "01:30", "America/New_York");
  assert(fallFoldBetween.toISOString() === "2026-11-01T06:30:00.000Z", "between repeated wall times, choose the second future occurrence");

  const afterToday = nextWeeklyRelease(new Date("2026-10-11T10:00:00Z"), 0, "01:30", "America/New_York");
  assert(afterToday.toISOString() === "2026-10-18T05:30:00.000Z", "after today's weekly slot, advance to next week");

  const exactlyAtSlot = nextWeeklyRelease(new Date("2026-10-11T05:30:00Z"), 0, "01:30", "America/New_York");
  assert(exactlyAtSlot.toISOString() === "2026-10-18T05:30:00.000Z", "an occurrence at exactly now is not a future release");

  for (const [weekday, time, zone] of [[7, "09:00", "UTC"], [0, "25:00", "UTC"], [0, "09:00", "Not/AZone"]] as const) {
    let threw = false;
    try { nextWeeklyRelease(new Date("2026-10-10T12:00:00Z"), weekday, time, zone); } catch { threw = true; }
    assert(threw, "invalid weekday, wall time, or timezone must be rejected");
  }
});

Deno.test("schedule advancement and lifecycle activation use atomic lease-fenced RPCs", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('supabase.rpc("aevora_advance_release_schedule_if_lease_owned",{'),
    "schedule deadline writes must use the atomic lease-fenced RPC");
  assert(source.includes('supabase.rpc("aevora_activate_story_lifecycle_if_lease_owned",{'),
    "lifecycle activation must use the atomic lease-fenced RPC");
  assert(!source.includes('.update(update).eq("id",schedule.id)'),
    "schedule advancement must not be split into a separate PostgREST update");
  assert(!source.includes('.update({lifecycle_status:"active"'),
    "lifecycle activation must not be split into a separate PostgREST update");
  assert(source.includes("if(advancement.error || advancement.data!==true)"),
    "unconfirmed atomic schedule advancement must fail closed");
  assert(source.includes("if(activation.error || activation.data!==true)"),
    "unconfirmed atomic lifecycle activation must fail closed");
  assert(!source.includes("const approved:any[]=[];"), "redundant preparing-lifecycle output preflight should stay removed");
});

Deno.test("atomic lease-fencing migration locks and validates ownership and restricts execution", async () => {
  const sql = await Deno.readTextFile(leaseFencingMigrationUrl);
  assert(sql.includes("aevora_advance_release_schedule_if_lease_owned"), "atomic schedule RPC definition missing");
  assert(sql.includes("aevora_activate_story_lifecycle_if_lease_owned"), "atomic lifecycle RPC definition missing");
  assert(sql.split("FOR UPDATE").length - 1 === 2, "both RPCs must lock the lease row through their transaction");
  assert(sql.split("v_lease_token <> p_lease_token").length - 1 === 2, "both RPCs must validate the exact lease token");
  assert(sql.split("v_lease_expires_at <= clock_timestamp()").length - 1 === 2, "both RPCs must reject expired leases");
  assert(sql.split("SECURITY DEFINER").length - 1 === 2, "both RPCs must use the reviewed security-definer contract");
  assert(sql.split("SET search_path TO 'pg_catalog', 'public', 'pg_temp'").length - 1 === 2, "both RPCs must pin search_path");
  assert(sql.includes("FROM PUBLIC, anon, authenticated"), "untrusted roles must not retain execute privileges");
  assert(sql.includes("TO postgres, service_role"), "only postgres and service_role should be granted execute");
});

Deno.test("scheduler requires strict publisher confirmation and database-published status", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes("d.success===true && d.published===true"), "publisher positive flags missing");
  assert(source.includes('d.status==="published"'), "publisher published status check missing");
  assert(source.includes('confirmedChapter.status!=="published"'), "database status confirmation missing");
});

Deno.test("publisher idempotency paths reject non-published rows before side effects", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  assert(source.split("CHAPTER_SLOT_CONFLICT").length - 1 === 2, "both existing-row and race guards must exist");
  const identitySource = await Deno.readTextFile(publisherIdempotencyUrl);
  assert(source.includes('from "./publisher-idempotency.ts"'), "publisher must use the tested identity helper");
  assert(identitySource.includes("function matchesPublishedOutput(chapter: any, output: any): boolean"), "published-output identity check missing");
  assert(identitySource.includes("chapterContent === outputContent"), "existing chapter must match the requested output content");
  assert(source.includes("if (!matchesPublishedOutput(existingChapter, output))"), "existing-row identity guard missing");
  assert(source.indexOf("if (!matchesPublishedOutput(existingChapter, output))") < source.indexOf("const synchronizationWarnings: string[] = [];"), "existing-row guard must precede synchronization");
  assert(source.includes("if (!matchesPublishedOutput(racedChapter, output))"), "race-path identity guard missing");
  assert(source.indexOf("if (!matchesPublishedOutput(racedChapter, output))") < source.indexOf("chapter_id: racedChapter.id"), "race guard must precede idempotent success");
  const raceGuard = source.indexOf("if (!matchesPublishedOutput(racedChapter, output))");
  const raceSync = source.indexOf("const raceSynchronizationWarnings");
  assert(raceSync > raceGuard, "race-path metadata sync must occur only after identity validation");
  assert(source.includes("racedSeriesSyncError") && source.includes("racedOutputSyncError") && source.includes("racedBlueprintSyncError"), "verified race path must attempt series, output, and blueprint synchronization");
  assert(source.includes("taleforge_ceo_execution_gate"), "Clara governance gate must remain");
  assert(source.includes("chapter_publication_reviews"), "publication review gate must remain");
});

Deno.test("publisher verifies the inserted database row before reporting success", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  const insertGuard = source.indexOf("if (!matchesPublishedOutput(insertedChapter, output))");
  const syncSection = source.indexOf("13. Synchronize generation output");
  assert(insertGuard >= 0, "inserted chapter identity/status confirmation guard missing");
  assert(syncSection > insertGuard, "inserted row must be verified before synchronization and final success response");
  assert(source.includes('code: "INSERTED_CHAPTER_STATUS_CONFLICT"'), "mismatched inserted row must return an explicit conflict");
});

Deno.test("publisher idempotency only confirms the exact published chapter output", () => {
  const output = {
    series_id: "series-a",
    chapter_number: 7,
    title: "  The Last Signal  ",
    content: "  A beacon blinked twice.  ",
  };
  const exactChapter = {
    id: "chapter-7",
    series_id: "series-a",
    chapter_number: 7,
    status: "published",
    title: "The Last Signal",
    content: "A beacon blinked twice.",
  };
  assert(matchesPublishedOutput(exactChapter, output), "same published content should be safely idempotent");
  assert(!matchesPublishedOutput({...exactChapter, content:"A different signal."}, output), "different output content must conflict");
  assert(!matchesPublishedOutput({...exactChapter, title:"Another Title"}, output), "different output title must conflict");
  assert(!matchesPublishedOutput({...exactChapter, status:"draft"}, output), "non-published row must conflict");
  assert(!matchesPublishedOutput({...exactChapter, series_id:"series-b"}, output), "different series must conflict");
  assert(!matchesPublishedOutput({...exactChapter, chapter_number:8}, output), "different chapter slot must conflict");
  for (const malformed of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert(!matchesPublishedOutput({...exactChapter, chapter_number:malformed}, output), "malformed existing chapter number must conflict");
    assert(!matchesPublishedOutput(exactChapter, {...output, chapter_number:malformed}), "malformed requested chapter number must conflict");
  }
  assert(!matchesPublishedOutput({...exactChapter, content:"   "}, output), "empty chapter content must not be idempotent");
});

Deno.test("published chapter history fails closed on gaps, duplicates, and malformed numbers", () => {
  assert(JSON.stringify(inspectPublishedChapterHistory([])) === JSON.stringify({ok:true,latestNumber:0,firstMissingChapter:null}), "empty history should be valid");
  assert(JSON.stringify(inspectPublishedChapterHistory([1,2,3])) === JSON.stringify({ok:true,latestNumber:3,firstMissingChapter:null}), "contiguous chapter history should be valid");
  assert(JSON.stringify(inspectPublishedChapterHistory([1,2,3,3])) === JSON.stringify({ok:false,reason:"duplicate_chapter_number"}), "duplicate published chapter numbers must fail closed");
  assert(JSON.stringify(inspectPublishedChapterHistory([1,2,4,5])) === JSON.stringify({ok:true,latestNumber:5,firstMissingChapter:3}), "missing middle chapter should be detected");
  for (const malformed of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert(inspectPublishedChapterHistory([1,2,malformed]).ok === false, "malformed published chapter numbers must fail closed");
  }
  for (const malformed of [true, false, {}, [], [1], "0x1", "1e0", "1.0", " 1 "]) {
    assert(inspectPublishedChapterHistory([1,2,malformed]).ok === false,
      "booleans, objects, arrays, and non-decimal numeric strings must not coerce into chapter numbers");
  }
  assert(inspectPublishedChapterHistory([1, "2", 3]).ok === true,
    "plain decimal integer strings remain compatible with serialized database values");
});

Deno.test("scheduler pages complete published history and pauses on a numbering gap", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('from "./published-history.ts"'), "scheduler must use the tested history helper");
  assert(source.includes('.select("id,chapter_number,published_at").eq("series_id",schedule.series_id).eq("status","published")'), "published history query missing");
  assert(source.includes('.range(offset,offset+499)'), "published history must be paginated");
  assert(source.includes('action:"published_chapter_gap"'), "scheduler must pause on a published chapter gap");
  assert(source.indexOf('action:"published_chapter_gap"') < source.indexOf("const readyOutputs:any[]=[];"), "gap guard must run before ready output selection");
  await Deno.readTextFile(publishedHistoryUrl);
});

Deno.test("recent publication timestamps prevent immediate follow-up batches after failed schedule advancement", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes("schedule.last_release_at"), "schedule last-release timestamp must be considered");
  assert(source.includes("row.published_at"), "published chapter timestamps must provide a recovery reference");
  assert(source.includes("releaseReferenceTimes.reduce"), "large publication histories must not use spread arguments to compute the latest timestamp");
  assert(source.includes("scheduleCooldownActive=!!scheduleCooldownUntil && now.getTime()<scheduleCooldownUntil.getTime()"), "cooldown must compare current time with next eligible release");
  assert(source.includes("if(releaseReferenceTimes.length>0)") && !source.includes("if(!dryRun && releaseReferenceTimes.length>0)"), "dry-run must report the same cooldown without mutating state");
  assert(source.includes("const publishCount=scheduleCooldownActive?0:Math.min(uniqueReady.length,dailyMax)"), "active cooldown must suppress publishing another batch");
  assert(source.includes('scheduleCooldownActive?"schedule_cooldown":"checked"'), "cooldown must be observable in the result");
  assert(source.indexOf("const publishCount=scheduleCooldownActive?0:") < source.indexOf("if(!dryRun && schedule.auto_publish && publishCount>0)"), "cooldown must be evaluated before publication");
  assert(source.indexOf('if(!dryRun && schedule.auto_publish && lifecycleStatus==="preparing"') > source.indexOf("const publishCount="), "cooldown must not bypass preparing-lifecycle verification");
});

Deno.test("scheduler qualifies publication reviews before deduplicating output revisions", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const helperSource = await Deno.readTextFile(reviewQualifiedOutputsUrl);
  const reviewQuery = source.indexOf('from("chapter_publication_reviews")');
  const filter = source.indexOf("qualifyReviewedOutputs(readyOutputs,publicationReviewRows)");
  const deduplication = source.indexOf("const uniqueReady:any[]=[];");
  assert(reviewQuery >= 0, "scheduler must load review rows for ready outputs");
  assert(source.includes('select("id,generation_output_id,decision,quality_passed,continuity_passed,originality_passed,safety_passed")'), "all review gates and stable review IDs must be loaded");
  assert(source.split("for(let reviewOffset=0;;reviewOffset+=500)").length - 1 === 2, "candidate and lifecycle review rows must be fully paginated");
  assert(source.split('.order("generation_output_id",{ascending:true}).order("id",{ascending:true})').length - 1 === 2, "review pagination must use a deterministic unique tie-breaker");
  assert(source.split(".range(reviewOffset,reviewOffset+499)").length - 1 === 2, "review pagination must not rely on the default API row limit");
  assert(source.includes('from "./review-qualified-outputs.ts"'), "scheduler must use the tested review helper");
  assert(filter > reviewQuery && filter < deduplication, "review qualification must precede chapter-slot deduplication");
  assert(source.includes("Failed to inspect publication reviews for ready chapters."), "review query failure must fail closed");
  assert(helperSource.includes("review.decision === \"approved\""), "review decision must be explicitly approved");
  assert(helperSource.includes("review.quality_passed === true") && helperSource.includes("review.continuity_passed === true") &&
    helperSource.includes("review.originality_passed === true") && helperSource.includes("review.safety_passed === true"), "all four gates must be explicitly true");
  assert(helperSource.includes("if (rows.length !== 1) continue;"), "ambiguous/multiple review rows must fail closed");
});

Deno.test("review qualification excludes missing, rejected, incomplete, and ambiguous reviews", () => {
  const outputs = [
    {id:"valid",chapter_number:1},
    {id:"missing",chapter_number:2},
    {id:"rejected",chapter_number:3},
    {id:"one-gate-failed",chapter_number:4},
    {id:"ambiguous",chapter_number:5},
  ];
  const approved = (id:string) => ({
    generation_output_id:id,decision:"approved",quality_passed:true,
    continuity_passed:true,originality_passed:true,safety_passed:true,
  });
  const reviews = [
    approved("valid"),
    {...approved("rejected"),decision:"rejected"},
    {...approved("one-gate-failed"),safety_passed:false},
    approved("ambiguous"),
    approved("ambiguous"),
  ];
  const qualified = qualifyReviewedOutputs(outputs,reviews);
  assert(JSON.stringify(qualified.map((row)=>row.id)) === JSON.stringify(["valid"]), "only exactly-one fully approved review should qualify");
  const revisions = [{id:"newer-unreviewed",chapter_number:6},{id:"older-reviewed",chapter_number:6}];
  assert(JSON.stringify(qualifyReviewedOutputs(revisions,[approved("older-reviewed")]).map((row)=>row.id)) === JSON.stringify(["older-reviewed"]),
    "a newer unreviewed revision must not hide an older reviewed output");
  assert(qualifyReviewedOutputs(outputs,[]).length===0, "missing review rows must be excluded");
  assert(qualifyReviewedOutputs([{id:123} as any],[approved("123")]).length===0, "non-string output identifiers must fail closed");
});

Deno.test("preparing lifecycle activation requires fully reviewed launch outputs", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const query = source.indexOf('.select("id,series_id,chapter_number,title,content,generation_status")');
  const qualification = source.indexOf("const launchReviewedOutputs=qualifyReviewedOutputs(launchApproved,launchReviewRows)");
  const launchReady = source.indexOf("const launchReady=launchNumbers.filter");
  const activationGate = source.indexOf("if(launchReady.length===launchCount)");
  const activation = source.indexOf('.update({lifecycle_status:"active"');
  assert(query >= 0 && source.indexOf('.in("generation_status",["approved","published"]).lte("chapter_number",launchCount)',query) > query, "launch verification must load approved/published output IDs and chapter numbers");
  assert(source.includes("const launchReviewRows:any[]=[];"), "launch review rows must be fetched");
  assert(qualification > query && launchReady > qualification && activationGate > launchReady && activation > activationGate, "lifecycle activation must follow review-qualified launch verification");
  assert(source.includes("matchesPublishedChapterOutput(chapterRows[0],output)"), "launch chapter must match reviewed output identity");
  assert(source.includes("launchReviewError"), "review query failure must block lifecycle activation");
  assert(source.includes("const invalidDailyConfig=") && source.includes("const invalidLaunchConfig="), "invalid lifecycle chapter limits must be rejected before publication");
  assert(source.indexOf("if(invalidDailyConfig || invalidLaunchConfig)") < source.indexOf("if(!dryRun && schedule.auto_publish && publishCount>0)"), "lifecycle limits must be validated before publication side effects");
  assert(source.includes('.range(offset,offset+499)'), "launch chapter/output history queries must be paginated");
  assert(source.includes('.select("series_id,lifecycle_status").maybeSingle()'), "lifecycle activation must return a confirmation row");
  assert(source.includes('!updatedLifecycle || updatedLifecycle.lifecycle_status!=="active"'), "missing or non-active lifecycle update must fail closed");
  assert(source.includes('if(!dryRun && schedule.auto_publish && lifecycleStatus==="preparing" && !publicationFailed && !leaseLost)'), "preparing lifecycle verification must be retryable without publishing a new chapter");
  assert(!source.includes('lifecycleStatus==="preparing" && published.length>0'), "lifecycle retry must not depend on a new publication in the current run");
});

Deno.test("publisher validates output_id before governance and database lookups", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  const parseBody = source.indexOf("const body = await req.json().catch(() => null)");
  const validateId = source.indexOf('typeof outputId !== "string" || outputId.length === 0');
  const governance = source.indexOf('supabase.rpc("taleforge_ceo_execution_gate"');
  const outputQuery = source.indexOf('.from("chapter_generation_outputs")');
  assert(parseBody >= 0 && validateId > parseBody, "request body must be parsed before validating output_id");
  assert(governance > validateId, "invalid identifiers must be rejected before the governance RPC");
  assert(source.includes('typeof body?.output_id === "string" ? body.output_id.trim() : body?.output_id'), "string identifiers must be trimmed before lookup");
  assert(outputQuery > governance, "output lookup must follow request validation and governance authorization");
  assert(source.includes('error: "output_id must be a non-empty string."'), "invalid identifiers must receive a clear client error");
});

Deno.test("publisher rejects non-approved generation statuses before review or publication", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  const guard = source.indexOf("if (!isPublishableGenerationStatus(output.generation_status))");
  const reviewQuery = source.indexOf('from("chapter_publication_reviews")');
  assert(guard >= 0 && guard < reviewQuery, "generation status must be checked before publication processing");
  assert(source.includes('from "./publisher-output-status.ts"'), "publisher must use the tested status policy");
  assert(source.includes('code: "OUTPUT_STATUS_CONFLICT"'), "ineligible status must return a distinct conflict");
  const existingChapterQuery = source.indexOf('.from("chapters")');
  const orphanedPublishedGuard = source.indexOf('if (output.generation_status === "published")');
  const insertChapter = source.indexOf('.insert(chapterInsert)');
  assert(existingChapterQuery >= 0 && orphanedPublishedGuard > existingChapterQuery && orphanedPublishedGuard < insertChapter,
    "published-status output without an existing chapter must be rejected before creating a new chapter");
  assert(source.includes("no matching published chapter occupies its slot"), "orphaned published output conflict must be explicit");
  await Deno.readTextFile(publisherOutputStatusUrl);
  assert(isPublishableGenerationStatus("approved"), "approved output should be eligible for review-gated publication");
  assert(isPublishableGenerationStatus("published"), "published output should permit safe idempotent retry");
  for (const status of [null, undefined, "", "generated", "quality_check", "needs_revision", "rejected", "draft"]) {
    assert(!isPublishableGenerationStatus(status), "non-approved status must fail closed");
  }
});

Deno.test("normal cron scans exclude auto-publish-disabled schedules while dry-run can inspect them", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const queryBuilder = source.indexOf("const buildScheduleQuery=()=>");
  const explicitSchedule = source.indexOf('if(scheduleId) q=q.eq("id",scheduleId);');
  const dueFilter = source.indexOf('if(!dryRun || !scheduleId) q=q.or(');
  const autoPublishFilter = source.indexOf('if(!dryRun && !scheduleId) q=q.eq("auto_publish",true);');
  assert(queryBuilder >= 0 && explicitSchedule > queryBuilder && dueFilter > explicitSchedule, "schedule query branching must remain explicit");
  assert(autoPublishFilter > dueFilter, "normal cron scans should filter disabled auto-publish schedules only in the due-schedule branch");
  assert(source.includes("Explicit IDs can inspect disabled schedules, but auto-publish remains separately gated."), "explicit schedule IDs should retain diagnostic visibility without bypassing auto-publish");
  assert(source.includes("if(!dryRun || !scheduleId)"), "only an explicit dry-run diagnostic may inspect a future schedule");
});

Deno.test("lifecycle chapter identity requires matching published content and scope", () => {
  const output = {series_id:"series-a",chapter_number:1,title:"  Opening  ",content:"  The story begins.  "};
  const chapter = {series_id:"series-a",chapter_number:1,status:"published",title:"Opening",content:"The story begins."};
  assert(matchesPublishedChapterOutput(chapter,output), "matching published chapter/output should qualify");
  assert(!matchesPublishedChapterOutput({...chapter,content:"Different content."},output), "content mismatch must fail");
  assert(!matchesPublishedChapterOutput({...chapter,title:"Different title"},output), "title mismatch must fail");
  assert(!matchesPublishedChapterOutput({...chapter,series_id:"series-b"},output), "series mismatch must fail");
  assert(!matchesPublishedChapterOutput({...chapter,chapter_number:2},output), "chapter mismatch must fail");
  assert(!matchesPublishedChapterOutput({...chapter,status:"draft"},output), "non-published chapter must fail");
});


Deno.test("explicit schedule IDs cannot bypass due-time checks during real runs", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('if(scheduleId) q=q.eq("id",scheduleId);'), "explicit schedule ID filter missing");
  assert(source.includes('if(!dryRun || !scheduleId) q=q.or(`next_release_at.is.null,next_release_at.lte.${now.toISOString()}`);'), "normal scans and all real runs must enforce due-time");
  assert(source.includes('if(!dryRun && !scheduleId) q=q.eq("auto_publish",true);'), "normal cron scans must filter auto-publish-disabled schedules");
  assert(source.includes("if(!dryRun || !scheduleId) q=q.or("), "only an explicit dry-run diagnostic may inspect a future schedule");
  assert(source.indexOf('if(!dryRun || !scheduleId) q=q.or(') < source.indexOf('if(!dryRun && !scheduleId) q=q.eq("auto_publish",true);'), "due-time gate must apply before normal-scan filter");
});


Deno.test("explicit disabled schedule diagnostics do not claim a write lease", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('if(!dryRun && schedule.auto_publish){'), "lease claims must require a real run and auto_publish=true");
  assert(source.includes("if(leaseClaimed){"), "only an actually claimed lease may be released");
  assert(source.includes('if(!dryRun && schedule.auto_publish && publishCount>0){'), "disabled schedules must not publish when explicitly inspected");
  assert(source.includes('if(!dryRun && schedule.auto_publish && lifecycleStatus==="preparing"'), "disabled schedules must not transition lifecycle state");
});

Deno.test("release handlers reject non-service-role callers before database operations", async () => {
  const scheduler = await Deno.readTextFile(schedulerUrl);
  const publisher = await Deno.readTextFile(publisherUrl);
  const schedulerGuard = scheduler.indexOf('isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))');
  const schedulerClient = scheduler.indexOf("createClient(url,key");
  assert(schedulerGuard >= 0 && schedulerGuard < schedulerClient,
    "scheduler must authenticate the configured server-side apikey before creating a database client");
  const publisherGuard = publisher.indexOf('isTrustedInternalApiKey(req.headers.get("apikey"), serviceRoleKey, Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))');
  const publisherClient = publisher.indexOf("createClient(");
  assert(publisherGuard >= 0 && publisherGuard < publisherClient,
    "publisher must authenticate the configured server-side apikey before creating a database client");
  assert(scheduler.includes("},401);"), "scheduler unauthorized callers must receive HTTP 401");
  assert(publisher.includes("}, 401);"), "publisher unauthorized callers must receive HTTP 401");
  assert(scheduler.includes('Deno.env.get("SUPABASE_SECRET_KEYS")') && publisher.includes('Deno.env.get("SUPABASE_SECRET_KEYS")'),
    "both handlers must support the newer server-side secret-key environment");
  assert(scheduler.includes('Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES")') && publisher.includes('Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES")'),
    "both handlers must require an explicit allowlist for newer secret-key names");
  const publisherCall = scheduler.indexOf('fetch(url+"/functions/v1/release-publisher"');
  const publisherAuth = scheduler.indexOf('Authorization:"Bearer "+key,apikey:key', publisherCall);
  assert(publisherCall >= 0 && publisherAuth > publisherCall,
    "scheduler internal publisher call must forward its configured server-side apikey");
  assert(scheduler.includes('const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")'),
    "scheduler database client must retain its legacy service-role environment fallback");
});

Deno.test("internal API-key validation requires an explicit named-secret allowlist", () => {
  const legacy = "legacy-service-role";
  const secretKeys = JSON.stringify({default:"sb_secret_default_key",internal:"sb_secret_internal_key",other:"sb_secret_other_key"});
  assert(isTrustedInternalApiKey("sb_secret_internal_key",legacy,secretKeys,"internal"), "allowlisted internal secret key should be trusted");
  assert(isTrustedInternalApiKey("sb_secret_default_key",legacy,secretKeys," default , internal "), "allowlist should trim whitespace and accept multiple explicit names");
  assert(isTrustedInternalApiKey(legacy,legacy,secretKeys,null), "legacy service-role compatibility should remain");
  assert(!isTrustedInternalApiKey("sb_secret_default_key",legacy,secretKeys,null), "new secret keys must be rejected when allowlist is unset");
  assert(!isTrustedInternalApiKey("sb_secret_other_key",legacy,secretKeys,"internal"), "configured but non-allowlisted secret key must be rejected");
  assert(!isTrustedInternalApiKey("sb_secret_internal_key",legacy,secretKeys,""), "empty allowlist must reject new secret keys");
  assert(!isTrustedInternalApiKey("sb_publishable_public_key",legacy,secretKeys,"internal"), "publishable key must not be trusted");
  assert(!isTrustedInternalApiKey("ordinary-user-token",legacy,secretKeys,"internal"), "ordinary user token must not be trusted");
  assert(!isTrustedInternalApiKey(null,legacy,secretKeys,"internal"), "missing apikey must be rejected");
  assert(!isTrustedInternalApiKey("sb_secret_internal_key",legacy,"not-json","internal"), "malformed secret-key config must not authenticate by itself");
  assert(!isTrustedInternalApiKey("sb_secret_internal_key",legacy,JSON.stringify(["sb_secret_internal_key"]),"0"), "array-shaped secret config must be rejected");
});
