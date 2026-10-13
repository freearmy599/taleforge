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

function safeAuditText(value, maxLength = 160) {
  const text = value == null ? "unknown" : String(value);
  let output = "";
  const markdown = new Set(["\\", String.fromCharCode(96), "*", "_", "{", "}", "[", "]", "(", ")", "<", ">", "#", "+", "-", ".", "!", "|"]);
  for (const character of text) {
    const code = character.charCodeAt(0);
    const safeCharacter = code < 32 || code === 127
      ? " "
      : markdown.has(character) ? "\\" + character : character;
    // Measure emitted escaped text, not input characters: Markdown escaping can double length.
    if (output.length + safeCharacter.length > maxLength) break;
    output += safeCharacter;
  }
  return output;
}

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
  if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function report(title, body) {
  // GitHub issue bodies have a hard size limit. Bound every report path,
  // including snapshots with unexpectedly large arrays or error details.
  const maxBodyLength = 60_000;
  const boundedBody = body.length > maxBodyLength
    ? body.slice(0, maxBodyLength - 80) + "\n\n... audit report truncated to stay within the GitHub issue body limit. ..."
    : body;
  const existing = await github("issues?state=open&per_page=100");
  const issue = existing.find((item) => !item.pull_request && item.title === title);
  if (issue) {
    await github(`issues/${issue.number}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: boundedBody }),
    });
    console.log(`Updated audit issue #${issue.number}`);
  } else {
    const created = await github("issues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body: boundedBody }),
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
  process.exitCode = 1;
} else {

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
    // Do not echo endpoint response bodies into logs or GitHub issues; they may contain sensitive diagnostics.
    throw new Error(`Audit endpoint returned HTTP ${response.status}`);
  }
  const snapshot = await response.json();
  const { jobs = [], providers = [], schedules = [], tasks = [], decisions = [] } = snapshot;
  const now = Date.now();
  const parseTimestamp = (value) => {
    if (typeof value !== "string" || value.trim() === "") return NaN;
    return Date.parse(value);
  };
  const snapshotTime = parseTimestamp(snapshot.generated_at);
  if (!Number.isFinite(snapshotTime)) {
    findings.push(`**Malformed control-plane snapshot timestamp:** generated_at=${safeAuditText(snapshot.generated_at ?? "missing", 80)}`);
  } else if (snapshotTime > now + 5 * 60_000) {
    findings.push(`**Control-plane snapshot timestamp is in the future:** generated_at=${safeAuditText(snapshot.generated_at, 80)}`);
  } else if (now - snapshotTime > 45 * 60_000) {
    findings.push(`**Stale control-plane snapshot:** generated_at=${safeAuditText(snapshot.generated_at, 80)}; snapshot is older than 45 minutes`);
  }
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
      findings.push(`**Inactive scheduled job:** ${safeAuditText(job.jobname)} (schedule ${safeAuditText(job.schedule, 80)})`);
      continue;
    }
    if (job.last_status && job.last_status !== "succeeded") {
      findings.push(`**Scheduled job failure:** ${safeAuditText(job.jobname)} status=${safeAuditText(job.last_status, 80)}`);
    }
    const finished = job.last_finished_at ? Date.parse(job.last_finished_at) : NaN;
    if (!Number.isFinite(finished) || now - finished > expectedMinutes(job.schedule) * 60_000) {
      findings.push(`**Stale scheduled job:** ${safeAuditText(job.jobname)} schedule=${safeAuditText(job.schedule, 80)}; last_finished_at=${safeAuditText(job.last_finished_at || "never", 80)}`);
    }
  }

  for (const schedule of schedules) {
    if (schedule.enabled && schedule.auto_publish) {
      findings.push(`**Publication safeguard requires review:** release schedule ${safeAuditText(schedule.id, 80)} (series ${safeAuditText(schedule.series_id, 80)}) has auto_publish=true. This monitor will not change it.`);
    }
  }

  for (const task of tasks) {
    if (["claimed", "in_progress"].includes(task.status)) {
      if (!task.lease_until) {
        findings.push(`**Missing engineering task lease timestamp:** ${safeAuditText(task.title)} (${safeAuditText(task.id, 80)}), active status=${safeAuditText(task.status, 40)}`);
      } else {
        const leaseUntil = parseTimestamp(task.lease_until);
        if (!Number.isFinite(leaseUntil)) {
          findings.push(`**Malformed engineering task lease timestamp:** ${safeAuditText(task.title)} (${safeAuditText(task.id, 80)}), lease_until=${safeAuditText(task.lease_until, 80)}`);
        } else if (leaseUntil < now) {
          findings.push(`**Expired engineering task lease:** ${safeAuditText(task.title)} (${safeAuditText(task.id, 80)}), lease_until=${safeAuditText(task.lease_until, 80)}`);
        }
      }
    }
    if (task.status === "failed") findings.push(`**Failed engineering task:** ${safeAuditText(task.title)} (${safeAuditText(task.id, 80)}); ${safeAuditText(task.blocked_reason || "no failure reason recorded")}`);
  }

  for (const decision of decisions) {
    if (decision.status === "awaiting_decision" && ["high", "critical"].includes(decision.urgency)) {
      findings.push(`**Owner decision required (${safeAuditText(decision.urgency, 40)}):** ${safeAuditText(decision.title)} (${safeAuditText(decision.id, 80)})`);
    }
    if (decision.status === "awaiting_decision" && decision.expires_at) {
      const expiresAt = parseTimestamp(decision.expires_at);
      if (!Number.isFinite(expiresAt)) {
        findings.push(`**Malformed decision expiry timestamp:** ${safeAuditText(decision.title)} (${safeAuditText(decision.id, 80)}), expires_at=${safeAuditText(decision.expires_at, 80)}`);
      } else if (expiresAt < now) {
        findings.push(`**Expired decision request:** ${safeAuditText(decision.title)} (${safeAuditText(decision.id, 80)})`);
      }
    }
  }

  const geminiProvider = providers.find((provider) => String(provider.provider || "").toLowerCase() === "gemini");
  if (!geminiProvider) {
    findings.push("**Missing Gemini provider state:** no Gemini row was returned by the control-plane snapshot; generation is expected to fail closed until provider state is restored.");
  }

  for (const provider of providers) {
    if (provider.cooldown_until) {
      const cooldownUntil = parseTimestamp(provider.cooldown_until);
      if (!Number.isFinite(cooldownUntil)) {
        findings.push(`**Malformed AI provider cooldown timestamp:** ${safeAuditText(provider.provider, 80)}, cooldown_until=${safeAuditText(provider.cooldown_until, 80)}`);
      }
    }
    if (provider.consecutive_throttle_count !== null && provider.consecutive_throttle_count !== undefined) {
      const rawThrottleCount = provider.consecutive_throttle_count;
      const throttleCount = typeof rawThrottleCount === "number"
        ? rawThrottleCount
        : typeof rawThrottleCount === "string" && /^(0|[1-9][0-9]*)$/.test(rawThrottleCount)
        ? Number(rawThrottleCount)
        : Number.NaN;
      if (!Number.isSafeInteger(throttleCount) || throttleCount < 0) {
        findings.push(`**Invalid AI provider throttle counter:** ${safeAuditText(provider.provider, 80)}, consecutive_throttle_count=${safeAuditText(rawThrottleCount, 40)}`);
      }
    }
    evidence.push(`- Provider ${safeAuditText(provider.provider, 80)}: cooldown until ${safeAuditText(provider.cooldown_until || "none", 80)}; consecutive throttles=${safeAuditText(provider.consecutive_throttle_count ?? "unknown", 40)}`);
  }
  evidence.push(`- Snapshot generated at: ${safeAuditText(snapshot.generated_at || "unknown", 80)}`);
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
    `Error: ${safeAuditText(error?.message || error, 240)}`,
    "",
    "No remediation was attempted. Verify the scoped audit token, endpoint configuration, and schema before enabling any write-capable worker.",
    "",
    `Last checked: ${new Date().toISOString()}`,
  ].join("\n");
  try {
    await report(title, body);
  } catch (reportError) {
    // Reporting can fail for the same GitHub/API outage that caused the audit failure.
    // Keep this fallback bounded and avoid an unhandled second failure.
    console.error("Audit failure report could not be delivered.");
  }
  console.error(body);
  process.exitCode = 1;
}

}
