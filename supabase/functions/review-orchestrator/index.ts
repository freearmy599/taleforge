import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "review-orchestrator-v4-fail-closed-provider-state";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function callFunction(baseUrl: string, serviceKey: string, functionName: string, outputId: string) {
  const res = await fetch(baseUrl + "/functions/v1/" + functionName, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + serviceKey,
      apikey: serviceKey,
    },
    body: JSON.stringify({ output_id: outputId }),
  });

  const text = await res.text();
  let data: unknown;
  try { data = JSON.parse(text); } catch { data = text; }

  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ success: false, error: "Missing Supabase environment configuration." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: providerState, error: providerStateError } = await supabase
      .from("taleforge_ai_provider_state")
      .select("cooldown_until,consecutive_throttle_count")
      .eq("provider", "gemini")
      .maybeSingle();

    if (providerStateError || !providerState) {
      console.error("[review-orchestrator] provider cooldown state unavailable; failing closed", providerStateError?.message ?? "No Gemini provider-state row found");
      return json({
        success: false,
        mode: "review-orchestrator",
        orchestrator_version: VERSION,
        checked_at: new Date().toISOString(),
        outputs_checked: 0,
        results: [],
        blocked: true,
        retryable: true,
        reason: "provider_state_unavailable",
        note: "Review pipeline blocked because Gemini provider cooldown state could not be verified; no review model calls were made.",
      }, 503);
    } else if (providerState?.cooldown_until && !Number.isFinite(new Date(providerState.cooldown_until).getTime())) {
      console.error("[review-orchestrator] provider cooldown timestamp is invalid; failing closed", String(providerState.cooldown_until));
      return json({
        success: false,
        mode: "review-orchestrator",
        orchestrator_version: VERSION,
        checked_at: new Date().toISOString(),
        outputs_checked: 0,
        results: [],
        blocked: true,
        retryable: true,
        reason: "provider_state_unavailable",
        note: "Review pipeline blocked because Gemini cooldown state is malformed; no review model calls were made.",
      }, 503);
    } else if (providerState?.cooldown_until && new Date(providerState.cooldown_until).getTime() > Date.now()) {
      console.warn("[review-orchestrator] review pipeline skipped due to active provider cooldown", JSON.stringify({
        cooldown_until: providerState.cooldown_until,
        consecutive_throttle_count: providerState.consecutive_throttle_count,
      }));
      return json({
        success: false,
        mode: "review-orchestrator",
        orchestrator_version: VERSION,
        checked_at: new Date().toISOString(),
        outputs_checked: 0,
        results: [],
        blocked: true,
        retryable: true,
        reason: "provider_cooldown",
        cooldown_until: providerState.cooldown_until,
        note: "Review pipeline was skipped to protect the exhausted Gemini quota; no review model calls were made.",
      }, 429);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "Request body must be valid JSON." }, 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json({ success: false, error: "Request body must be a JSON object." }, 400);
    }
    const request = body as Record<string, unknown>;
    for (const field of ["output_id", "series_id"] as const) {
      if (request[field] !== undefined &&
          (typeof request[field] !== "string" || request[field].trim().length === 0)) {
        return json({ success: false, error: field + " must be a non-empty string when provided." }, 400);
      }
    }
    if (request.dry_run !== undefined && typeof request.dry_run !== "boolean") {
      return json({ success: false, error: "dry_run must be a boolean when provided." }, 400);
    }
    const requestedOutputId = typeof request.output_id === "string" ? request.output_id.trim() : null;
    const requestedSeriesId = typeof request.series_id === "string" ? request.series_id.trim() : null;
    const dryRun = request.dry_run === true;

    let outputQuery = supabase
      .from("chapter_generation_outputs")
      .select("id,series_id,chapter_blueprint_id,chapter_number,title,generation_status,revision_of_output_id")
      .order("chapter_number", { ascending: true });

    if (requestedOutputId) {
      outputQuery = outputQuery.eq("id", requestedOutputId);
    } else {
      outputQuery = outputQuery.in("generation_status", ["generated", "quality_check", "approved"]);
    }

    if (requestedSeriesId) outputQuery = outputQuery.eq("series_id", requestedSeriesId);

    const { data: outputs, error: outputError } = await outputQuery.limit(requestedOutputId ? 1 : 10);

    if (outputError) {
      return json({
        success: false,
        error: "Failed to load outputs for review.",
        details: errorMessage(outputError),
      }, 500);
    }

    const results = [];

    for (const output of outputs ?? []) {
      if (output.generation_status === "published" && !dryRun) {
        results.push({
          output_id: output.id,
          chapter_number: output.chapter_number,
          title: output.title,
          action: "skipped",
          blocked: true,
          reason: "Published outputs cannot be reprocessed by the live review orchestrator.",
        });
        continue;
      }

      const { data: existingReviews, error: reviewsError } = await supabase
        .from("chapter_reviews")
        .select("review_type,status,score")
        .eq("generation_output_id", output.id);

      if (reviewsError) {
        results.push({
          output_id: output.id,
          chapter_number: output.chapter_number,
          action: "error",
          details: errorMessage(reviewsError),
        });
        continue;
      }

      const reviewMap = new Map(
        (existingReviews ?? []).map((review) => [review.review_type, review])
      );

      const reviewPlan = [
        {
          name: "quality",
          functionName: "generate-chapter",
          alreadyPassed:
            reviewMap.get("quality")?.status === "passed" &&
            Number(reviewMap.get("quality")?.score ?? 0) >= 85,
        },
        {
          name: "continuity",
          functionName: "continuity-review",
          alreadyPassed:
            reviewMap.get("continuity")?.status === "passed" &&
            Number(reviewMap.get("continuity")?.score ?? 0) >= 85,
        },
        {
          name: "originality",
          functionName: "originality-review",
          alreadyPassed:
            reviewMap.get("originality")?.status === "passed" &&
            Number(reviewMap.get("originality")?.score ?? 0) >= 85,
        },
        {
          name: "safety",
          functionName: "safety-review",
          alreadyPassed:
            reviewMap.get("safety")?.status === "passed" &&
            Number(reviewMap.get("safety")?.score ?? 0) >= 85,
        },
        {
          name: "publication",
          functionName: "publication-review",
          alreadyPassed: false,
        },
      ];

      if (dryRun) {
        results.push({
          output_id: output.id,
          chapter_number: output.chapter_number,
          title: output.title,
          generation_status: output.generation_status,
          action: "dry_run",
          review_plan: reviewPlan.map((step) => ({
            review: step.name,
            function: step.functionName,
            already_passed: step.alreadyPassed,
          })),
          note: "Dry run only. No review function was called and no database state was changed.",
        });
        continue;
      }

      const steps = [];
      let blocked = false;

      for (const step of reviewPlan) {
        if (step.name === "publication" && output.revision_of_output_id) {
          const { data: regression, error: regressionError } = await supabase.rpc(
            "taleforge_evaluate_revision_regression",
            { p_revised_output_id: output.id }
          );
          steps.push({ review: "revision_regression", action: "evaluated", status: regressionError ? "error" : (regression?.status ?? null), result: regressionError ? { error: errorMessage(regressionError) } : regression });
          if (regressionError || !["improved", "neutral"].includes(regression?.status)) { blocked = true; break; }
        }

        if (step.alreadyPassed) {
          steps.push({
            review: step.name,
            action: "already_passed",
            status: "passed",
            score: reviewMap.get(step.name)?.score ?? null,
          });
          continue;
        }

        const call = await callFunction(supabaseUrl, serviceRoleKey, step.functionName, output.id);

        steps.push({
          review: step.name,
          function: step.functionName,
          http_status: call.status,
          ok: call.ok,
          result: call.data,
        });

        if (!call.ok) {
          blocked = true;
          break;
        }

        if (step.name !== "publication") {
          const result = call.data as Record<string, unknown> | null;
          const decision = result?.decision;
          const score = Number(result?.score ?? 0);

          if (decision !== "passed" || score < 85) {
            blocked = true;
            break;
          }
        }
      }

      results.push({
        output_id: output.id,
        chapter_number: output.chapter_number,
        title: output.title,
        action: blocked ? "blocked" : "reviewed",
        blocked,
        steps,
      });
    }

    return json({
      success: true,
      mode: "review-orchestrator",
      orchestrator_version: VERSION,
      checked_at: new Date().toISOString(),
      outputs_checked: outputs?.length ?? 0,
      results,
      note: "The orchestrator runs quality, continuity, originality, revision regression when applicable, safety, then publication review. It never publishes directly.",
    });
  } catch (error) {
    return json({
      success: false,
      mode: "review-orchestrator",
      orchestrator_version: VERSION,
      error: "Unexpected review orchestrator error.",
      details: errorMessage(error),
    }, 500);
  }
});