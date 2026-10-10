#!/usr/bin/env node
/**
 * Read-only Aevora control-plane audit.
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Uses GITHUB_TOKEN only
 * to create/update one issue with findings; never writes to Supabase.
 */
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.status === 204 ? null : response.json();
}

async function supabase(table, select, extra = "") {
  const url = `${supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}`;
  const response = await fetch(url, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!response.ok) throw new Error(`Supabase read ${table} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function report(title, body) {
  const existing = await github("issues?state=open&per_page=100");
  const issue = existing.find((item) => !item.pull_request && item.title === title);
  if (issue) {
    await github(`issues/${issue.number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    console.log(`Updated audit issue #${issue.number}`);
  } else {
    const created = await github("issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    console.log(`Created audit issue #${created.number}`);
  }
}

const title = "[Aevora Control Plane] Automated audit findings";
const missing = [];
if (!repo) missing.push("GITHUB_REPOSITORY");
if (!token) missing.push("GITHUB_TOKEN");
if (!supabaseUrl) missing.push("SUPABASE_URL");
if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

if (missing.length) {
  const body = [
    "## Aevora control-plane audit is not fully configured",
    "",
    `Missing environment values: ${missing.join(", ")}`,
    "",
    "This workflow is read-only and does not change Supabase. Configure the required repository secret/variable through GitHub Settings, or keep this monitor disabled. Do not paste secrets into issues or chat.",
    "",
    `Last checked: ${new Date().toISOString()}`,
  ].join("\n");
  if (repo && token) await report(title, body);
  console.error(body);
  process.exit(0);
}

const findings = [];
const evidence = [];
try {
  const [jobs, providers, schedules, tasks, decisions] = await Promise.all([
    supabase("aevora_automation_job_status", "jobname,active,schedule,last_status,last_started_at,last_finished_at,last_message"),
    supabase("taleforge_ai_provider_state", "provider,cooldown_until,consecutive_throttle_count,last_error_at"),
    supabase("release_schedules", "id,series_id,enabled,auto_generate,auto_publish,next_release_at"),
    supabase("aevora_engineering_tasks", "id,title,status,lease_until,updated_at,blocked_reason"),
    supabase("aevora_engineering_decisions", "id,title,urgency,status,created_at,expires_at"),
  ]);

  const now = Date.now();
  const expectedMinutes = (cron) => {
    if (cron === "*/5 * * * *") return 20;
    if (cron === "*/15 * * * *") return 45;
    if (cron === "*/30 * * * *") return 75;
    if (cron === "0 * * * *") return 150;
    if (cron === "0 6 * * *") return 1800;
    return 180;
  };

  for (const job of jobs) {
    if (!job.active) {
      findings.push(`**Inactive scheduled job:** ${job.jobname} (schedule ${job.schedule})`);
      continue;
    }
    if (job.last_status && job.last_status !== "succeeded") {
      findings.push(`**Scheduled job failure:** ${job.jobname} status=${job.last_status}; message=${String(job.last_message || "").slice(0, 180)}`);
    }
    const finished = job.last_finished_at ? Date.parse(job.last_finished_at) : NaN;
    if (!Number.isFinite(finished) || now - finished > expectedMinutes(job.schedule) * 60_000) {
      findings.push(`**Stale scheduled job:** ${job.jobname} schedule=${job.schedule}; last_finished_at=${job.last_finished_at || "never"}`);
    }
  }

  for (const schedule of schedules) {
    if (schedule.enabled && schedule.auto_publish) {
      findings.push(`**Publication safeguard requires review:** release schedule ${schedule.id} (series ${schedule.series_id}) has auto_publish=true. This monitor will not change it.`);
    }
  }

  for (const task of tasks) {
    if (["claimed", "in_progress"].includes(task.status) && task.lease_until && Date.parse(task.lease_until) < now) {
      findings.push(`**Expired engineering task lease:** ${task.title} (${task.id}), lease_until=${task.lease_until}`);
    }
    if (task.status === "failed") findings.push(`**Failed engineering task:** ${task.title} (${task.id}); ${task.blocked_reason || "no failure reason recorded"}`);
  }

  for (const decision of decisions) {
    if (decision.status === "awaiting_decision" && ["high", "critical"].includes(decision.urgency)) {
      findings.push(`**Owner decision required (${decision.urgency}):** ${decision.title} (${decision.id})`);
    }
    if (decision.status === "awaiting_decision" && decision.expires_at && Date.parse(decision.expires_at) < now) {
      findings.push(`**Expired decision request:** ${decision.title} (${decision.id})`);
    }
  }

  for (const provider of providers) {
    evidence.push(`- Gemini/provider ${provider.provider}: cooldown until ${provider.cooldown_until || "none"}; consecutive throttles=${provider.consecutive_throttle_count ?? "unknown"}`);
  }
  evidence.push(`- Scheduled jobs checked: ${jobs.length}`);
  evidence.push(`- Release schedules checked: ${schedules.length}`);
  evidence.push(`- Engineering tasks checked: ${tasks.length}`);
  evidence.push(`- Awaiting decisions: ${decisions.filter((d) => d.status === "awaiting_decision").length}`);

  const body = [
    findings.length ? "## Findings requiring attention" : "## No current control-plane findings",
    "",
    findings.length ? findings.map((f) => `- ${f}`).join("\n") : "The latest read-only audit found no stale/failed scheduled jobs, expired task leases, or high-priority decision requests.",
    "",
    "## Evidence snapshot",
    ...evidence,
    "",
    "This report is generated by a read-only audit. It does not invoke Gemini, mutate release schedules, publish content, or modify Supabase rows.",
    "",
    `Last checked: ${new Date().toISOString()}`,
  ].join("\n");
  await report(title, body);
  console.log(`Audit completed. Findings: ${findings.length}`);
} catch (error) {
  const body = [
    "## Aevora control-plane audit failed",
    "",
    `Error: ${String(error?.message || error)}`,
    "",
    "No remediation was attempted. Verify credentials, table grants, and schema before enabling any write-capable worker.",
    "",
    `Last checked: ${new Date().toISOString()}`,
  ].join("\n");
  await report(title, body);
  console.error(body);
  process.exitCode = 1;
}
