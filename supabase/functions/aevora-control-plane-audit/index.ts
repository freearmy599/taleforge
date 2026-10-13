import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const AUDIT_TOKEN = Deno.env.get("AEVORA_AUDIT_TOKEN") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

async function readTable(table: string, select: string): Promise<unknown[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.searchParams.set("select", select);
  url.searchParams.set("limit", "500");
  const response = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) {
    console.error("[aevora-control-plane-audit] table read failed", table, response.status);
    throw new Error(`Audit data source unavailable: ${table}`);
  }
  return await response.json();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!AUDIT_TOKEN) {
    console.error("[aevora-control-plane-audit] AEVORA_AUDIT_TOKEN is not configured");
    return json({ error: "audit_auth_not_configured" }, 503);
  }
  const supplied = (req.headers.get("authorization") ?? "").replace(/^Bearer\\s+/i, "");
  if (!constantTimeEqual(supplied, AUDIT_TOKEN)) return json({ error: "unauthorized" }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[aevora-control-plane-audit] Supabase runtime configuration missing");
    return json({ error: "audit_runtime_not_configured" }, 503);
  }

  try {
    const [jobs, providers, schedules, tasks, decisions] = await Promise.all([
      readTable("aevora_automation_job_status", "jobname,active,schedule,last_status,last_started_at,last_finished_at"),
      readTable("taleforge_ai_provider_state", "provider,cooldown_until,consecutive_throttle_count,last_error_at"),
      readTable("release_schedules", "id,series_id,enabled,auto_generate,auto_publish,next_release_at"),
      readTable("aevora_engineering_tasks", "id,title,status,lease_until,updated_at,blocked_reason"),
      readTable("aevora_engineering_decisions", "id,title,urgency,status,created_at,expires_at"),
    ]);
    return json({
      generated_at: new Date().toISOString(),
      read_only: true,
      jobs,
      providers,
      schedules,
      tasks,
      decisions,
    });
  } catch (error) {
    console.error("[aevora-control-plane-audit] snapshot failed", String(error));
    return json({ error: "audit_snapshot_failed" }, 503);
  }
});
