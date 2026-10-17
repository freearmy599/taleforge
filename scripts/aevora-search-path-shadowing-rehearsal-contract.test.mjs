import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const script = await readFile(
  new URL("./test-aevora-search-path-shadowing.sh", import.meta.url),
  "utf8",
);
const workflow = await readFile(
  new URL("../.github/workflows/aevora-edge-validation.yml", import.meta.url),
  "utf8",
);

test("shadowing rehearsal requires explicit disposable acknowledgement and exact test database", () => {
  assert.match(script, /AEVORA_DISPOSABLE_SEARCH_PATH_REHEARSAL/);
  assert.match(script, /I_UNDERSTAND_THIS_IS_DISPOSABLE/);
  assert.match(script, /\[\[ "\$DATABASE_URL" == \*\/aevora_search_path_shadowing_test \]\]/);
  assert.doesNotMatch(script, /sxmbnlgufqhcwxcpcsvb|supabase\.co|aevora_shadow_test_role.*password/i);
});

test("rehearsal demonstrates unqualified temp resolution and schema-qualified protection", () => {
  assert.match(script, /SET search_path = public/);
  assert.match(script, /SELECT marker FROM series LIMIT 1/);
  assert.match(script, /temporary-shadow/);
  assert.match(script, /SET search_path = pg_catalog, public, pg_temp/);
  assert.match(script, /SELECT marker FROM public\.series LIMIT 1/);
  assert.match(script, /Expected unqualified SECURITY DEFINER lookup to resolve temp relation first/);
  assert.match(script, /Expected schema-qualified lookup to resolve public relation/);
});

test("CI runs the rehearsal only against a separately named disposable database", () => {
  assert.match(workflow, /Rehearse SECURITY DEFINER temp-relation shadowing on disposable PostgreSQL/);
  assert.match(workflow, /aevora_search_path_shadowing_test/);
  assert.match(workflow, /bash scripts\/test-aevora-search-path-shadowing\.sh/);
});
