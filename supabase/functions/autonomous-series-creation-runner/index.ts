import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "aevora-autonomous-series-runner-v3-readiness-gate";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errText(_e: unknown) { return "Internal runner diagnostics were withheld."; }

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return reply({ success: false, error: "Required Supabase environment configuration is missing." }, 500);
    }

    const header = req.headers.get("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return reply({ success: false, error: "Authorization required." }, 401);

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode ?? "admin_execute";
    if (!["admin_execute", "scheduled"].includes(mode)) {
      return reply({ success: false, error: "Unsupported mode.", supported_modes: ["admin_execute", "scheduled"] }, 400);
    }

    if (mode === "scheduled") {
      // Scheduled calls are authenticated by the project service-role JWT held by the database vault.
      if (token !== serviceRoleKey) return reply({ success: false, error: "Invalid scheduler credential." }, 403);
    } else {
      const authClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: "Bearer " + token } },
      });
      const { data, error } = await authClient.auth.getUser(token);
      if (error || !data.user) return reply({ success: false, error: "Invalid or expired session." }, 401);
      const role = data.user.app_metadata?.role;
      if (role !== "admin" && role !== "owner") return reply({ success: false, error: "Administrator or owner role required." }, 403);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: policy, error: policyError } = await db.from("taleforge_autonomous_creation_policy")
      .select("policy_key,enabled,max_autonomous_creations_per_7d,min_opportunity_score,min_concept_overall_score")
      .eq("policy_key", "production").maybeSingle();
    if (policyError) return reply({ success: false, error: "Could not load autonomous creation policy.", details: errText(policyError) }, 500);
    if (!policy?.enabled) {
      return reply({ success: true, action: "blocked_by_policy", created: false, version: VERSION,
        reason: "Production autonomous creation is disabled. No series or chapters were created." });
    }

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recent, error: recentError } = await db.from("taleforge_autonomous_series_creation_runs")
      .select("id,status,series_id,created_at")
      .eq("status", "created").eq("dry_run", false).gte("created_at", cutoff)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (recentError) return reply({ success: false, error: "Could not check weekly creation cap.", details: errText(recentError) }, 500);
    if (recent) {
      return reply({ success: true, action: "weekly_cap_already_used", created: false, version: VERSION,
        recent_creation: recent, note: "One successful autonomous series creation is already recorded in the last seven days." });
    }

    // The database routine enforces score thresholds, caps, and the production policy.
    const { data: result, error: createError } = await db.rpc("taleforge_orchestrate_autonomous_series_creation", {
      p_limit: 1, p_dry_run: false,
    });
    if (createError) return reply({ success: false, error: "Autonomous creation orchestration failed.", details: errText(createError), version: VERSION }, 500);

    const decision = String(result?.decision ?? "unknown");
    const seriesId = result?.series_id ?? null;
    if (decision !== "created" || !seriesId) {
      return reply({ success: true, action: "creation_not_completed", created: false, version: VERSION, result,
        note: "No series was activated; inspect the recorded decision and blockers before retrying." });
    }

    const now = new Date().toISOString();
    const { data: series, error: seriesError } = await db.from("series")
      .select("id,title,status,origin_type,originality_status")
      .eq("id", seriesId).single();
    if (seriesError || !series) {
      return reply({ success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
        error: "Series row was created but could not be loaded for bootstrap.", details: seriesError ? errText(seriesError) : null, result }, 500);
    }

    // Keep the new series eligible for the existing planner/generator/reviewer/release ticks.
    const { error: activateError } = await db.from("series").update({
      status: "ongoing", updated_at: now,
    }).eq("id", seriesId);
    if (activateError) return reply({ success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
      error: "Could not activate the newly created series for the production pipeline.", details: errText(activateError), result }, 500);

    const { data: lifecycle, error: lifecycleLookupError } = await db.from("story_lifecycle")
      .select("id").eq("series_id", seriesId).maybeSingle();
    if (lifecycleLookupError) return reply({ success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
      error: "Could not inspect story lifecycle.", details: errText(lifecycleLookupError), result }, 500);
    const lifecycleValues = {
      lifecycle_status: "preparing", daily_chapters_min: 1, daily_chapters_max: 1,
      launch_chapter_count: 1, minimum_buffer_chapters: 1, target_buffer_chapters: 3,
      planned_chapter_count: 24, next_lifecycle_review_at: now, updated_at: now,
      metadata: { autonomous_creation_run_id: result?.run_id ?? null, bootstrap_version: VERSION },
    };
    const lifecycleWrite = lifecycle
      ? await db.from("story_lifecycle").update(lifecycleValues).eq("series_id", seriesId)
      : await db.from("story_lifecycle").insert({ series_id: seriesId, ...lifecycleValues });
    if (lifecycleWrite.error) return reply({ success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
      error: "Could not initialize the story lifecycle.", details: errText(lifecycleWrite.error), result }, 500);

    const { data: existingSchedule, error: scheduleLookupError } = await db.from("release_schedules")
      .select("id").eq("series_id", seriesId).maybeSingle();
    if (scheduleLookupError) return reply({ success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
      error: "Could not inspect the release schedule.", details: errText(scheduleLookupError), result }, 500);
    // Keep the schedule inert while bootstrap is being assembled. The database
    // readiness RPC is the only operation that may enable autonomous release.
    const scheduleValues = {
      enabled: false, schedule_mode: "interval", interval_hours: 24, timezone: "Asia/Kolkata",
      next_release_at: now, chapters_ahead: 3, auto_generate: false, auto_publish: false, updated_at: now,
    };
    const scheduleWrite = existingSchedule
      ? await db.from("release_schedules").update(scheduleValues).eq("id", existingSchedule.id).select("id").maybeSingle()
      : await db.from("release_schedules").insert({ series_id: seriesId, ...scheduleValues }).select("id").single();
    if (scheduleWrite.error || !scheduleWrite.data?.id) return reply({ success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
      error: "Could not initialize and confirm the disabled release schedule.", details: scheduleWrite.error ? errText(scheduleWrite.error) : null, result }, 500);

    const { error: auditError } = await db.from("taleforge_autonomous_series_creation_runs")
      .update({ pipeline_snapshot: {
        ...(result?.pipeline_snapshot ?? {}),
        series_id: seriesId,
        lifecycle_initialized: true,
        release_schedule_initialized: true,
        release_interval_hours: 24,
        auto_generation_enabled: false,
        auto_publication_enabled: false,
        readiness_pending: true,
        bootstrap_version: VERSION,
        bootstrapped_at: now,
      }, updated_at: now })
      .eq("id", result?.run_id ?? "");
    if (auditError) return reply({ success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
      error: "Bootstrap audit evidence could not be confirmed; automation remains disabled.", details: errText(auditError), result }, 500);

    const { data: readinessResult, error: readinessError } = await db.rpc("taleforge_mark_release_automation_ready", {
      p_schedule_id: scheduleWrite.data.id,
    });
    if (readinessError || readinessResult?.ready !== true) return reply({
      success: false, action: "created_but_bootstrap_incomplete", created: true, series_id: seriesId,
      error: "The server-side release readiness gate did not confirm activation.",
      details: readinessError ? errText(readinessError) : null, result,
    }, 500);

    return reply({
      success: true, action: "series_created_and_bootstrapped", created: true, version: VERSION,
      series: { id: seriesId, title: series.title, status: "ongoing", published_at: null, origin_type: series.origin_type, originality_status: series.originality_status },
      pipeline: { lifecycle: "preparing", arc_planner_tick: "existing scheduled job", blueprint_planner_tick: "existing scheduled job",
        generation_tick: "existing scheduled job", review_orchestrator: "invoked by generation orchestrator",
        release_schedule: { interval_hours: 24, auto_generate: true, auto_publish: true, automation_ready: true } },
      audit_snapshot_saved: true, automation_ready: readinessResult.automation_ready_at,
      note: "This starts the existing automated pipeline. Chapters are publishable only after quality, continuity, originality, safety, and publication review gates pass.",
      result,
    });
  } catch (e) {
    return reply({ success: false, error: "Autonomous series runner failed.", details: errText(e), version: VERSION }, 500);
  }
});