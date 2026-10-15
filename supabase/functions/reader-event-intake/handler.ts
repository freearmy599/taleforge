const MAX_BODY_BYTES = 2048;
const ALLOWED_EVENTS = new Set([
  "story_open", "chapter_start", "reading_progress", "chapter_complete",
  "follow", "unfollow", "bookmark", "unbookmark",
]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
async function readBoundedBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    try { await req.body?.cancel(); } catch { /* request may already be closing */ }
    return null;
  }
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

export type ReaderEventIntakeDependencies = {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
};

export function createReaderEventIntakeHandler({
  supabaseUrl,
  serviceRoleKey,
  fetchImpl = fetch,
}: ReaderEventIntakeDependencies) {
  return async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "intake_unavailable" }, 503);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }

  let raw: string | null;
  try { raw = await readBoundedBody(req); } catch { return json({ error: "invalid_body" }, 400); }
  if (raw === null) return json({ error: "payload_too_large" }, 413);

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "invalid_payload" }, 400);
    body = parsed as Record<string, unknown>;
  } catch { return json({ error: "invalid_json" }, 400); }

  const allowedKeys = new Set(["visitor_id", "event_uuid", "event_type", "series_id", "chapter_id", "progress_percent"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) return json({ error: "unknown_field" }, 400);
  if (typeof body.visitor_id !== "string" || body.visitor_id.length < 16 || body.visitor_id.length > 100 ||
      typeof body.event_type !== "string" || !ALLOWED_EVENTS.has(body.event_type) ||
      !isUuid(body.series_id) ||
      (body.chapter_id !== undefined && body.chapter_id !== null && !isUuid(body.chapter_id)) ||
      (body.event_uuid !== undefined && body.event_uuid !== null && !isUuid(body.event_uuid))) {
    return json({ error: "invalid_payload" }, 400);
  }
  const progress = body.progress_percent;
  if (body.event_type === "reading_progress") {
    if (!Number.isInteger(progress) || (progress as number) < 0 || (progress as number) > 100) return json({ error: "invalid_progress" }, 400);
  } else if (progress !== undefined && progress !== null) {
    return json({ error: "unexpected_progress" }, 400);
  }

  try {
    const response = await fetchImpl(new URL("/rest/v1/rpc/aevora_ingest_reader_event", supabaseUrl), {
      method: "POST",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        p_visitor_id: body.visitor_id,
        p_event_uuid: body.event_uuid ?? null,
        p_event_type: body.event_type,
        p_series_id: body.series_id,
        p_chapter_id: body.chapter_id ?? null,
        p_progress_percent: progress ?? null,
      }),
    });
    if (!response.ok) {
      console.error("[reader-event-intake] database RPC unavailable", response.status);
      return json({ error: "intake_unavailable" }, 503);
    }
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("outcome" in result)) return json({ error: "intake_unavailable" }, 503);
    const outcome = (result as { outcome: unknown }).outcome;
    if (outcome === "accepted") return json({ ok: true }, 202);
    if (outcome === "duplicate") return json({ ok: true, duplicate: true }, 200);
    if (outcome === "limited") return json({ error: "rate_limited" }, 429);
    if (outcome === "invalid") return json({ error: "invalid_event" }, 422);
    return json({ error: "intake_unavailable" }, 503);
  } catch {
    console.error("[reader-event-intake] RPC request failed");
    return json({ error: "intake_unavailable" }, 503);
  }
  };
}
