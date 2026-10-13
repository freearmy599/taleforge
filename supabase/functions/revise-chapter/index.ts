import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers":
"authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODEL = "gemini-3.5-flash-lite";
const REVISION_VERSION = "revision-v12-redacted-fail-closed-cooldown";


const MAX_REVISION_ATTEMPTS = 3;

function boundsForTarget(target: number) {
const advisory = Math.max(2000, Math.round(Number(target) || 3000));
return { target: advisory, minimum: 2000 };
}

function jsonResponse(
body: Record<string, unknown>,
status = 200
) {
return new Response(
JSON.stringify(body, null, 2),
{
status,
headers: {
...corsHeaders,
"Content-Type": "application/json",
},
}
);
}

function countWords(text: string): number {
return text
.trim()
.split(/\s+/)
.filter(Boolean)
.length;
}

function normalizeText(text: string): string {
return text
.toLowerCase()
.replace(/\s+/g, " ")
.trim();
}

function cleanGeminiOutput(text: string): string {
let cleaned = text.trim();

/*
* Remove accidental Markdown fences.
*/
cleaned = cleaned
.replace(/^```(?:text|markdown)?\s*/i, "")
.replace(/\s*```$/i, "")
.trim();

/*
* If Gemini accidentally returns:
*
* {"content":"..."}
*
* extract the actual chapter.
*/
try {
const parsed = JSON.parse(cleaned);

if (
parsed &&
typeof parsed === "object" &&
typeof parsed.content === "string"
) {
cleaned = parsed.content.trim();
}
} catch {
// Normal prose. Nothing to do.
}

return cleaned;
}

function findArtifacts(content: string) {
const findings: string[] = [];

const patterns = [
["world reveal", /\bworld reveal\s*:/i],
["character development", /\bcharacter development\s*:/i],
["plot event", /\bplot event\s*:/i],
["chapter blueprint", /\bchapter blueprint\s*:/i],
["story blueprint", /\bstory blueprint\s*:/i],
["continuity requirement", /\bcontinuity requirement\s*:/i],
["previous chapter dependencies", /\bprevious chapter dependencies\s*:/i],
["target word count", /\btarget word count\s*:/i],
["generation note", /\bgeneration note\s*:/i],
["AI reference", /\bas an ai\b/i],
["author instruction", /\bthe author should\b/i],
["reader instruction", /\bthe reader should\b/i],
["analysis marker", /\banalysis\s*:/i],
["final answer marker", /\bfinal answer\s*:/i],
["assistant marker", /\bassistant\s*:/i],
["system marker", /\bsystem\s*:/i],
["developer marker", /\bdeveloper\s*:/i],
["prompt marker", /\bprompt\s*:/i],
["instructions marker", /\binstructions\s*:/i],
["revision marker", /\brevision\s*:/i],
];

for (const [label, regex] of patterns) {
if ((regex as RegExp).test(content)) {
findings.push(
`Generation artifact detected: ${label}.`
);
}
}

return findings;
}

function findCorruption(content: string) {
const findings: string[] = [];

if (
/\b([A-Za-z]{3,})\s+\1\s+\1\b/i.test(
content
)
) {
findings.push(
"Repeated-word corruption detected."
);
}

if (/[!?.,]{5,}/.test(content)) {
findings.push(
"Repeated punctuation artifact detected."
);
}

/*
* Detect glued chapter/story words, but only when
* they actually occur inside a larger token.
*/
const gluedPattern =
/\b[A-Za-z]{1,3}(?:The|Chapter|Story)[A-Za-z]{1,20}\b/;

const gluedMatch =
content.match(gluedPattern);

if (gluedMatch) {
findings.push(
`Suspicious concatenated text detected: "${gluedMatch[0]}".`
);
}

return findings;
}

function validateRevision(content: string, title: string, revisionMinimum: number, revisionTarget: number) {
const issues: string[] = [];
const warnings: string[] = [];

const wordCount =
countWords(content);

if (wordCount < 500) {
issues.push(
`Revision is critically short at ${wordCount} words.`
);
}

if (
wordCount < revisionMinimum
) {
issues.push(
`Revision is below the production minimum: ${wordCount} words versus minimum ${revisionMinimum}.`
);
}



if (
wordCount >= revisionMinimum &&
wordCount < revisionTarget
) {
warnings.push(
`Revision is below the exact target: ${wordCount} words versus target ${revisionTarget}.`
);
}

issues.push(
...findArtifacts(content)
);

issues.push(
...findCorruption(content)
);

const normalizedTitle =
normalizeText(title);

const normalizedContent =
normalizeText(content);

if (
normalizedTitle.length > 5
) {
const occurrences =
normalizedContent
.split(normalizedTitle)
.length - 1;

if (occurrences >= 3) {
warnings.push("Chapter title appears multiple times inside the chapter; review for formatting artifacts.");
}

const finalSection =
normalizedContent.slice(
Math.max(
0,
normalizedContent.length - 500
)
);

if (
finalSection.includes(
normalizedTitle
)
) {
warnings.push("Chapter title appears near the end of the chapter; review for formatting artifacts.");
}
}

if (!content.trim()) {
issues.push(
"Revision returned empty content."
);
}

/*
* Check final punctuation.
*/
const trimmed =
content.trim();

if (trimmed.length > 0) {
const lastCharacter =
trimmed[trimmed.length - 1];

const validEndings = [
".",
"!",
"?",
"\"",
"'",
"”",
"’",
];

if (
!validEndings.includes(
lastCharacter
)
) {
issues.push(
"Chapter appears to end without completed punctuation."
);
}
}

return {
passed:
issues.length === 0,
wordCount,
targetWordCount:
revisionTarget,
minimumWordCount:
revisionMinimum,
maximumWordCount: null,
issues,
warnings,
};
}

async function callGemini(
apiKey: string,
prompt: string,
temperature = 0.40
) {
const endpoint =
`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

const response =
await fetch(
endpoint,
{
method: "POST",
headers: {
"Content-Type":
"application/json",
},
body: JSON.stringify({
contents: [
{
parts: [
{
text: prompt,
},
],
},
],
generationConfig: {
temperature,
maxOutputTokens: 16000,
},
}),
}
);

const responseText = await response.text();

if (!response.ok) {
throw new Error(`Gemini HTTP ${response.status}${response.status === 429 ? " RESOURCE_EXHAUSTED" : ""}`);
}

let data: any;
try {
data = JSON.parse(responseText);
} catch {
throw new Error("Gemini returned an unreadable response.");
}

const generatedText =
data?.candidates?.[0]?.content?.parts
?.map(
(part: any) =>
part?.text || ""
)
.join("")
.trim();

if (!generatedText) {
throw new Error(
"Gemini returned an empty response."
);
}

return generatedText;
}

async function recordGeminiThrottle(supabase: any, error: unknown) {
const message = error instanceof Error ? error.message : String(error);
if (!message.includes("Gemini HTTP 429") && !message.includes("RESOURCE_EXHAUSTED")) return null;
try {
const { data, error: stateError } = await supabase.from("taleforge_ai_provider_state")
.select("cooldown_until,consecutive_throttle_count").eq("provider","gemini").maybeSingle();
if (stateError || !data) {
console.error("[revise-chapter] Gemini cooldown state unavailable; cooldown persistence was skipped.");
return null;
}
const priorCount = Number(data.consecutive_throttle_count ?? 0);
const count = (Number.isFinite(priorCount) && priorCount >= 0 ? Math.floor(priorCount) : 0) + 1;
const cooldownHours = Math.min(24, 6 * Math.pow(2, Math.min(count - 1, 2)));
const now = Date.now();
const proposedUntil = now + cooldownHours * 60 * 60 * 1000;
const existingUntil = data.cooldown_until ? Date.parse(data.cooldown_until) : 0;
if (data.cooldown_until && !Number.isFinite(existingUntil)) {
console.error("[revise-chapter] Existing Gemini cooldown timestamp is malformed; existing state was preserved.");
return null;
}
const until = new Date(Math.max(proposedUntil, existingUntil)).toISOString();
const { error: writeError } = await supabase.from("taleforge_ai_provider_state").upsert({
provider: "gemini", cooldown_until: until, consecutive_throttle_count: count,
last_error: "Gemini quota or rate-limit response", last_error_at: new Date().toISOString(), updated_at: new Date().toISOString()
}, { onConflict: "provider" });
if (writeError) {
console.error("[revise-chapter] Gemini cooldown could not be persisted.");
return null;
}
return { cooldown_until: until, cooldown_hours: Math.max(0, (Date.parse(until) - now) / 3600000), consecutive_throttle_count: count };
} catch {
console.error("[revise-chapter] Gemini cooldown persistence failed unexpectedly.");
return null;
}
}

Deno.serve(async (req) => {

if (req.method === "OPTIONS") {
return new Response(
"ok",
{
headers:
corsHeaders,
}
);
}

if (req.method !== "POST") {
return jsonResponse(
{
success: false,
error:
"Only POST requests are supported.",
},
405
);
}

try {

const supabaseUrl =
Deno.env.get(
"SUPABASE_URL"
);

const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY");

const geminiApiKey =
Deno.env.get(
"GEMINI_API_KEY"
);

if (!supabaseUrl) {
throw new Error(
"SUPABASE_URL secret is missing."
);
}

if (!serviceRoleKey) {
throw new Error(
"TALEFORGE_SERVICE_ROLE_KEY secret is missing."
);
}

if (!geminiApiKey) {
throw new Error(
"GEMINI_API_KEY secret is missing."
);
}

if (!isTrustedInternalApiKey(req.headers.get("apikey"), serviceRoleKey, Deno.env.get("SUPABASE_SECRET_KEYS"), Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) {
return jsonResponse({ success: false, error: "Caller must authenticate with a configured server-side Supabase API key." }, 401);
}

const supabase =
createClient(
supabaseUrl,
serviceRoleKey
);
const providerStateResult = await supabase
.from("taleforge_ai_provider_state")
.select("cooldown_until,consecutive_throttle_count")
.eq("provider", "gemini")
.maybeSingle();
if (providerStateResult.error || !providerStateResult.data) {
console.error("[revise-chapter] Gemini provider state unavailable; failing closed.");
return jsonResponse({ success: false, blocked: true, retryable: true, reason: "provider_state_unavailable", note: "Revision blocked because Gemini cooldown state could not be verified; no model call was made." }, 503);
}
const cooldownUntil = providerStateResult.data.cooldown_until ? Date.parse(providerStateResult.data.cooldown_until) : null;
if (providerStateResult.data.cooldown_until && (cooldownUntil === null || !Number.isFinite(cooldownUntil))) {
console.error("[revise-chapter] Gemini cooldown timestamp is malformed; failing closed.");
return jsonResponse({ success: false, blocked: true, retryable: true, reason: "invalid_cooldown_timestamp", note: "Revision blocked because Gemini cooldown state is malformed; no model call was made." }, 503);
}
if (cooldownUntil !== null && cooldownUntil > Date.now()) {
return jsonResponse({ success: false, blocked: true, retryable: true, reason: "provider_cooldown", cooldown_until: providerStateResult.data.cooldown_until, consecutive_throttle_count: providerStateResult.data.consecutive_throttle_count, note: "Revision skipped while Gemini cooldown is active; no model call was made." }, 503);
}


let body: any;
try {
body = await req.json();
} catch {
return jsonResponse({ success: false, error: "Request body must be valid JSON." }, 400);
}

const governance = await supabase.rpc("taleforge_ceo_execution_gate", { p_action_scope: "revision" });
if (governance.error || governance.data?.authorized !== true) {
return jsonResponse({
success: false,
error: "Revision blocked by Clara Aurel governance gate.",
governance: { authorized: governance.data?.authorized === true },
details: governance.error ? "Internal governance diagnostics were withheld." : null,
}, 423);
}

const outputId = body?.output_id;
const requestedRevisionPriority = Number(body?.revision_priority ?? 0);
const requestedRevisionTargets = Array.isArray(body?.revision_targets) ? body.revision_targets : [];
const requestedRevisionStrategy = String(body?.revision_strategy ?? body?.revisionStrategy ?? '');

if (!outputId) {
return jsonResponse(
{
success: false,
error:
"An explicit output_id is required.",
},
400
);
}

/*
* Load the exact output.
*/
const {
data: originalOutput,
error: outputError,
} =
await supabase
.from(
"chapter_generation_outputs"
)
.select("*")
.eq(
"id",
outputId
)
.single();

if (outputError) {
throw new Error(
`Could not load generation output: ${outputError.message}`
);
}

if (!originalOutput) {
throw new Error(
"Generation output was not found."
);
}

if (
originalOutput.generation_status ===
"published"
) {
return jsonResponse(
{
success: false,
error:
"Published outputs cannot be revised.",
},
400
);
}

/*
* Load chapter blueprint.
*/
const {
data: blueprint,
error: blueprintError,
} =
await supabase
.from(
"chapter_blueprints"
)
.select("*")
.eq(
"id",
originalOutput.chapter_blueprint_id
)
.single();

if (blueprintError) {
throw new Error(`Could not load chapter blueprint: ${blueprintError.message}`);
}

const dynamicBounds = boundsForTarget(blueprint?.target_word_count);
const revisionTarget = dynamicBounds.target;
const revisionMinimum = dynamicBounds.minimum;

const { data: advancedChapterPlan, error: advancedChapterPlanError } = await supabase
.from("taleforge_advanced_chapter_plans")
.select("*")
.eq("chapter_blueprint_id", originalOutput.chapter_blueprint_id)
.eq("status", "active")
.order("version", { ascending: false })
.limit(1)
.maybeSingle();
if (advancedChapterPlanError) {
throw new Error(`Could not load advanced chapter plan: ${advancedChapterPlanError.message}`);
}

/*
* Load series.
*/
const {
data: series,
error: seriesError,
} =
await supabase
.from("series")
.select("*")
.eq(
"id",
originalOutput.series_id
)
.single();

if (seriesError) {
throw new Error(
`Could not load series: ${seriesError.message}`
);
}

/*
* Load latest quality review.
*/
const {
data: qualityReview
} =
await supabase
.from(
"chapter_reviews"
)
.select("*")
.eq(
"generation_output_id",
outputId
)
.eq(
"review_type",
"quality"
)
.order(
"created_at",
{
ascending: false,
}
)
.limit(1)
.maybeSingle();

const reviewFindings =
qualityReview?.findings ||
{};

/*
* Keep the original quality-review context,
* but the actual chapter being revised will
* change after every internal attempt.
*/
const hardValidation =
reviewFindings?.hard_validation ||
{};

const aiReview =
reviewFindings?.ai_review ||
{};

const criticalIssues =
reviewFindings?.critical_issues ||
[];

const strategyInstructions: Record<string,string> = {
targeted_semantic: "Target only the semantic chapter-plan failures and preserve healthy material.",
quality_repair: "Repair the weakest quality dimensions with the smallest necessary changes.",
continuity_repair: "Prioritize canon, character, relationship, world-state, and causal continuity.",
originality_repair: "Remove repetitive or derivative passages while preserving canon and chapter objectives.",
safety_repair: "Repair safety-related blockers while preserving intended story function and canon.",
hard_validation_repair: "Correct hard validation failures while preserving narrative substance.",
hook_pacing_repair: "Improve pacing and the ending hook while preserving required events and continuity.",
plot_progression_repair: "Ensure meaningful plot-thread advancement, escalation, dependency movement, or payoff without filler.",
structural_rewrite: "Perform a broader structural rewrite because multiple narrative dimensions are weak.",
full_rewrite: "Rebuild the chapter from the execution plan while preserving canon and story identity."
};
const selectedStrategyInstruction = (typeof body?.revision_strategy === "string" ? body.revision_strategy : "") && strategyInstructions[(typeof body?.revision_strategy === "string" ? body.revision_strategy : "")]
? strategyInstructions[(typeof body?.revision_strategy === "string" ? body.revision_strategy : "")]
: "";
const revisionInstructions =
reviewFindings?.revision_instructions ||
[];
const strategyContext = selectedStrategyInstruction
? `SELECTED REVISION STRATEGY: ${(typeof body?.revision_strategy === "string" ? body.revision_strategy : "")}
PRIORITY: ${requestedRevisionPriority}
TARGET FAILURES: ${JSON.stringify(requestedRevisionTargets)}
STRATEGY DIRECTIVE: ${selectedStrategyInstruction}`
: "";

/*
* THIS IS THE IMPORTANT FIX:
*
* currentContent changes after every Gemini
* attempt.
*
* Attempt 2 receives attempt 1.
* Attempt 3 receives attempt 2.
*/
let currentContent =
originalOutput.content || "";

let currentValidation =
validateRevision(currentContent, originalOutput.title, revisionMinimum, revisionTarget);

let attemptsUsed = 0;

const attemptReports: any[] = [];

for (
let attempt = 1;
attempt <= MAX_REVISION_ATTEMPTS;
attempt++
) {

attemptsUsed = attempt;

const currentWordCount =
countWords(
currentContent
);

const remainingWords =
Math.max(
0,
revisionTarget -
currentWordCount
);

const minimumAdditionalWords =
Math.max(
0,
revisionMinimum -
currentWordCount
);

let expansionMode =
"full revision";

if (
currentWordCount <
revisionMinimum
) {
expansionMode =
"mandatory narrative expansion";
}

const prompt = `
You are TaleForge's professional serialized-fiction revision engine.\n\nCRITICAL PRODUCTION LENGTH REQUIREMENT:\n- The revised chapter MUST contain at least 2000 words after generation and should target the supplied revisionTarget, preferably reaching at least 90% of that target.\n- Never return a short summary, outline, abridgement, excerpt, or partial revision. Return the COMPLETE chapter as polished prose.\n- Preserve the original chapter's plot and required beats while expanding scenes, dialogue, sensory detail, character reactions, transitions, and consequences when needed to reach the required length naturally.

ADVANCED CHAPTER PLAN:
${JSON.stringify(advancedChapterPlan)}

SEMANTIC EXECUTION REQUIREMENT:
- Treat the latest quality review's semantic_plan_alignment findings as production requirements, not optional suggestions.
- Treat the Advanced Chapter Plan above as the chapter's canonical execution architecture.
- Repair unmet causal objectives, character/relationship/world/thread objectives, dependency-chain breaks, missing escalation, missing payoff progression, weak ending awareness, weak hook execution, and padding identified by the review.
- Preserve established canon and do not invent unsupported facts merely to satisfy a plan.
- The revision must improve the chapter's narrative function, not merely add words.
- Repair unmet causal objectives, character/relationship/world/thread objectives, dependency-chain breaks, missing escalation, missing payoff progression, weak ending awareness, weak hook execution, and padding identified by the review.
- Preserve established canon and do not invent unsupported facts merely to satisfy a plan.
- The revision must improve the chapter's narrative function, not merely add words.\n- Before returning, internally verify that the complete prose is at least 2000 words. If it is shorter, continue writing until it meets the minimum.

You are revising an EXISTING chapter.

Do not restart the story.

SEMANTIC EXECUTION REQUIREMENT:
Use the quality review's semantic_plan_alignment findings as revision requirements. Repair unmet or weak causal, character, relationship, world-state, thread, dependency-chain, escalation, payoff, ending-awareness, hook-strategy, and anti-padding requirements when the evidence supports them. Preserve canonical facts; do not invent missing canon merely to satisfy a plan. The goal is semantic execution of the existing Advanced Chapter Plan, not literal copying of plan language.

Do not create a different plot.

Do not replace the established story with a new one.

CURRENT SERIES:
${series?.title || "Unknown"}

CHAPTER NUMBER:
${originalOutput.chapter_number}

CHAPTER TITLE:
${originalOutput.title}

TARGET:
${revisionTarget} words

HARD MINIMUM:
${revisionMinimum} words

MAXIMUM:
${revisionTarget} words

CURRENT VERSION WORD COUNT:
${currentWordCount}

WORDS STILL NEEDED TO REACH TARGET:
${remainingWords}

MINIMUM ADDITIONAL WORDS REQUIRED:
${minimumAdditionalWords}

THIS IS INTERNAL REVISION ATTEMPT:
${attempt} of ${MAX_REVISION_ATTEMPTS}

REVISION MODE:
${expansionMode}

IMPORTANT:

The current chapter is the source of truth for this revision attempt.

Preserve its existing:
- characters
- motivations
- plot events
- discoveries
- clues
- setting
- world rules
- continuity
- narrative viewpoint
- tone
- ending direction

Improve it by developing the existing scenes.

If the chapter is below ${revisionMinimum} words, you MUST expand it substantially.

Do not simply rewrite the same number of words.

Add meaningful narrative material such as:
- complete scenes
- character interaction
- investigation
- consequences
- sensory detail
- environmental detail
- meaningful dialogue
- internal reactions
- worldbuilding revealed naturally through action
- tension and suspense
- transitions between scenes

Do NOT add filler.

Do NOT repeat the same information.

Do NOT artificially repeat descriptions.

Do NOT inflate the chapter with empty dialogue.

The final chapter MUST be at least ${revisionMinimum} words.

Aim for approximately ${revisionTarget} words.

Do not stop early.

Do not mention word counts inside the story.

Do not mention this revision process.

Do not mention AI.

Do not mention prompts, blueprints, reviewers, validators, or instructions.

Do not use headings such as:
World Reveal
Character Development
Plot Event
Chapter Blueprint
Revision
Analysis
Final Answer

Output ONLY the finished chapter prose.

No JSON.

No Markdown code fences.

CHAPTER BLUEPRINT:
${JSON.stringify(
blueprint || {},
null,
2
)}

ORIGINAL QUALITY REVIEW CONTEXT:
${JSON.stringify(
aiReview || {},
null,
2
)}

QUALITY ISSUES:
${JSON.stringify(
criticalIssues,
null,
2
)}

REVISION INSTRUCTIONS:
${JSON.stringify(
revisionInstructions,
null,
2
)}

SELECTED REVISION STRATEGY CONTEXT:
${strategyContext}

PREVIOUS HARD VALIDATION:
${JSON.stringify(
hardValidation,
null,
2
)}

CURRENT CHAPTER VERSION TO REVISE:
${currentContent}
`;

let rawResponse: string;
try {
rawResponse = await callGemini(geminiApiKey, prompt, attempt === 1 ? 0.42 : 0.38);
} catch (providerError) {
const cooldown = await recordGeminiThrottle(supabase, providerError);
const providerMessage = providerError instanceof Error ? providerError.message : "";
if (providerMessage.includes("Gemini HTTP 429") || providerMessage.includes("RESOURCE_EXHAUSTED")) {
return jsonResponse({ success: false, blocked: true, retryable: true, reason: "provider_quota_blocked", cooldown_until: cooldown?.cooldown_until ?? providerStateResult.data.cooldown_until ?? null, error: "Revision paused because Gemini quota or rate limits were reached." }, 429);
}
throw providerError;
}

let revisedContent = cleanGeminiOutput(rawResponse);

const normalizedBeforeRevision = normalizeText(currentContent);
const normalizedAfterRevision = normalizeText(revisedContent);
if (normalizedAfterRevision === normalizedBeforeRevision) {
attemptReports.push({
attempt,
input_word_count: currentWordCount,
output_word_count: countWords(revisedContent),
passed: false,
issues: ["Revision produced no meaningful content change from its input."],
warnings: [],
});
currentValidation = {
passed: false,
wordCount: countWords(revisedContent),
targetWordCount: revisionTarget,
minimumWordCount: revisionMinimum,
maximumWordCount: null,
issues: ["Revision produced no meaningful content change from its input."],
warnings: [],
};
currentContent = revisedContent;
continue;
}

for (let continuationAttempt = 1; continuationAttempt <= 2 && countWords(revisedContent) < revisionMinimum; continuationAttempt++) {
const remaining = revisionMinimum - countWords(revisedContent);
const continuationPrompt =
"Continue this chapter from the exact end. Return ONLY new polished story prose. Do not summarize, restart, explain, add headings, or repeat earlier text. Add at least " +
Math.max(900, remaining + 250) +
" words so the combined chapter reaches at least " +
revisionMinimum +
" words.\\n\\nCURRENT CHAPTER:\\n" +
revisedContent;
const continuation = cleanGeminiOutput(
await callGemini(geminiApiKey, continuationPrompt, 0.36)
);
if (!continuation || normalizeText(continuation) === normalizeText(revisedContent)) break;
revisedContent = revisedContent.trim() + "\\n\\n" + continuation.trim();
}

const validation =
validateRevision(revisedContent, originalOutput.title, revisionMinimum, revisionTarget);

attemptReports.push({
attempt,
input_word_count:
currentWordCount,
output_word_count:
validation.wordCount,
passed:
validation.passed,
issues:
validation.issues,
warnings:
validation.warnings,
});

/*
* IMPORTANT:
*
* Even when the attempt fails, it becomes
* the source for the next attempt.
*/
currentContent =
revisedContent;

currentValidation =
validation;

/*
* Stop immediately once the revision satisfies
* all deterministic production requirements.
*/
if (
validation.passed
) {
break;
}
}

/*
* If the final attempt still fails,
* do NOT insert it into the database.
*/
if (
!currentValidation.passed
) {

return jsonResponse({
success: false,

mode:
"chapter-revision",

status:
"revision_failed_validation",

original_output_id:
outputId,

series_id:
originalOutput.series_id,

chapter_number:
originalOutput.chapter_number,

chapter_title:
originalOutput.title,

attempts_used:
attemptsUsed,

original_word_count:
countWords(
originalOutput.content ||
""
),

final_attempt_word_count:
currentValidation.wordCount,

target_word_count:
revisionTarget,

minimum_word_count:
revisionMinimum,

maximum_word_count: null,

validation:
currentValidation,

attempt_reports:
attemptReports,

published:
false,

next_step:
"Do not publish. The accumulated revision attempts still failed deterministic validation.",
}, 422);
}

/*
* A valid revision now exists.
*
* Save it as a NEW output.
*/
const originalAttempt =
Number(
originalOutput.generation_attempt ||
1
);

const newAttempt =
originalAttempt + 1;

const {
data: revisedOutput,
error: insertError,
} =
await supabase
.from(
"chapter_generation_outputs"
)
.insert({
series_id:
originalOutput.series_id,

chapter_blueprint_id:
originalOutput.chapter_blueprint_id,

generation_job_id:
originalOutput.generation_job_id,

chapter_number:
originalOutput.chapter_number,

title:
originalOutput.title,

content:
currentContent,

word_count:
currentValidation.wordCount,

generation_model:
GEMINI_MODEL,

generation_prompt_version:
REVISION_VERSION,

generation_attempt:
newAttempt,

quality_score:
null,

quality_report:
null,

continuity_report:
null,

originality_report:
null,

safety_report:
null,

generation_status:
"generated",

revision_of_output_id:
outputId,
})
.select()
.single();

if (insertError) {
throw new Error(
`Could not save revised output: ${insertError.message}`
);
}

/*
* Mark the previous output as needing revision.
*/
await supabase
.from(
"chapter_generation_outputs"
)
.update({
generation_status:
"needs_revision",
})
.eq(
"id",
outputId
);

/*
* Keep blueprint out of published state.
*/
await supabase
.from(
"chapter_blueprints"
)
.update({
generation_status:
"generated",
})
.eq(
"id",
originalOutput.chapter_blueprint_id
);


const reviewHandoff = { attempted: true, ok: false, status: 0, result: null as unknown };
try {
const reviewHandoffResponse = await fetch(`${supabaseUrl}/functions/v1/review-orchestrator`, {
method: "POST",
headers: {
"Content-Type": "application/json",
Authorization: `Bearer ${serviceRoleKey}`,
apikey: serviceRoleKey,
},
body: JSON.stringify({ output_id: revisedOutput.id, dry_run: false }),
});
const reviewHandoffText = await reviewHandoffResponse.text();
let parsedHandoff: any = null;
try { parsedHandoff = JSON.parse(reviewHandoffText); } catch { /* response details intentionally discarded */ }
reviewHandoff.ok = reviewHandoffResponse.ok;
reviewHandoff.status = reviewHandoffResponse.status;
reviewHandoff.result = { success: parsedHandoff?.success === true };
} catch {
reviewHandoff.result = { success: false, error: "Review handoff failed; internal diagnostics were withheld." };
}
return jsonResponse({
success: true,

mode:
"chapter-revision",

status:
"generated",

original_output_id:
outputId,

revised_output_id:
revisedOutput.id,

series_id:
originalOutput.series_id,

chapter_number:
originalOutput.chapter_number,

chapter_title:
originalOutput.title,

original_word_count:
countWords(
originalOutput.content ||
""
),

revised_word_count:
currentValidation.wordCount,

target_word_count:
revisionTarget,

minimum_word_count:
revisionMinimum,

maximum_word_count: null,

revision_attempts_used:
attemptsUsed,

revision_version:
REVISION_VERSION,

validation:
currentValidation,

attempt_reports:
attemptReports,

published:
false,

review_handoff: reviewHandoff,
next_step:
"Run deterministic quality validation on the revised output.",
});

} catch (error) {

console.error("[revise-chapter] revision failed; internal diagnostics were withheld.", JSON.stringify({ error_name: error instanceof Error ? error.name : "UnknownError" }));

return jsonResponse({
success: false,
error: "Revision failed; internal diagnostics were withheld.",
revision_version: REVISION_VERSION,
}, 500);
}
});