import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
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
const publisherUrl = new URL("../release-publisher/index.ts", import.meta.url);
const publisherIdempotencyUrl = new URL("../release-publisher/publisher-idempotency.ts", import.meta.url);
const publisherOutputStatusUrl = new URL("../release-publisher/publisher-output-status.ts", import.meta.url);

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
  assert(source.includes('supabase.rpc("aevora_claim_release_scheduler_lease",{p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180}'), "claim RPC name and lease arguments must remain aligned");
  assert(source.includes('supabase.rpc("aevora_renew_release_scheduler_lease",{p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180}'), "renew RPC name and lease arguments must remain aligned");
  assert(source.includes('supabase.rpc("aevora_release_scheduler_lease",{p_schedule_id:schedule.id,p_lease_token:leaseToken}'), "release RPC name and token-scoped arguments must remain aligned");
  assert(source.includes("if(leaseClaimed){"), "release must be conditional on an acquired lease");
});

Deno.test("scheduler pages schedules and approved outputs in stable order", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('return q.order("id",{ascending:true});'), "schedule ID ordering missing");
  assert(source.includes("buildScheduleQuery().range(offset,offset+499)"), "schedule paging missing");
  assert(source.includes('.order("chapter_number",{ascending:true})\n          .order("created_at",{ascending:false})\n          .order("id",{ascending:true})\n          .range(offset,offset+499)'), "approved output ordering/paging missing");
});

Deno.test("weekly schedule uses validated IANA timezone and DST-aware wall time", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('String(schedule.timezone??"UTC")'), "schedule timezone is not passed to weekly resolver");
  assert(source.includes('/^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/'), "strict wall-time validation regex missing");
  assert(source.includes("matchingWallTimeCandidates"), "DST fold/gap resolver missing");
  assert(source.indexOf("Validate scheduling configuration before any publication side effect.") < source.indexOf('from("story_lifecycle")'), "schedule preflight must precede publication setup");
  assert(!source.includes("nextRelease=now;"), "activation must not trigger an immediate extra release batch");
});

Deno.test("schedule advancement requires a confirmed update row", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('.update(update).eq("id",schedule.id).select("id,next_release_at").maybeSingle()'), "schedule update must return the updated row");
  assert(source.includes("if(updateError || !updatedSchedule)"), "missing-row schedule update must fail closed");
  assert(!source.includes("const approved:any[]=[];"), "redundant preparing-lifecycle output preflight should stay removed");
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

Deno.test("published chapter history fails closed on gaps and malformed numbers", () => {
  assert(JSON.stringify(inspectPublishedChapterHistory([])) === JSON.stringify({ok:true,latestNumber:0,firstMissingChapter:null}), "empty history should be valid");
  assert(JSON.stringify(inspectPublishedChapterHistory([1,2,3,3])) === JSON.stringify({ok:true,latestNumber:3,firstMissingChapter:null}), "duplicates should not create a false gap");
  assert(JSON.stringify(inspectPublishedChapterHistory([1,2,4,5])) === JSON.stringify({ok:true,latestNumber:5,firstMissingChapter:3}), "missing middle chapter should be detected");
  for (const malformed of [null, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert(inspectPublishedChapterHistory([1,2,malformed]).ok === false, "malformed published chapter numbers must fail closed");
  }
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
  assert(source.includes('select("generation_output_id,decision,quality_passed,continuity_passed,originality_passed,safety_passed")'), "all review gates must be loaded");
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
