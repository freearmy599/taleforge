import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
import { safeRetryErrorMessage } from "../publication-sync-processor/retry-error.ts";
import { nextWeeklyRelease, nextWeeklyReleaseAfterBatch } from "./weekly-schedule.ts";
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
const leaseFoundationMigrationUrl = new URL("../../migrations/20261012183000_aevora_release_scheduler_lease_foundation.sql", import.meta.url);
const serverOnlyGrantsMigrationUrl = new URL("../../migrations/20261013090000_aevora_server_only_metrics_outbox_grants.sql", import.meta.url);
const weeklyScheduleUrl = new URL("./weekly-schedule.ts", import.meta.url);
const publisherUrl = new URL("../release-publisher/index.ts", import.meta.url);
const generateChapterUrl = new URL("../generate-chapter/index.ts", import.meta.url);
const publisherIdempotencyUrl = new URL("../release-publisher/publisher-idempotency.ts", import.meta.url);
const publisherOutputStatusUrl = new URL("../release-publisher/publisher-output-status.ts", import.meta.url);
const generationOrchestratorUrl = new URL("../generation-orchestrator/index.ts", import.meta.url);
const reviewOrchestratorUrl = new URL("../review-orchestrator/index.ts", import.meta.url);
const publicationSyncProcessorUrl = new URL("../publication-sync-processor/index.ts", import.meta.url);
const postPublicationCanonSyncUrl = new URL("../post-publication-canon-sync/index.ts", import.meta.url);
const characterContinuityUrl = new URL("../character-continuity/index.ts", import.meta.url);
const worldContinuityUrl = new URL("../world-continuity/index.ts", import.meta.url);
const arcPlannerUrl = new URL("../arc-planner/index.ts", import.meta.url);
const continuityReviewUrl = new URL("../continuity-review/index.ts", import.meta.url);
const originalityReviewUrl = new URL("../originality-review/index.ts", import.meta.url);
const safetyReviewUrl = new URL("../safety-review/index.ts", import.meta.url);
const publicationReviewUrl = new URL("../publication-review/index.ts", import.meta.url);
const controlPlaneAuditScriptUrl = new URL("../../../scripts/aevora-control-plane-audit.mjs", import.meta.url);


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

Deno.test("generation orchestrator distinguishes mid-run provider-state failure from active cooldown", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  const loopStart = source.indexOf("for(const schedule of ordered){const readinessDisposition=automationReadinessDisposition(schedule.automation_ready_at,dryRun);");
  const readinessGuard = source.indexOf('if(readinessDisposition!=="ready")', loopStart);
  const unavailableGuard = source.indexOf("if(liveCooldown.lookup_error)", loopStart);
  const activeCooldownGuard = source.indexOf("if(liveCooldown.active)", unavailableGuard);
  const scheduleSeriesRead = source.indexOf("const series=schedule.series;", activeCooldownGuard);
  assert(loopStart >= 0 && readinessGuard > loopStart, "every schedule iteration must check readiness before any AI-dependent work");
  assert(unavailableGuard > readinessGuard, "provider-state lookup must follow readiness verification");
  assert(activeCooldownGuard > unavailableGuard && scheduleSeriesRead > activeCooldownGuard, "provider-state failure and active cooldown must both skip the schedule before series processing");
  assert(source.includes('action:"provider_state_unavailable",blocked:true,retryable:true'), "mid-run provider-state failures must be reported as blocked and retryable");
  assert(source.includes('action:"ai_cooldown"'), "a confirmed active cooldown must remain distinguishable from unavailable state");
});

Deno.test("generation orchestrator failure updates cannot overwrite a blueprint reclaimed by another worker", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  const unguardedRejectedUpdate = 'update({generation_status:"rejected",updated_at:new Date().toISOString()}).eq("id",b.id);';
  assert(!source.includes(unguardedRejectedUpdate), "failure and exception paths must not overwrite a blueprint whose status changed after this worker claimed it");
  assert(source.includes('async function transitionBlueprintStatus(supabase:any,id:string,nextStatus:string,expectedStatus:string)'), "status transitions must use the shared compare-and-set helper");
  assert(source.includes('.eq("id",id).eq("generation_status",expectedStatus).select("id").maybeSingle()'), "the helper must fence updates to the expected current status and verify affected rows");
  assert(source.includes('transitionBlueprintStatus(supabase,b.id,"rejected","generating")'), "generation failures must transition only a blueprint still claimed as generating");
  assert(source.split('transitionBlueprintStatus(supabase,b.id,"rejected","generating")').length - 1 >= 2, "generation failure and pipeline exception recovery must both use the fenced rejection helper");
  const claim = source.indexOf('.update({generation_status:"generating",updated_at:new Date().toISOString()}).eq("id",b.id).in("generation_status",["planned","ready","rejected"])');
  assert(claim >= 0, "the fenced failure paths must be paired with the existing atomic blueprint claim");
});

Deno.test("generation orchestrator success updates also preserve newer blueprint states", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  const successUpdate = 'update({generation_status:"generated",updated_at:new Date().toISOString()}).eq("id",b.id).eq("generation_status","generating").select("id").maybeSingle();';
  assert(source.includes(successUpdate), "successful generation must only transition a blueprint still claimed as generating");
  assert(source.includes("blueprintUpdateError||!blueprintUpdated"), "blueprint status writes must be checked instead of silently ignored");
  assert(source.includes("blueprint_status_sync_failed"), "unreconciled blueprint state must block further processing");
  assert(source.includes("Blueprint status update or verification failed; internal diagnostics were withheld."), "blueprint reconciliation errors must not expose raw database diagnostics");
});

Deno.test("generation orchestrator fails closed when published chapter history cannot be read", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  assert(source.includes('const{data:pub,error:publishedHistoryError}=await supabase.from("chapters").select("chapter_number").eq("series_id",schedule.series_id).eq("status","published")'),
    "latest published chapter lookup must retain database errors");
  assert(source.includes('if(publishedHistoryError){results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"published_history_unavailable",blocked:true,retryable:true'),
    "a published-history read failure must block generation for the affected schedule");
  assert(source.includes('reason:"Could not verify the latest published chapter; generation stopped to avoid acting on an unsafe chapter boundary."'),
    "the blocked result must explain the safe-stop reason");
  assert(!source.includes('const{data:pub}=await supabase.from("chapters").select("chapter_number")'),
    "published-history errors must not be silently converted to chapter number zero");
});

Deno.test("generation buffer counts only the latest output state per chapter", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  assert(source.includes('const latestAfterValues=[...latestAfter.values()];const backlog=latestAfterValues.some((o)=>o.generation_status==="needs_revision")'),
    "backlog and buffer accounting must share the latest output per chapter");
  assert(source.includes('for(const o of latestAfterValues)if(activeStatuses.has(o.generation_status))activeNums.add(o.chapter_number)'),
    "only each chapter's latest output may count toward the active generation buffer");
  assert(!source.includes('for(const o of refreshed??[])if(activeStatuses.has(o.generation_status))activeNums.add(o.chapter_number)'),
    "superseded generated/approved outputs must not keep a chapter falsely counted as active");
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

Deno.test("generation orchestrator stops a schedule when revision-exhaustion persistence fails", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  assert(source.includes('const exhaustionUpdateFailures:any[]=[];const revisionExhaustedOutputs:any[]=[];const exhaustedCandidates=[...latest.values()].filter((o)=>o.generation_status==="needs_revision"&&Number(o.generation_attempt??1)>=3);if(dryRun){for(const o of exhaustedCandidates)revisionExhaustedOutputs.push'),
    "revision exhaustion updates must be checked instead of silently ignored");
  assert(source.includes('if(exhaustionError||!exhausted)exhaustionUpdateFailures.push({output_id:o.id,chapter_number:o.chapter_number,error:exhaustionError?errorMessage(exhaustionError):"Revision state changed before exhaustion could be recorded."})'),
    "failed or stale exhaustion writes must preserve diagnostic context");
  assert(source.includes('update({generation_status:"rejected",updated_at:new Date().toISOString()})'),
    "exhausted outputs must use a generation status allowed by the database constraint");
  assert(!source.includes('generation_status:"revision_exhausted"'),
    "revision_exhausted is an action label, not a permitted database status");
  assert(source.includes('if(exhaustionUpdateFailures.length){results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"revision_exhaustion_update_failed",blocked:true,retryable:true'),
    "a failed exhaustion write must block further processing for that schedule");
  assert(source.includes('reason:"Could not persist revision exhaustion state; schedule processing stopped to avoid continuing with stale revision state."'),
    "the blocked result must explain why processing stopped");
  assert(source.includes("revision_exhausted_outputs:revisionExhaustedOutputs"),
    "success and failure results must report which revisions were exhausted");
});

Deno.test("generation orchestrator dry-run avoids known database mutations", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  assert(source.includes('const intelligenceRefresh=dryRun?{ok:true,report:{gemini_used:false,content_generation_performed:false,skipped:"dry_run_read_only"}}:await refreshDeterministicIntelligence(supabase);'),
    "dry-run must skip deterministic intelligence refresh RPCs that write state");
  assert(source.includes('const advancedPlanBuildResult=dryRun?{data:null,error:null}:await supabase.rpc("taleforge_build_advanced_chapter_plans"'),
    "dry-run must not build or upsert advanced chapter plans");
  assert(source.includes('if(dryRun){for(const o of exhaustedCandidates)revisionExhaustedOutputs.push') && source.includes('else for(const o of exhaustedCandidates){const{data:blueprintRejected,error:blueprintRejectError}'),
    "dry-run must report exhausted revisions without mutating either blueprint or output statuses");
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

Deno.test("review orchestrator does not treat an HTTP-200 rejected publication review as success", async () => {
  const source = await Deno.readTextFile(reviewOrchestratorUrl);
  const httpGuard = source.indexOf("if (!call.ok)");
  const publicationGuard = source.indexOf('if (step.name === "publication")');
  const approvedDecision = source.indexOf('result?.decision !== "approved"', publicationGuard);
  const eligibleGuard = source.indexOf("result?.eligible !== true", publicationGuard);
  const statusGuard = source.indexOf('result?.generation_status !== "approved"', publicationGuard);
  const safetyGate = source.indexOf("gates?.safety?.passed === true", publicationGuard);
  const blockedResult = source.indexOf("blocked = true;", approvedDecision);
  assert(publicationGuard > httpGuard, "publication decision must be checked after transport success");
  assert(approvedDecision > publicationGuard && eligibleGuard > approvedDecision && statusGuard > eligibleGuard,
    "publication result must explicitly confirm approved decision, eligibility, and output status");
  assert(safetyGate > publicationGuard && blockedResult > statusGuard && blockedResult > safetyGate, "all four publication gates must be checked and rejected results must block the orchestration");
  assert(source.includes("publication-review intentionally returns HTTP 200 for both approved"), "the HTTP-200 rejected-decision hazard must remain documented in source");
});

Deno.test("chapter generation and quality review fail closed on missing or malformed Gemini provider state", async () => {
  const source = await Deno.readTextFile(generateChapterUrl);
  const generationMissingState = source.indexOf("if(providerStateError||!providerState)");
  const generationInvalidTimestamp = source.indexOf("!Number.isFinite(new Date(providerState.cooldown_until).getTime())");
  const generationActiveCooldown = source.indexOf("new Date(providerState.cooldown_until).getTime()>Date.now()");
  const reviewMissingState = source.indexOf("if(reviewProviderStateError||!reviewProviderState)");
  const reviewInvalidTimestamp = source.indexOf("!Number.isFinite(new Date(reviewProviderState.cooldown_until).getTime())");
  const reviewActiveCooldown = source.indexOf("new Date(reviewProviderState.cooldown_until).getTime()>Date.now()");
  assert(generationMissingState >= 0 && source.includes('console.error("[generate-chapter] provider cooldown lookup failed; failing closed.")'),
    "generation must block when provider state is missing without logging raw database diagnostics");
  assert(generationInvalidTimestamp > generationMissingState && generationActiveCooldown > generationInvalidTimestamp,
    "generation must reject malformed cooldown timestamps before active-cooldown comparison");
  assert(reviewMissingState >= 0 && source.includes('mode:"quality-review"'),
    "quality review must block when provider state is missing");
  assert(reviewInvalidTimestamp > reviewMissingState && reviewActiveCooldown > reviewInvalidTimestamp,
    "quality review must reject malformed cooldown timestamps before active-cooldown comparison");
  assert(source.includes("Gemini cooldown state is malformed; generation was blocked to protect quota."),
    "generation malformed state must fail closed with retryable provider-state error");
  assert(source.includes("Gemini cooldown state is malformed; AI quality review was blocked."),
    "quality-review malformed state must fail closed with retryable provider-state error");
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
  assert(source.includes("nextWeeklyReleaseAfterBatch(processingCompletedAt,weeklyReleaseAt,"), "weekly deadline must share the completion-time anchor and avoid a second same-day batch");
  assert(source.includes("last_release_at:processingCompletedAt.toISOString()"), "last release timestamp must reflect processing completion, not invocation start");
  assert(!source.includes("new Date(latestReleaseMs+Number(schedule.interval_hours)*3600000)"),
    "raw interval arithmetic must not bypass validation");
});

Deno.test("weekly schedule uses validated IANA timezone and DST-aware wall time", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const helper = await Deno.readTextFile(weeklyScheduleUrl);
  assert(source.includes('String(schedule.timezone??"UTC")'), "schedule timezone is not passed to weekly resolver");
  assert(source.includes('import { nextWeeklyRelease, nextWeeklyReleaseAfterBatch } from "./weekly-schedule.ts"'), "scheduler must use the directly tested weekly resolver and post-batch cadence guard");
  assert(helper.includes('/^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/'), "strict wall-time validation regex missing");
  assert(helper.includes("matchingWallTimeCandidates"), "DST fold/gap resolver missing");
  assert(source.indexOf("Validate scheduling configuration before any publication side effect.") < source.indexOf('from("story_lifecycle")'), "schedule preflight must precede publication setup");
  assert(!source.includes("nextRelease=now;"), "activation must not trigger an immediate extra release batch");
  assert(source.includes("nextRelease=nextWeeklyReleaseAfterBatch(processingCompletedAt,weeklyReleaseAt,"),
    "weekly next-release deadline must respect the reserved slot and completion time to prevent a second same-day batch");
});

Deno.test("weekly release after a batch never schedules a second batch at today's later slot", () => {
  const reservedSlot = new Date("2026-10-11T03:30:00.000Z"); // Sunday 09:00 Asia/Kolkata
  const completedBeforeSameDaySlot = new Date("2026-10-11T02:00:00.000Z");
  const afterReservedSlot = nextWeeklyReleaseAfterBatch(
    completedBeforeSameDaySlot, reservedSlot, 0, "09:00", "Asia/Kolkata",
  );
  assert(afterReservedSlot.toISOString() === "2026-10-18T03:30:00.000Z",
    "a batch completed before today's reserved slot must schedule the following week, not a second batch later today");

  const completedOnPreviousDay = new Date("2026-10-10T13:00:00.000Z");
  const preserveNextDaySlot = nextWeeklyReleaseAfterBatch(
    completedOnPreviousDay, reservedSlot, 0, "09:00", "Asia/Kolkata",
  );
  assert(preserveNextDaySlot.toISOString() === reservedSlot.toISOString(),
    "a future weekly slot on a later day must remain eligible");

  const completedAfterSlot = new Date("2026-10-11T04:00:00.000Z");
  const afterLongBatch = nextWeeklyReleaseAfterBatch(
    completedAfterSlot, reservedSlot, 0, "09:00", "Asia/Kolkata",
  );
  assert(afterLongBatch.toISOString() === "2026-10-18T03:30:00.000Z",
    "a batch that completes after its reserved slot must also schedule the next weekly occurrence");

  const nextWeekSlot = new Date("2026-10-18T03:30:00.000Z");
  const completedAfterThisWeeksSlot = new Date("2026-10-11T04:00:00.000Z");
  const preserveNextWeekSlot = nextWeeklyReleaseAfterBatch(
    completedAfterThisWeeksSlot, nextWeekSlot, 0, "09:00", "Asia/Kolkata",
  );
  assert(preserveNextWeekSlot.toISOString() === nextWeekSlot.toISOString(),
    "when this week's slot has already passed, the reserved next-week slot must not be skipped");

  const afterSpringGap = new Date("2026-03-08T07:00:00.000Z");
  const nextValidDstSlot = new Date("2026-03-15T06:30:00.000Z");
  const preserveDstSlot = nextWeeklyReleaseAfterBatch(
    afterSpringGap, nextValidDstSlot, 0, "02:30", "America/New_York",
  );
  assert(preserveDstSlot.toISOString() === nextValidDstSlot.toISOString(),
    "a DST-gap week must not cause the next valid weekly slot to be skipped");

  const missingReservedSlot = nextWeeklyReleaseAfterBatch(
    completedBeforeSameDaySlot, null, 0, "09:00", "Asia/Kolkata",
  );
  assert(missingReservedSlot.toISOString() === "2026-10-18T03:30:00.000Z",
    "a missing reserved slot must not permit a second batch later on the same local day");

  const foldFirstSlot = new Date("2026-11-01T05:30:00.000Z");
  const beforeFoldSlot = new Date("2026-11-01T05:00:00.000Z");
  const skipRepeatedFoldSlot = nextWeeklyReleaseAfterBatch(
    beforeFoldSlot, foldFirstSlot, 0, "01:30", "America/New_York",
  );
  assert(skipRepeatedFoldSlot.toISOString() === "2026-11-08T06:30:00.000Z",
    "a completed batch must skip both repeated wall-clock occurrences on a DST fall-back day");

  const betweenFoldSlots = new Date("2026-11-01T05:45:00.000Z");
  const staleReservedFoldSlot = nextWeeklyReleaseAfterBatch(
    betweenFoldSlots, foldFirstSlot, 0, "01:30", "America/New_York",
  );
  assert(staleReservedFoldSlot.toISOString() === "2026-11-08T06:30:00.000Z",
    "a stale reserved slot must not reselect the second DST-fold occurrence on the same day");

  const foldSecondSlot = new Date("2026-11-01T06:30:00.000Z");
  const preserveNoSecondFoldBatch = nextWeeklyReleaseAfterBatch(
    betweenFoldSlots, foldSecondSlot, 0, "01:30", "America/New_York",
  );
  assert(preserveNoSecondFoldBatch.toISOString() === "2026-11-08T06:30:00.000Z",
    "a future second-fold slot must not allow a second batch after the first wall-clock occurrence was consumed");

  let invalidCompletionRejected = false;
  try {
    nextWeeklyReleaseAfterBatch(new Date(Number.NaN), reservedSlot, 0, "09:00", "Asia/Kolkata");
  } catch {
    invalidCompletionRejected = true;
  }
  assert(invalidCompletionRejected, "invalid completion timestamps must fail closed");
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

Deno.test("lease foundation migration reproduces the inspected lease table and RPC contract", async () => {
  const sql = await Deno.readTextFile(leaseFoundationMigrationUrl);
  assert(sql.includes("CREATE TABLE IF NOT EXISTS public.aevora_release_scheduler_leases"), "lease table definition missing");
  for (const column of ["schedule_id uuid PRIMARY KEY", "lease_token uuid NOT NULL", "lease_expires_at timestamptz NOT NULL", "created_at timestamptz NOT NULL DEFAULT clock_timestamp()", "updated_at timestamptz NOT NULL DEFAULT clock_timestamp()"]) {
    assert(sql.includes(column), "lease table column contract missing: " + column);
  }
  assert(sql.includes("ENABLE ROW LEVEL SECURITY"), "lease table must keep RLS enabled");
  assert(sql.includes("FROM PUBLIC, anon, authenticated"), "untrusted roles must not receive table/function privileges");
  assert(sql.includes("GRANT ALL ON TABLE public.aevora_release_scheduler_leases TO postgres, service_role"), "table access must remain restricted to server roles");
  for (const name of ["aevora_claim_release_scheduler_lease", "aevora_renew_release_scheduler_lease", "aevora_release_scheduler_lease"]) {
    assert(sql.includes("CREATE OR REPLACE FUNCTION public." + name), "lease RPC definition missing: " + name);
  }
  assert(sql.split("SECURITY DEFINER").length - 1 === 3, "all lease RPCs must use security-definer execution");
  assert(sql.split("SET search_path = pg_catalog").length - 1 === 3, "all lease RPCs must use a pg_catalog-only search_path");
  assert(sql.includes("p_lease_seconds < 30 OR p_lease_seconds > 900"), "lease duration bounds must match the inspected production contract");
  assert(sql.includes("WHERE public.aevora_release_scheduler_leases.lease_expires_at <= clock_timestamp()"), "claim must not replace an unexpired lease");
  assert(sql.includes("AND lease_expires_at > clock_timestamp()"), "renewal must reject expired leases");
  assert(sql.includes("WHERE schedule_id = p_schedule_id AND lease_token = p_lease_token"), "release must require the exact lease token");
});

Deno.test("atomic lease-fencing migration locks and validates ownership and restricts execution", async () => {
  const sql = await Deno.readTextFile(leaseFencingMigrationUrl);
  assert(sql.includes("aevora_advance_release_schedule_if_lease_owned"), "atomic schedule RPC definition missing");
  assert(sql.includes("aevora_activate_story_lifecycle_if_lease_owned"), "atomic lifecycle RPC definition missing");
  assert(sql.split("FOR UPDATE").length - 1 === 3, "both lease locks and the lifecycle schedule-row lock must remain transactional");
  assert(sql.split("FROM public.aevora_release_scheduler_leases").length - 1 === 2, "both RPCs must read and lock the lease table");
  assert(sql.split("v_lease_token <> p_lease_token").length - 1 === 2, "both RPCs must validate the exact lease token");
  assert(sql.split("v_lease_expires_at <= clock_timestamp()").length - 1 === 2, "both RPCs must reject expired leases");
  assert(sql.includes("OR p_next_release_at <= p_last_release_at THEN"), "atomic advancement must reject a non-advancing release deadline");
  assert(sql.includes("WHERE id = p_schedule_id AND series_id = p_series_id\n    FOR UPDATE;"), "lifecycle activation must lock the matching schedule row before transition");
  assert(sql.split("SECURITY DEFINER").length - 1 === 2, "both RPCs must use the reviewed security-definer contract");
  assert(sql.split("SET search_path = pg_catalog").length - 1 === 2, "both RPCs must use a pg_catalog-only search_path");
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

Deno.test("publisher confirms canonical sync enqueue before reporting publication success", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  const helperStart = source.indexOf("async function ensureCanonSyncOutboxEvent(");
  const helperEnd = source.indexOf("\nDeno.serve", helperStart);
  const helper = source.slice(helperStart, helperEnd);
  const enqueue = helper.indexOf('.from("publication_sync_outbox")');
  const verify = helper.indexOf('.select("id,status,attempts")');
  assert(helperStart >= 0 && helperEnd > helperStart && enqueue >= 0 && verify > enqueue,
    "canonical sync enqueue must be followed by a database confirmation read");
  assert(helper.includes("if (enqueueError)"), "enqueue errors must be reported instead of treated as success");
  assert(helper.includes("if (error || !data)"), "missing or unreadable outbox rows must remain unconfirmed");
  assert(helper.includes('queued: data.status !== "succeeded"'), "queued state must be derived from the verified outbox row");
  assert(source.includes('success: canonSyncResult.confirmed && synchronizationWarnings.length === 0'), "normal and idempotent publication responses must fail success when output or blueprint synchronization is unconfirmed");
  assert(source.includes('success: canonSyncResult.confirmed && raceSynchronizationWarnings.length === 0'), "concurrent duplicate publication response must fail success when output or blueprint synchronization is unconfirmed");
  assert(source.includes("Canonical publication sync enqueue could not be confirmed:"), "response warnings must disclose an unconfirmed enqueue");
  assert(!source.includes("post-publication canon synchronization was attempted."), "response must not claim an unverified synchronization attempt");
});

Deno.test("publisher synchronization writes are fenced and verify affected rows", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  const fencedOutputWrites = source.match(/\.in\("generation_status",\s*\["approved",\s*"published"\]\)/g) ?? [];
  assert(fencedOutputWrites.length === 3, "all three output-sync paths must restrict updates to approved/published states");
  const checkedRows = source.match(/\.select\("id"\)\.maybeSingle\(\)/g) ?? [];
  assert(checkedRows.length >= 6, "output and blueprint synchronization paths must verify affected rows");
  assert(source.includes("generation_output: !racedOutputSyncError && !!racedOutputSyncRow"), "race path must not report output synchronization without an affected row");
  assert(source.includes("blueprint: !racedBlueprintSyncError && !!racedBlueprintSyncRow"), "race path must not report blueprint synchronization without an affected row");
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
  const activation = source.indexOf('supabase.rpc("aevora_activate_story_lifecycle_if_lease_owned",{');
  assert(query >= 0 && source.indexOf('.in("generation_status",["approved","published"]).lte("chapter_number",launchCount)',query) > query, "launch verification must load approved/published output IDs and chapter numbers");
  assert(source.includes("const launchReviewRows:any[]=[];"), "launch review rows must be fetched");
  assert(qualification > query && launchReady > qualification && activationGate > launchReady && activation > activationGate, "lifecycle activation must follow review-qualified launch verification");
  assert(source.includes("matchesPublishedChapterOutput(chapterRows[0],output)"), "launch chapter must match reviewed output identity");
  assert(source.includes("launchReviewError"), "review query failure must block lifecycle activation");
  assert(source.includes("const invalidDailyConfig=") && source.includes("const invalidLaunchConfig="), "invalid lifecycle chapter limits must be rejected before publication");
  assert(source.indexOf("if(invalidDailyConfig || invalidLaunchConfig)") < source.indexOf("if(!dryRun && schedule.auto_publish && publishCount>0)"), "lifecycle limits must be validated before publication side effects");
  assert(source.includes('.range(offset,offset+499)'), "launch chapter/output history queries must be paginated");
  assert(source.includes("if(activation.error || activation.data!==true)"), "unconfirmed atomic lifecycle activation must fail closed");
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

Deno.test("privileged release and orchestration handlers reject untrusted callers before database operations", async () => {
  const scheduler = await Deno.readTextFile(schedulerUrl);
  const publisher = await Deno.readTextFile(publisherUrl);
  const generation = await Deno.readTextFile(generationOrchestratorUrl);
  const review = await Deno.readTextFile(reviewOrchestratorUrl);
  const generateChapter = await Deno.readTextFile(generateChapterUrl);
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

  const generationGuard = generation.indexOf('isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))');
  const generationClient = generation.indexOf("createClient(supabaseUrl,key");
  assert(generationGuard >= 0 && generationGuard < generationClient,
    "generation orchestrator must authenticate the configured server-side apikey before creating a privileged client");
  assert(generation.includes('},401)'), "generation orchestrator unauthorized callers must receive HTTP 401");

  const reviewGuard = review.indexOf('isTrustedInternalApiKey(req.headers.get("apikey"), serviceRoleKey, Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))');
  const reviewClient = review.indexOf("createClient(supabaseUrl, serviceRoleKey");
  assert(reviewGuard >= 0 && reviewGuard < reviewClient,
    "review orchestrator must authenticate the configured server-side apikey before creating a privileged client");
  assert(review.includes('}, 401)'), "review orchestrator unauthorized callers must receive HTTP 401");

  const generateChapterGuard = generateChapter.indexOf('isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))');
  const generateChapterClient = generateChapter.indexOf("createClient(url,key");
  assert(generateChapterGuard >= 0 && generateChapterGuard < generateChapterClient,
    "generate-chapter must authenticate the configured server-side apikey before creating a privileged client");
  assert(generateChapter.includes('},401)'), "generate-chapter unauthorized callers must receive HTTP 401");
  assert(generateChapter.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY")'),
    "generate-chapter must prefer the standard Supabase service-role environment while retaining legacy compatibility");
  assert(generateChapter.includes("for Aevora.") && !generateChapter.includes("for TaleForge."),
    "chapter-generation prompts must use the current Aevora brand");
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


Deno.test("publisher first-publication timestamp repair is conditional and surfaces write errors", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  const conditionalWrites = source.match(/\.eq\("id", series\.id\)\.is\("published_at", null\)/g) ?? [];
  assert(conditionalWrites.length === 3,
    "existing-chapter, concurrent-insert-race, and normal-insert paths must only fill a missing first-publication timestamp");
  const errorChecks = [
    "if (seriesSyncError) synchronizationWarnings.push(",
    "if (racedSeriesSyncError) raceSynchronizationWarnings.push(",
  ];
  for (const check of errorChecks) {
    assert(source.includes(check), "series timestamp write errors must be surfaced as warnings: " + check);
  }
  assert(source.split("Series first-publication timestamp sync failed:").length - 1 === 3,
    "all three publisher paths must report timestamp synchronization failures consistently");
});


Deno.test("publication sync processor authenticates before privileged work and verifies outbox state writes", async () => {
  const source = await Deno.readTextFile(publicationSyncProcessorUrl);
  const auth = source.indexOf("isTrustedInternalApiKey(");
  const client = source.indexOf("createClient(url,key");
  assert(auth >= 0 && client > auth, "worker must validate the server-side API key before creating a privileged client");
  assert(source.includes('if (req.method !== "POST")'), "worker must reject non-POST requests");
  assert(source.includes("if (staleRecovery.error) throw new Error("), "stale event recovery errors must not be silently ignored");
  assert(source.includes('.lt("attempts",8)'), "events at the retry ceiling must not be auto-claimed indefinitely");
  assert((source.match(/\.eq\("id",event\.id\)\.eq\("status","processing"\)\.eq\("locked_at",now\)\.select\("id"\)\.maybeSingle\(\)/g) ?? []).length === 2,
    "completion and retry writes must be fenced to the exact claimed processing lease and verify an affected row");
  assert(source.includes('status: attempts >= 8 ? "failed" : "pending"'), "retry ceiling must retain the schema-supported terminal failed status");
  assert(source.includes('status:attempts >= 8 ? "failed_terminal" : "retry_scheduled"'),
    "response must distinguish terminal failures from scheduled retries");
  assert(source.includes('.eq("status","processing")\n      .or("locked_at.is.null,locked_at.lt."'),
    "stale recovery must target only processing rows with a missing or expired lock");
  assert(source.includes('new Date(Date.now()-10*60*1000).toISOString()'),
    "stale processing recovery must use a bounded age threshold rather than reclaiming fresh work");
  assert(source.includes('const delayMinutes = Math.min(60, Math.pow(2,Math.max(0,attempts-1))*5)'),
    "retry delay must grow exponentially but remain capped");
  assert(source.includes('const batchSucceeded=results.every((result:any)=>result.status==="succeeded")'),
    "an empty or fully successful claimed batch may succeed, but any reported failure must make the batch unsuccessful");
  assert(source.includes('if (completion.error || !completion.data)') &&
      source.includes('if (retryWrite.error || !retryWrite.data)'),
    "database errors and zero-row lease-fenced writes must be surfaced as unsuccessful outcomes");
  assert(source.includes('status:"retry_state_update_failed"'),
    "a lost lease or failed retry-state write must not be reported as a successful retry");
  assert(source.includes('results.push({id:event.id,chapter_id:event.chapter_id,status:"claim_failed"})'),
    "claim failures must not echo raw database diagnostics into the response");
  assert(source.includes('results.push({id:event.id,chapter_id:event.chapter_id,status:"retry_state_update_failed",attempts})'),
    "retry-state failures must not echo raw database diagnostics into the response");
  assert(source.includes('error:"Publication sync processor failed."'),
    "unexpected processor failures must use a bounded public error");
  assert(!source.includes("claim.error.message") && !source.includes("retryWrite.error?.message") &&
      !source.includes("staleRecovery.error.message") && !source.includes("throw error;"),
    "raw database error details must not enter API responses or persisted retry diagnostics");
});

Deno.test("post-publication canon sync authenticates and verifies publication before downstream calls", async () => {
  const source = await Deno.readTextFile(postPublicationCanonSyncUrl);
  const auth = source.indexOf("isTrustedInternalApiKey(");
  const body = source.indexOf("const body=await req.json()");
  const publishedCheck = source.indexOf('if(chapter.status!=="published")');
  const downstreamCalls = source.indexOf('for(const name of ["character-continuity","world-continuity"])');
  assert(auth >= 0 && body > auth, "canon sync must authenticate before parsing and acting on a request");
  assert(source.includes('if(req.method!=="POST")'), "canon sync must reject non-POST requests");
  assert(source.includes('typeof body.chapter_id==="string"?body.chapter_id.trim():""'),
    "chapter_id must be a non-empty string rather than arbitrary truthy input");
  assert(publishedCheck >= 0 && downstreamCalls > publishedCheck,
    "published chapter status must be verified before invoking continuity workers");
  assert(source.includes("results[name]={ok:r.ok && data?.success===true,status:r.status};"),
    "downstream result summaries must expose only success and HTTP status, never response bodies");
  assert(!source.includes("results[name]={ok:r.ok && data?.success===true,status:r.status,data}"),
    "downstream response payloads must not be returned to the caller");
  for (const [variable, label] of [["chRes", "published chapter"], ["intelligenceRes", "story intelligence view"], ["trendingRes", "story trending view"]] as const) {
    assert(source.includes(`HTTP "+${variable}.status`), label + " errors must report status without echoing upstream response bodies");
    assert(!source.includes("await "+variable+".text()"), label + " error handling must not expose upstream response bodies");
  }
  assert(source.includes('post-publication-canon-sync-v5-redacted-errors'), "canon sync version must identify generic error handling");
  assert(source.includes('error:"Post-publication synchronization failed."'), "uncaught errors must return a generic public message");
  assert(!source.includes("error:e instanceof Error?e.message:String(e)"), "raw exception messages must not be returned to callers");
});


Deno.test("internal metrics and publication outbox remain server-only without client policies", async () => {
  const sql = await Deno.readTextFile(serverOnlyGrantsMigrationUrl);
  for (const table of ["publication_sync_outbox", "story_attachment_metrics"]) {
    assert(sql.includes("'" + table + "'"), table + " must be included in the server-only target list");
  }
  assert(sql.includes("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY"),
    "all existing target tables must have RLS enabled");
  assert(sql.includes("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated"),
    "all target tables must revoke relation-level privileges");
  assert(sql.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"),
    "all target tables must also revoke separately granted column privileges");
  assert(!/CREATE\s+POLICY/i.test(sql), "server-only internal tables must not receive client-facing policies");
  assert(!/GRANT\s+.+\s+TO\s+(PUBLIC|anon|authenticated)/i.test(sql),
    "server-only migration must not grant table privileges to ordinary client roles");
});


Deno.test("character and world continuity workers authenticate before body parsing or privileged clients", async () => {
  for (const [name, url] of [
    ["character-continuity", characterContinuityUrl],
    ["world-continuity", worldContinuityUrl],
  ] as const) {
    const source = await Deno.readTextFile(url);
    const guard = source.indexOf("isTrustedInternalApiKey(");
    const body = source.indexOf("req.json()");
    const client = source.indexOf("createClient(url,key)");
    assert(source.includes('if(req.method!=="POST")'), name + " must reject non-POST requests");
    assert(guard >= 0 && body > guard && client > guard,
      name + " must authenticate a configured server-side apikey before parsing requests or creating a privileged client");
    assert(source.includes('Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES")'),
      name + " must require the explicit secret-key allowlist");
    assert(source.includes("!Number.isFinite(cooldownUntil)"),
      name + " must fail closed on a malformed non-empty provider cooldown timestamp");
  }
});

Deno.test("planning handlers require trusted server-side callers", async () => {
  const cases = [
    ["blueprint-planner", new URL("../blueprint-planner/index.ts", import.meta.url), "req.json()", "createClient(supabaseUrl, serviceKey)"],
    ["story-dna-planner", new URL("../story-dna-planner/index.ts", import.meta.url), "req.json()", "createClient(url,key)"],
    ["arc-planner", new URL("../arc-planner/index.ts", import.meta.url), "req.json()", "createClient(url,key)"],
    ["semantic-continuity-extraction", new URL("../semantic-continuity-extraction/index.ts", import.meta.url), "req.json()", "createClient(url,key)"],
  ] as const;
  for (const [name, url, bodyMarker, clientMarker] of cases) {
    const source = await Deno.readTextFile(url);
    const guard = source.indexOf("isTrustedInternalApiKey(");
    assert(source.includes("POST"), name + " must enforce a POST-only method policy");
    assert(guard >= 0 && source.indexOf(bodyMarker) > guard && source.indexOf(clientMarker) > guard,
      name + " must authenticate before parsing requests or creating a privileged client");
    assert(source.includes("AEVORA_INTERNAL_API_KEY_NAMES"), name + " must use the explicit internal-key allowlist");
  }
});


Deno.test("continuity review requires trusted server-side authentication before privileged client creation", async () => {
  const source = await Deno.readTextFile(continuityReviewUrl);
  const guard = source.indexOf("isTrustedInternalApiKey(req.headers.get(\"apikey\"), serviceRoleKey");
  const client = source.indexOf("const supabase = createClient(");
  assert(guard >= 0 && client > guard,
    "continuity review must validate the configured server-side apikey before creating its privileged client");
  assert(source.includes("AEVORA_INTERNAL_API_KEY_NAMES"),
    "continuity review must require the explicit internal-key allowlist");
  assert(source.includes('if (req.method !== "POST")'),
    "continuity review must retain the POST-only request policy");
});


Deno.test("all review workers require a trusted internal key before privileged clients", async () => {
  const cases = [
    ["continuity-review", continuityReviewUrl],
    ["originality-review", originalityReviewUrl],
    ["safety-review", safetyReviewUrl],
    ["publication-review", publicationReviewUrl],
  ] as const;
  for (const [name, url] of cases) {
    const source = await Deno.readTextFile(url);
    const guard = source.indexOf("isTrustedInternalApiKey(req.headers.get(\"apikey\"), serviceRoleKey");
    const client = source.indexOf("const supabase = createClient(");
    assert(guard >= 0 && client > guard,
      name + " must authenticate before creating a privileged database client");
    assert(source.includes("AEVORA_INTERNAL_API_KEY_NAMES"),
      name + " must require the explicit internal-key allowlist");
    assert(source.includes('if (req.method !== "POST")'),
      name + " must retain its POST-only request policy");
  }
});


Deno.test("semantic continuity extraction blocks malformed provider cooldown before queue claim", async () => {
  const source = await Deno.readTextFile(new URL("../semantic-continuity-extraction/index.ts", import.meta.url));
  const invalidTimestamp = source.indexOf("!Number.isFinite(cooldownUntil)");
  const queueClaim = source.indexOf('db.rpc("taleforge_claim_continuity_queue"');
  assert(invalidTimestamp >= 0 && queueClaim > invalidTimestamp,
    "malformed non-empty provider cooldown state must block before claiming queued work");
});


Deno.test("semantic continuity dry-run never claims or resets a queue item", async () => {
  const source = await Deno.readTextFile(new URL("../semantic-continuity-extraction/index.ts", import.meta.url));
  const dryRun = source.indexOf('if(!execute) return new Response(JSON.stringify({success:true,version:VERSION,status:"dry_run",queue_mutated:false})');
  const claim = source.indexOf('db.rpc("taleforge_claim_continuity_queue"');
  assert(dryRun >= 0 && claim > dryRun,
    "dry-run must return before the queue-claim RPC");
  assert(!source.includes('.update({status:"pending",locked_at:null,updated_at:new Date().toISOString()})'),
    "dry-run must not claim a job and then mutate it back to pending");
});


Deno.test("review workers reject malformed provider cooldown timestamps", async () => {
  for (const path of ["../continuity-review/index.ts", "../originality-review/index.ts", "../safety-review/index.ts"]) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    const invalidTimestamp = source.indexOf("Number.isFinite(");
    const requestBody = source.indexOf("req.json()", invalidTimestamp);
    assert(invalidTimestamp >= 0 && requestBody > invalidTimestamp,
      path + " must reject malformed cooldown state before processing a request");
    assert(source.includes("provider_state_unavailable"), path + " must fail closed on malformed provider state");
  }
});


Deno.test("server-only table grant migration revokes relation and column privileges without adding policies", async () => {
  const migration = await Deno.readTextFile(new URL("../../migrations/20261013090000_aevora_server_only_metrics_outbox_grants.sql", import.meta.url));
  assert(migration.includes("REVOKE ALL PRIVILEGES ON TABLE"), "migration must revoke relation-level privileges");
  assert(migration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"),
    "migration must revoke separately granted column privileges");
  assert(migration.includes("'publication_sync_outbox'"), "outbox must remain server-only");
  assert(migration.includes("'story_attachment_metrics'"), "attachment metrics must remain server-only");
  assert(migration.includes("anon, authenticated"), "both client roles must lose direct grants, alongside PUBLIC");
  assert(!/CREATE\s+POLICY/i.test(migration), "migration must not create client-facing policies");
});


Deno.test("internal narrative intelligence tables are not exposed by public read policies", async () => {
  const migration = await Deno.readTextFile(new URL("../../migrations/20261013103000_lock_internal_narrative_intelligence_tables.sql", import.meta.url));
  for (const table of [
    "character_continuity_events",
    "world_continuity_events",
    "taleforge_continuity_reconciliation_findings",
    "taleforge_continuity_reconciliation_runs",
    "taleforge_narrative_depth_plans",
    "taleforge_narrative_memory_snapshots",
    "taleforge_narrative_thread_events",
    "taleforge_narrative_thread_progression",
    "taleforge_narrative_threads",
    "taleforge_novelty_evaluations",
    "taleforge_system_dependencies",
    "taleforge_system_health",
    "taleforge_system_registry",
  ]) {
    assert(migration.includes("public." + table), table + " must be included in internal-table hardening");
  }
  assert(migration.includes("REVOKE ALL PRIVILEGES ON TABLE"), "client table grants must be revoked");
  assert(migration.includes("FROM PUBLIC, anon, authenticated"), "PUBLIC and both client roles must be restricted from internal table access");
  assert(!/CREATE\s+POLICY/i.test(migration), "migration must not add broad client policies");
});


Deno.test("internal planner and metrics RPCs lose client EXECUTE grants", async () => {
  const migration = await Deno.readTextFile(new URL("../../migrations/20261013110000_restrict_internal_invoker_rpc_execution.sql", import.meta.url));
  for (const signature of [
    "apply_attachment_directives(uuid)",
    "get_active_story_arc_plan(uuid)",
    "get_production_buffer_plan()",
    "get_story_narrative_destination(uuid)",
    "prepare_next_chapter_blueprint(uuid)",
    "refresh_story_attachment_metrics(uuid)",
    "taleforge_get_long_term_architecture_context(uuid)",
    "taleforge_score_story_opportunity(numeric, numeric, numeric, numeric, numeric)",
    "taleforge_update_updated_at()",
    "touch_story_lifecycle_updated_at()",
    "update_series_chapter_count()",
    "update_updated_at()",
  ]) {
    assert(migration.includes("public." + signature), signature + " must be restricted to trusted callers");
  }
  assert((migration.match(/FROM PUBLIC, anon, authenticated;/g) ?? []).length === 12,
    "every internal RPC/trigger helper must revoke inherited PUBLIC execution as well as direct anon/authenticated grants");
});


Deno.test("publisher blocks success when canonical-sync outbox has exhausted retries", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  assert(source.includes('const terminalFailure = data.status === "failed" && Number(data.attempts) >= 8;'),
    "terminal outbox failure must be derived from the persisted status and retry count");
  assert(source.includes('status: "failed_terminal"'),
    "publisher must expose terminal synchronization failure for recovery");
  assert(source.includes("confirmed: false, queued: false, status: \"failed_terminal\""),
    "a terminal outbox row must not be reported as confirmed or queued");
  assert(source.includes('success: canonSyncResult.confirmed && synchronizationWarnings.length === 0'),
    "publisher success must require confirmed canonical sync plus output and blueprint synchronization");
});

Deno.test("scheduler aggregate response fails when any schedule reports a safety failure", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const failureSet = source.slice(source.indexOf("const failureActions=new Set("), source.indexOf("const hasScheduleFailures="));
  assert(failureSet.includes('"lease_unavailable"'), "lease claim failure must fail the aggregate result");
  assert(failureSet.includes('"publish_unconfirmed"'), "unconfirmed publication must fail the aggregate result");
  assert(failureSet.includes('"schedule_advance_unconfirmed"'), "unconfirmed schedule advancement must fail the aggregate result");
  assert(failureSet.includes('"lease_release_warning"'), "unconfirmed lease release must be visible in aggregate failure status");
  assert(source.includes("success:!hasScheduleFailures"), "aggregate success must not be hard-coded true");
  assert(source.includes("const hasPublishedSideEffects=results.some("),
    "partial success must be derived from confirmed publication side effects even when the final action is a later failure");
  assert(source.includes("Number(result.published_count)>0") && source.includes("Array.isArray(result.published)&&result.published.length>0"),
    "partial success must recognize confirmed published counts and chapter lists");
  assert(source.includes("let confirmedPublishedCount=0;") && source.includes("confirmedPublishedCount++;"),
    "confirmed publications must be counted outside the inner try so unexpected later errors cannot erase known side effects");
  assert(source.includes('action:"schedule_error",published_count:confirmedPublishedCount'),
    "unexpected per-schedule errors must preserve the count of chapters already confirmed published");
  assert(source.includes("partial_success:hasPublishedSideEffects&&hasScheduleFailures"),
    "publication followed by lifecycle or schedule-advance failure must be reported as partial success");
});


Deno.test("review orchestrator fails closed and reports blocked batches as unsuccessful", async () => {
  const source = await Deno.readTextFile(reviewOrchestratorUrl);
  const providerLookup = source.indexOf('.from("taleforge_ai_provider_state")');
  const unavailableGuard = source.indexOf('reason: "provider_state_unavailable"', providerLookup);
  const requestBody = source.indexOf("body = await req.json()", providerLookup);
  assert(providerLookup >= 0 && unavailableGuard > providerLookup,
    "provider-state lookup failure must return a blocked response");
  assert(requestBody > unavailableGuard,
    "provider state must be verified before request processing and any review calls");
  assert(source.includes("const hasReviewFailures = results.some((result: any) =>"),
    "blocked and errored per-output results must be aggregated");
  assert(source.includes("success: !hasReviewFailures"),
    "the overall review response must not claim success when any output is blocked or errored");
  assert(source.includes('if (step.name !== "quality" && result?.success !== true)'),
    "dedicated review workers must explicitly affirm success before their decisions are trusted");
  assert(source.includes("exposes decision/score without a top-level success flag") &&
      source.includes("continuity, originality, safety, and publication workers must explicitly"),
    "the quality worker's legacy response contract and dedicated-worker success requirements must remain documented");
  for (const workerPath of [
    "../continuity-review/index.ts",
    "../originality-review/index.ts",
    "../safety-review/index.ts",
    "../publication-review/index.ts",
  ]) {
    const worker = await Deno.readTextFile(new URL(workerPath, import.meta.url));
    assert(worker.includes("success: true"),
      workerPath + " must explicitly affirm success in its positive response contract");
  }
  assert(source.includes("partial_success: results.some((result: any) => result.action === \"reviewed\") && hasReviewFailures"),
    "mixed reviewed and blocked batches must be explicitly identified as partial success");
  assert(source.includes("}, hasReviewFailures ? 422 : 200);"),
    "blocked or errored review batches must return a non-success HTTP status");
});

Deno.test("all dedicated review workers support standard and legacy service-role environments", async () => {
  for (const workerPath of [
    "../continuity-review/index.ts",
    "../originality-review/index.ts",
    "../safety-review/index.ts",
    "../publication-review/index.ts",
  ]) {
    const source = await Deno.readTextFile(new URL(workerPath, import.meta.url));
    assert(source.includes('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get('),
      workerPath + " must prefer the standard Supabase service-role key");
    assert(source.includes('"TALEFORGE_SERVICE_ROLE_KEY"'),
      workerPath + " must preserve the legacy environment fallback");
    assert(source.indexOf('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")') < source.indexOf('isTrustedInternalApiKey('),
      workerPath + " must resolve the key before internal caller authentication");
  }
});

Deno.test("generation orchestrator reports nested failures instead of unconditional success", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  assert(source.includes("function hasPipelineFailure(value:unknown):boolean"),
    "generation orchestrator must recursively inspect nested pipeline outcomes");
  assert(source.includes("const hasFailures=hasPipelineFailure(results)||hasPipelineFailure(intelligenceRefresh)"),
    "generation results and both intelligence-refresh envelope and nested report failures must affect the aggregate outcome");
  assert(source.includes("success:!hasFailures"),
    "overall success must be derived from actual pipeline outcomes");
  assert(source.includes("},hasFailures?422:200)"),
    "a failed or blocked generation run must return a non-2xx status");
  assert(source.includes('action:"ai_cooldown",blocked:true,retryable:true'),
    "a quota cooldown skip must be reported as a blocked, retryable result");
  assert(source.includes("partial_success:hasFailures&&hasProcessed"),
    "mixed processed and failed schedules must be identified as partial success");
});

Deno.test("control-plane audit reports malformed lease, decision, and provider-state values", async () => {
  const source = await Deno.readTextFile(controlPlaneAuditScriptUrl);
  assert(source.includes("const parseTimestamp = (value) =>"),
    "audit timestamp parsing must be explicit and reusable");
  assert(source.includes("Malformed engineering task lease timestamp"),
    "malformed active-task lease timestamps must be surfaced as findings");
  assert(source.includes("Missing engineering task lease timestamp"),
    "active tasks without a lease expiry must be surfaced instead of silently skipped");
  assert(source.includes("Malformed decision expiry timestamp"),
    "malformed pending-decision expiry timestamps must be surfaced as findings");
  assert(source.includes("**Expired engineering task lease:**"),
    "valid but expired task leases must remain detectable");
  assert(source.includes("**Expired decision request:**"),
    "valid but expired decision requests must remain detectable");
  assert(source.includes("**Missing Gemini provider state:**"),
    "a missing Gemini provider row must be visible because generation fails closed without it");
  assert(source.includes("**Malformed AI provider cooldown timestamp:**"),
    "malformed provider cooldown timestamps must be surfaced instead of appearing healthy");
  assert(source.includes("**Invalid AI provider throttle counter:**"),
    "negative or non-integer throttle counters must be surfaced for repair");
  assert(source.includes('/^(0|[1-9][0-9]*)$/.test(rawThrottleCount)'),
    "boolean, whitespace-padded, decimal, and otherwise malformed counter values must not coerce into plausible counts");
});


Deno.test("internal API-key validation fails closed and only trusts explicitly allowlisted server keys", () => {
  assert(!isTrustedInternalApiKey(null, "legacy-service-role", '{"aevora_internal":"secret-1"}', "aevora_internal"),
    "missing presented keys must always be rejected");
  assert(isTrustedInternalApiKey("legacy-service-role", "legacy-service-role", null, null),
    "the configured legacy service-role key must remain supported");
  assert(isTrustedInternalApiKey("secret-1", null, '{"aevora_internal":"secret-1","unrelated":"secret-2"}', "aevora_internal"),
    "an explicitly allowlisted project secret must be accepted");
  assert(!isTrustedInternalApiKey("secret-2", null, '{"aevora_internal":"secret-1","unrelated":"secret-2"}', "aevora_internal"),
    "a valid but non-allowlisted project secret must be rejected");
  assert(!isTrustedInternalApiKey("secret-1", null, '{"aevora_internal":"secret-1"}', ""),
    "an empty allowlist must not trust project secrets");
  assert(!isTrustedInternalApiKey("secret-1", null, '{"aevora_internal":"secret-1"}', "   , "),
    "an allowlist containing only whitespace must not trust project secrets");
  assert(!isTrustedInternalApiKey("secret-1", null, '{"aevora_internal":"secret-1"}', "missing_name"),
    "an allowlisted name with no configured value must not authenticate a caller");
  assert(!isTrustedInternalApiKey("secret-1", null, '["secret-1"]', "0"),
    "a JSON array must not be treated as a named secret-key map");
  assert(!isTrustedInternalApiKey("secret-1", null, 'not-json', "aevora_internal"),
    "malformed secret configuration must fail closed without throwing");
  assert(!isTrustedInternalApiKey("secret-1", null, '{"aevora_internal":1}', "aevora_internal"),
    "non-string secret values must not authenticate callers");
  assert(!isTrustedInternalApiKey(" secret-1", null, '{"aevora_internal":"secret-1"}', "aevora_internal"),
    "presented credentials must match exactly rather than being silently normalized");
});


Deno.test("publication sync processor never persists downstream response bodies in error details", async () => {
  const source = await Deno.readTextFile(publicationSyncProcessorUrl);
  assert(source.includes('throw new Error("Canon sync failed: HTTP "+response.status);'),
    "downstream sync failures must use a bounded status-only error");
  assert(!source.includes('throw new Error("Canon sync failed: HTTP "+response.status+" "+text'),
    "untrusted downstream response bodies must not enter retry errors or outbox last_error");
  assert(source.includes('import { safeRetryErrorMessage } from "./retry-error.ts";'),
    "processor must use the shared tested retry normalizer");
  assert(safeRetryErrorMessage(new Error("Canon sync failed: HTTP 503")) === "Canon sync failed: HTTP 503",
    "three-digit downstream HTTP statuses should remain useful and bounded");
  assert(safeRetryErrorMessage(new Error("Canon sync failed: HTTP 503 secret-response")) === "Publication sync attempt failed.",
    "unexpected downstream details must be discarded");
  assert(safeRetryErrorMessage(new Error("token=secret")) === "Publication sync attempt failed.",
    "arbitrary errors must never be persisted verbatim");
  assert(safeRetryErrorMessage("private response") === "Publication sync attempt failed.",
    "non-Error thrown values must be normalized");
  assert(safeRetryErrorMessage(new Error("Outbox completion write was not confirmed.")) === "Outbox completion write was not confirmed.",
    "known internal completion failures should retain safe diagnostics");
  assert(source.includes("last_error: safeRetryErrorMessage(e),"),
    "retry state should persist only normalized internal errors");
});


Deno.test("arc planner correctly removes JSON trailing commas", async () => {
  const source = await Deno.readTextFile(arcPlannerUrl);
  assert(source.includes('replace(/,\\s*([}\\]])/g,"$1")'),
    "arc planner normalization must match whitespace after a comma before a closing brace or bracket");
  assert(!source.includes('replace(/,\\\\s*([}\\\\]])/g,"$1")'),
    "escaped backslash-s must not match a literal backslash instead of whitespace");
});

Deno.test("generation orchestrator verifies blueprint resets after blocked or failed generation", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  assert(source.includes("async function transitionBlueprintStatus"), "blueprint status transitions must have a checked helper");
  assert(source.includes('if(error)return false;if(updated)return true;'), "status transition helper must check write errors and reconcile no-op writes");
  assert(source.includes('action:"blueprint_state_transition_failed",blocked:true,retryable:true'), "failed reset transitions must block and report retryability");
  assert((source.match(/transitionBlueprintStatus\(supabase,b.id,"ready","generating"\)/g) || []).length === 2,
    "governance and provider-quota blocks must safely return claimed blueprints to ready");
  assert(source.includes('transitionBlueprintStatus(supabase,b.id,"rejected","generating")'),
    "non-retryable generation failures must verify their terminal blueprint transition");
});


Deno.test("generation orchestrator fails closed when story lifecycle lookup fails", async () => {
  const source = await Deno.readTextFile(generationOrchestratorUrl);
  const lifecycleLookup = source.indexOf('const{data:lifecycle,error:lifecycleError}=await supabase.from("story_lifecycle")');
  const lifecycleGuard = source.indexOf('if(lifecycleError||!lifecycle){results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lifecycle_unavailable"', lifecycleLookup);
  const planBuild = source.indexOf('await supabase.rpc("taleforge_build_advanced_chapter_plans"', lifecycleLookup);
  assert(lifecycleLookup >= 0, "lifecycle query errors must be captured");
  assert(lifecycleGuard > lifecycleLookup, "lifecycle lookup errors must be handled immediately");
  assert(planBuild > lifecycleGuard, "lifecycle failures must stop processing before chapter-plan writes or generation");
  assert(source.includes('blocked:true,retryable:true,reason:"Story lifecycle could not be verified; AI-dependent work was skipped."'),
    "lifecycle lookup failure must be surfaced as blocked and retryable");
});
