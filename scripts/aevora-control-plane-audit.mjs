#!/usr/bin/env node
/**
 * Read-only Aevora control-plane audit.
 * GitHub Actions receives only a scoped AEVORA_AUDIT_TOKEN, never the
 * Supabase service-role key. The Supabase Edge Function performs read-only
 * table reads and returns a bounded status snapshot.
 */
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const auditUrl = process.env.AEVORA_AUDIT_URL;
const auditToken = process.env.AEVORA_AUDIT_TOKEN;

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
if (!auditUrl) missing.push("AEVORA_AUDIT_URL");
if (!auditToken) missing.push("AEVORA_AUDIT_TOKEN");

if (missing.length) {
  const body = [
    "## Aevora control-plane audit is not fully configured",
    "",
    `Missing environment values: ${missing.join(", ")}`,
    "",
    "The monitor uses a scoped token to call a read-only Supabase Edge Function; the Supabase service-role key is not stored in GitHub. Configure AEVORA_AUDIT_TOKEN in Supabase Edge Function secrets and GitHub Actions secrets using the same privately generated value. Never paste it into source code, issues, or chat.",
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
  // Diagnose header-incompatible characters without ever printing the secret.
  const tokenChars = Array.from(auditToken);
  const badIndex = tokenChars.findIndex((character) => character.codePointAt(0) > 127);
  if (badIndex !== -1) {
    const codePoint = tokenChars[badIndex].codePointAt(0);
    throw new Error(`AEVORA_AUDIT_TOKEN contains a non-ASCII character at token position ${badIndex} (Unicode code point U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}); secret value not logged`);
  }

  const response = await fetch(auditUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${auditToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Audit endpoint returned ${response.status}: ${errorBody.slice(0, 180)}`);
  }
  const snapshot = await response.json();
  const { jobs = [], providers = [], schedules = [], tasks = [], decisions = [] } = snapshot;
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
      findings.push(`**Scheduled job failure:** ${job.jobname} status=${job.last_status}`);
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
    evidence.push(`- Provider ${provider.provider}: cooldown until ${provider.cooldown_until || "none"}; consecutive throttles=${provider.consecutive_throttle_count ?? "unknown"}`);
  }
  evidence.push(`- Snapshot generated at: ${snapshot.generated_at || "unknown"}`);
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
    "This report is generated by a read-only audit. It does not invoke Gemini, mutate release schedules, publish content, or modify Supabase.",
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
    "No remediation was attempted. Verify the scoped audit token, endpoint configuration, and schema before enabling any write-capable worker.",
    "",
    `Last checked: ${new Date().toISOString()}`,
  ].join("\n");
  await report(title, body);
  console.error(body);
  process.exitCode = 1;
}
