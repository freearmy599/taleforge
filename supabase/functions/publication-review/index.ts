import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const corsHeaders = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers":
"authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PUBLICATION_VERSION = "publication-v1";

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

function isPassingReview(review: any): boolean {
if (!review) return false;

const status = cleanText(review.status).toLowerCase();

const score =
typeof review.score === "number"
? review.score
: 0;

return (
status === "passed" &&
score >= 85
);
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

if (!supabaseUrl || !serviceRoleKey) {
return jsonResponse(
{
success: false,
error:
"Required Supabase environment variables are missing.",
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

const body = await req.json().catch(() => ({}));

const outputId = cleanText(body?.output_id);

if (!outputId) {
return jsonResponse(
{
success: false,
error:
"output_id is required. Publication review never automatically selects an output.",
},
400
);
}

/*
* ---------------------------------------------------------
* 1. LOAD GENERATION OUTPUT
* ---------------------------------------------------------
*/

const { data: output, error: outputError } =
await supabase
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
quality_score,
quality_report,
continuity_report,
originality_report,
safety_report,
generation_status,
created_at,
updated_at
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

/*
* ---------------------------------------------------------
* 2. BASIC OUTPUT VALIDATION
* ---------------------------------------------------------
*/

const validationIssues: string[] = [];
const validationWarnings: string[] = [];

if (!cleanText(output.title)) {
validationIssues.push(
"Chapter title is missing."
);
}

if (!cleanText(output.content)) {
validationIssues.push(
"Chapter content is missing."
);
}

if (
typeof output.word_count !== "number" ||
output.word_count < 500
) {
validationIssues.push(
"Chapter word count is below the minimum publication threshold."
);
}

if (
typeof output.chapter_number !== "number" ||
output.chapter_number < 1
) {
validationIssues.push(
"Chapter number is invalid."
);
}

if (!output.series_id) {
validationIssues.push(
"Series ID is missing."
);
}

if (!output.chapter_blueprint_id) {
validationIssues.push(
"Chapter blueprint ID is missing."
);
}

if (
output.generation_status === "published"
) {
validationIssues.push(
"This generation output is already marked as published."
);
}

/*
* ---------------------------------------------------------
* 3. LOAD SERIES
* ---------------------------------------------------------
*/

const { data: series, error: seriesError } =
await supabase
.from("series")
.select(`
id,
title,
slug,
description,
status,
age_rating,
chapter_count,
ai_assisted,
ai_disclosure,
origin_type,
originality_status,
published_at
`)
.eq("id", output.series_id)
.single();

if (seriesError || !series) {
validationIssues.push(
"The parent series could not be found."
);
}

/*
* ---------------------------------------------------------
* 4. LOAD BLUEPRINT
* ---------------------------------------------------------
*/

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
target_word_count,
generation_status,
release_status
`)
.eq("id", output.chapter_blueprint_id)
.maybeSingle();

if (blueprintError) {
validationIssues.push(
"Could not load the chapter blueprint."
);
}

if (!blueprint) {
validationIssues.push(
"The chapter blueprint does not exist."
);
}

/*
* ---------------------------------------------------------
* 5. BLUEPRINT RELATIONSHIP CHECK
* ---------------------------------------------------------
*/

if (blueprint) {
if (
blueprint.series_id !==
output.series_id
) {
validationIssues.push(
"The chapter blueprint belongs to a different series."
);
}

if (
blueprint.chapter_number !==
output.chapter_number
) {
validationIssues.push(
"Chapter number does not match the blueprint."
);
}

if (
cleanText(blueprint.title) &&
cleanText(output.title) &&
cleanText(blueprint.title) !==
cleanText(output.title)
) {
validationWarnings.push(
"Chapter title differs from the blueprint title."
);
}
}

/*
* ---------------------------------------------------------
* 6. SERIES PUBLICATION CHECKS
* ---------------------------------------------------------
*/

if (series) {
const seriesStatus =
cleanText(series.status).toLowerCase();

if (
seriesStatus === "draft"
) {
validationIssues.push(
"The series is still in draft status."
);
}

if (
seriesStatus === "cancelled"
) {
validationIssues.push(
"The series has been cancelled."
);
}

if (
seriesStatus === "hiatus"
) {
validationWarnings.push(
"The series is currently on hiatus."
);
}

if (
series.origin_type ===
"ai_original" &&
!series.ai_disclosure
) {
validationWarnings.push(
"AI disclosure is not enabled for an AI-original series."
);
}

if (
series.originality_status !==
"approved" &&
series.originality_status !==
"checked"
) {
validationWarnings.push(
"Series-level originality status is not approved."
);
}
}

/*
* ---------------------------------------------------------
* 7. LOAD ALL REQUIRED REVIEWS
* ---------------------------------------------------------
*/

const { data: reviews, error: reviewsError } =
await supabase
.from("chapter_reviews")
.select(`
id,
generation_output_id,
review_type,
status,
score,
findings,
reviewer_model,
reviewer_version,
created_at,
updated_at
`)
.eq(
"generation_output_id",
outputId
);

if (reviewsError) {
return jsonResponse(
{
success: false,
error:
"Could not load chapter reviews.",
details:
reviewsError.message,
},
500
);
}

const reviewList = reviews || [];

const qualityReview =
reviewList.find(
(review) =>
review.review_type === "quality"
);

const continuityReview =
reviewList.find(
(review) =>
review.review_type === "continuity"
);

const originalityReview =
reviewList.find(
(review) =>
review.review_type === "originality"
);

const safetyReview =
reviewList.find(
(review) =>
review.review_type === "safety"
);

/*
* ---------------------------------------------------------
* 8. REQUIRED REVIEW GATE CHECK
* ---------------------------------------------------------
*/

const reviewGateResults = {
quality: {
present: !!qualityReview,
passed:
isPassingReview(qualityReview),
score:
qualityReview?.score ?? null,
status:
qualityReview?.status ?? null,
},

continuity: {
present: !!continuityReview,
passed:
isPassingReview(continuityReview),
score:
continuityReview?.score ?? null,
status:
continuityReview?.status ?? null,
},

originality: {
present: !!originalityReview,
passed:
isPassingReview(originalityReview),
score:
originalityReview?.score ?? null,
status:
originalityReview?.status ?? null,
},

safety: {
present: !!safetyReview,
passed:
isPassingReview(safetyReview),
score:
safetyReview?.score ?? null,
status:
safetyReview?.status ?? null,
},
};

if (!qualityReview) {
validationIssues.push(
"Quality review is missing."
);
}

if (!continuityReview) {
validationIssues.push(
"Continuity review is missing."
);
}

if (!originalityReview) {
validationIssues.push(
"Originality review is missing."
);
}

if (!safetyReview) {
validationIssues.push(
"Safety review is missing."
);
}

if (
qualityReview &&
!isPassingReview(qualityReview)
) {
validationIssues.push(
"Quality review has not passed."
);
}

if (
continuityReview &&
!isPassingReview(continuityReview)
) {
validationIssues.push(
"Continuity review has not passed."
);
}

if (
originalityReview &&
!isPassingReview(originalityReview)
) {
validationIssues.push(
"Originality review has not passed."
);
}

if (
safetyReview &&
!isPassingReview(safetyReview)
) {
validationIssues.push(
"Safety review has not passed."
);
}

/*
* ---------------------------------------------------------
* 9. DUPLICATE CHAPTER CHECK
* ---------------------------------------------------------
*/

if (series) {
const { data: existingChapter } =
await supabase
.from("chapters")
.select(`
id,
series_id,
chapter_number,
title,
status
`)
.eq(
"series_id",
output.series_id
)
.eq(
"chapter_number",
output.chapter_number
)
.maybeSingle();

if (existingChapter) {
validationIssues.push(
`Chapter ${output.chapter_number} already exists in the series.`
);
}
}

/*
* ---------------------------------------------------------
* 10. GENERATION OUTPUT STATUS CHECK
* ---------------------------------------------------------
*/

if (
output.generation_status ===
"rejected"
) {
validationIssues.push(
"The generation output is marked as rejected."
);
}

/*
* ---------------------------------------------------------
* 11. FINAL PUBLICATION DECISION
* ---------------------------------------------------------
*/

const eligible =
validationIssues.length === 0 &&
reviewGateResults.quality.passed &&
reviewGateResults.continuity.passed &&
reviewGateResults.originality.passed &&
reviewGateResults.safety.passed;

const decision = eligible
? "approved"
: "rejected";

/*
* ---------------------------------------------------------
* 12. SAVE PUBLICATION REVIEW
* ---------------------------------------------------------
*/

const publicationReviewPayload = {
generation_output_id:
outputId,

decision,

quality_passed:
reviewGateResults.quality.passed,

continuity_passed:
reviewGateResults.continuity.passed,

originality_passed:
reviewGateResults.originality.passed,

safety_passed:
reviewGateResults.safety.passed,

reviewer_notes: JSON.stringify(
{
publication_version:
PUBLICATION_VERSION,

eligible,

validation_issues:
validationIssues,

validation_warnings:
validationWarnings,

review_gate_results:
reviewGateResults,

reviewed_at:
new Date().toISOString(),
},
null,
2
),

decided_at:
new Date().toISOString(),
};

const { data: publicationReview, error: publicationError } =
await supabase
.from(
"chapter_publication_reviews"
)
.upsert(
publicationReviewPayload,
{
onConflict:
"generation_output_id",
}
)
.select()
.single();

if (publicationError) {
return jsonResponse(
{
success: false,
error:
"Publication review could not be saved.",
details:
publicationError.message,
output_id:
outputId,
},
500
);
}

/*
* ---------------------------------------------------------
* 13. UPDATE GENERATION OUTPUT
*
* IMPORTANT:
* This does NOT publish the chapter.
* It only marks the generation output as approved/rejected.
* ---------------------------------------------------------
*/

const newGenerationStatus =
eligible
? "approved"
: "rejected";

const { error: outputUpdateError } =
await supabase
.from(
"chapter_generation_outputs"
)
.update({
generation_status:
newGenerationStatus,
})
.eq(
"id",
outputId
);

if (outputUpdateError) {
return jsonResponse(
{
success: false,
error:
"Publication review was saved, but the generation output status could not be updated.",
details:
outputUpdateError.message,
publication_review_id:
publicationReview.id,
output_id:
outputId,
},
500
);
}

/*
* ---------------------------------------------------------
* 14. FINAL RESPONSE
* ---------------------------------------------------------
*/

return jsonResponse({
success: true,

mode:
"publication-review",

publication_version:
PUBLICATION_VERSION,

output_id:
outputId,

publication_review_id:
publicationReview.id,

series_id:
output.series_id,

series_title:
series?.title || null,

chapter_number:
output.chapter_number,

chapter_title:
output.title,

decision,

eligible,

published:
false,

review_gates:
reviewGateResults,

validation: {
issues:
validationIssues,

warnings:
validationWarnings,

passed:
validationIssues.length === 0,
},

generation_status:
newGenerationStatus,

next_step:
eligible
? "Chapter is approved for publication. Do not publish until the release scheduler or explicit publication action runs."
: "Chapter is not eligible for publication. Resolve the failed checks and run publication review again.",
});
} catch (error) {
return jsonResponse(
{
success: false,
error:
"Unexpected publication-review error.",
details:
error instanceof Error
? error.message
: String(error),
},
500
);
}
});