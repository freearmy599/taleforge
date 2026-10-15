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
