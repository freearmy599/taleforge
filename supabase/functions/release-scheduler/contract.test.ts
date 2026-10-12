import { inspectPublishedChapterHistory } from "./published-history.ts";
import { qualifyReviewedOutputs } from "./review-qualified-outputs.ts";
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
  assert(source.includes("if(!dryRun){\n        const leaseClaim"), "real-run-only lease claim guard missing");
  assert(source.includes("if(leaseClaimed){\n          const released"), "conditional lease release guard missing");
  assert(!source.includes('if(dryRun){\n        const leaseClaim'), "dry-run lease claim must not exist");
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
  assert(source.includes('.select("id,chapter_number").eq("series_id",schedule.series_id).eq("status","published")'), "published history query missing");
  assert(source.includes('.range(offset,offset+499)'), "published history must be paginated");
  assert(source.includes('action:"published_chapter_gap"'), "scheduler must pause on a published chapter gap");
  assert(source.indexOf('action:"published_chapter_gap"') < source.indexOf("const readyOutputs:any[]=[];"), "gap guard must run before ready output selection");
  await Deno.readTextFile(publishedHistoryUrl);
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
  assert(qualifyReviewedOutputs([{id:"numeric-id"}],[approved("numeric-id")]).length===0, "malformed output identifiers must fail closed");
});

Deno.test("preparing lifecycle activation requires fully reviewed launch outputs", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  const query = source.indexOf('.select("id,chapter_number,generation_status").eq("series_id",schedule.series_id).in("generation_status",["approved","published"])');
  const qualification = source.indexOf("const launchReviewedOutputs=qualifyReviewedOutputs(launchApproved??[],launchReviewRows)");
  const approvedSet = source.indexOf("const approvedSet=new Set(launchReviewedOutputs.map");
  const activation = source.indexOf('.update({lifecycle_status:"active"');
  assert(query >= 0, "launch verification must load output IDs and chapter numbers");
  assert(source.includes("const launchReviewRows:any[]=[];"), "launch review rows must be fetched");
  assert(qualification > query && approvedSet > qualification && activation > approvedSet, "lifecycle activation must follow review-qualified launch verification");
  assert(source.includes("launchReviewError"), "review query failure must block lifecycle activation");
});

Deno.test("publisher rejects non-approved generation statuses before review or publication", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  const guard = source.indexOf("if (!isPublishableGenerationStatus(output.generation_status))");
  const reviewQuery = source.indexOf('from("chapter_publication_reviews")');
  assert(guard >= 0 && guard < reviewQuery, "generation status must be checked before publication processing");
  assert(source.includes('from "./publisher-output-status.ts"'), "publisher must use the tested status policy");
  assert(source.includes('code: "OUTPUT_STATUS_CONFLICT"'), "ineligible status must return a distinct conflict");
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
  const dueFilter = source.indexOf('q=q.or(`next_release_at.is.null,next_release_at.lte.${now.toISOString()}`);');
  const autoPublishFilter = source.indexOf('if(!dryRun) q=q.eq("auto_publish",true);');
  assert(queryBuilder >= 0 && explicitSchedule > queryBuilder && dueFilter > explicitSchedule, "schedule query branching must remain explicit");
  assert(autoPublishFilter > dueFilter, "normal cron scans should filter disabled auto-publish schedules only in the due-schedule branch");
  assert(source.includes("Dry-run intentionally keeps them visible for diagnostics."), "dry-run should retain diagnostic visibility");
});
