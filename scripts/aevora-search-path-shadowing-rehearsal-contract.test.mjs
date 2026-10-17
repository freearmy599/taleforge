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
const migration = await readFile(
  new URL("../supabase/migrations/20261017160000_harden_narrative_security_definer_search_path.sql", import.meta.url),
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
  assert.match(script, /aevora_test_unqualified_fixed_path/);
  assert.match(script, /Expected pg_temp-last search_path to prefer public relation/);
  assert.match(script, /-f supabase\/migrations\/20261017160000_harden_narrative_security_definer_search_path\.sql/);
  assert.match(script, /configured_count <> 6/);
});

test("prepared migration changes only the six reviewed function-local search paths", () => {
  const expectedFunctions = [
    /taleforge_reassess_long_term_narrative_architecture\(uuid\)/,
    /taleforge_refresh_long_term_narrative_architecture\(uuid\)/,
    /taleforge_consolidate_narrative_memory\(uuid, integer\)/,
    /taleforge_verify_narrative_memory_consolidation\(\)/,
    /taleforge_verify_plot_thread_progression\(\)/,
    /taleforge_refresh_narrative_memory_consolidation_health\(\)/,
  ];
  for (const pattern of expectedFunctions) assert.match(migration, pattern);
  assert.equal((migration.match(/SET search_path = pg_catalog, public, pg_temp/g) ?? []).length, 6);
  assert.doesNotMatch(migration, /CREATE OR REPLACE FUNCTION|GRANT |REVOKE |DROP TRIGGER|UPDATE public\./i);
});

test("CI runs the rehearsal only against a separately named disposable database", () => {
  assert.match(workflow, /Rehearse SECURITY DEFINER temp-relation shadowing on disposable PostgreSQL/);
  assert.match(workflow, /aevora_search_path_shadowing_test/);
  assert.match(workflow, /bash scripts\/test-aevora-search-path-shadowing\.sh/);
});
