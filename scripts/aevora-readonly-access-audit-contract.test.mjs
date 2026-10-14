/**
 * Guard the reusable database access audit against accidental mutations.
 * Source-level contract only; the SQL is not executed by this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../docs/aevora/phase1-readonly-access-audit.sql", import.meta.url),
  "utf8",
);

const trendingMigration = await readFile(
  new URL("../supabase/migrations/20261014130000_public_trending_aggregate_rpc.sql", import.meta.url),
  "utf8",
);

const revisionConflictReport = await readFile(
  new URL("../docs/aevora/phase1-revision-successor-conflict-report.sql", import.meta.url),
  "utf8",
);

test("Phase 1 access audit contains only read-only SELECT statements", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "").trim();
  const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 6, "expected six discrete metadata queries");
  for (const [index, statement] of statements.entries()) {
    assert.match(statement, /^SELECT\b/i, `statement ${index + 1} must begin with SELECT`);
    assert.doesNotMatch(
      statement,
      /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|CALL|DO)\b/i,
      `statement ${index + 1} must not contain a mutating SQL command`,
    );
  }
});

test("explicit column ACL audit uses pg_attribute.attacl rather than effective column privileges", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "");
  assert.match(executableSql, /pg_attribute\s+a/i);
  assert.match(executableSql, /aclexplode\(a\.attacl\)/i);
  assert.doesNotMatch(executableSql, /FROM\s+information_schema\.(role_)?column_privileges/i);
});

test("function inventory inspects effective EXECUTE without calling functions", () => {
  assert.match(sql, /has_function_privilege\(r\.rolname, p\.oid, 'EXECUTE'\)/i);
  assert.match(sql, /pg_get_function_identity_arguments\(p\.oid\)/i);
});

test("default ACL inventory distinguishes future-object privileges by owner", () => {
  assert.match(sql, /FROM\s+pg_default_acl\s+d/i);
  assert.match(sql, /pg_get_userbyid\(d\.defaclrole\)\s+AS\s+default_acl_owner/i);
  assert.match(sql, /d\.defaclobjtype/i);
  assert.match(sql, /aclexplode\(d\.defaclacl\)/i);
  assert.match(sql, /WHERE\s+n\.nspname\s*=\s*'public'/i);
  assert.match(sql, /d\.defaclnamespace\s*=\s*0/i);
  assert.match(sql, /n\.nspname\s*<>\s*'public'/i);
});

test("existing sequence ACL inventory is read-only and distinguishes client roles", () => {
  assert.match(sql, /c\.relkind\s*=\s*'S'/i);
  assert.match(sql, /aclexplode\(c\.relacl\)/i);
  assert.match(sql, /sequence_owner/i);
  assert.match(sql, /grantee\.rolname\s+IN\s+\('anon',\s*'authenticated'\)/i);
});


test("public trending data is exposed only through a fixed-search-path aggregate function", () => {
  assert.match(trendingMigration, /CREATE OR REPLACE FUNCTION public\.get_public_story_trending_scores\(\)/i);
  assert.match(trendingMigration, /SECURITY DEFINER/i);
  assert.match(trendingMigration, /SET search_path = pg_catalog/i);
  assert.match(trendingMigration, /created_at > pg_catalog\.now\(\) - interval '30 days'/i);
  assert.match(trendingMigration, /WHERE s\.status = ANY \(ARRAY\['ongoing'::text, 'completed'::text\]\)/i);
  assert.match(trendingMigration, /REVOKE ALL PRIVILEGES ON FUNCTION public\.get_public_story_trending_scores\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(trendingMigration, /GRANT EXECUTE ON FUNCTION public\.get_public_story_trending_scores\(\) TO anon, authenticated, service_role/i);
  assert.match(trendingMigration, /CREATE OR REPLACE VIEW public\.story_trending_scores\s+WITH \(security_invoker = true\)/i);
  assert.match(trendingMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.story_trending_scores, public\.story_intelligence\s+FROM PUBLIC, anon, authenticated/i);
  assert.match(trendingMigration, /GRANT SELECT ON TABLE public\.story_trending_scores, public\.story_intelligence\s+TO anon, authenticated/i);
  assert.doesNotMatch(trendingMigration, /visitor_id|reader_events\.id|CREATE\s+POLICY|GRANT\s+SELECT\s+ON\s+TABLE\s+public\.reader_events/i);
});


const identitySequenceMigration = await readFile(
  new URL("../supabase/migrations/20261014120000_lock_public_identity_sequence_grants.sql", import.meta.url),
  "utf8",
);

test("identity sequence migration limits direct sequence access without changing identity columns", () => {
  for (const sequence of ["aevora_engineering_events_id_seq", "reader_events_id_seq"]) {
    assert.match(
      identitySequenceMigration,
      new RegExp("REVOKE ALL PRIVILEGES ON SEQUENCE public\\." + sequence + " FROM PUBLIC, anon, authenticated", "i"),
      sequence + " must revoke direct client sequence privileges",
    );
  }
  assert.doesNotMatch(identitySequenceMigration, /GRANT\s+.+\s+TO\s+(PUBLIC|anon|authenticated)/i);
  assert.doesNotMatch(identitySequenceMigration, /ALTER\s+TABLE|ALTER\s+SEQUENCE|DROP\s+SEQUENCE|CREATE\s+SEQUENCE/i);
  assert.match(identitySequenceMigration, /service_role grants/i);
});


const readerEventsMigration = await readFile(
  new URL("../supabase/migrations/20261014150000_reader_events_insert_only.sql", import.meta.url),
  "utf8",
);

test("reader event intake grants only INSERT to ordinary clients and retains the RLS policy contract", () => {
  assert.match(readerEventsMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.reader_events FROM PUBLIC, anon, authenticated/i);
  assert.match(readerEventsMigration, /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.reader_events FROM PUBLIC, anon, authenticated/i);
  assert.match(readerEventsMigration, /GRANT INSERT ON TABLE public\.reader_events TO anon, authenticated/i);
  assert.doesNotMatch(readerEventsMigration, /GRANT\s+(?!INSERT\b)[A-Z ,]+\s+ON\s+TABLE\s+public\.reader_events\s+TO\s+(PUBLIC|anon|authenticated)/i);
  assert.doesNotMatch(readerEventsMigration, /CREATE\s+POLICY|DROP\s+POLICY|DELETE\s+FROM\s+public\.reader_events|TRUNCATE\s+TABLE/i);
});


test("revision-successor conflict report is read-only and excludes story content", () => {
  const executableSql = revisionConflictReport.replace(/--[^\n]*/g, "").trim();
  const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 1, "expected one read-only conflict report query");
  assert.match(statements[0], /^WITH\b/i);
  assert.doesNotMatch(
    statements[0],
    /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|GRANT|REVOKE|TRUNCATE|CALL|DO)\b/i,
  );
  assert.doesNotMatch(executableSql, /output_text|chapter_content/i);
  assert.match(executableSql, /generation_status\s*=\s*'approved'/i);
});


test("public trending aggregate preserves the exact existing discovery-view output contract", () => {
  const expectedColumns = [
    "series_id uuid",
    "title text",
    "subtitle text",
    "description text",
    "status text",
    "published_at timestamptz",
    "trending_score numeric",
    "opens bigint",
    "completions bigint",
    "follows bigint",
    "bookmarks bigint",
    "latest_activity timestamptz",
  ];
  const returnBlock = trendingMigration.match(/RETURNS TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE sql/i);
  assert.ok(returnBlock, "trending RPC must declare an explicit table return contract");
  const actualColumns = returnBlock[1]
    .split(",")
    .map((column) => column.trim().replace(/\s+/g, " ").toLowerCase());
  assert.deepEqual(actualColumns, expectedColumns, "RPC output names, types, and order must match the observed discovery view contract");
  assert.match(trendingMigration, /CREATE OR REPLACE VIEW public\.story_trending_scores\s+WITH \(security_invoker = true\)/i);
  assert.match(readerEventsMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.reader_events FROM PUBLIC, anon, authenticated/i);
  assert.match(readerEventsMigration, /GRANT INSERT ON TABLE public\.reader_events TO anon, authenticated/i);
  assert.doesNotMatch(readerEventsMigration, /GRANT SELECT ON TABLE public\.reader_events TO (PUBLIC|anon|authenticated)/i);
});


const defaultPrivilegesMigration = await readFile(
  new URL("../supabase/migrations/20261014170000_restrict_public_default_privileges.sql", import.meta.url),
  "utf8",
);

test("future-object default privilege migration is owner-guarded and removes client defaults", () => {
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /pg_has_role\(current_user, owner_role, 'MEMBER'\)/i);
  assert.match(defaultPrivilegesMigration, /requires a privileged owner operation/i);
  assert.doesNotMatch(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/i);
});


const internalNarrativeMigration = await readFile(
  new URL("../supabase/migrations/20261013103000_lock_internal_narrative_intelligence_tables.sql", import.meta.url),
  "utf8",
);

test("internal narrative migration revokes both relation and column grants on diagnostic view", () => {
  assert.match(
    internalNarrativeMigration,
    /REVOKE ALL PRIVILEGES ON TABLE public\.taleforge_system_health_snapshot FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    internalNarrativeMigration,
    /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.taleforge_system_health_snapshot FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(internalNarrativeMigration, /pg_attribute/i);
  assert.match(internalNarrativeMigration, /attisdropped/i);
  assert.match(
    internalNarrativeMigration,
    /DROP POLICY IF EXISTS "public can read system health" ON public\.taleforge_system_health/i,
  );
  assert.doesNotMatch(
    internalNarrativeMigration,
    /GRANT\s+(SELECT|ALL PRIVILEGES)\s+ON\s+(TABLE\s+)?public\.taleforge_system_health_snapshot\s+TO\s+(PUBLIC|anon|authenticated)/i,
  );
});


test("internal narrative migration keeps every DO dollar-quoted block balanced", () => {
  const opens = internalNarrativeMigration.match(/\bDO\s+\$\$/gi) ?? [];
  const closes = internalNarrativeMigration.match(/^\$\$;\s*$/gm) ?? [];
  assert.equal(opens.length, closes.length, "DO $$ blocks and $$; terminators must match");
  assert.doesNotMatch(internalNarrativeMigration, /\bDO\s+\$(?:\r?\n|$)/i, "reject malformed single-dollar DO opener");
  assert.doesNotMatch(internalNarrativeMigration, /^\$;\s*$/m, "reject malformed single-dollar DO terminator");
});


const unapprovedInternalWritesMigration = await readFile(
  new URL("../supabase/migrations/20261014180000_revoke_unapproved_internal_client_writes.sql", import.meta.url),
  "utf8",
);

test("unapproved internal-write migration covers all 41 audited uncovered tables and preserves SELECT", () => {
  for (const table of ["taleforge_advanced_chapter_plans","taleforge_character_architecture","taleforge_ending_architecture","taleforge_genre_grammars","taleforge_genre_inversion_patterns","taleforge_genre_taxonomy","taleforge_grammar_compatibility","taleforge_hybrid_story_recipes","taleforge_hybrid_story_recipes_generated","taleforge_narrative_arc_layers","taleforge_narrative_culture_profiles","taleforge_narrative_memory_consolidations","taleforge_narrative_modes","taleforge_series_genre_grammar_profiles","taleforge_series_genre_profiles","taleforge_series_narrative_profiles","taleforge_series_subgenre_profiles","taleforge_story_concept_arc_characters","taleforge_story_concept_arc_endings","taleforge_story_concept_arc_relationships","taleforge_story_concept_arc_threads","taleforge_story_concept_arc_world_functions","taleforge_story_concept_arcs","taleforge_story_concept_candidates","taleforge_story_concept_character_causality","taleforge_story_concept_characters","taleforge_story_concept_evaluations","taleforge_story_concept_faction_causality","taleforge_story_concept_factions","taleforge_story_concept_relationships","taleforge_story_concept_state_transitions","taleforge_story_concept_world_dependencies","taleforge_story_concept_world_links","taleforge_story_concept_world_rules","taleforge_story_concept_world_state_models","taleforge_story_concept_world_state_transitions","taleforge_story_concept_worlds","taleforge_story_opportunities","taleforge_story_specific_depth_designs","taleforge_story_trope_library","taleforge_subgenre_intelligence"]) {
    assert.match(
      unapprovedInternalWritesMigration,
      new RegExp("'" + table + "'"),
      table + " must be in the explicit audited table list",
    );
  }
  assert.match(unapprovedInternalWritesMigration, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE/i);
  assert.match(unapprovedInternalWritesMigration, /REVOKE INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\) ON TABLE/i);
  assert.doesNotMatch(unapprovedInternalWritesMigration, /REVOKE ALL PRIVILEGES ON TABLE/i);
  assert.doesNotMatch(unapprovedInternalWritesMigration, /GRANT\s+.+\s+TO\s+(PUBLIC|anon|authenticated)/i);
});


const internalStoryReadLockMigration = await readFile(
  new URL("../supabase/migrations/20261014190000_lock_internal_story_design_read_surfaces.sql", import.meta.url),
  "utf8",
);

test("internal story-design read lock removes client SELECT paths from all 41 audited relations", () => {
  for (const table of ["taleforge_advanced_chapter_plans","taleforge_character_architecture","taleforge_ending_architecture","taleforge_genre_grammars","taleforge_genre_inversion_patterns","taleforge_genre_taxonomy","taleforge_grammar_compatibility","taleforge_hybrid_story_recipes","taleforge_hybrid_story_recipes_generated","taleforge_narrative_arc_layers","taleforge_narrative_culture_profiles","taleforge_narrative_memory_consolidations","taleforge_narrative_modes","taleforge_series_genre_grammar_profiles","taleforge_series_genre_profiles","taleforge_series_narrative_profiles","taleforge_series_subgenre_profiles","taleforge_story_concept_arc_characters","taleforge_story_concept_arc_endings","taleforge_story_concept_arc_relationships","taleforge_story_concept_arc_threads","taleforge_story_concept_arc_world_functions","taleforge_story_concept_arcs","taleforge_story_concept_candidates","taleforge_story_concept_character_causality","taleforge_story_concept_characters","taleforge_story_concept_evaluations","taleforge_story_concept_faction_causality","taleforge_story_concept_factions","taleforge_story_concept_relationships","taleforge_story_concept_state_transitions","taleforge_story_concept_world_dependencies","taleforge_story_concept_world_links","taleforge_story_concept_world_rules","taleforge_story_concept_world_state_models","taleforge_story_concept_world_state_transitions","taleforge_story_concept_worlds","taleforge_story_opportunities","taleforge_story_specific_depth_designs","taleforge_story_trope_library","taleforge_subgenre_intelligence"]) {
    assert.match(internalStoryReadLockMigration, new RegExp("'" + table + "'"));
  }
  assert.match(internalStoryReadLockMigration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/i);
  assert.match(internalStoryReadLockMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(internalStoryReadLockMigration, /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(internalStoryReadLockMigration, /p\.cmd IN \('SELECT', 'ALL'\)/i);
  assert.match(internalStoryReadLockMigration, /p\.roles && ARRAY\['anon', 'authenticated', 'public'\]::name\[\]/i);
  assert.match(internalStoryReadLockMigration, /DROP POLICY IF EXISTS %I ON public\.%I/i);
  assert.doesNotMatch(internalStoryReadLockMigration, /GRANT\s+.+\s+TO\s+(PUBLIC|anon|authenticated)/i);
});
