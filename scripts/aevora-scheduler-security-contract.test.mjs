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
  assert.ok(source.includes('release-scheduler-v16-dst-fold-cadence'));
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
