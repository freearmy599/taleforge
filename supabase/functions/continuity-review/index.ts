import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers":
"authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const CONTINUITY_VERSION = "continuity-v9-redacted-provider-state";

const MIN_SCORE = 85;

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
if (typeof value !== "string") return "";
return value.trim();
}

function wordCount(text: string): number {
return text
.trim()
.split(/\s+/)
.filter(Boolean).length;
}

function normalize(text: string): string {
return text
.toLowerCase()
.replace(/[^\p{L}\p{N}\s]/gu, " ")
.replace(/\s+/g, " ")
.trim();
}

function containsText(text: string, phrase: string): boolean {
const normalizedText = normalize(text);
const normalizedPhrase = normalize(phrase);

if (!normalizedPhrase) return false;

return normalizedText.includes(normalizedPhrase);
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
parts: [{ text: prompt }],
},
],
generationConfig: {
temperature: 0.1,
responseMimeType: "application/json",
},
}),
}
);

if (!response.ok) {
// Do not retain or propagate the provider response body; it may contain sensitive diagnostics.
throw new Error(
`Gemini HTTP ${response.status}${response.status === 429 ? " RESOURCE_EXHAUSTED" : ""}`
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

async function recordGeminiQuotaCooldown(supabase: any, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "";
  const isQuotaFailure = message.includes("Gemini HTTP 429") || message.includes("RESOURCE_EXHAUSTED");
  const isTemporaryOverload = message.includes("Gemini HTTP 503");
  if (!isQuotaFailure && !isTemporaryOverload) return;

  try {
    const { data, error: recordError } = await supabase.rpc(
      "aevora_record_gemini_throttle",
      { p_event_id: crypto.randomUUID(), p_event_class: isQuotaFailure ? "quota" : "overload" },
    );
    const result = Array.isArray(data) ? data[0] : data;
    if (recordError || result?.recorded !== true) {
      console.error("[quota-guard] Gemini cooldown could not be persisted; the review request remains blocked.");
      return;
    }
    console.warn("[quota-guard] Gemini cooldown recorded", JSON.stringify({
      cooldown_until: result.cooldown_until,
      cooldown_hours: result.cooldown_hours,
      consecutive_throttle_count: result.consecutive_throttle_count,
    }));
  } catch {
    console.error("[quota-guard] Gemini cooldown persistence failed unexpectedly; the review request remains blocked.");
  }
}
Deno.serve(async (req) => {
if (req.method === "OPTIONS") {
return new Response("ok", { headers: corsHeaders });
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
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY");
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
console.error("[quota-guard] Gemini provider state unavailable; failing closed.");
return jsonResponse({
success: false,
blocked: true,
retryable: true,
reason: "provider_state_unavailable",
note: "Gemini review blocked because provider cooldown state could not be verified; no model call was made.",
}, 503);
}

if(typeof providerState.consecutive_throttle_count!=="number"||!Number.isSafeInteger(providerState.consecutive_throttle_count)||providerState.consecutive_throttle_count<0){return jsonResponse({success:false,blocked:true,retryable:true,reason:"provider_state_unavailable",note:"Gemini review blocked because provider state is malformed; no model call was made."},503);}
const cooldownTimestamp = providerState.cooldown_until ? new Date(providerState.cooldown_until).getTime() : null;
if (providerState.cooldown_until && (cooldownTimestamp === null || !Number.isFinite(cooldownTimestamp))) {
return jsonResponse({ success: false, blocked: true, retryable: true, reason: "provider_state_unavailable", note: "Gemini review blocked because provider cooldown state is malformed; no model call was made." }, 503);
}

if (cooldownTimestamp !== null && cooldownTimestamp > Date.now()) {
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
"output_id is required. Continuity review never automatically selects an output.",
},
400
);
}

// ------------------------------------------------------------
// 1. Load generation output
// ------------------------------------------------------------

const { data: output, error: outputError } = await supabase
.from("chapter_generation_outputs")
.select(`
id,
series_id,
chapter_blueprint_id,
generation_job_id,
chapter_number,
title,
content,
word_count,
generation_model,
generation_prompt_version,
generation_attempt,
generation_status,
created_at
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

const chapterContent = cleanText(output.content);

if (!chapterContent) {
return jsonResponse(
{
success: false,
error: "The generation output has no chapter content.",
},
400
);
}

// ------------------------------------------------------------
// 2. Load series
// ------------------------------------------------------------

const { data: series, error: seriesError } = await supabase
.from("series")
.select(`
id,
title,
subtitle,
description,
status,
age_rating,
mood,
intensity,
ai_assisted,
ai_disclosure,
origin_type,
originality_status
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

// ------------------------------------------------------------
// 3. Load story DNA / blueprint
// ------------------------------------------------------------

const { data: storyBlueprint, error: blueprintError } =
await supabase
.from("story_blueprints")
.select(`
id,
series_id,
premise,
hook,
theme,
tone,
plot_structure,
conflict_type,
protagonist_type,
narrative_style,
pacing_style,
ending_style,
world_concept,
world_rules,
character_plan,
world_plan,
arc_plan,
chapter_plan,
originality_notes,
similarity_notes,
diversity_profile,
generation_status,
version
`)
.eq("series_id", output.series_id)
.maybeSingle();

if (blueprintError) {
return jsonResponse(
{
success: false,
error: "Could not load the story blueprint.",
details: "Internal review diagnostics were withheld.",
},
500
);
}

// ------------------------------------------------------------
// 4. Load chapter blueprint
// ------------------------------------------------------------

let chapterBlueprint: any = null;

if (output.chapter_blueprint_id) {
const { data, error } = await supabase
.from("chapter_blueprints")
.select(`
id,
series_id,
blueprint_id,
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
target_word_count,
generation_status,
release_status
`)
.eq("id", output.chapter_blueprint_id)
.maybeSingle();

if (error) {
return jsonResponse(
{
success: false,
error: "Could not load the chapter blueprint.",
details: "Internal review diagnostics were withheld.",
},
500
);
}

chapterBlueprint = data;
}

// ------------------------------------------------------------
// 5. Load previous chapters
// ------------------------------------------------------------

const currentChapterNumber = Number(output.chapter_number || 0);

const previousChapters: any[] = [];

if (currentChapterNumber > 1) {
const { data, error } = await supabase
.from("chapters")
.select(`
id,
series_id,
chapter_number,
title,
summary,
content,
word_count,
status,
published_at
`)
.eq("series_id", output.series_id)
.lt("chapter_number", currentChapterNumber)
.order("chapter_number", { ascending: false })
.limit(5);

if (error) {
return jsonResponse(
{
success: false,
error: "Could not load previous chapters.",
details: "Internal review diagnostics were withheld.",
},
500
);
}

if (data) {
previousChapters.push(...data.reverse());
}
}

// ------------------------------------------------------------
// 6. Deterministic continuity checks
// ------------------------------------------------------------

const hardIssues: string[] = [];
const warnings: string[] = [];

const actualWordCount = wordCount(chapterContent);

if (currentChapterNumber < 1) {
hardIssues.push("Invalid chapter number.");
}

if (!output.title) {
hardIssues.push("Chapter title is missing.");
}

if (
chapterBlueprint &&
Number(chapterBlueprint.chapter_number) !== currentChapterNumber
) {
hardIssues.push(
`Chapter number mismatch: output is ${currentChapterNumber}, blueprint is ${chapterBlueprint.chapter_number}.`
);
}

if (
chapterBlueprint &&
chapterBlueprint.title &&
normalize(chapterBlueprint.title) !== normalize(output.title)
) {
warnings.push(
`Chapter title differs from blueprint title: "${output.title}" vs "${chapterBlueprint.title}".`
);
}

if (actualWordCount < 500) {
hardIssues.push(
`Chapter is too short for production continuity review: ${actualWordCount} words.`
);
}

// Check explicit continuity requirements supplied by the blueprint.
const continuityRequirements =
chapterBlueprint?.continuity_requirements;

if (Array.isArray(continuityRequirements)) {
for (const requirement of continuityRequirements) {
if (typeof requirement !== "string") continue;

const requirementText = requirement.trim();

if (!requirementText) continue;

// This is deliberately a warning rather than an automatic failure.
// A narrative requirement does not always need to appear literally.
if (!containsText(chapterContent, requirementText)) {
warnings.push(
`Continuity requirement may need verification: "${requirementText}"`
);
}
}
}

// A chapter after Chapter 1 should normally have previous context.
if (currentChapterNumber > 1 && previousChapters.length === 0) {
warnings.push(
"No previous published chapters were found for comparison."
);
}

const deterministicPassed = hardIssues.length === 0;

// ------------------------------------------------------------
// 7. Prepare previous chapter context for Gemini
// ------------------------------------------------------------

const previousChapterContext = previousChapters
.map((chapter) => {
return `
CHAPTER ${chapter.chapter_number}
Title: ${chapter.title || ""}
Summary:
${chapter.summary || "(no summary)"}

Content:
${cleanText(chapter.content).slice(0, 12000)}
`;
})
.join("\n\n---\n\n");

// ------------------------------------------------------------
// 8. Prepare blueprint context
// ------------------------------------------------------------

const storyBlueprintContext = storyBlueprint
? `
Premise:
${storyBlueprint.premise || ""}

Hook:
${storyBlueprint.hook || ""}

Theme:
${storyBlueprint.theme || ""}

Tone:
${storyBlueprint.tone || ""}

Plot structure:
${storyBlueprint.plot_structure || ""}

Conflict type:
${storyBlueprint.conflict_type || ""}

Protagonist type:
${storyBlueprint.protagonist_type || ""}

Narrative style:
${storyBlueprint.narrative_style || ""}

Pacing style:
${storyBlueprint.pacing_style || ""}

Ending style:
${storyBlueprint.ending_style || ""}

World concept:
${storyBlueprint.world_concept || ""}

World rules:
${JSON.stringify(storyBlueprint.world_rules || {}, null, 2)}

Character plan:
${JSON.stringify(storyBlueprint.character_plan || {}, null, 2)}

World plan:
${JSON.stringify(storyBlueprint.world_plan || {}, null, 2)}

Arc plan:
${JSON.stringify(storyBlueprint.arc_plan || {}, null, 2)}
`
: "(No story blueprint available.)";

const chapterBlueprintContext = chapterBlueprint
? `
Chapter number:
${chapterBlueprint.chapter_number}

Title:
${chapterBlueprint.title || ""}

Purpose:
${chapterBlueprint.purpose || ""}

Summary:
${chapterBlueprint.summary || ""}

Plot events:
${JSON.stringify(chapterBlueprint.plot_events || [], null, 2)}

Character developments:
${JSON.stringify(
chapterBlueprint.character_developments || [],
null,
2
)}

World reveals:
${JSON.stringify(chapterBlueprint.world_reveals || [], null, 2)}

Clues and mysteries:
${JSON.stringify(
chapterBlueprint.clues_and_mysteries || [],
null,
2
)}

Continuity requirements:
${JSON.stringify(
chapterBlueprint.continuity_requirements || [],
null,
2
)}

Previous chapter dependencies:
${JSON.stringify(
chapterBlueprint.previous_chapter_dependencies || [],
null,
2
)}

Ending hook:
${chapterBlueprint.ending_hook || ""}
`
: "(No chapter blueprint available.)";

// ------------------------------------------------------------
// 9. Gemini continuity review
// ------------------------------------------------------------

const prompt = `
You are Aevora's continuity-control engine.

Your task is to determine whether ONE generated web-novel chapter is consistent
with the established series, story bible, chapter blueprint, and previous chapters.

This is NOT a writing task.
Do not rewrite the chapter.
Do not improve prose.
Do not judge whether you personally like the story.

Focus specifically on continuity.

Check:

1. Character identity and behavior
2. Character knowledge and memory
3. Character relationships
4. Locations and geography
5. World rules
6. Objects, abilities, technologies, magic, systems, or mechanics
7. Timeline and sequence of events
8. Previous chapter consequences
9. Previously established facts
10. Chapter blueprint requirements
11. Unresolved clues and mysteries
12. Cause-and-effect consistency
13. Contradictions
14. Impossible knowledge
15. Sudden unexplained changes
16. Ending connection
17. Series-level consistency

IMPORTANT:
A story may intentionally introduce a mystery, reveal, deception, unreliable
information, or surprising event. Do NOT classify something as a contradiction
merely because it is surprising.

Only flag something when the chapter conflicts with established information
or creates a serious unexplained continuity problem.

SERIES:
${series.title}

Subtitle:
${series.subtitle || ""}

Description:
${series.description || ""}

STORY DNA:
${storyBlueprintContext}

CURRENT CHAPTER BLUEPRINT:
${chapterBlueprintContext}

PREVIOUS CHAPTERS:
${previousChapterContext || "(No previous chapters available.)"}

CURRENT CHAPTER:
Chapter number: ${currentChapterNumber}
Title: ${output.title}

Content:
${chapterContent}

Return ONLY valid JSON using this exact structure:

{
"decision": "passed" | "needs_revision" | "failed",
"score": 0,
"character_consistency": "string",
"world_consistency": "string",
"timeline_consistency": "string",
"location_consistency": "string",
"knowledge_consistency": "string",
"object_and_system_consistency": "string",
"blueprint_alignment": "string",
"previous_chapter_connection": "string",
"clue_and_mystery_continuity": "string",
"cause_and_effect": "string",
"ending_continuity": "string",
"contradictions": [],
"critical_issues": [],
"warnings": [],
"required_revisions": [],
"overall_assessment": "string"
}

Scoring:

90-100 = excellent continuity
85-89 = production acceptable
70-84 = needs revision
below 70 = failed

A critical contradiction should normally result in "failed" or "needs_revision".

Do not fail merely because the chapter introduces new information.
`;

let aiReview: any;

try {
aiReview = await callGemini(geminiApiKey, prompt);
} catch (error) {
await recordGeminiQuotaCooldown(supabase, error);
const providerMessage = error instanceof Error ? error.message : String(error);
const quotaFailure = providerMessage.includes("Gemini HTTP 429") || providerMessage.includes("RESOURCE_EXHAUSTED");
const providerOverloaded = providerMessage.includes("Gemini HTTP 503");
return jsonResponse(
{
success: false,
retryable: quotaFailure || providerOverloaded,
reason: quotaFailure ? "provider_quota_blocked" : providerOverloaded ? "provider_temporarily_unavailable" : "review_failed",
error: quotaFailure ? "Gemini quota or rate limit was reached; retry after cooldown." : providerOverloaded ? "Gemini is temporarily unavailable; retry after cooldown." : "Gemini review failed; internal diagnostics were withheld.",
output_id: outputId,
deterministic_validation: {
passed: deterministicPassed,
issues: hardIssues,
warnings,
},
},
quotaFailure ? 429 : providerOverloaded ? 503 : 502
);
}

const aiScore =
typeof aiReview?.score === "number"
? Math.max(0, Math.min(100, aiReview.score))
: 0;

const aiDecision = cleanText(aiReview?.decision).toLowerCase();

const criticalIssues = Array.isArray(aiReview?.critical_issues)
? aiReview.critical_issues
: [];

const contradictions = Array.isArray(aiReview?.contradictions)
? aiReview.contradictions
: [];

const aiWarnings = Array.isArray(aiReview?.warnings)
? aiReview.warnings
: [];

const requiredRevisions = Array.isArray(
aiReview?.required_revisions
)
? aiReview.required_revisions
: [];

const finalPassed =
deterministicPassed &&
aiDecision === "passed" &&
aiScore >= MIN_SCORE &&
criticalIssues.length === 0 &&
contradictions.length === 0;

const finalDecision = finalPassed
? "passed"
: aiDecision === "failed" || criticalIssues.length > 0
? "failed"
: "needs_revision";

// ------------------------------------------------------------
// 10. Save chapter review
// ------------------------------------------------------------

const reviewFindings = {
continuity_version: CONTINUITY_VERSION,
deterministic_validation: {
passed: deterministicPassed,
actual_word_count: actualWordCount,
issues: hardIssues,
warnings,
},
ai_review: aiReview,
final_decision: finalDecision,
final_score: aiScore,
previous_chapters_checked: previousChapters.map((chapter) => ({
chapter_number: chapter.chapter_number,
title: chapter.title,
})),
reviewed_at: new Date().toISOString(),
};

const { data: review, error: reviewError } = await supabase
.from("chapter_reviews")
.upsert(
{
generation_output_id: outputId,
review_type: "continuity",
status: finalDecision,
score: aiScore,
findings: reviewFindings,
reviewer_model: GEMINI_MODEL,
reviewer_version: CONTINUITY_VERSION,
},
{
onConflict: "generation_output_id,review_type",
}
)
.select()
.single();

if (reviewError) {
return jsonResponse(
{
success: false,
error: "Continuity review completed but could not be saved.",
details: "Internal review diagnostics were withheld.",
output_id: outputId,
decision: finalDecision,
score: aiScore,
},
500
);
}

// ------------------------------------------------------------
// 11. Save continuity report on generation output
// ------------------------------------------------------------

const { error: updateError } = await supabase
.from("chapter_generation_outputs")
.update({
continuity_report: reviewFindings,
generation_status:
finalDecision === "passed"
? "approved"
: finalDecision === "needs_revision"
? "needs_revision"
: "rejected",
})
.eq("id", outputId);

if (updateError) {
return jsonResponse(
{
success: false,
error:
"Continuity review was saved, but the generation output could not be updated.",
details: "Internal review diagnostics were withheld.",
review_id: review.id,
output_id: outputId,
},
500
);
}

// ------------------------------------------------------------
// 12. Return production result
// ------------------------------------------------------------

return jsonResponse({
success: true,
mode: "continuity-review",
continuity_version: CONTINUITY_VERSION,
output_id: outputId,
review_id: review.id,
series_id: output.series_id,
series_title: series.title,
chapter_number: currentChapterNumber,
chapter_title: output.title,

decision: finalDecision,
score: aiScore,

deterministic_validation: {
passed: deterministicPassed,
actual_word_count: actualWordCount,
issues: hardIssues,
warnings,
},

previous_chapters_checked: previousChapters.map((chapter) => ({
chapter_number: chapter.chapter_number,
title: chapter.title,
})),

ai_review: {
decision: aiDecision,
score: aiScore,
character_consistency:
aiReview?.character_consistency || "",
world_consistency:
aiReview?.world_consistency || "",
timeline_consistency:
aiReview?.timeline_consistency || "",
location_consistency:
aiReview?.location_consistency || "",
knowledge_consistency:
aiReview?.knowledge_consistency || "",
object_and_system_consistency:
aiReview?.object_and_system_consistency || "",
blueprint_alignment:
aiReview?.blueprint_alignment || "",
previous_chapter_connection:
aiReview?.previous_chapter_connection || "",
clue_and_mystery_continuity:
aiReview?.clue_and_mystery_continuity || "",
cause_and_effect:
aiReview?.cause_and_effect || "",
ending_continuity:
aiReview?.ending_continuity || "",
contradictions,
critical_issues: criticalIssues,
warnings: aiWarnings,
required_revisions: requiredRevisions,
overall_assessment:
aiReview?.overall_assessment || "",
},

generation_status:
finalDecision === "passed"
? "approved"
: finalDecision === "needs_revision"
? "needs_revision"
: "rejected",

published: false,

next_step:
finalDecision === "passed"
? "Run originality review next. Do not publish yet."
: finalDecision === "needs_revision"
? "Revise the chapter using the required continuity revisions, then run continuity review again."
: "Do not publish. Fix the continuity failures and review again.",
});
} catch (error) {
return jsonResponse(
{
success: false,
error: "Unexpected continuity-review error.",
details: "Internal review diagnostics were withheld.",
},
500
);
}
});