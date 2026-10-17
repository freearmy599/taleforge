/**
 * Governance ACL/provenance documentation contract.
 *
 * This source-only test keeps the read-only audit query and its evidence record
 * aligned. It does not connect to Supabase or authorize production changes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = await readFile(
  new URL("../docs/aevora/PHASE1-GOVERNANCE-GATE-DEPENDENCY-ACL-FOLLOWUP-20261017.md", import.meta.url),
  "utf8",
);
const checklist = await readFile(
  new URL("../docs/aevora/MASTER-COMPLETION-CHECKLIST-20261016.md", import.meta.url),
  "utf8",
);
const query = await readFile(
  new URL("../docs/aevora/phase1-publication-schema-provenance.sql", import.meta.url),
  "utf8",
);
const matrix = await readFile(
  new URL("../docs/aevora/PHASE1-CLIENT-GRANT-DEFAULT-ACL-RECONCILIATION-20261017.md", import.meta.url),
  "utf8",
);
const lineage = await readFile(
  new URL("../docs/aevora/PHASE1-GOVERNANCE-SCHEMA-LINEAGE-20261017.md", import.meta.url),
  "utf8",
);

const governanceRelations = [
  "taleforge_system_governance_registry",
  "taleforge_system_governance_dependencies",
  "taleforge_system_governance_runs",
  "taleforge_system_health",
];

test("live governance ACL evidence names all four relations in report and query", () => {
  for (const relation of governanceRelations) {
    assert.ok(report.includes("public." + relation), "report missing " + relation);
    assert.ok(query.includes("'" + relation + "'"), "read-only query missing " + relation);
    assert.ok(matrix.includes("public." + relation), "ACL matrix missing " + relation);
  }
});

test("default-ACL evidence retains both creator roles and all broad privilege classes", () => {
  for (const creator of ["postgres", "supabase_admin"]) {
    assert.ok(report.includes("`" + creator + "`"), "report missing creator role " + creator);
    assert.ok(query.includes("'" + creator + "'"), "query missing creator role " + creator);
  }
  for (const privilege of [
    "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
    "REFERENCES", "TRIGGER", "MAINTAIN", "USAGE", "EXECUTE",
  ]) {
    assert.ok(report.includes(privilege), "report missing privilege " + privilege);
  }
  assert.match(query, /pg_catalog\.pg_default_acl/);
  assert.match(query, /pg_catalog\.aclexplode/);
});

test("governance gate definition query and publication-approval distinction remain explicit", () => {
  for (const routine of ["taleforge_ceo_execution_gate", "taleforge_boss_evaluate"]) {
    assert.ok(query.includes("'" + routine + "'"), "query missing live routine " + routine);
  }
  assert.match(report, /not a per-chapter human approval token|not a human approval record|not proof.{0,100}(?:human|chapter)/i);
  assert.match(report, /provenance remains unresolved|remains unresolved/i);
});

test("lineage evidence preserves separate schema generations and the legacy health foreign key", () => {
  for (const relation of [
    "taleforge_system_registry",
    "taleforge_system_governance_registry",
    "taleforge_system_dependencies",
    "taleforge_system_governance_dependencies",
    "taleforge_system_health",
    "taleforge_system_governance_runs",
  ]) {
    assert.ok(lineage.includes("`" + relation + "`"), "lineage report missing " + relation);
  }
  assert.match(lineage, /different OIDs/i);
  assert.match(lineage, /foreign key references the \*\*legacy\*\*/i);
  assert.match(lineage, /not rename candidates/i);
  assert.match(matrix, /governance schema lineage recheck/i);
});

test("audit records do not misrepresent read-only findings as production remediation", () => {
  assert.match(report, /no grants or policies changed|no production/i);
  assert.ok(checklist.includes("Automated publishing remains **NO-GO**"), "checklist must preserve the publishing NO-GO gate");
  assert.match(query, /READ ONLY/i);
  assert.match(query, /never apply a blanket revoke/i);
  assert.match(matrix, /No live grants or policies have been changed/i);
});
