/**
 * Guard the reusable database access audit against accidental mutations.
 * Source-level contract only; the SQL is not executed by this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import vm from "node:vm";

const sql = await readFile(
  new URL("../docs/aevora/phase1-readonly-access-audit.sql", import.meta.url),
  "utf8",
);

const trendingMigration = await readFile(
  new URL("../supabase/migrations/20261014130000_public_trending_aggregate_rpc.sql", import.meta.url),
  "utf8",
);
const dormantReaderTablesMigration = await readFile(
  new URL("../supabase/migrations/20261016210000_lock_dormant_reader_account_tables.sql", import.meta.url),
  "utf8",
);

const readerEventIdempotencyMigration = await readFile(
  new URL("../supabase/migrations/20261014220000_reader_event_idempotency_key.sql", import.meta.url),
  "utf8",
);
const readingProgressSource = await readFile(
  new URL("../reading-progress.js", import.meta.url),
  "utf8",
);
const publishedLibrarySource = await readFile(
  new URL("../taleforge-data.js", import.meta.url),
  "utf8",
);
const chapterReaderSource = await readFile(
  new URL("../chapter.html", import.meta.url),
  "utf8",
);
const homeSource = await readFile(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const readerEventTimestampMigration = await readFile(
  new URL("../supabase/migrations/20261014230000_reader_event_server_timestamp.sql", import.meta.url),
  "utf8",
);

const revisionConflictReport = await readFile(
  new URL("../docs/aevora/phase1-revision-successor-conflict-report.sql", import.meta.url),
  "utf8",
);

test("Phase 1 access audit contains only read-only SELECT statements", () => {
  const executableSql = sql.replace(/--[^\n]*/g, "").trim();
  const statements = executableSql.split(";").map((statement) => statement.trim()).filter(Boolean);
  assert.equal(statements.length, 7, "expected seven discrete metadata queries");
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

test("default ACL audit reports current executor membership for owner-scoped follow-up", () => {
  assert.match(sql, /current_user AS audit_executor/i);
  assert.match(sql, /pg_has_role\(current_user, owner_role\.oid, 'MEMBER'\)/i);
  assert.match(sql, /owner_role\.rolname IN \('postgres', 'supabase_admin'\)/i);
  assert.match(sql, /membership is a preflight signal/i);
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


test("prepared trending aggregate is fixed-search-path and gated to service role", () => {
  assert.match(trendingMigration, /CREATE OR REPLACE FUNCTION public\.get_public_story_trending_scores\(\)/i);
  assert.match(trendingMigration, /SECURITY DEFINER/i);
  assert.match(trendingMigration, /SET search_path = pg_catalog/i);
  assert.match(trendingMigration, /created_at > pg_catalog\.now\(\) - interval '30 days'/i);
  assert.match(trendingMigration, /WHERE s\.status = ANY \(ARRAY\['ongoing'::text, 'completed'::text\]\)/i);
  assert.match(trendingMigration, /REVOKE ALL PRIVILEGES ON FUNCTION public\.get_public_story_trending_scores\(\) FROM PUBLIC, anon, authenticated/i);
  assert.match(trendingMigration, /GRANT EXECUTE ON FUNCTION public\.get_public_story_trending_scores\(\) TO service_role/i);
  assert.doesNotMatch(trendingMigration, /GRANT EXECUTE ON FUNCTION public\.get_public_story_trending_scores\(\) TO (?:PUBLIC|anon|authenticated)/i);
  assert.match(trendingMigration, /CREATE OR REPLACE VIEW public\.story_trending_scores\s+WITH \(security_invoker = true\)/i);
  assert.match(trendingMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.story_trending_scores FROM PUBLIC, anon, authenticated/i);
  assert.match(trendingMigration, /GRANT SELECT ON TABLE public\.story_trending_scores TO service_role/i);
  assert.match(trendingMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.story_intelligence\s+FROM PUBLIC, anon, authenticated/i);
  assert.match(trendingMigration, /GRANT SELECT ON TABLE public.story_intelligence\s+TO service_role/i);
  assert.doesNotMatch(trendingMigration, /GRANT SELECT ON TABLE public.story_intelligence\s+TO (?:PUBLIC|anon|authenticated)/i);
  const returnedColumns = trendingMigration.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/i)?.[1] ?? "";
  assert.doesNotMatch(returnedColumns, /\bvisitor_id\b|\bid\b/i,
    "raw visitor identifiers and event IDs must not be exposed in the aggregate result contract");
  assert.match(trendingMigration, /latest_follow_state AS \([\s\S]*?DISTINCT ON \(re\.visitor_id, re\.series_id\)[\s\S]*?event_type IN \('follow', 'unfollow'\)/i);
  assert.match(trendingMigration, /latest_bookmark_state AS \([\s\S]*?DISTINCT ON \(re\.visitor_id, re\.chapter_id\)[\s\S]*?event_type IN \('bookmark', 'unbookmark'\)/i);
  assert.match(trendingMigration, /re\.created_at <= pg_catalog\.now\(\)/i);
  assert.doesNotMatch(trendingMigration, /CREATE\s+POLICY|GRANT\s+SELECT\s+ON\s+TABLE\s+public\.reader_events/i);
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

test("future public table and sequence defaults are owner-guarded and fail closed", () => {
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated/i);
  assert.match(defaultPrivilegesMigration, /global table or sequence client defaults exist/i);
  assert.match(defaultPrivilegesMigration, /pg_has_role\(current_user, owner_role, 'MEMBER'\)/i);
  assert.match(defaultPrivilegesMigration, /executor cannot administer default privileges/i);
  assert.match(defaultPrivilegesMigration, /executor_is_superuser/i);
  assert.match(defaultPrivilegesMigration, /ARRAY\['postgres', 'supabase_admin'\]/i,
    "both known table owners must be checked through the owner loop");
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES/i,
    "table default cleanup must remain scoped to public");
  assert.match(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES/i,
    "sequence default cleanup must remain scoped to public");
  assert.doesNotMatch(defaultPrivilegesMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/i);
  assert.doesNotMatch(defaultPrivilegesMigration, /REVOKE EXECUTE ON FUNCTIONS/i,
    "function EXECUTE defaults remain deferred for a separate owner/schema review");
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

test("internal story-design read lock removes client SELECT paths only from the 27 high-risk planning relations", () => {
  const internalTables = ["taleforge_advanced_chapter_plans","taleforge_character_architecture","taleforge_ending_architecture","taleforge_narrative_arc_layers","taleforge_narrative_memory_consolidations","taleforge_story_concept_arc_characters","taleforge_story_concept_arc_endings","taleforge_story_concept_arc_relationships","taleforge_story_concept_arc_threads","taleforge_story_concept_arc_world_functions","taleforge_story_concept_arcs","taleforge_story_concept_candidates","taleforge_story_concept_character_causality","taleforge_story_concept_characters","taleforge_story_concept_evaluations","taleforge_story_concept_faction_causality","taleforge_story_concept_factions","taleforge_story_concept_relationships","taleforge_story_concept_state_transitions","taleforge_story_concept_world_dependencies","taleforge_story_concept_world_links","taleforge_story_concept_world_rules","taleforge_story_concept_world_state_models","taleforge_story_concept_world_state_transitions","taleforge_story_concept_worlds","taleforge_story_opportunities","taleforge_story_specific_depth_designs"];
  const provisionalReferenceTables = ["taleforge_genre_grammars","taleforge_genre_inversion_patterns","taleforge_genre_taxonomy","taleforge_grammar_compatibility","taleforge_hybrid_story_recipes","taleforge_hybrid_story_recipes_generated","taleforge_narrative_culture_profiles","taleforge_narrative_modes","taleforge_series_genre_grammar_profiles","taleforge_series_genre_profiles","taleforge_series_narrative_profiles","taleforge_series_subgenre_profiles","taleforge_story_trope_library","taleforge_subgenre_intelligence"];
  for (const table of internalTables{
    assert.match(internalStoryReadLockMigration, new RegExp("'" + table + "'"));
  }
  for (const table of provisionalReferenceTables) {
    assert.doesNotMatch(internalStoryReadLockMigration, new RegExp("'" + table + "'"), table + " must remain outside the read lock pending API review");
  }
  assert.equal(internalTables.length, 27);
  assert.equal(provisionalReferenceTables.length, 14);
  assert.match(internalStoryReadLockMigration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/i);
  assert.match(internalStoryReadLockMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(internalStoryReadLockMigration, /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(internalStoryReadLockMigration, /p\.cmd IN \('SELECT', 'ALL'\)/i);
  assert.match(internalStoryReadLockMigration, /p\.roles && ARRAY\['anon', 'authenticated', 'public'\]::name\[\]/i);
  assert.match(internalStoryReadLockMigration, /DROP POLICY IF EXISTS %I ON public\.%I/i);
  assert.doesNotMatch(internalStoryReadLockMigration, /GRANT\s+.+\s+TO\s+(PUBLIC|anon|authenticated)/i);
});


const readerEventIntegrityMigration = await readFile(
  new URL("../supabase/migrations/20261014200000_reader_event_relationship_integrity.sql", import.meta.url),
  "utf8",
);

const readerEventIntegrityDoc = await readFile(
  new URL("../docs/aevora/PHASE1-READER-EVENT-RELATIONSHIP-INTEGRITY-20261014.md", import.meta.url),
  "utf8",
);

test("reader-event integrity documentation references the canonical migration", () => {
  assert.match(readerEventIntegrityDoc, /20261014200000_reader_event_relationship_integrity\.sql/);
  assert.doesNotMatch(readerEventIntegrityDoc, /20261014200000_validate_reader_event_series_chapter_pair\.sql/);
});

test("reader event idempotency keys are unique and reused on retry", () => {
  assert.match(readerEventIdempotencyMigration, /ADD COLUMN IF NOT EXISTS event_uuid uuid/i);
  assert.match(readerEventIdempotencyMigration, /CREATE UNIQUE INDEX IF NOT EXISTS reader_events_event_uuid_uidx[\s\S]*?WHERE event_uuid IS NOT NULL/i);
  assert.match(readingProgressSource, /const pendingEventIds=new Map\(\)/);
  assert.match(readingProgressSource, /payload\.event_uuid=eventUuid/);
  assert.match(readingProgressSource, /error\.code==="23505"/);
  assert.match(readingProgressSource, /pendingEventIds\.set\(eventKey,eventUuid\)/);
});

test("reader-event intake retries reuse the same UUID and distinct progress values get distinct UUIDs", async () => {
  const storage = new Map();
  let now = 1_000_000;
  let uuidCounter = 0;
  const submitted = [];
  const responses = [
    { ok: false, status: 503 },
    { ok: true, status: 200 },
    { ok: true, status: 200 },
  ];
  const localStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
    removeItem(key) { storage.delete(key); },
  };
  const randomUUID = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;
  const supabase = {
    from() {
      assert.fail("enabled intake mode must not fall back to direct reader_events INSERT");
    },
  };
  const window = {
    taleForgeSupabase: supabase,
    taleForgeReaderEventIntakeEnabled: true,
    taleForgeSupabaseConfig: {
      url: "https://example.supabase.co",
      publishableKey: "test-publishable-key",
    },
    crypto: { randomUUID },
  };
  const fetch = async (_url, init) => {
    submitted.push(JSON.parse(init.body));
    return responses.shift() ?? { ok: true, status: 200 };
  };
  vm.runInNewContext(readingProgressSource, {
    window,
    localStorage,
    crypto: { randomUUID },
    fetch,
    URL,
    Date: { now: () => now },
    Math,
    JSON,
    Map,
    console: { debug() {} },
  });

  const track = window.taleForgeProgress.track;
  await track("reading_progress", { seriesId: "series-a", chapterId: "chapter-a", progressPercent: 40 });
  now += 15_001;
  await track("reading_progress", { seriesId: "series-a", chapterId: "chapter-a", progressPercent: 40 });
  now += 15_001;
  await track("reading_progress", { seriesId: "series-a", chapterId: "chapter-a", progressPercent: 41 });
  now += 15_001;
  await track("reading_progress", { seriesId: "series-a", chapterId: "chapter-a", progressPercent: 40 });

  assert.equal(submitted.length, 3, "a previously accepted progress value must not be counted again in this page session");
  assert.ok(submitted[0].event_uuid, "UUID is attached when browser crypto is available and intake is enabled");
  assert.equal(submitted[1].event_uuid, submitted[0].event_uuid,
    "retry after a failed intake request must reuse the original event UUID");
  assert.notEqual(submitted[2].event_uuid, submitted[1].event_uuid,
    "a distinct progress value must use a distinct idempotency key");
});

test("browser reader-event names match the database event vocabulary", () => {
  const allowed = new Set([
    "story_open", "chapter_start", "reading_progress", "chapter_complete",
    "follow", "unfollow", "bookmark", "unbookmark",
  ]);
  const emitted = [];
  for (const source of [chapterReaderSource, homeSource, readingProgressSource]) {
    for (const match of source.matchAll(/\.track\(["']([a-z_]+)["']/g)) emitted.push(match[1]);
  }
  assert.ok(emitted.length > 0, "browser reader event calls should be discovered");
  assert.deepEqual([...new Set(emitted.filter((name) => !allowed.has(name)))], [],
    "every browser event name must satisfy the reader_events CHECK constraint");
});

test("anonymous reader events cannot choose their own event timestamp", () => {
  assert.match(readerEventTimestampMigration, /RETURNS trigger[\s\S]*?SET search_path = pg_catalog/i);
  assert.match(readerEventTimestampMigration, /current_user IN \('anon', 'authenticated'\)/i);
  assert.match(readerEventTimestampMigration, /NEW\.created_at := statement_timestamp\(\)/i);
  assert.match(readerEventTimestampMigration, /BEFORE INSERT ON public\.reader_events/i);
  assert.match(readerEventTimestampMigration, /REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC, anon, authenticated/i);
});

test("reader-event insert policy requires a published chapter to match its eligible series", () => {
  assert.match(readerEventIntegrityMigration, /DROP POLICY IF EXISTS "Public can record reader events"/i);
  assert.match(readerEventIntegrityMigration, /CREATE POLICY "Public can record reader events"[\s\S]*?FOR INSERT[\s\S]*?TO anon, authenticated/i);
  assert.match(readerEventIntegrityMigration, /c\.id = reader_events\.chapter_id/i);
  assert.match(readerEventIntegrityMigration, /c\.series_id = reader_events\.series_id/i);
  assert.match(readerEventIntegrityMigration, /c\.status = 'published'/i);
  assert.match(readerEventIntegrityMigration, /s\.status IN \('ongoing', 'completed'\)/i);
  assert.match(readerEventIntegrityMigration, /series_id IS NOT NULL/i);
  assert.match(readerEventIntegrityMigration, /visitor_id IS NOT NULL[\s\S]*?length\(visitor_id\) BETWEEN 16 AND 100/i);
  assert.doesNotMatch(readerEventIntegrityMigration, /GRANT\s+.+\s+TO\s+(PUBLIC|anon|authenticated)/i);
});



test("Supabase migration timestamps are unique within the branch", async () => {
  const names = await readdir(new URL("../supabase/migrations/", import.meta.url));
  const timestamped = names.filter((name) => /^\d{14}_.+\.sql$/.test(name));
  const seen = new Map();
  for (const name of timestamped) {
    const timestamp = name.slice(0, 14);
    const previous = seen.get(timestamp) ?? [];
    previous.push(name);
    seen.set(timestamp, previous);
  }
  const duplicates = [...seen.entries()].filter(([, matches]) => matches.length > 1);
  assert.deepEqual(duplicates, [], "each migration timestamp must be unique to avoid ordering ambiguity");
});


test("published library gracefully degrades when the gated intelligence view is unavailable", () => {
  assert.match(publishedLibrarySource, /Intelligence is optional enrichment[\s\S]*?Keep the published library usable/i);
  assert.match(publishedLibrarySource, /const intel=new Map\(\(intelRes\.data\|\|\[\]\)\.map/);
  assert.doesNotMatch(publishedLibrarySource, /if\s*\(intelRes\.error\)\s*throw/);
});


test("dormant account/community tables have no client policies or client ACLs", () => {
  for (const table of ["profiles","bookmarks","collections","collection_stories","comments","likes","notifications","ratings","reading_history","story_reports","recommendations"]) {
    assert.match(dormantReaderTablesMigration, new RegExp("'" + table + "'"));
  }
  assert.match(dormantReaderTablesMigration, /relrowsecurity/);
  assert.match(dormantReaderTablesMigration, /pg_catalog\.pg_policies/);
  assert.match(dormantReaderTablesMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(dormantReaderTablesMigration, /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(dormantReaderTablesMigration, /unexpectedly has an RLS policy|unexpectedly has a policy/i);
  assert.doesNotMatch(dormantReaderTablesMigration, /GRANT .* TO (?:PUBLIC|anon|authenticated)/i);
  assert.doesNotMatch(dormantReaderTablesMigration, /FROM PUBLIC, anon, authenticated, service_role/i,
    "trusted service_role privileges must remain intact");
});

const baseStoryPlanningReadMigration = await readFile(
  new URL("../supabase/migrations/20261016220000_lock_base_story_planning_read_surfaces.sql", import.meta.url),
  "utf8",
);

test("base story-planning tables are server-only and public read policies are removed", () => {
  for (const table of ["story_arc_plan", "story_ending_plans", "story_lifecycle"]) {
    assert.ok(baseStoryPlanningReadMigration.includes("'" + table + "'"), "missing internal table " + table);
  }
  assert.ok(baseStoryPlanningReadMigration.includes("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated"));
  assert.match(baseStoryPlanningReadMigration, /DROP POLICY IF EXISTS/i);
  assert.match(baseStoryPlanningReadMigration, /pg_policies/i);
  assert.match(baseStoryPlanningReadMigration, /ENABLE ROW LEVEL SECURITY/i);
});
