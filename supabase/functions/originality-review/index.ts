import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers":
"authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const ORIGINALITY_VERSION = "originality-v2-fail-closed-provider-state";
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
return typeof value === "string" ? value.trim() : "";
}

function normalize(text: string): string {
return text
.toLowerCase()
.replace(/[^\p{L}\p{N}\s]/gu, " ")
.replace(/\s+/g, " ")
.trim();
}

function similarityTokens(a: string, b: string): number {
const aTokens = new Set(
normalize(a)
.split(" ")
.filter((x) => x.length > 2)
);

const bTokens = new Set(
normalize(b)
.split(" ")
.filter((x) => x.length > 2)
);

if (!aTokens.size || !bTokens.size) return 0;

let intersection = 0;

for (const token of aTokens) {
if (bTokens.has(token)) {
intersection++;
}
}

const union = new Set([...aTokens, ...bTokens]).size;

return union === 0 ? 0 : intersection / union;
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

function buildSeriesProfile(series: any): string {
return `
Series title:
${series.title || ""}

Subtitle:
${series.subtitle || ""}

Description:
${series.description || ""}

Primary genre:
${series.primary_genre_id || ""}

Mood:
${series.mood || ""}

Intensity:
${series.intensity || ""}

Origin type:
${series.origin_type || ""}

Premise:
${series.premise || ""}

Hook:
${series.hook || ""}

Theme:
${series.theme || ""}

Plot structure:
${series.plot_structure || ""}

Conflict type:
${series.conflict_type || ""}

Protagonist type:
${series.protagonist_type || ""}

Narrative style:
${series.narrative_style || ""}

World concept:
${series.world_concept || ""}

World rules:
${JSON.stringify(series.world_rules || {}, null, 2)}
`;
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
const serviceRoleKey = Deno.env.get(
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
"output_id is required. Originality review never automatically selects an output.",
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
details: outputError?.message || null,
},
404
);
}

const { data: candidateSeries, error: seriesError } =
await supabase
.from("series")
.select(`
id,
title,
subtitle,
description,
primary_genre_id,
mood,
intensity,
origin_type,
originality_status
`)
.eq("id", output.series_id)
.single();

if (seriesError || !candidateSeries) {
return jsonResponse(
{
success: false,
error: "Candidate series was not found.",
details: seriesError?.message || null,
},
404
);
}

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
originality_notes,
similarity_notes
`)
.eq("series_id", output.series_id)
.maybeSingle();

if (blueprintError) {
return jsonResponse(
{
success: false,
error: "Could not load candidate Story DNA.",
details: blueprintError.message,
},
500
);
}

const { data: existingSeries, error: existingError } =
await supabase
.from("series")
.select(`
id,
title,
subtitle,
description,
primary_genre_id,
mood,
intensity,
origin_type,
originality_status
`)
.neq("id", output.series_id)
.in("status", ["ongoing", "completed"])
.in("originality_status", ["approved", "checked"])
.order("published_at", {
ascending: false,
})
.limit(100);

if (existingError) {
return jsonResponse(
{
success: false,
error: "Could not load the TaleForge catalogue.",
details: existingError.message,
},
500
);
}

const catalogue = existingSeries || [];

const candidateText = `
${candidateSeries.title || ""}
${candidateSeries.subtitle || ""}
${candidateSeries.description || ""}
${storyBlueprint?.premise || ""}
${storyBlueprint?.hook || ""}
`;

const deterministicMatches: any[] = [];

for (const existing of catalogue) {
const titleSimilarity = similarityTokens(
candidateSeries.title || "",
existing.title || ""
);

const descriptionSimilarity = similarityTokens(
candidateSeries.description || "",
existing.description || ""
);

const combinedSimilarity = similarityTokens(
candidateText,
`
${existing.title || ""}
${existing.subtitle || ""}
${existing.description || ""}
`
);

if (
titleSimilarity >= 0.75 ||
descriptionSimilarity >= 0.65 ||
combinedSimilarity >= 0.70
) {
deterministicMatches.push({
id: existing.id,
title: existing.title,
title_similarity: Number(
titleSimilarity.toFixed(3)
),
description_similarity: Number(
descriptionSimilarity.toFixed(3)
),
combined_similarity: Number(
combinedSimilarity.toFixed(3)
),
});
}
}

const sortedCatalogue = [...catalogue].sort(
(a, b) => {
const aScore = similarityTokens(
candidateText,
`${a.title} ${a.subtitle || ""} ${a.description || ""}`
);

const bScore = similarityTokens(
candidateText,
`${b.title} ${b.subtitle || ""} ${b.description || ""}`
);

return bScore - aScore;
}
);

const comparisonCandidates =
sortedCatalogue.slice(0, 20);

const catalogueContext =
comparisonCandidates
.map((series, index) => {
return `
CATALOGUE ITEM ${index + 1}

ID:
${series.id}

Title:
${series.title}

Subtitle:
${series.subtitle || ""}

Description:
${series.description || ""}

Genre ID:
${series.primary_genre_id || ""}

Mood:
${series.mood || ""}

Intensity:
${series.intensity || ""}

Origin:
${series.origin_type || ""}
`;
})
.join("\n---\n");

const candidateContext = `
CANDIDATE SERIES

ID:
${candidateSeries.id}

${buildSeriesProfile({
...candidateSeries,
...storyBlueprint,
})}

Candidate chapter number:
${output.chapter_number}

Candidate chapter title:
${output.title}

Candidate chapter content:
${cleanText(output.content).slice(0, 18000)}
`;

const prompt = `
You are TaleForge's originality and similarity-control engine.

Your job is to determine whether a proposed AI-generated web-novel
series/chapter is sufficiently distinct from the existing TaleForge
catalogue.

IMPORTANT:

This is NOT a worldwide copyright or plagiarism determination.

You must NOT claim that a story is globally unique.

You are checking for meaningful internal duplication and suspicious
conceptual similarity inside TaleForge.

Analyze:

1. Premise similarity
2. Core hook similarity
3. World concept similarity
4. Magic/technology/system similarity
5. Protagonist similarity
6. Main conflict similarity
7. Plot structure similarity
8. Character-role similarity
9. Setting similarity
10. Title similarity
11. Story progression similarity
12. Overall conceptual similarity

Do NOT flag a story merely because it shares a broad genre trope.

Examples of acceptable similarities:

- fantasy
- magic
- kingdoms
- academy
- reincarnation
- mystery
- adventure
- romance
- cultivation
- dungeon
- time travel

These are broad genres/tropes.

Flag similarity when multiple important structural elements overlap
in a way that makes two stories feel substantially alike.

For each strong match, explain WHY it is similar.

Distinguish:

LOW:
Normal genre/trope overlap.

MEDIUM:
Several meaningful similarities but clearly different overall.

HIGH:
Major premise/world/character/conflict overlap.

CRITICAL:
The candidate appears to reproduce an existing TaleForge concept
with only superficial changes.

The goal is to encourage DIFFERENT stories, not eliminate normal
genre conventions.

${candidateContext}

EXISTING TALEFORGE CATALOGUE:
${catalogueContext || "(No existing catalogue entries.)"}

Return ONLY valid JSON:

{
"decision": "passed" | "needs_revision" | "failed",
"score": 0,
"overall_similarity_level": "low" | "medium" | "high" | "critical",
"premise_originality": "string",
"hook_originality": "string",
"world_originality": "string",
"character_originality": "string",
"conflict_originality": "string",
"plot_structure_originality": "string",
"title_originality": "string",
"system_or_mechanics_originality": "string",
"strong_matches": [
{
"series_id": "string",
"series_title": "string",
"similarity_level": "low" | "medium" | "high" | "critical",
"similar_elements": [],
"explanation": "string"
}
],
"critical_issues": [],
"warnings": [],
"revision_instructions": [],
"overall_assessment": "string"
}

Scoring:

90-100:
Strongly distinct from the TaleForge catalogue.

85-89:
Acceptably distinct.

70-84:
Meaningful similarity exists and revision is recommended.

Below 70:
Too similar to existing TaleForge content.

A high or critical similarity match should normally result in
"needs_revision" or "failed".

Do not fail solely because of common genre tropes.
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
error: "Gemini originality review failed.",
details:
error instanceof Error
? error.message
: String(error),
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

const strongMatches =
Array.isArray(aiReview?.strong_matches)
? aiReview.strong_matches
: [];

const criticalIssues =
Array.isArray(aiReview?.critical_issues)
? aiReview.critical_issues
: [];

const highOrCriticalMatches =
strongMatches.filter(
(match: any) =>
match?.similarity_level === "high" ||
match?.similarity_level === "critical"
);

const deterministicHighMatches =
deterministicMatches.filter(
(match) =>
match.combined_similarity >= 0.80 ||
match.description_similarity >= 0.75 ||
match.title_similarity >= 0.85
);

const finalPassed =
aiDecision === "passed" &&
aiScore >= MIN_SCORE &&
criticalIssues.length === 0 &&
highOrCriticalMatches.length === 0 &&
deterministicHighMatches.length === 0;

const finalDecision = finalPassed
? "passed"
: aiDecision === "failed" ||
criticalIssues.length > 0 ||
highOrCriticalMatches.length > 0 ||
deterministicHighMatches.length > 0
? "failed"
: "needs_revision";

const reviewFindings = {
originality_version:
ORIGINALITY_VERSION,

catalogue_size_checked:
catalogue.length,

deterministic_matches:
deterministicMatches,

deterministic_high_matches:
deterministicHighMatches,

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
review_type: "originality",
status: finalDecision,
score: aiScore,
findings: reviewFindings,
reviewer_model: GEMINI_MODEL,
reviewer_version:
ORIGINALITY_VERSION,
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
"Originality review completed but could not be saved.",
details: reviewError.message,
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
originality_report:
reviewFindings,
})
.eq("id", outputId);

if (updateError) {
return jsonResponse(
{
success: false,
error:
"Originality review was saved, but the generation output could not be updated.",
details: updateError.message,
review_id: review.id,
output_id: outputId,
},
500
);
}

return jsonResponse({
success: true,
mode: "originality-review",
originality_version:
ORIGINALITY_VERSION,

output_id:
outputId,

review_id:
review.id,

series_id:
output.series_id,

series_title:
candidateSeries.title,

chapter_number:
output.chapter_number,

chapter_title:
output.title,

decision:
finalDecision,

score:
aiScore,

catalogue_size_checked:
catalogue.length,

deterministic_validation: {
matches_found:
deterministicMatches.length,

high_similarity_matches:
deterministicHighMatches,
},

ai_review: {
decision:
aiDecision,

score:
aiScore,

overall_similarity_level:
aiReview?.overall_similarity_level ||
"low",

premise_originality:
aiReview?.premise_originality ||
"",

hook_originality:
aiReview?.hook_originality ||
"",

world_originality:
aiReview?.world_originality ||
"",

character_originality:
aiReview?.character_originality ||
"",

conflict_originality:
aiReview?.conflict_originality ||
"",

plot_structure_originality:
aiReview?.plot_structure_originality ||
"",

title_originality:
aiReview?.title_originality ||
"",

system_or_mechanics_originality:
aiReview?.system_or_mechanics_originality ||
"",

strong_matches:
strongMatches,

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
aiReview?.overall_assessment ||
"",
},

generation_status:
output.generation_status,

published: false,

next_step:
finalDecision === "passed"
? "Run safety review next. Do not publish yet."
: finalDecision === "needs_revision"
? "Revise the chapter or series concept using the originality instructions, then run originality review again."
: "Do not publish. The candidate is too similar to existing TaleForge content and requires redesign.",
});
} catch (error) {
return jsonResponse(
{
success: false,
error:
"Unexpected originality-review error.",
details:
error instanceof Error
? error.message
: String(error),
},
500
);
}
});