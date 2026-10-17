/**
 * Static contract for fully locking internal taxonomy/grammar relations.
 * This source-only test does not connect to or modify Supabase.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261017140000_lock_internal_reference_taxonomy_client_access.sql", import.meta.url),
  "utf8",
);

const relations = [
  "taleforge_genre_taxonomy",
  "taleforge_subgenre_intelligence",
  "taleforge_narrative_modes",
  "taleforge_story_trope_library",
  "taleforge_genre_grammars",
  "taleforge_genre_inversion_patterns",
  "taleforge_grammar_compatibility",
  "taleforge_hybrid_story_recipes",
  "taleforge_hybrid_story_recipes_generated",
  "taleforge_narrative_culture_profiles",
  "taleforge_series_genre_grammar_profiles",
  "taleforge_series_genre_profiles",
  "taleforge_series_narrative_profiles",
  "taleforge_series_subgenre_profiles",
];

test("all internal taxonomy relations fail closed when any expected relation is missing", () => {
  assert.match(migration, /IF\s+to_regclass\(format\('public\.%I',\s*target_name\)\)\s+IS\s+NULL\s+THEN[\s\S]*RAISE EXCEPTION/i);
  for (const relation of relations) {
    assert.ok(migration.includes("'" + relation + "'"), "missing taxonomy relation: " + relation);
  }
});

test("taxonomy migration removes relation-level and column-level client privileges", () => {
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i,
    "RLS does not replace relation-level privilege revocation",
  );
  assert.match(
    migration,
    /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i,
    "column-level grants must also be revoked",
  );
  assert.match(migration, /FOREACH target_name IN ARRAY ARRAY\[/);
  assert.doesNotMatch(migration, /\bGRANT\b/i, "migration must not add access");
  assert.doesNotMatch(migration, /\bservice_role\b/i, "trusted server-role privileges must remain untouched");
});

test("taxonomy ACL correction is idempotent and limits revokes to the intended client roles", () => {
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+ALL\s+TABLES/i);
  assert.doesNotMatch(migration, /ALTER DEFAULT PRIVILEGES/i);
});
