/**
 * Internal worker authorization contracts.
 * Static source checks only; does not call Supabase or deploy any function.
 * Run with: node --test scripts/aevora-internal-worker-auth-contract.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const workers = [
  "arc-planner",
  "blueprint-planner",
  "character-continuity",
  "continuity-review",
  "generate-chapter",
  "generation-orchestrator",
  "originality-review",
  "post-publication-canon-sync",
  "publication-review",
  "publication-sync-processor",
  "release-publisher",
  "release-scheduler",
  "review-orchestrator",
  "revise-chapter",
  "safety-review",
  "semantic-continuity-extraction",
  "story-dna-planner",
  "world-continuity",
];

async function source(path) {
  return readFile(new URL("../" + path, import.meta.url), "utf8");
}

test("every privileged Edge worker authenticates before parsing input or creating clients", async () => {
  for (const name of workers) {
    const s = await source("supabase/functions/" + name + "/index.ts");
    const serve = s.indexOf("Deno.serve");
    assert.ok(serve >= 0, name + " must expose an Edge handler");
    assert.equal(s.slice(0, serve).search(/createClient\\s*\\(/), -1, name + " must not create a database client at module load before request authentication");
    const handler = s.slice(serve);
    const guard = handler.indexOf("isTrustedInternalApiKey(");
    assert.ok(guard >= 0, name + " must call the shared internal API-key guard");
    const bodyParse = handler.search(/(?:await\s+)?(?:req|request)\.json\s*\(/);
    if (bodyParse >= 0) {
      assert.ok(guard < bodyParse, name + " must authenticate before parsing request JSON");
    }
    const clientInit = handler.search(/createClient\s*\(/);
    if (clientInit >= 0) {
      assert.ok(guard < clientInit, name + " must authenticate before creating a privileged database client");
    }
    assert.match(handler, /req\.method\s*!==?\s*["']POST["']/, name + " must reject non-POST requests (apart from CORS preflight)");
  }
});

test("the shared internal API-key allowlist fails closed", async () => {
  const s = await source("supabase/functions/_shared/internal-api-key.ts");
  assert.ok(s.includes("if (!presentedApiKey) return false"));
  assert.ok(s.includes("if (!secretKeysJson || !allowedSecretKeyNamesCsv) return false"));
  assert.ok(s.includes("if (allowedNames.size === 0) return false"));
  assert.ok(s.includes("if (!parsed || typeof parsed !== \"object\" || Array.isArray(parsed)) return false"));
  assert.ok(s.includes("allowedNames.has(name) && typeof value === \"string\""));
  assert.ok(s.includes("return false;"), "malformed secret configuration must never default to trust");
  assert.equal(/allowedNames\.size\s*===\s*0\s*\)\s*return\s*true/.test(s), false);
});

test("browser source files do not contain server-only credentials or internal key configuration", async () => {
  const browserFiles = [
    "404.html",
    "admin.html",
    "chapter.html",
    "chief-editor.html",
    "index.html",
    "library.html",
    "notifications.html",
    "privacy.html",
    "reading-progress.js",
    "series.html",
    "stories.html",
    "story.html",
    "supabase-client.js",
    "taleforge-data.js",
    "terms.html",
  ];
  const rootEntries = await readdir(new URL("../", import.meta.url), { withFileTypes: true });
  const discoveredBrowserFiles = rootEntries
    .filter((entry) => entry.isFile() && /\.(?:html|js)$/i.test(entry.name))
    .map((entry) => entry.name);
  assert.ok(discoveredBrowserFiles.includes("index.html"), "root HTML discovery must match the .html extension");
  assert.ok(discoveredBrowserFiles.includes("supabase-client.js"), "root JavaScript discovery must match the .js extension");
  const filesToCheck = [...new Set([...browserFiles, ...discoveredBrowserFiles])];
  const secretMarkers = /SUPABASE_SERVICE_ROLE_KEY|service_role_key|serviceRoleKey|SUPABASE_SECRET_KEYS|AEVORA_INTERNAL_API_KEY_NAMES|GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY/i;
  for (const path of filesToCheck) {
    const s = await source(path);
    assert.doesNotMatch(s, secretMarkers, path + " must not embed server-only credential names or internal key configuration");
  }
});


test("autonomous series runner authenticates each supported mode before privileged client creation", async () => {
  const s = await source("supabase/functions/autonomous-series-creation-runner/index.ts");
  const handler = s.slice(s.indexOf("Deno.serve"));
  const bodyParse = handler.indexOf("req.json()");
  const privilegedClient = handler.indexOf("createClient(supabaseUrl, serviceRoleKey");
  assert.ok(bodyParse >= 0 && privilegedClient > bodyParse, "runner must parse only enough input to select an auth mode before privileged work");
  assert.match(handler, /if \(mode === "scheduled"\)[\s\S]*?token !== serviceRoleKey[\s\S]*?return reply\(\{ success: false, error: "Invalid scheduler credential\." \}, 403\)/,
    "scheduled mode must require the exact server-held service-role credential");
  assert.match(handler, /authClient\.auth\.getUser\(token\)/, "admin mode must validate the bearer token as a real user session");
  assert.match(handler, /role !== "admin" && role !== "owner"/, "admin mode must require an admin or owner application role");
  assert.ok(privilegedClient > handler.indexOf('role !== "admin" && role !== "owner"'),
    "the service-role database client must be created only after admin-mode authorization checks");
  assert.match(handler, /if \(!token\) return reply\(\{ success: false, error: "Authorization required\." \}, 401\)/);
});

test("control-plane audit validates its dedicated token before any privileged REST read", async () => {
  const s = await source("supabase/functions/aevora-control-plane-audit/index.ts");
  const handler = s.slice(s.indexOf("Deno.serve"));
  const tokenConfigured = handler.indexOf("if (!AUDIT_TOKEN)");
  const tokenCheck = handler.indexOf("constantTimeEqual(supplied, AUDIT_TOKEN)");
  const runtimeConfig = handler.indexOf("if (!SUPABASE_URL || !SERVICE_ROLE_KEY)");
  const firstRead = handler.indexOf("readTable(\"");
  assert.ok(tokenConfigured >= 0 && tokenCheck > tokenConfigured, "audit endpoint must fail closed when its dedicated token is absent");
  assert.ok(runtimeConfig > tokenCheck && firstRead > runtimeConfig, "no privileged data read may occur before token and runtime configuration checks");
  assert.match(s, /function constantTimeEqual\(a: string, b: string\)/, "dedicated audit token comparison helper must exist");
  assert.match(handler, /req\.method !== "GET"/, "audit endpoint must be read-only GET");
  assert.match(s, /"Cache-Control": "no-store"/, "audit snapshot must not be cached by intermediaries");
});


test("every Edge Function entrypoint is explicitly classified by the authorization contract", async () => {
  const entries = await readdir(new URL("../supabase/functions/", import.meta.url), { withFileTypes: true });
  const actual = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(new URL(`../supabase/functions/${entry.name}/index.ts`, import.meta.url), "utf8");
      actual.push(entry.name);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const classified = [
    ...workers,
    "autonomous-series-creation-runner",
    "aevora-control-plane-audit",
  ];
  assert.deepEqual(
    actual.sort(),
    [...classified].sort(),
    "a new or removed Edge Function must be explicitly classified and covered by the appropriate authorization contract",
  );
});
