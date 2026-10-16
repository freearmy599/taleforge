/**
 * Provider-state grants contract.
 * Source-level checks only; this does not apply the migration or query production.
 * Run with: node --test scripts/aevora-provider-state-grants-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../supabase/migrations/20261013120000_lock_ai_provider_state_table.sql", import.meta.url),
  "utf8",
);

const metricsOutboxMigration = await readFile(
  new URL("../supabase/migrations/20261013090000_aevora_server_only_metrics_outbox_grants.sql", import.meta.url),
  "utf8",
);

const internalTablesMigration = await readFile(
  new URL("../supabase/migrations/20261013130000_lock_internal_policyless_tables.sql", import.meta.url),
  "utf8",
);

const narrativeMigration = await readFile(
  new URL("../supabase/migrations/20261013103000_lock_internal_narrative_intelligence_tables.sql", import.meta.url),
  "utf8",
);

const readerFeatureMigration = await readFile(
  new URL("../supabase/migrations/20261014100000_lock_unwired_reader_feature_tables.sql", import.meta.url),
  "utf8",
);

const publicContentMigration = await readFile(
  new URL("../supabase/migrations/20261014160000_limit_public_content_tables_to_select.sql", import.meta.url),
  "utf8",
);

const internalRpcMigration = await readFile(
  new URL("../supabase/migrations/20261013110000_restrict_internal_invoker_rpc_execution.sql", import.meta.url),
  "utf8",
);

const identitySequenceMigration = await readFile(
  new URL("../supabase/migrations/20261014120000_lock_public_identity_sequence_grants.sql", import.meta.url),
  "utf8",
);

const providerStateFixture = await readFile(
  new URL("./aevora-provider-state-lock-fixture.sql", import.meta.url),
  "utf8",
);
const providerStateAssertions = await readFile(
  new URL("./aevora-provider-state-lock-assertions.sql", import.meta.url),
  "utf8",
);
const providerStateRehearsal = await readFile(
  new URL("./test-aevora-provider-state-lock.sh", import.meta.url),
  "utf8",
);

const defaultPrivilegeMigration = await readFile(
  new URL("../supabase/migrations/20261014170000_restrict_public_default_privileges.sql", import.meta.url),
  "utf8",
);
const defaultPrivilegeFixture = await readFile(
  new URL("./aevora-public-default-privilege-fixture.sql", import.meta.url),
  "utf8",
);
const defaultPrivilegeAssertions = await readFile(
  new URL("./aevora-public-default-privilege-assertions.sql", import.meta.url),
  "utf8",
);
const defaultPrivilegeRehearsal = await readFile(
  new URL("./test-aevora-public-default-privileges.sh", import.meta.url),
  "utf8",
);

test("provider-state ACL lock has disposable PostgreSQL runtime assertions", () => {
  assert.match(providerStateFixture, /GRANT ALL PRIVILEGES ON TABLE public\.taleforge_ai_provider_state TO anon, authenticated/);
  assert.match(providerStateFixture, /GRANT SELECT \(last_error\), UPDATE \(last_error\).*TO anon, authenticated/);
  assert.match(providerStateAssertions, /has_table_privilege\(client_role, 'public\.taleforge_ai_provider_state', privilege_name\)/);
  assert.match(providerStateAssertions, /has_column_privilege\(client_role, 'public\.taleforge_ai_provider_state', 'last_error', privilege_name\)/);
  assert.match(providerStateAssertions, /'TRUNCATE'/);
  assert.match(providerStateAssertions, /service_role grants were unexpectedly removed/);
  assert.match(providerStateAssertions, /legacy Gemini overload diagnostic was not sanitized/);
  assert.match(providerStateRehearsal, /AEVORA_DISPOSABLE_PROVIDER_STATE_REHEARSAL/);
  assert.match(providerStateRehearsal, /Refusing provider-state lock rehearsal against a Supabase URL/);
  assert.match(providerStateRehearsal, /20261013120000_lock_ai_provider_state_table\.sql/);
});

test("public default-privilege lock is rehearsed against newly created objects", () => {
  assert.match(defaultPrivilegeFixture, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated/);
  assert.match(defaultPrivilegeFixture, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated/);
  assert.match(defaultPrivilegeFixture, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon, authenticated/);
  assert.match(defaultPrivilegeAssertions, /CREATE TABLE public\.aevora_default_privilege_probe/);
  assert.match(defaultPrivilegeAssertions, /CREATE SEQUENCE public\.aevora_default_privilege_probe_seq/);
  assert.match(defaultPrivilegeAssertions, /CREATE FUNCTION public\.aevora_default_privilege_probe_fn/);
  assert.match(defaultPrivilegeAssertions, /has_sequence_privilege/);
  assert.match(defaultPrivilegeAssertions, /has_function_privilege/);
  assert.match(defaultPrivilegeAssertions, /acl\.grantee = 0/);
  assert.match(defaultPrivilegeRehearsal, /AEVORA_DISPOSABLE_DEFAULT_PRIVILEGE_REHEARSAL/);
  assert.match(defaultPrivilegeRehearsal, /Refusing default-privilege rehearsal against a Supabase URL/);
  assert.match(defaultPrivilegeRehearsal, /20261014170000_restrict_public_default_privileges\.sql/);
  assert.match(defaultPrivilegeMigration, /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated/);
});

test("Gemini provider state is server-side only", () => {
  assert.ok(migration.includes("ALTER TABLE public.taleforge_ai_provider_state ENABLE ROW LEVEL SECURITY"));
  assert.ok(migration.includes("REVOKE ALL PRIVILEGES ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated"));
  assert.ok(migration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.taleforge_ai_provider_state FROM PUBLIC, anon, authenticated"), "provider-state column grants must also be revoked");
  assert.ok(migration.includes("SET last_error = CASE"), "legacy Gemini diagnostics must be classified and redacted");
  assert.ok(migration.includes("WHEN last_error ILIKE '%Gemini HTTP 503%'"), "legacy temporary-overload payloads must be sanitized");
  assert.ok(migration.includes("WHEN last_error ILIKE '%Gemini HTTP 429%'"), "legacy quota payloads must be sanitized");
  assert.ok(migration.includes("ELSE 'Gemini provider diagnostic redacted'"), "unknown legacy provider diagnostics must be redacted rather than retained");
  assert.ok(migration.includes("AND last_error NOT IN ("), "already-safe diagnostics should avoid unnecessary rewrites");
  assert.equal(/CREATE POLICY/i.test(migration), false, "internal provider state must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(migration), false, "migration must not re-grant client access");
});

test("publication outbox and attachment metrics remain server-side only", () => {
  for (const table of ["publication_sync_outbox", "story_attachment_metrics"]) {
    assert.ok(metricsOutboxMigration.includes(`'${table}'`), `${table} must be in the server-only target list`);
  }
  assert.ok(metricsOutboxMigration.includes("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY"), "all target tables must have RLS enabled");
  assert.ok(metricsOutboxMigration.includes("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "all target tables must revoke relation-level privileges");
  assert.ok(metricsOutboxMigration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "outbox and metrics column grants must also be revoked");
  assert.equal(/CREATE POLICY/i.test(metricsOutboxMigration), false, "server-only telemetry and outbox tables must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(metricsOutboxMigration), false, "server-only tables must not re-grant client access");
});

test("internal policyless intelligence tables are server-side only", () => {
  const internalTables = [
    "automation_config",
    "chapter_blueprints",
    "chapter_generation_outputs",
    "chapter_publication_reviews",
    "chapter_reviews",
    "generation_jobs",
    "generation_settings",
    "release_schedules",
    "story_blueprints",
    "story_versions",
    "taleforge_ceo_daily_operations",
    "taleforge_ceo_incidents",
    "taleforge_ceo_repair_plans",
    "taleforge_continuity_extraction_queue",
    "taleforge_executive_reports",
    "taleforge_generation_context_snapshots",
    "taleforge_hybrid_story_engine_runs",
    "taleforge_inversion_evaluations",
    "taleforge_narrative_profile_selections",
    "taleforge_novelty_signatures",
    "taleforge_story_concept_design_runs",
    "taleforge_story_opportunity_runs",
    "taleforge_system_governance_dependencies",
    "taleforge_system_governance_registry",
    "taleforge_system_governance_runs",
  ];
  for (const table of internalTables) {
    assert.ok(internalTablesMigration.includes(table), `missing server-only grant repair for ${table}`);
  }
  assert.ok(internalTablesMigration.includes("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY"));
  assert.ok(internalTablesMigration.includes("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated"));
  assert.ok(internalTablesMigration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "internal table column grants must also be revoked");
  assert.equal(/CREATE POLICY/i.test(internalTablesMigration), false, "internal tables must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(internalTablesMigration), false, "migration must not re-grant client access");
});

test("internal narrative intelligence tables lose public read policies and client grants", () => {
  const internalTables = [
    "character_continuity_events",
    "world_continuity_events",
    "taleforge_continuity_reconciliation_findings",
    "taleforge_continuity_reconciliation_runs",
    "taleforge_narrative_depth_plans",
    "taleforge_narrative_memory_snapshots",
    "taleforge_narrative_thread_events",
    "taleforge_narrative_thread_progression",
    "taleforge_narrative_threads",
    "taleforge_novelty_evaluations",
    "taleforge_system_dependencies",
    "taleforge_system_health",
    "taleforge_system_registry",
  ];
  for (const table of internalTables) {
    assert.ok(narrativeMigration.includes(`public.${table}`), `missing internal narrative lock for ${table}`);
  }
  assert.ok(narrativeMigration.includes("ENABLE ROW LEVEL SECURITY;"), "all narrative internal tables must explicitly have RLS enabled");
  assert.ok(narrativeMigration.includes("REVOKE ALL PRIVILEGES ON TABLE"));
  assert.ok(narrativeMigration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "narrative internal column grants must also be revoked");
  assert.ok(narrativeMigration.includes("REVOKE ALL PRIVILEGES ON TABLE public.taleforge_system_health_snapshot FROM PUBLIC, anon, authenticated"), "diagnostic-bearing status view must not remain directly exposed");
  assert.equal(/CREATE POLICY/i.test(narrativeMigration), false, "internal narrative state must not gain client policies");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(narrativeMigration), false, "migration must not re-grant client access");
});

test("internal story opportunity scoring RPC is not exposed to client roles", () => {
  assert.ok(
    internalRpcMigration.includes("REVOKE EXECUTE ON FUNCTION public.taleforge_score_story_opportunity(numeric, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated"),
    "pure planner scoring helper must not retain inherited client EXECUTE grants",
  );
});


test("unwired reader-feature tables remain unavailable to direct client roles until policies are designed", () => {
  const readerTables = [
    "bookmarks",
    "collection_stories",
    "collections",
    "comments",
    "likes",
    "notifications",
    "profiles",
    "ratings",
    "reading_history",
    "recommendations",
    "story_reports",
  ];
  for (const table of readerTables) {
    assert.ok(readerFeatureMigration.includes(`'${table}'`), `${table} must be included in the dormant reader-feature target list`);
  }
  assert.ok(readerFeatureMigration.includes("ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY"), "all target tables must have RLS enabled");
  assert.ok(readerFeatureMigration.includes("REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "all target tables must revoke relation-level client grants");
  assert.ok(readerFeatureMigration.includes("REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated"), "migration must defensively clear explicit column ACLs");
  assert.equal(/CREATE\s+POLICY/i.test(readerFeatureMigration), false, "no broad client policies may be added before access requirements are defined");
  assert.equal(/GRANT\s+.+\s+TO\s+(anon|authenticated)/i.test(readerFeatureMigration), false, "migration must not re-grant client access");
});


test("server-only migration targets cover the complete 39-table client-grant inventory", () => {
  const extractTargets = (source, label) => {
    const match = source.match(/FOREACH\s+table_name\s+IN\s+ARRAY\s+ARRAY\[([\s\S]*?)\]/i);
    assert.ok(match, label + " must declare an explicit bounded table target list");
    return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
  };
  const internalTargets = extractTargets(internalTablesMigration, "internal policyless migration");
  const metricsTargets = extractTargets(metricsOutboxMigration, "metrics/outbox migration");
  const readerTargets = extractTargets(readerFeatureMigration, "unwired reader migration");
  const targets = [
    ...internalTargets,
    ...metricsTargets,
    "taleforge_ai_provider_state",
    ...readerTargets,
  ];
  assert.equal(internalTargets.length, 25, "expected 25 internal policyless table targets");
  assert.equal(metricsTargets.length, 2, "expected 2 metrics/outbox table targets");
  assert.equal(readerTargets.length, 11, "expected 11 dormant reader-feature table targets");
  assert.ok(migration.includes("public.taleforge_ai_provider_state"), "provider-state migration must cover the remaining server-only table");
  assert.equal(new Set(targets).size, 39, "the four migration groups must cover 39 unique client-granted, policyless base tables");
  assert.equal(targets.length, 39, "migration groups must not contain duplicate table targets");
});

test("identity sequences are not directly exposed to ordinary client roles", () => {
  for (const sequence of ["aevora_engineering_events_id_seq", "reader_events_id_seq"]) {
    assert.ok(identitySequenceMigration.includes("public." + sequence), sequence + " must be included in the sequence lock");
    assert.ok(
      identitySequenceMigration.includes("REVOKE ALL PRIVILEGES ON SEQUENCE public." + sequence + " FROM PUBLIC, anon, authenticated"),
      sequence + " must revoke broad direct sequence privileges",
    );
  }
  assert.equal(identitySequenceMigration.includes("GRANT "), false,
    "sequence lock must not re-grant direct client access");
  assert.ok(identitySequenceMigration.includes("FROM PUBLIC, anon, authenticated"),
    "sequence revokes must cover PUBLIC and both ordinary client roles");
});


test("public content tables keep RLS and expose only SELECT to ordinary clients", () => {
  for (const table of ["series", "chapters", "stories", "genres", "tags", "story_tags"]) {
    assert.ok(publicContentMigration.includes("'" + table + "'"), table + " must be in the public content target list");
  }
  assert.match(publicContentMigration, /ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY/i);
  assert.match(publicContentMigration, /REVOKE ALL PRIVILEGES ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(publicContentMigration, /REVOKE ALL PRIVILEGES \(%s\) ON TABLE public\.%I FROM PUBLIC, anon, authenticated/i);
  assert.match(publicContentMigration, /GRANT SELECT ON TABLE public\.series, public\.chapters, public\.stories, public\.genres, public\.tags, public\.story_tags TO anon, authenticated/i);
  assert.doesNotMatch(publicContentMigration, /GRANT\s+(INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN|ALL)\b/i);
  assert.doesNotMatch(publicContentMigration, /CREATE\s+POLICY/i);
});
