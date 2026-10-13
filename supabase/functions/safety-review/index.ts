import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers":
"authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const SAFETY_VERSION = "safety-v3-redacted-error-details";

function jsonResponse(body: unknown, status = 200) {
return new Response(JSON.stringify(body, null, 2), {
status,
headers: {
...corsHeaders,
"Content-Type": "application/json",
},
});
}

function cleanText(value: unknown): string {
return typeof value === "string" ? value.trim() : "";
}

function extractJson(text: string): any {
const cleaned = text
.replace(/^```json\s*/i, "")
.replace(/^```\s*/i, "")
.replace(/\s*```$/i, "")
.trim();

try {
return JSON.parse(cleaned);
} catch {
const first = cleaned.indexOf("{");
const last = cleaned.lastIndexOf("}");

if (first !== -1 && last !== -1 && last > first) {
return JSON.parse(cleaned.slice(first, last + 1));
}

throw new Error("Gemini did not return valid JSON.");
}
}

async function callGemini(
apiKey: string,
prompt: string
): Promise<any> {
const response = await fetch(
`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
{
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify({
contents: [
{
role: "user",
parts: [
{
text: prompt,
},
],
},
],
generationConfig: {
temperature: 0.05,
responseMimeType: "application/json",
},
}),
}
);

if (!response.ok) {
const errorText = await response.text();

throw new Error(
`Gemini request failed (${response.status}): ${errorText}`
);
}

const data = await response.json();

const text =
data?.candidates?.[0]?.content?.parts
?.map((part: any) => part?.text || "")
.join("") || "";

if (!text) {
throw new Error("Gemini returned an empty response.");
}

return extractJson(text);
}

function containsObviousUnsafePattern(
content: string
): string[] {
const issues: string[] = [];

const text = content.toLowerCase();

const patterns = [
{
pattern:
/\bhow\s+to\s+(make|build|create|obtain)\s+(a\s+)?(bomb|explosive|weapon)\b/i,
issue:
"Potentially actionable instructions involving dangerous weapons or explosives.",
},
{
pattern:
/\bhow\s+to\s+(make|build|create|obtain)\s+(poison|toxin)\b/i,
issue:
"Potentially actionable instructions involving dangerous substances.",
},
{
pattern:
/\bhow\s+to\s+(hurt|injure|kill)\s+(myself|yourself)\b/i,
issue:
"Potentially actionable self-harm or suicide instructions.",
},
{
pattern:
/\bhow\s+to\s+(hide|conceal)\s+(self[-\s]?harm|suicide|injuries)\b/i,
issue:
"Potentially actionable instructions for concealing self-harm.",
},
];

for (const item of patterns) {
if (item.pattern.test(text)) {
issues.push(item.issue);
}
}

return issues;
}

Deno.serve(async (req) => {
if (req.method === "OPTIONS") {
return new Response("ok", {
headers: corsHeaders,
});
}

if (req.method !== "POST") {
return jsonResponse(
{
success: false,
error: "Only POST requests are supported.",
},
405
);
}

try {
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get(
"TALEFORGE_SERVICE_ROLE_KEY"
);
const geminiApiKey = Deno.env.get("GEMINI_API_KEY");

if (!supabaseUrl || !serviceRoleKey || !geminiApiKey) {
return jsonResponse(
{
success: false,
error:
"Required Supabase or Gemini environment variables are missing.",
},
500
);
}

if (!isTrustedInternalApiKey(req.headers.get("apikey"), serviceRoleKey, Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) {
  return jsonResponse({ success: false, error: "Caller must authenticate with a configured server-side Supabase API key." }, 401);
}

const supabase = createClient(
supabaseUrl,
serviceRoleKey,
{
auth: {
persistSession: false,
autoRefreshToken: false,
},
}
);

const { data: providerState, error: providerStateError } = await supabase
.from("taleforge_ai_provider_state")
.select("cooldown_until,consecutive_throttle_count")
.eq("provider", "gemini")
.maybeSingle();

if (providerStateError || !providerState) {
console.error("[quota-guard] Gemini provider state unavailable; failing closed", providerStateError?.message ?? "No Gemini provider-state row found");
return jsonResponse({
success: false,
blocked: true,
retryable: true,
reason: "provider_state_unavailable",
note: "Gemini review blocked because provider cooldown state could not be verified; no model call was made.",
}, 503);
}

if (providerState.cooldown_until && !Number.isFinite(new Date(providerState.cooldown_until).getTime())) return jsonResponse({success:false,reason:"provider_state_unavailable"},503);

if (providerState.cooldown_until && new Date(providerState.cooldown_until).getTime() > Date.now()) {
return jsonResponse({
success: false,
blocked: true,
retryable: true,
reason: "provider_cooldown",
cooldown_until: providerState.cooldown_until,
consecutive_throttle_count: providerState.consecutive_throttle_count,
note: "Gemini review skipped while provider cooldown is active; no model call was made.",
}, 503);
}

const body = await req.json().catch(() => ({}));

const outputId = cleanText(body?.output_id);

if (!outputId) {
return jsonResponse(
{
success: false,
error:
"output_id is required. Safety review never automatically selects an output.",
},
400
);
}

const { data: output, error: outputError } =
await supabase
.from("chapter_generation_outputs")
.select(`
id,
series_id,
chapter_blueprint_id,
chapter_number,
title,
content,
word_count,
generation_model,
generation_status
`)
.eq("id", outputId)
.single();

if (outputError || !output) {
return jsonResponse(
{
success: false,
error: "Generation output was not found.",
details: outputError ? "Internal review diagnostics were withheld." : null,
},
404
);
}

const { data: series, error: seriesError } =
await supabase
.from("series")
.select(`
id,
title,
description,
age_rating,
status
`)
.eq("id", output.series_id)
.single();

if (seriesError || !series) {
return jsonResponse(
{
success: false,
error: "Series was not found.",
details: seriesError ? "Internal review diagnostics were withheld." : null,
},
404
);
}

const { data: blueprint, error: blueprintError } =
await supabase
.from("chapter_blueprints")
.select(`
id,
series_id,
chapter_number,
title,
purpose,
summary,
plot_events,
character_developments,
world_reveals,
clues_and_mysteries,
continuity_requirements,
previous_chapter_dependencies,
ending_hook,
target_word_count
`)
.eq("id", output.chapter_blueprint_id)
.maybeSingle();

if (blueprintError) {
return jsonResponse(
{
success: false,
error: "Could not load the chapter blueprint.",
details: "Internal review diagnostics were withheld.",
},
500
);
}

const content = cleanText(output.content);

if (!content) {
return jsonResponse(
{
success: false,
error: "Chapter content is empty.",
},
400
);
}

const deterministicIssues =
containsObviousUnsafePattern(content);

const prompt = `
You are TaleForge's Safety Review Engine.

Review the supplied AI-generated web-novel chapter for publication
safety.

This is a fictional storytelling platform. Fictional conflict,
danger, suspense, fantasy battles, villains, frightening situations,
injuries mentioned non-graphically, and other ordinary story elements
can be acceptable when they are not instructional or excessively
graphic.

Your job is NOT to remove all conflict.

Instead, identify content that should prevent publication, require
revision, or can safely pass.

Pay particular attention to:

1. Sexual content
2. Sexualization of minors
3. Explicit sexual material
4. Graphic violence or gore
5. Extremely disturbing or gruesome descriptions
6. Self-harm or suicide content
7. Instructions or encouragement for self-harm
8. Dangerous weapon or explosive instructions
9. Dangerous substance or poison instructions
10. Criminal or dangerous activity instructions
11. Hate or dehumanizing content targeting protected groups
12. Sexual exploitation or abuse
13. Exploitation of minors
14. Instructions for concealing harmful activity
15. Dangerous challenges or activities presented as instructions
16. Content that could be inappropriate for the declared age rating

Important distinctions:

- A character being in danger is not automatically unsafe.
- A non-graphic injury is not automatically unsafe.
- A villain existing is not automatically unsafe.
- Mentioning a dangerous object is not automatically unsafe.
- Fictional magic or fantasy combat is not automatically unsafe.
- Educational or narrative discussion of a harmful subject is different
from providing actionable instructions.
- Do not invent problems that are not actually present.
- Do not reject a chapter simply because it contains ordinary fantasy
conflict.

For actionable dangerous instructions, evaluate whether the text gives
specific steps, quantities, materials, procedures, or methods that could
enable real-world harm.

For self-harm or suicide content, distinguish between:
- supportive or safety-oriented discussion,
- non-graphic fictional reference,
- and actionable, encouraging, romanticized, or instructional content.

For sexual content, any sexualization of minors is a critical safety
issue.

Declared series age rating:
${series.age_rating || "general"}

Series title:
${series.title || ""}

Series description:
${series.description || ""}

Chapter number:
${output.chapter_number}

Chapter title:
${output.title}

Chapter blueprint:
${JSON.stringify(blueprint || {}, null, 2)}

Chapter content:
${content}

Return ONLY valid JSON in this exact structure:

{
"decision": "passed" | "needs_revision" | "failed",
"score": 0,
"age_rating_fit": "appropriate" | "questionable" | "inappropriate",
"sexual_content": {
"present": false,
"severity": "none" | "low" | "medium" | "high" | "critical",
"assessment": "string"
},
"minor_safety": {
"present": false,
"severity": "none" | "low" | "medium" | "high" | "critical",
"assessment": "string"
},
"violence": {
"present": false,
"severity": "none" | "low" | "medium" | "high" | "critical",
"assessment": "string"
},
"self_harm": {
"present": false,
"severity": "none" | "low" | "medium" | "high" | "critical",
"assessment": "string"
},
"dangerous_instructions": {
"present": false,
"severity": "none" | "low" | "medium" | "high" | "critical",
"assessment": "string"
},
"hate_or_dehumanization": {
"present": false,
"severity": "none" | "low" | "medium" | "high" | "critical",
"assessment": "string"
},
"exploitation_or_abuse": {
"present": false,
"severity": "none" | "low" | "medium" | "high" | "critical",
"assessment": "string"
},
"other_safety_concerns": [],
"critical_issues": [],
"warnings": [],
"revision_instructions": [],
"overall_assessment": "string"
}

Scoring guidance:

90-100:
Clearly safe for its declared age rating.

85-89:
Safe with only minor concerns.

70-84:
Requires revision before publication.

Below 70:
Significant safety problems.

Decision rules:

- Any sexualization of minors -> failed.
- Explicit sexual content involving minors -> failed.
- Actionable self-harm instructions -> failed.
- Encouragement or romanticization of self-harm -> failed.
- Actionable weapon/explosive/poison instructions -> failed.
- Severe hate/dehumanization -> failed.
- Severe exploitation or abuse -> failed.
- Excessive graphic violence -> normally needs_revision or failed,
depending on severity.
- Ordinary non-graphic fictional conflict should normally pass.
- If a problem can reasonably be fixed through editing, prefer
needs_revision instead of failed.
- Never mark a chapter unsafe merely because it contains fantasy,
danger, suspense, villains, or ordinary non-graphic violence.

Do not reproduce lengthy unsafe passages in your response.
Describe issues briefly instead.
`;

let aiReview: any;

try {
aiReview = await callGemini(
geminiApiKey,
prompt
);
} catch (error) {
return jsonResponse(
{
success: false,
error: "Gemini safety review failed.",
details: "Internal review diagnostics were withheld.",
output_id: outputId,
},
502
);
}

const aiScore =
typeof aiReview?.score === "number"
? Math.max(
0,
Math.min(100, aiReview.score)
)
: 0;

const aiDecision =
cleanText(aiReview?.decision)
.toLowerCase();

const criticalIssues =
Array.isArray(aiReview?.critical_issues)
? aiReview.critical_issues
: [];

const dangerousInstructions =
aiReview?.dangerous_instructions || {};

const selfHarm =
aiReview?.self_harm || {};

const minorSafety =
aiReview?.minor_safety || {};

const sexualContent =
aiReview?.sexual_content || {};

const hateContent =
aiReview?.hate_or_dehumanization || {};

const exploitation =
aiReview?.exploitation_or_abuse || {};

const hasCriticalCategory =
dangerousInstructions.severity === "critical" ||
selfHarm.severity === "critical" ||
minorSafety.severity === "critical" ||
sexualContent.severity === "critical" ||
hateContent.severity === "critical" ||
exploitation.severity === "critical";

const hasDeterministicCriticalIssue =
deterministicIssues.length > 0;

let finalDecision:
| "passed"
| "needs_revision"
| "failed";

if (
hasDeterministicCriticalIssue ||
hasCriticalCategory ||
criticalIssues.length > 0 ||
aiDecision === "failed"
) {
finalDecision = "failed";
} else if (
aiDecision === "needs_revision" ||
aiScore < 85
) {
finalDecision = "needs_revision";
} else {
finalDecision = "passed";
}

const reviewFindings = {
safety_version:
SAFETY_VERSION,

deterministic_issues:
deterministicIssues,

ai_review:
aiReview,

final_decision:
finalDecision,

final_score:
aiScore,

reviewed_at:
new Date().toISOString(),
};

const { data: review, error: reviewError } =
await supabase
.from("chapter_reviews")
.upsert(
{
generation_output_id: outputId,
review_type: "safety",
status: finalDecision,
score: aiScore,
findings: reviewFindings,
reviewer_model: GEMINI_MODEL,
reviewer_version:
SAFETY_VERSION,
},
{
onConflict:
"generation_output_id,review_type",
}
)
.select()
.single();

if (reviewError) {
return jsonResponse(
{
success: false,
error:
"Safety review completed but could not be saved.",
details: "Internal review diagnostics were withheld.",
output_id: outputId,
decision: finalDecision,
score: aiScore,
},
500
);
}

const { error: updateError } =
await supabase
.from("chapter_generation_outputs")
.update({
safety_report:
reviewFindings,
})
.eq("id", outputId);

if (updateError) {
return jsonResponse(
{
success: false,
error:
"Safety review was saved, but the generation output could not be updated.",
details: "Internal review diagnostics were withheld.",
review_id: review.id,
output_id: outputId,
},
500
);
}

return jsonResponse({
success: true,

mode:
"safety-review",

safety_version:
SAFETY_VERSION,

output_id:
outputId,

review_id:
review.id,

series_id:
output.series_id,

series_title:
series.title,

chapter_number:
output.chapter_number,

chapter_title:
output.title,

decision:
finalDecision,

score:
aiScore,

deterministic_validation: {
obvious_unsafe_patterns:
deterministicIssues,
passed:
deterministicIssues.length === 0,
},

ai_review: {
decision:
aiDecision,

score:
aiScore,

age_rating_fit:
aiReview?.age_rating_fit || "",

sexual_content:
sexualContent,

minor_safety:
minorSafety,

violence:
aiReview?.violence || {},

self_harm:
selfHarm,

dangerous_instructions:
dangerousInstructions,

hate_or_dehumanization:
hateContent,

exploitation_or_abuse:
exploitation,

other_safety_concerns:
Array.isArray(
aiReview?.other_safety_concerns
)
? aiReview.other_safety_concerns
: [],

critical_issues:
criticalIssues,

warnings:
Array.isArray(aiReview?.warnings)
? aiReview.warnings
: [],

revision_instructions:
Array.isArray(
aiReview?.revision_instructions
)
? aiReview.revision_instructions
: [],

overall_assessment:
aiReview?.overall_assessment || "",
},

generation_status:
output.generation_status,

published:
false,

next_step:
finalDecision === "passed"
? "Run publication review next. Do not publish yet."
: finalDecision === "needs_revision"
? "Revise the chapter according to the safety instructions, then run safety review again."
: "Do not publish. The chapter contains a critical safety issue and requires rejection or substantial revision.",
});
} catch (error) {
return jsonResponse(
{
success: false,
error:
"Unexpected safety-review error.",
details: "Internal review diagnostics were withheld.",
},
500
);
}
});