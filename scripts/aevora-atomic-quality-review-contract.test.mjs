import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("quality review persistence uses one atomic database commit for review row and output status", async () => {
  const source = await readFile(new URL("../supabase/functions/generate-chapter/index.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../supabase/migrations/20261017150000_aevora_atomic_quality_review_commit.sql", import.meta.url), "utf8");
  const deterministic = source.indexOf('p_review_status:"needs_revision"');
  const ai = source.indexOf("p_review_status:decision");
  assert.ok(deterministic >= 0 && ai > deterministic, "both deterministic and AI review paths must call the atomic RPC");
  assert.match(source, /db\.rpc\("aevora_commit_quality_review"/, "quality review must use the database atomic commit primitive");
  assert.doesNotMatch(source, /from\("chapter_reviews"\)\.upsert/, "worker must not persist a review separately from output status");
  assert.match(source, /commit\?\.committed!==true/, "worker must handle a fenced output without writing a review");
  assert.match(source, /score<0\|\|score>100/, "AI scores outside the documented 0-100 range must not be accepted");
  assert.match(migration, /SECURITY INVOKER/, "atomic primitive must not elevate privileges");
  assert.match(migration, /UPDATE public\.chapter_generation_outputs[\s\S]*?INSERT INTO public\.chapter_reviews/, "status transition and review write must occur in one function transaction");
  assert.match(migration, /output\.generation_status IN \('generated', 'needs_revision', 'quality_check'\)/, "finalized output states must be fenced");
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/, "browser roles must not execute the internal RPC");
  assert.match(migration, /TO service_role/, "trusted server role must retain execution");
});
