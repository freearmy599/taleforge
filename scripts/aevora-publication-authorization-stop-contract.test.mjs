/**
 * Fail-closed scheduler authorization-stop regression.
 *
 * Static source checks only. Does not invoke Edge Functions, Gemini, or Supabase.
 * The release scheduler must remain unable to reach publication-side effects
 * until the database commit-boundary authorization is implemented and approved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../supabase/functions/release-scheduler/index.ts", import.meta.url),
  "utf8",
);
const publisher = await readFile(
  new URL("../supabase/functions/release-publisher/index.ts", import.meta.url),
  "utf8",
);

test("real auto-publish work stops before lease claims and publisher calls", () => {
  const guardStart = source.indexOf('if(!dryRun && schedule.auto_publish){');
  const guardEnd = source.indexOf('const leaseToken=crypto.randomUUID();', guardStart);
  assert.ok(guardStart >= 0, "scheduler must retain an explicit auto-publish authorization stop");
  assert.ok(guardEnd > guardStart, "authorization stop must precede lease-token creation");
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /publication_authorization_not_implemented/,
    "scheduler must report the stable fail-closed action");
  assert.match(guard, /continue;/,
    "real auto-publish schedule must exit the current iteration before side effects");

  const leaseClaim = source.indexOf('rpc("aevora_claim_release_scheduler_lease"');
  const publisherCall = source.indexOf('fetch(url+"/functions/v1/release-publisher"');
  assert.ok(leaseClaim > guardEnd, "lease claim must remain after the stop guard");
  assert.ok(publisherCall > guardEnd, "publisher HTTP call must remain after the stop guard");
});

test("authorization stop is scoped to real auto-publish work, preserving read-only dry-run diagnostics", () => {
  const guardStart = source.indexOf('if(!dryRun && schedule.auto_publish){');
  const guardEnd = source.indexOf('const leaseToken=crypto.randomUUID();', guardStart);
  const guard = source.slice(guardStart, guardEnd);
  assert.match(guard, /!dryRun && schedule\.auto_publish/,
    "the stop must cover non-dry-run auto-publish only");
  assert.match(guard, /publication_authorization_not_implemented/,
    "dry-run must not be used as a path to bypass the real publication gate");
});


test("schedule advancement requires the complete selected batch to be confirmed", () => {
  assert.match(source, /function isConfirmedPublicationResponse\(r:any,d:any\):boolean\s*\{\s*return r\.ok && d!==null && typeof d===\"object\" && d\.success===true && d\.published===true && d\.status===\"published\" && typeof d\.chapter_id===\"string\" && d\.chapter_id\.trim\(\)\.length>0;/,
    "HTTP success alone must not qualify as publication success");
  assert.match(source, /const allSelectedConfirmed = !dryRun && schedule\.auto_publish && publishCount>0\s*&& attemptedCount===publishCount && published\.length===publishCount\s*&& !publicationFailed && !leaseLost;/,
    "the batch completion predicate must reject partial batches and lease loss");
  assert.match(source, /if\(!dryRun && nextRelease && allSelectedConfirmed\)/,
    "schedule advancement must be conditional on full batch confirmation");
});

test("scheduler verifies the persisted chapter before counting a publisher response", () => {
  const publisherCall = source.indexOf('fetch(url+"/functions/v1/release-publisher"');
  const persistedChapterCheck = source.indexOf('from("chapters")', publisherCall);
  const confirmationCondition = source.indexOf('confirmedChapter.status!=="published"', persistedChapterCheck);
  assert.ok(publisherCall >= 0 && persistedChapterCheck > publisherCall,
    "scheduler must read the persisted chapter after publisher response");
  assert.ok(confirmationCondition > persistedChapterCheck,
    "scheduler must reject a chapter whose persisted status is not published");
});


test("persisted publication confirmation binds chapter ID, series, chapter number, and status", () => {
  const publisherCall = source.indexOf('fetch(url+"/functions/v1/release-publisher"');
  const persistedChapterCheck = source.indexOf('from("chapters")', publisherCall);
  const query = source.slice(persistedChapterCheck, source.indexOf("published.push(", persistedChapterCheck));
  assert.match(query, /\.eq\("id",d\.chapter_id\)/,
    "the persisted row must be the exact chapter ID returned by the publisher");
  assert.match(query, /\.eq\("series_id",schedule\.series_id\)/,
    "a published chapter from another series must not confirm this schedule");
  assert.match(query, /\.eq\("chapter_number",candidate\.chapter_number\)/,
    "a different chapter slot must not confirm the candidate");
  assert.match(query, /confirmedChapter\.status!==\"published\"/,
    "the persisted chapter must be in published status");
});


test("scheduler renews its lease before invoking the publisher", () => {
  const renewIndex = source.indexOf('rpc("aevora_renew_release_scheduler_lease"');
  const publisherIndex = source.indexOf('fetch(url+"/functions/v1/release-publisher"', renewIndex);
  const leaseLostIndex = source.indexOf('leaseLost=true;', renewIndex);
  assert.ok(renewIndex >= 0 && publisherIndex > renewIndex,
    "the current schedule lease must be renewed before the publisher call");
  assert.ok(leaseLostIndex > renewIndex && leaseLostIndex < publisherIndex,
    "a rejected lease renewal must fail closed before publication side effects");
  const renewalGuard = source.slice(renewIndex, publisherIndex);
  assert.match(renewalGuard, /renewed\.error \|\| renewed\.data!==true[\s\S]*?break;/,
    "renewal error or non-ownership must stop the batch");
});

test("schedule advancement uses the same lease token in an atomic database RPC", () => {
  const advanceIndex = source.indexOf('rpc("aevora_advance_release_schedule_if_lease_owned"');
  assert.ok(advanceIndex >= 0, "schedule advancement must use the lease-aware RPC");
  const advancement = source.slice(advanceIndex, advanceIndex + 550);
  assert.match(advancement, /p_schedule_id:schedule\.id/);
  assert.match(advancement, /p_lease_token:leaseToken/);
  assert.match(advancement, /p_next_release_at:nextRelease\.toISOString\(\)/);
  assert.match(advancement, /advancement\.error \|\| advancement\.data!==true[\s\S]*?leaseLost=true;/,
    "an unconfirmed advancement must not be reported as successful");
});

test("claimed scheduler leases are released in finally, with failures surfaced", () => {
  const finallyIndex = source.indexOf("}finally{");
  const releaseIndex = source.indexOf('rpc("aevora_release_scheduler_lease"', finallyIndex);
  assert.ok(finallyIndex >= 0 && releaseIndex > finallyIndex,
    "lease release must run in the schedule-processing finally block");
  const cleanup = source.slice(finallyIndex, source.indexOf("\n      }\n    }", finallyIndex));
  assert.match(cleanup, /if\(leaseClaimed\)/);
  assert.match(cleanup, /released\?\.error \|\| released\?\.data!==true/);
  assert.match(cleanup, /action:"lease_release_warning"/,
    "failed lease release must be visible as a scheduler failure");
});


test("database confirmation lookup errors, missing rows, and mismatched status fail closed before counting a publication", () => {
  const publisherCall = source.indexOf('fetch(url+"/functions/v1/release-publisher"');
  const confirmationQuery = source.indexOf('const {data:confirmedChapter,error:confirmError}', publisherCall);
  const failureGuard = source.indexOf('if(confirmError || !confirmedChapter || confirmedChapter.status!=="published")', confirmationQuery);
  const publicationCount = source.indexOf('confirmedPublishedCount++;', failureGuard);
  const publishedPush = source.indexOf('published.push(', failureGuard);
  assert.ok(publisherCall >= 0 && confirmationQuery > publisherCall,
    "the scheduler must perform a database confirmation lookup after publisher response");
  assert.ok(failureGuard > confirmationQuery,
    "database lookup errors, missing rows, or non-published status must enter a failure guard");
  assert.match(source.slice(failureGuard, publishedPush),
    /publicationFailed=true;[\s\S]*?action:"publish_unconfirmed"/,
    "unconfirmed database state must mark the batch failed and surface publish_unconfirmed");
  assert.ok(publicationCount > failureGuard && publicationCount < source.indexOf("const allSelectedConfirmed"),
    "the confirmation counter must only be incremented in the success path before batch-completion evaluation");
  assert.ok(publishedPush > failureGuard && publishedPush < publicationCount,
    "the response must not be added to the published batch before the database row is confirmed");
});


test("partial publication failure blocks lifecycle activation and schedule advancement", () => {
  const lifecycleGate = source.indexOf('if(!dryRun && schedule.auto_publish && lifecycleStatus==="preparing" && !publicationFailed && !leaseLost)');
  const lifecycleRpc = source.indexOf('rpc("aevora_activate_story_lifecycle_if_lease_owned"', lifecycleGate);
  assert.ok(lifecycleGate >= 0 && lifecycleRpc > lifecycleGate,
    "lifecycle activation must remain behind a fail-closed gate");
  assert.match(source.slice(lifecycleGate, lifecycleRpc),
    /!publicationFailed && !leaseLost/,
    "a partial publication failure or lease loss must block activation");
  const completionGate = source.indexOf('const allSelectedConfirmed =');
  const advanceGate = source.indexOf('if(!dryRun && nextRelease && allSelectedConfirmed)', completionGate);
  const advanceRpc = source.indexOf('rpc("aevora_advance_release_schedule_if_lease_owned"', advanceGate);
  assert.ok(completionGate >= 0 && advanceGate > completionGate && advanceRpc > advanceGate,
    "schedule advancement must remain behind full-batch confirmation");
  assert.match(source.slice(completionGate, advanceGate),
    /attemptedCount===publishCount && published\.length===publishCount[\s\S]*?!publicationFailed && !leaseLost/,
    "partial batches, publisher failures, and lease loss must fail the completion predicate");
});


test("publisher blocks manual and automatic publication before publication-state access", () => {
  const governanceCheck = publisher.indexOf('taleforge_ceo_execution_gate",{p_action_scope:"publication"}');
  const stop = publisher.indexOf('code: "PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED"', governanceCheck);
  const outputLookup = publisher.indexOf('.from("chapter_generation_outputs")');
  const scheduleLookup = publisher.indexOf('.from("release_schedules")');
  const chapterLookup = publisher.indexOf('.from("chapters")');
  assert.ok(governanceCheck >= 0, "publisher must retain the separate governance gate");
  assert.ok(stop > governanceCheck, "trusted-approval stop must follow internal governance authentication");
  assert.ok(scheduleLookup < stop, "publisher must classify the persisted schedule before deciding whether the manual path is blocked");
  assert.ok(outputLookup >= 0 && outputLookup < chapterLookup && chapterLookup > stop, "publisher must stop before chapter lookup or publication-side effects");
  const stopBlock = publisher.slice(stop - 300, chapterLookup);
  assert.match(stopBlock, /published: false/);
  assert.match(stopBlock, /}, 423\)/);
  assert.match(stopBlock, /Publication blocked until trusted approval is implemented/);
});

test("publisher no longer relies on manual schedule flags as proof of human approval", () => {
  const stop = publisher.indexOf('code: "PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED"');
  const manualBranch = publisher.indexOf('automationSchedule.schedule_mode === "manual"');
  assert.ok(stop >= 0 && manualBranch > stop,
    "all modes must fail closed before the later manual-vs-automated schedule checks");
  assert.match(publisher.slice(Math.max(0, stop - 700), manualBranch),
    /trusted-approval record bound to[\s\S]*?service-role authentication are[\s\S]*?not per-chapter human approval/);
});
