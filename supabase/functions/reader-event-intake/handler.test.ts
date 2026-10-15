import { assertEquals, assertNotMatch } from "jsr:@std/assert@1";
import { createReaderEventIntakeHandler } from "./handler.ts";

const seriesId = "00000000-0000-4000-8000-000000000101";
const chapterId = "00000000-0000-4000-8000-000000000111";
const eventUuid = "00000000-0000-4000-8000-000000000201";
const serviceRoleKey = "test-service-role-secret";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    visitor_id: "reader-event-test-visitor-0001",
    event_uuid: eventUuid,
    event_type: "story_open",
    series_id: seriesId,
    chapter_id: null,
    progress_percent: null,
    ...overrides,
  };
}

function post(body: string, headers: Record<string, string> = {
  "content-type": "application/json",
}) {
  return new Request("https://aevora.test/functions/v1/reader-event-intake", {
    method: "POST",
    headers,
    body,
  });
}

function makeHandler(
  outcome: unknown = { outcome: "accepted" },
  responseStatus = 200,
  onFetch?: (input: RequestInfo | URL, init?: RequestInit) => void,
) {
  const fetchImpl: typeof fetch = async (input, init) => {
    onFetch?.(input, init);
    return new Response(JSON.stringify(outcome), {
      status: responseStatus,
      headers: { "Content-Type": "application/json" },
    });
  };
  return createReaderEventIntakeHandler({
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey,
    fetchImpl,
  });
}

Deno.test("only POST JSON is accepted and OPTIONS has CORS headers", async () => {
  const handler = makeHandler();
  const get = await handler(new Request("https://aevora.test", { method: "GET" }));
  assertEquals(get.status, 405);
  const options = await handler(new Request("https://aevora.test", { method: "OPTIONS" }));
  assertEquals(options.status, 200);
  assertEquals(options.headers.get("Access-Control-Allow-Origin"), "*");
  const media = await handler(post(JSON.stringify(payload()), { "content-type": "text/plain" }));
  assertEquals(media.status, 415);
});

Deno.test("malformed, oversized, unknown and invalid payloads are rejected before RPC", async () => {
  let calls = 0;
  const handler = makeHandler({ outcome: "accepted" }, 200, () => { calls++; });
  assertEquals((await handler(post("{"))).status, 400);
  assertEquals((await handler(post(JSON.stringify(payload({ extra: true }))))).status, 400);
  assertEquals((await handler(post(JSON.stringify(payload({ event_type: "not_allowed" }))))).status, 400);
  assertEquals((await handler(post(JSON.stringify(payload({ series_id: "not-a-uuid" }))))).status, 400);
  assertEquals((await handler(post(JSON.stringify(payload({ event_type: "reading_progress" }))))).status, 400);
  assertEquals((await handler(post(JSON.stringify(payload({ event_type: "reading_progress", progress_percent: 101 }))))).status, 400);
  assertEquals((await handler(post(JSON.stringify(payload({ event_type: "story_open", progress_percent: 5 }))))).status, 400);
  assertEquals((await handler(post(JSON.stringify({ ...payload(), padding: "x".repeat(3000) })))).status, 413);
  assertEquals(calls, 0, "invalid requests must not call the database RPC");
});

Deno.test("valid payload is mapped to the private RPC without leaking service credentials", async () => {
  let rpcUrl = "";
  let rpcHeaders = new Headers();
  let rpcBody: Record<string, unknown> = {};
  const handler = makeHandler({ outcome: "accepted" }, 200, (input, init) => {
    rpcUrl = input instanceof Request ? input.url : String(input);
    rpcHeaders = new Headers(init?.headers);
    rpcBody = JSON.parse(String(init?.body));
  });
  const response = await handler(post(JSON.stringify(payload({
    event_type: "reading_progress",
    chapter_id: chapterId,
    progress_percent: 42,
  }))));
  assertEquals(response.status, 202);
  assertEquals(rpcUrl, "https://project.supabase.co/rest/v1/rpc/aevora_ingest_reader_event");
  assertEquals(rpcHeaders.get("apikey"), serviceRoleKey);
  assertEquals(rpcHeaders.get("authorization"), `Bearer ${serviceRoleKey}`);
  assertEquals(rpcBody.p_visitor_id, "reader-event-test-visitor-0001");
  assertEquals(rpcBody.p_event_uuid, eventUuid);
  assertEquals(rpcBody.p_event_type, "reading_progress");
  assertEquals(rpcBody.p_series_id, seriesId);
  assertEquals(rpcBody.p_chapter_id, chapterId);
  assertEquals(rpcBody.p_progress_percent, 42);
  const responseText = await response.text();
  assertNotMatch(responseText, /test-service-role-secret|reader-event-test-visitor/);
});

Deno.test("database outcomes map to stable client responses", async () => {
  const duplicate = await makeHandler({ outcome: "duplicate" })(post(JSON.stringify(payload())));
  assertEquals(duplicate.status, 200);
  assertEquals((await duplicate.json()).duplicate, true);

  const limited = await makeHandler({ outcome: "limited" })(post(JSON.stringify(payload())));
  assertEquals(limited.status, 429);
  assertEquals((await limited.json()).error, "rate_limited");

  const invalid = await makeHandler({ outcome: "invalid" })(post(JSON.stringify(payload())));
  assertEquals(invalid.status, 422);
  assertEquals((await invalid.json()).error, "invalid_event");

  const unknown = await makeHandler({ outcome: "unexpected" })(post(JSON.stringify(payload())));
  assertEquals(unknown.status, 503);
  assertEquals((await unknown.json()).error, "intake_unavailable");

  const rpcFailure = await makeHandler({ error: "internal details" }, 500)(post(JSON.stringify(payload())));
  assertEquals(rpcFailure.status, 503);
  assertNotMatch(await rpcFailure.text(), /internal details/);
});

Deno.test("missing credentials and fetch exceptions fail closed without diagnostic leakage", async () => {
  const missing = createReaderEventIntakeHandler({
    supabaseUrl: "",
    serviceRoleKey: "",
    fetchImpl: async () => { throw new Error("should not be called"); },
  });
  assertEquals((await missing(post(JSON.stringify(payload())))).status, 503);

  const failing = createReaderEventIntakeHandler({
    supabaseUrl: "https://project.supabase.co",
    serviceRoleKey,
    fetchImpl: async () => { throw new Error("private network details"); },
  });
  const response = await failing(post(JSON.stringify(payload())));
  assertEquals(response.status, 503);
  assertNotMatch(await response.text(), /private network details|test-service-role-secret/);
});
