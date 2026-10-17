/**
 * Scheduler response-redaction contracts.
 * Source-only checks: no Supabase calls, generation, or publication.
 * Run with: node --test scripts/aevora-scheduler-security-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../supabase/functions/release-scheduler/index.ts", import.meta.url),
  "utf8",
);

test("scheduler version records diagnostic redaction", () => {
  assert.ok(source.includes('release-scheduler-v17-publication-authorization-preflight'));
});

test("scheduler exception helper never returns provider or database exception text", () => {
  assert.ok(source.includes('function message(_e: unknown){ return "Internal scheduler diagnostics were withheld."; }'));
  assert.equal(source.includes('function message(e: unknown){ return e instanceof Error ? e.message : String(e); }'), false);
});

test("publisher response body is not echoed into scheduler result payloads", () => {
  assert.ok(source.includes('details:"Publisher response body was withheld."'));
  assert.equal(source.includes('http_status:r.status,details:d'), false);
});

test("scheduler keeps lease ownership and publication confirmation checks", () => {
  for (const rpc of [
    "aevora_claim_release_scheduler_lease",
    "aevora_renew_release_scheduler_lease",
    "aevora_release_scheduler_lease",
    "aevora_advance_release_schedule_if_lease_owned",
  ]) assert.ok(source.includes(rpc), "missing lease RPC: " + rpc);
  assert.ok(source.includes("d.success===true && d.published===true"));
  assert.ok(source.includes('confirmedChapter.status!=="published"'));
  const blocked = source.indexOf('action:"publication_authorization_not_implemented"');
  const lease = source.indexOf("const leaseToken=crypto.randomUUID()");
  assert.ok(blocked >= 0 && lease > blocked, "publication preflight must precede lease work");
  const failures = source.slice(source.indexOf("const failureActions"), source.indexOf("const hasScheduleFailures"));
  assert.ok(failures.includes('"publication_authorization_not_implemented"'), "blocked automation must be an unsuccessful result");
});

test("lease renewal is checked before each publisher invocation", () => {
  const renew = source.indexOf('supabase.rpc("aevora_renew_release_scheduler_lease"');
  const publisher = source.indexOf('url+"/functions/v1/release-publisher"');
  assert.ok(renew >= 0 && publisher > renew, "the lease must be renewed before publication");
  assert.ok(source.indexOf('if(renewed.error || renewed.data!==true)') < publisher,
    "failed lease renewal must stop before invoking the publisher");
});

test("schedule advancement requires every selected publication to be confirmed", () => {
  assert.ok(source.includes('const allSelectedConfirmed = !dryRun && schedule.auto_publish && publishCount>0'));
  assert.ok(source.includes('attemptedCount===publishCount && published.length===publishCount'));
  assert.ok(source.includes('&& !publicationFailed && !leaseLost;'));
  assert.ok(source.includes('if(!dryRun && nextRelease && allSelectedConfirmed)'));
  assert.ok(source.includes('aevora_advance_release_schedule_if_lease_owned'));
});

test("publication-authorization rejection cannot be mistaken for a confirmed release", async () => {
  const publisher = await readFile(
    new URL("../supabase/functions/release-publisher/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(publisher, /PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED/);
  const match = source.match(/function isConfirmedPublicationResponse\(r:any,d:any\):boolean\{[\s\S]*?\}/);
  assert.ok(match, "scheduler must expose a strict publication-confirmation predicate");
  const helper = match[0].replace("function isConfirmedPublicationResponse(r:any,d:any):boolean", "function isConfirmedPublicationResponse(r,d)");
  const isConfirmed = runInNewContext(helper + "; isConfirmedPublicationResponse");
  const blocked = { success: false, error: "Automated publication is disabled until separate publication authorization is implemented.", code: "PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED" };
  assert.equal(isConfirmed({ ok: false }, blocked), false);
  assert.equal(isConfirmed({ ok: true }, blocked), false);
  assert.equal(isConfirmed({ ok: true }, { success: true, published: true, status: "published" }), false);
  assert.equal(isConfirmed({ ok: true }, { success: true, published: true, status: "published", chapter_id: "chapter-1" }), true);
  assert.ok(source.includes("attemptedCount===publishCount && published.length===publishCount"), "schedule advancement must require every selected publication to be confirmed");
});

test("lifecycle activation is blocked after publication or lease failure", () => {
  assert.ok(source.includes('lifecycleStatus==="preparing" && !publicationFailed && !leaseLost'));
  assert.ok(source.includes('action:"lifecycle_transition_failed"'));
});

test("claimed scheduler leases are released in a finally block and release uncertainty is surfaced as failure", () => {
  const claim = source.indexOf('supabase.rpc("aevora_claim_release_scheduler_lease"');
  const renewal = source.indexOf('supabase.rpc("aevora_renew_release_scheduler_lease"');
  const release = source.indexOf('supabase.rpc("aevora_release_scheduler_lease"');
  const finallyBlock = source.lastIndexOf("}finally{", release);
  assert.ok(claim >= 0 && renewal > claim && release > renewal, "claim, renew, and release paths must all exist");
  assert.ok(finallyBlock > claim, "lease cleanup must be inside the schedule-processing finally block");
  const cleanup = source.slice(finallyBlock, source.indexOf("\n      }\n    }", finallyBlock));
  assert.match(cleanup, /if\(leaseClaimed\)/, "only a lease claimed by this invocation should be released");
  assert.match(cleanup, /released\?\.data!==true/, "an unconfirmed release must not be treated as success");
  assert.match(source, /"lease_release_warning"/, "release uncertainty must be surfaced in the scheduler result");
  assert.match(source, /failureActions=new Set\(\[[\s\S]*?"lease_release_warning"/, "lease release uncertainty must affect overall scheduler success");
});


test("scheduler lease RPCs pin SECURITY DEFINER search paths and deny client-role execution", async () => {
  const foundation = await readFile(
    new URL("../supabase/migrations/20261012183000_aevora_release_scheduler_lease_foundation.sql", import.meta.url),
    "utf8",
  );
  const fencing = await readFile(
    new URL("../supabase/migrations/20261012190000_aevora_atomic_scheduler_lease_fencing.sql", import.meta.url),
    "utf8",
  );
  const functions = [
    ["aevora_claim_release_scheduler_lease", foundation],
    ["aevora_renew_release_scheduler_lease", foundation],
    ["aevora_release_scheduler_lease", foundation],
    ["aevora_advance_release_schedule_if_lease_owned", fencing],
    ["aevora_activate_story_lifecycle_if_lease_owned", fencing],
  ];
  for (const [name, migration] of functions) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const definition = migration.match(new RegExp("CREATE OR REPLACE FUNCTION public\\." + escaped + "\\([\\s\\S]*?\\$function\\$"));
    assert.ok(definition, "missing lease RPC definition: " + name);
    assert.match(definition[0], /SECURITY DEFINER/, name + " must be SECURITY DEFINER");
    assert.match(definition[0], /SET search_path = pg_catalog/, name + " must pin search_path");
    assert.match(migration, new RegExp("REVOKE ALL ON FUNCTION public\\." + escaped + "\\([\\s\\S]*?FROM PUBLIC, anon, authenticated;"), name + " must revoke client-role execution");
    assert.match(migration, new RegExp("GRANT EXECUTE ON FUNCTION public\\." + escaped + "\\([\\s\\S]*?TO postgres, service_role;"), name + " must grant only trusted server roles");
  }
});


test("automated publication remains fail-closed before any chapter idempotency or insert path until atomic authorization exists", async () => {
  const publisher = await readFile(
    new URL("../supabase/functions/release-publisher/index.ts", import.meta.url),
    "utf8",
  );
  const authorizationBlock = publisher.indexOf("PUBLICATION_AUTHORIZATION_NOT_IMPLEMENTED");
  const existingChapterPath = publisher.indexOf('const { data: existingChapter');
  const insertChapterPath = publisher.indexOf('const { data: insertedChapter');
  assert.ok(authorizationBlock >= 0, "automated publication must remain explicitly blocked");
  assert.ok(existingChapterPath > authorizationBlock,
    "authorization fail-closed gate must precede the existing-chapter/idempotency path");
  assert.ok(insertChapterPath > authorizationBlock,
    "authorization fail-closed gate must precede chapter insertion");
  assert.match(publisher, /checked at the database commit boundary/,
    "the publisher must document that authorization belongs at the database commit boundary");
});


test("automatic-publication preflight exits before publisher, lifecycle, or schedule-advance side effects", () => {
  const blocked = source.indexOf('action:"publication_authorization_not_implemented"');
  const continueAfterBlock = source.indexOf("continue;", blocked);
  const leaseClaim = source.indexOf('supabase.rpc("aevora_claim_release_scheduler_lease"', blocked);
  const publisherCall = source.indexOf('url+"\/functions\/v1\/release-publisher"', blocked);
  const lifecycleWrite = source.indexOf('supabase.rpc("aevora_activate_story_lifecycle_if_lease_owned"', blocked);
  const scheduleAdvance = source.indexOf('supabase.rpc("aevora_advance_release_schedule_if_lease_owned"', blocked);

  assert.ok(blocked >= 0 && continueAfterBlock > blocked,
    "blocked automatic publication must exit the current schedule iteration");
  assert.ok(leaseClaim > continueAfterBlock,
    "no lease claim may happen before the fail-closed branch exits");
  assert.ok(publisherCall > continueAfterBlock,
    "no publisher invocation may happen before the fail-closed branch exits");
  assert.ok(lifecycleWrite > continueAfterBlock,
    "no lifecycle write may happen before the fail-closed branch exits");
  assert.ok(scheduleAdvance > continueAfterBlock,
    "no schedule advancement may happen before the fail-closed branch exits");
});


test("dry-run mode cannot claim leases, call the publisher, transition lifecycle, or advance schedules", () => {
  const claim = source.indexOf('supabase.rpc("aevora_claim_release_scheduler_lease"');
  const publisher = source.indexOf('url+"/functions/v1/release-publisher"');
  const activate = source.indexOf('supabase.rpc("aevora_activate_story_lifecycle_if_lease_owned"');
  const advance = source.indexOf('supabase.rpc("aevora_advance_release_schedule_if_lease_owned"');
  assert.ok(claim >= 0 && publisher > claim && activate > publisher && advance > activate,
    "expected lease, publisher, lifecycle, and schedule-advance operations in the scheduler");
  const claimGate = source.lastIndexOf("if(!dryRun && schedule.auto_publish){", claim);
  assert.ok(claimGate >= 0 && claimGate < claim,
    "lease claim must be gated behind non-dry-run automatic publication");
  assert.ok(source.slice(claimGate, claim).includes("let leaseClaim:any=null;"),
    "lease claim setup must remain inside the non-dry-run gate");
  const publishGate = source.lastIndexOf("if(!dryRun && schedule.auto_publish && publishCount>0){", publisher);
  assert.ok(publishGate >= 0 && publishGate < publisher,
    "publisher invocation must remain inside a non-dry-run publication gate");
  assert.ok(source.slice(publishGate, publisher).includes('supabase.rpc("aevora_renew_release_scheduler_lease"'),
    "lease renewal must remain inside the gated publication path");
  assert.match(source.slice(advance - 120, advance), /if\(!dryRun && nextRelease && allSelectedConfirmed\)/,
    "schedule advancement must be gated by non-dry-run mode and confirmed publications");
  const lifecycleGate = source.lastIndexOf('if(!dryRun && schedule.auto_publish && lifecycleStatus==="preparing" && !publicationFailed && !leaseLost){', activate);
  assert.ok(lifecycleGate >= 0 && lifecycleGate < activate,
    "lifecycle activation must be gated by non-dry-run mode and successful publication");
  assert.ok(source.slice(activate, activate + 300).includes("aevora_activate_story_lifecycle_if_lease_owned"),
    "lifecycle activation must use the lease-owned atomic RPC");
});


test("scheduler requires a trusted internal API key before creating its service-role client", () => {
  const guard = source.indexOf("if(!isTrustedInternalApiKey(");
  const client = source.indexOf("const supabase=createClient(");
  assert.ok(source.includes('import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";'));
  assert.ok(guard >= 0 && client > guard, "internal caller authentication must precede service-role client creation");
  assert.ok(source.includes('return response({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."},401);'));
});


test("internal API key helper fails closed for missing, malformed, or unallowlisted secret keys", async () => {
  const helper = await readFile(
    new URL("../supabase/functions/_shared/internal-api-key.ts", import.meta.url),
    "utf8",
  );
  assert.match(helper, /if \(!presentedApiKey\) return false;/);
  assert.match(helper, /legacyServiceRoleKey && presentedApiKey === legacyServiceRoleKey/);
  assert.match(helper, /if \(!secretKeysJson \|\| !allowedSecretKeyNamesCsv\) return false;/);
  assert.match(helper, /if \(allowedNames\.size === 0\) return false;/);
  assert.match(helper, /typeof parsed !== "object" \|\| Array\.isArray\(parsed\)/);
  assert.match(helper, /allowedNames\.has\(name\) && typeof value === "string"/);
  assert.match(helper, /value\.length > 0 && value === presentedApiKey/);
  assert.match(helper, /catch \{[\s\S]*?return false;/);
});


test("publication confirmation predicate rejects malformed, contradictory, and incomplete publisher responses", () => {
  const match = source.match(/function isConfirmedPublicationResponse\(r:any,d:any\):boolean\{[\s\S]*?\}/);
  assert.ok(match, "strict publication confirmation predicate must be present");
  const helper = match[0].replace("function isConfirmedPublicationResponse(r:any,d:any):boolean", "function isConfirmedPublicationResponse(r,d)");
  const isConfirmed = runInNewContext(helper + "; isConfirmedPublicationResponse");
  const valid = { success: true, published: true, status: "published", chapter_id: "chapter-1" };
  assert.equal(isConfirmed({ ok: true }, valid), true);
  for (const response of [
    null,
    undefined,
    "published",
    [],
    { ...valid, success: false },
    { ...valid, published: false },
    { ...valid, status: "queued" },
    { ...valid, chapter_id: "" },
    { ...valid, chapter_id: "   " },
    { ...valid, chapter_id: 123 },
  ]) {
    assert.equal(isConfirmed({ ok: true }, response), false, "malformed/contradictory response must not confirm publication");
  }
  assert.equal(isConfirmed({ ok: false }, valid), false, "HTTP failure must never confirm publication");
  assert.equal(isConfirmed({ ok: true }, { ...valid, status: "published", extra: { error: true } }), true,
    "irrelevant additional response fields must not override the required confirmation fields");
});

test("scheduler confirms the persisted chapter ID, series slot, and published status before counting success", () => {
  const start = source.indexOf("const {data:confirmedChapter,error:confirmError}=await supabase.from(\"chapters\")");
  const accepted = source.indexOf("published.push({...d,status:confirmedChapter.status})", start);
  assert.ok(start >= 0 && accepted > start,
    "a persisted chapter confirmation query must precede counting the publisher response");
  const confirmation = source.slice(start, accepted);
  assert.match(confirmation, /\.eq\(\"id\",d\.chapter_id\)/,
    "confirmation must use the chapter ID returned by the publisher");
  assert.match(confirmation, /\.eq\(\"series_id\",schedule\.series_id\)/,
    "confirmation must bind the chapter to the scheduled series");
  assert.match(confirmation, /\.eq\(\"chapter_number\",candidate\.chapter_number\)/,
    "confirmation must bind the chapter to the selected chapter slot");
  assert.match(confirmation, /if\(confirmError \|\| !confirmedChapter \|\| confirmedChapter\.status!==\"published\"\)/,
    "lookup errors, missing rows, and non-published rows must all fail closed");
  assert.match(confirmation, /publicationFailed=true;[\s\S]*?break;/,
    "unconfirmed persistence must stop the batch rather than count a publication");
});

test("scheduler cannot bypass lease-fenced RPCs with direct schedule or lifecycle writes", () => {
  assert.doesNotMatch(source, /\.from\(["']release_schedules["']\)\s*\.(?:update|upsert|delete)\s*\(/,
    "release schedule state must only advance through lease-owned atomic RPCs");
  assert.doesNotMatch(source, /\.from\(["']series["']\)\s*\.(?:update|upsert|delete)\s*\(/,
    "series lifecycle must not be changed by an unfenced direct table write");
  for (const rpc of [
    "aevora_advance_release_schedule_if_lease_owned",
    "aevora_activate_story_lifecycle_if_lease_owned",
  ]) assert.ok(source.includes(rpc), "missing lease-fenced state transition RPC: " + rpc);
});

