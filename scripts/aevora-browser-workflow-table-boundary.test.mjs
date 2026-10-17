/**
 * Browser-to-workflow-table boundary contract.
 *
 * Prevents reader/admin browser assets from directly querying or mutating
 * internal workflow/control tables. Public reader paths for published series,
 * chapters and constrained reader-event intake are intentionally not blocked.
 * Source-only; no network or database side effects.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const repositoryRoot = new URL("../", import.meta.url);
const ignoredDirectories = new Set([
  ".git", "node_modules", ".deno", ".next", "dist", "coverage", "scripts", "docs", "supabase", ".github",
]);
const serverOnlyRelations = [
  "automation_config",
  "chapter_blueprints",
  "chapter_generation_outputs",
  "chapter_publication_reviews",
  "chapter_reviews",
  "generation_jobs",
  "generation_settings",
  "publication_sync_outbox",
  "story_attachment_metrics",
  "release_schedules",
  "story_blueprints",
  "story_versions",
  "taleforge_ai_provider_state",
  "taleforge_autonomous_series_creation_runs",
  "aevora_release_scheduler_leases",
  "story_arc_plan",
  "story_ending_plans",
  "story_lifecycle",
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

async function collectBrowserSources() {
  const files = [];
  const visited = new Set();
  async function walk(directory) {
    if (visited.has(directory.href)) return;
    visited.add(directory.href);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await walk(new URL(`${entry.name}/`, directory));
        }
      } else if (entry.isFile() && /\.(?:html|js|mjs)$/i.test(entry.name)) {
        files.push(new URL(entry.name, directory));
      }
    }
  }
  await walk(repositoryRoot);
  return [...new Map(files.map((file) => [file.href, file])).values()];
}

test("browser-facing sources cannot directly query internal workflow/control tables", async () => {
  const files = await collectBrowserSources();
  assert.ok(files.length > 0, "browser source discovery must not silently return an empty set");
  const violations = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const relation of serverOnlyRelations) {
      const pattern = new RegExp(
        "\\.from\\(\\s*['\"]" + relation + "['\"]\\s*\\)",
        "i",
      );
      if (pattern.test(source)) violations.push(`${file.pathname}: ${relation}`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `internal workflow tables must be accessed through trusted server paths: ${violations.join(", ")}`,
  );
});

test("server-only relation inventory covers the publication and provider security boundaries", () => {
  for (const relation of [
    "chapter_blueprints",
    "chapter_generation_outputs",
    "chapter_publication_reviews",
    "chapter_reviews",
    "publication_sync_outbox",
    "story_attachment_metrics",
    "release_schedules",
    "story_blueprints",
    "taleforge_ai_provider_state",
    "story_arc_plan",
    "story_ending_plans",
    "story_lifecycle",
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
  ]) {
    assert.ok(serverOnlyRelations.includes(relation), `missing server-only relation: ${relation}`);
  }
});
