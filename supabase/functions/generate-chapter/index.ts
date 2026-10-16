import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
import { isAutomationReady } from "../release-scheduler/readiness.ts";

const MODEL="gemini-3.5-flash-lite";
const QUALITY_VERSION="quality-v8-short-overload-cooldown";
const TARGET=3000, MINIMUM=2000;
function boundsForTarget(target:number){const advisory=Math.max(2000,Math.round(Number(target)||TARGET));return {target:advisory,minimum:2000};}
const headers={
"Access-Control-Allow-Origin":"*",
"Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods":"POST, OPTIONS",
"Content-Type":"application/json"
};
function reply(body:unknown,status=200){return new Response(JSON.stringify(body,null,2),{status,headers});}
function words(t:string){return t.trim()?t.trim().split(/\s+/).filter(Boolean).length:0;}
async function gemini(key:string,prompt:string,json=false){
const u=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`;
const r=await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
contents:[{parts:[{text:prompt}]}],
generationConfig:{temperature:json?.2:.8,maxOutputTokens:json?8000:9000,...(json?{responseMimeType:"application/json"}:{})}
})});
const raw=await r.text();
if(!r.ok){
 // Provider bodies can contain request metadata; retain only status for safe diagnostics.
 throw new Error(`Gemini HTTP ${r.status}${r.status===429?" RESOURCE_EXHAUSTED":""}`);
}
const d=JSON.parse(raw),t=d?.candidates?.[0]?.content?.parts?.map((p:any)=>p?.text||"").join("").trim();
if(!t)throw new Error("Gemini returned no text.");
return t;
}
function parseJson(t:string){return JSON.parse(t.replace(/^\s*```json\s*/i,"").replace(/\s*```\s*$/i,"").trim());}

Deno.serve(async(req)=>{
if(req.method==="OPTIONS")return new Response("ok",{headers});
if(req.method!=="POST")return reply({success:false,error:"Only POST requests are supported."},405);
let db:any=null;
try{
const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY"),gkey=Deno.env.get("GEMINI_API_KEY");
if(!url||!key||!gkey){console.error("[generate-chapter] configuration missing",JSON.stringify({missing:[...(!url?["SUPABASE_URL"]:[]),...(!key?["SUPABASE_SERVICE_ROLE_KEY or TALEFORGE_SERVICE_ROLE_KEY"]:[]),...(!gkey?["GEMINI_API_KEY"]:[])]}));return reply({success:false,error:"Required server configuration is missing."},500);}
if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES")))return reply({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."},401);
const body=await req.json().catch(()=>({}));
const blueprintId=body?.blueprint_id,outputId=body?.output_id;
db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

const governance=await db.rpc("taleforge_ceo_execution_gate",{p_action_scope:"generation"});
if(governance.error||governance.data?.authorized!==true){
 return reply({success:false,error:"Generation blocked by Clara Aurel governance gate.",governance:{authorized:governance.data?.authorized===true},details:governance.error?"Internal governance diagnostics were withheld.":null},423);
}

{
 const {data:providerState,error:providerStateError}=await db.from("taleforge_ai_provider_state").select("cooldown_until,consecutive_throttle_count").eq("provider","gemini").maybeSingle();
 if(providerStateError||!providerState){
  console.error("[generate-chapter] provider cooldown lookup failed; failing closed.");
  return reply({success:false,retryable:true,reason:"provider_state_unavailable",error:"Gemini cooldown state could not be verified; generation was blocked to protect quota."},503);
 }else if(typeof providerState.consecutive_throttle_count!=="number"||!Number.isSafeInteger(providerState.consecutive_throttle_count)||providerState.consecutive_throttle_count<0){
  console.error("[generate-chapter] provider throttle counter is malformed; failing closed.");
  return reply({success:false,retryable:true,reason:"provider_state_unavailable",error:"Gemini provider state is malformed; generation was blocked to protect quota."},503);
 }else if(providerState.cooldown_until && !Number.isFinite(new Date(providerState.cooldown_until).getTime())){
  console.error("[generate-chapter] provider cooldown timestamp is invalid; failing closed",String(providerState.cooldown_until));
  return reply({success:false,retryable:true,reason:"provider_state_unavailable",error:"Gemini cooldown state is malformed; generation was blocked to protect quota."},503);
 }else if(providerState.cooldown_until && new Date(providerState.cooldown_until).getTime()>Date.now()){
  console.warn("[generate-chapter] generation skipped due to active provider cooldown",JSON.stringify({cooldown_until:providerState.cooldown_until,consecutive_throttle_count:providerState.consecutive_throttle_count}));
  return reply({success:false,retryable:true,reason:"provider_cooldown",error:"Gemini provider cooldown is active; generation was skipped to protect quota.",cooldown_until:providerState.cooldown_until},429);
 }
}

if(blueprintId&&!outputId){
const {data:b,error:be}=await db.from("chapter_blueprints").select("*").eq("id",blueprintId).single();
if(be||!b)return reply({success:false,error:"Blueprint could not be loaded."},404);
const {data:s,error:se}=await db.from("series").select("id,title,subtitle,description,mood,intensity,age_rating,status").eq("id",b.series_id).single();
if(se||!s)return reply({success:false,error:"Series could not be loaded."},404);
if(["completed","cancelled","hiatus"].includes(s.status))return reply({success:false,blocked:true,retryable:false,error:"Series status does not permit new chapter generation."},409);

// Direct trusted calls must not bypass the schedule-level generation gate.
const {data:seriesSchedules,error:seriesScheduleError}=await db.from("release_schedules")
  .select("id,enabled,auto_generate,automation_ready_at,schedule_mode")
  .eq("series_id",b.series_id).order("id",{ascending:true}).limit(2);
if(seriesScheduleError)return reply({success:false,retryable:true,error:"Could not verify scheduled generation readiness."},503);
const {data:autonomousRuns,error:autonomousRunError}=await db.from("taleforge_autonomous_series_creation_runs")
  .select("id").eq("series_id",b.series_id).eq("dry_run",false).limit(1);
if(autonomousRunError)return reply({success:false,retryable:true,error:"Could not verify autonomous-series provenance."},503);
const isAutonomousSeries=(autonomousRuns??[]).length>0;
if((seriesSchedules??[]).length>1||(isAutonomousSeries&&(seriesSchedules??[]).length!==1))
  return reply({success:false,blocked:true,retryable:false,error:"Series automation schedule is missing or ambiguous."},409);
if((seriesSchedules??[]).length===1){
  const schedule=seriesSchedules[0];
  const requiresAutomation=isAutonomousSeries||schedule.schedule_mode!=="manual"||schedule.auto_generate===true;
  if(requiresAutomation&&(s.status!=="ongoing"||schedule.enabled!==true||schedule.auto_generate!==true||!isAutomationReady(schedule.automation_ready_at)))
    return reply({success:false,blocked:true,retryable:false,error:"Scheduled generation is not ready; no chapter generation was attempted."},423);
}
const {data:contextResult,error:contextError}=await db.rpc("taleforge_build_generation_context",{p_blueprint_id:b.id});
if(contextError||!contextResult?.context)return reply({success:false,error:"Generation context could not be verified."},500);
const generationContext=contextResult.context;
const contextSnapshotId=contextResult.snapshot_id;
const contextHash=contextResult.context_hash;
const bounds=boundsForTarget(b.target_word_count||TARGET); const target=bounds.target; const minimum=bounds.minimum;
const prompt=`Write an original serialized-fiction chapter for Aevora. Do not imitate or reproduce any existing copyrighted story, author, or franchise. Treat the supplied Generation Context as canonical story state. Do not contradict it. Do not invent established facts that conflict with it. Never import mechanics, terminology, power systems, technology, magic, cultivation, or other genre assumptions from another genre unless explicitly established by this story.

GENERATION CONTEXT
${JSON.stringify(generationContext)}

GENERATION CONTEXT GOVERNANCE
Context snapshot: ${contextSnapshotId}
Context hash: ${contextHash}
The Advanced Chapter Plan is the immediate execution plan for this chapter and must be followed.\n\nPACING INTELLIGENCE GOVERNANCE\nThe Generation Context may contain a pacing_intelligence object. Use it as dynamic guidance for how the chapter unfolds, never as a replacement for canon, story architecture, narrative depth, continuity, or the Advanced Chapter Plan. If pace_direction is \"too_fast\", give important consequences, emotional beats, and causal transitions enough scene space and do not compress major payoffs. If pace_direction is \"too_slow\", prioritize meaningful tracked dependencies, character choices, world-state changes, and plot-thread progression; do not add filler. If pace_direction is \"stagnating\", require a meaningful tracked consequence or state change before low-value events. If pace_direction is \"stable\", maintain momentum while protecting upcoming payoffs. If pacing status is \"not_available\", do not invent pacing changes and follow the canonical plan normally. Never accelerate or slow a chapter merely to satisfy a numeric pacing score; use the signal to shape scene emphasis, consequence density, transitions, and payoff timing while preserving the story's intended rhythm.\n\nThe Advanced Chapter Plan is the immediate execution plan for this chapter and must be followed. It is derived from the Chapter Blueprint plus story-specific narrative depth, plot-thread progression, escalation, payoff, ending, continuity, and anti-padding constraints. The story-specific depth designs are not decorative metadata: use their causal chains to shape actual scenes, character behavior, relationship dynamics, world interaction, consequences, and forward connections. Important scenes should be written as lived moments rather than plot summaries. Use distinct character voices, meaningful subtext, natural dialogue, emotional reactions, sensory grounding, spatial awareness, internal thought where appropriate, and action/reaction chains. Let description, dialogue, conflict, and environment reveal character and world instead of merely explaining them. Give important emotional or dramatic beats enough scene space to land, while keeping momentum and avoiding repetitive prose or artificial padding. Story DNA, Story Identity, Story Blueprint, Arc Plan, canonical continuity state, character state, relationships, world elements, prior published chapters, future-payoff awareness, and the Advanced Chapter Plan are authoritative context layers. Do not treat the Advanced Chapter Plan or narrative-depth requirements as optional advice.

Write a complete chapter of at least ${minimum} words. The blueprint word count is advisory only; let the chapter arc, scenes, revelations, conflicts, and ending determine the natural final length. Preserve continuity, build scenes, use natural dialogue and sensory detail, follow the blueprint, protect character/world states, preserve open mysteries and future payoffs, and end on the specified hook. Do not add unrelated plotlines. Do not include headings, AI commentary, blueprint text, analysis, instructions, context metadata, or word-count notes. Return ONLY chapter prose.`;

let content="",attempt=0;
for(let n=1;n<=2;n++){
attempt=n;
content=await gemini(gkey,n===1?prompt:prompt+"\n\nEXPANSION REQUEST: produce a complete production-length chapter at least "+minimum+" words; let the chapter arc determine the final length while preserving the canonical Generation Context and ending hook.");
if(words(content)>=minimum)break;
}const count=words(content);
if(!content.trim())throw new Error("Gemini returned empty chapter content.");

const {data:out,error:oe}=await db.from("chapter_generation_outputs").insert({
series_id:b.series_id,chapter_blueprint_id:b.id,chapter_number:b.chapter_number,title:b.title,
content,word_count:count,generation_model:MODEL,generation_prompt_version:"generation-v5-semantic-chapter-execution",
generation_attempt:attempt,generation_status:"generated",quality_report:{generation_context_snapshot_id:contextSnapshotId,generation_context_hash:contextHash,context_version:"generation-context-v5-long-term-architecture"}
}).select("id,series_id,chapter_blueprint_id,chapter_number,title,word_count,generation_model,generation_prompt_version,generation_attempt,generation_status,created_at").single();
if(oe||!out){
const{error:rejectStatusError}=await db.from("chapter_blueprints").update({generation_status:"rejected",updated_at:new Date().toISOString()}).eq("id",b.id).eq("generation_status","generating");if(rejectStatusError)console.error("[generate-chapter] blueprint rejection transition failed; internal diagnostics were withheld.");
throw new Error("Could not create generation output; internal database diagnostics were withheld.");
}
const{data:blueprintUpdated,error:blueprintUpdateError}=await db.from("chapter_blueprints").update({generation_status:"generated",updated_at:new Date().toISOString()}).eq("id",b.id).eq("generation_status","generating").select("id").maybeSingle();let blueprintStatusSynced=!blueprintUpdateError&&!!blueprintUpdated;if(!blueprintStatusSynced){const{data:currentBlueprint,error:currentBlueprintError}=await db.from("chapter_blueprints").select("generation_status").eq("id",b.id).maybeSingle();blueprintStatusSynced=!currentBlueprintError&&["generated","quality_check","approved","published"].includes(String(currentBlueprint?.generation_status))}if(!blueprintStatusSynced)console.error("[generate-chapter] blueprint status could not be reconciled; internal diagnostics were withheld.");
return reply({success:true,mode:"generation",generator_version:"generation-v5-semantic-chapter-execution",already_generated:false,blueprint_id:b.id,output_id:out.id,chapter_number:out.chapter_number,chapter_title:out.title,word_count:out.word_count,generation_status:out.generation_status,generation_attempt:out.generation_attempt,blueprint_status_synced:blueprintStatusSynced,status_sync_warning:blueprintStatusSynced?undefined:"Chapter output was saved, but blueprint status needs safe reconciliation."});
}

if(!outputId)return reply({success:false,error:"A blueprint_id is required for generation or an output_id is required for quality review."},400);

// Deterministic validation can run during cooldown; the provider guard is
// kept directly beside the Gemini review call below.

const {data:out,error:oe}=await db.from("chapter_generation_outputs").select("*").eq("id",outputId).single();
if(oe){
 console.error("[generate-chapter] quality-review output lookup failed; internal diagnostics were withheld.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"review_context_unavailable",error:"Generation output could not be read; quality review was blocked."},503);
}
if(!out)return reply({success:false,error:"Generation output not found."},404);
// Only in-progress quality states may be reviewed. Approved outputs are already
// past quality review, and published outputs must remain immutable here.
const qualityReviewEligibleStatuses=["generated","needs_revision","quality_check"];
if(!qualityReviewEligibleStatuses.includes(out.generation_status)){
 const alreadyPublished=out.generation_status==="published";
 return reply({success:false,mode:"quality-review",retryable:false,
  reason:alreadyPublished?"output_already_published":"output_status_not_reviewable",
  generation_status:out.generation_status??null,
  error:alreadyPublished
   ?"Published outputs cannot be reprocessed by the quality-review endpoint."
   :"Output is not in an eligible quality-review state; approved or otherwise finalized outputs cannot be reprocessed."
 },409);
}
const {data:b,error:be}=await db.from("chapter_blueprints").select("*").eq("id",out.chapter_blueprint_id).single();
if(be||!b){
 console.error("[generate-chapter] quality-review blueprint lookup failed; failing closed.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"review_context_unavailable",error:"Required chapter blueprint context could not be verified; quality review was blocked."},503);
}
const reviewBounds=boundsForTarget(b.target_word_count);
const target=reviewBounds.target;
const minimum=reviewBounds.minimum;
const {data:s,error:se}=await db.from("series").select("title,status").eq("id",out.series_id).single();
if(se||!s){
 console.error("[generate-chapter] quality-review series lookup failed; failing closed.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"review_context_unavailable",error:"Required series context could not be verified; quality review was blocked."},503);
}

const count=words(out.content||""),issues:string[]=[],warnings:string[]=[];
if(!out.content?.trim())issues.push("Chapter content is empty.");
if(count<500)issues.push(`Chapter is critically short at ${count} words.`);
if(count<minimum)issues.push(`Chapter is below the production minimum: ${count} words versus minimum ${minimum}.`);


const hard={passed:issues.length===0,actualWordCount:count,targetWordCount:target,minimumWordCount:minimum,maximumWordCount:null,issues,warnings,repeatedPassages:[]};

if(issues.length){
const {data:review,error:reviewError}=await db.from("chapter_reviews").upsert({
generation_output_id:outputId,review_type:"quality",status:"needs_revision",score:0,
findings:{hard_validation:hard,quality_version:QUALITY_VERSION},reviewer_model:MODEL,reviewer_version:QUALITY_VERSION
},{onConflict:"generation_output_id,review_type"}).select().single();
if(reviewError){
 console.error("[generate-chapter] deterministic quality-review write failed; internal diagnostics were withheld.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"review_persistence_failed",error:"The deterministic review could not be saved; output state was not advanced."},503);
}
const {data:statusRow,error:statusError}=await db.from("chapter_generation_outputs").update({generation_status:"needs_revision",quality_score:0,quality_report:{hard_validation:hard,quality_version:QUALITY_VERSION},updated_at:new Date().toISOString()}).eq("id",outputId).neq("generation_status","published").select("id").maybeSingle();
if(statusError||!statusRow){
 console.error("[generate-chapter] deterministic review status update failed or was fenced.");
 return reply({success:false,mode:"quality-review",retryable:!statusError,reason:statusError?"review_persistence_failed":"output_state_changed",review_id:review?.id||null,error:"The output status could not be safely advanced; published or concurrently changed output state was preserved."},statusError?503:409);
}
return reply({success:true,mode:"quality-review",validation_mode:"deterministic-failure",output_id:outputId,review_id:review?.id||null,chapter_number:out.chapter_number,chapter_title:out.title,decision:"needs_revision",score:0,generation_status:"needs_revision",published:false,hard_validation:hard,next_step:"Run revise-chapter on this output."});
}

const contextSnapshotId=out?.quality_report?.generation_context_snapshot_id;
let advancedPlan:any={};
if(contextSnapshotId){
 const {data:cs,error:contextError}=await db.from("taleforge_generation_context_snapshots").select("payload").eq("id",contextSnapshotId).maybeSingle();
 if(contextError||!cs){
  console.error("[generate-chapter] quality-review context snapshot unavailable; failing closed.");
  return reply({success:false,mode:"quality-review",retryable:true,reason:"review_context_unavailable",error:"The required generation-context snapshot could not be verified; quality review was blocked."},503);
 }
 advancedPlan=cs.payload?.advanced_chapter_plan||{};
}
// Direct quality-review calls must not bypass the orchestrator's readiness gate.
// This check stays after deterministic hard validation, so short/empty chapters can
// still receive a deterministic needs_revision result without invoking Gemini.
const {data:qualitySchedules,error:qualityScheduleError}=await db.from("release_schedules")
  .select("id,enabled,auto_generate,auto_publish,automation_ready_at,schedule_mode")
  .eq("series_id",out.series_id).order("id",{ascending:true}).limit(2);
if(qualityScheduleError){
 console.error("[generate-chapter] quality-review schedule lookup failed; failing closed.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"automation_readiness_unavailable",error:"Quality review readiness could not be verified; AI review was blocked."},503);
}
const {data:qualityAutonomousRuns,error:qualityAutonomousRunError}=await db.from("taleforge_autonomous_series_creation_runs")
  .select("id").eq("series_id",out.series_id).eq("dry_run",false).limit(1);
if(qualityAutonomousRunError){
 console.error("[generate-chapter] quality-review autonomous provenance lookup failed; failing closed.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"automation_readiness_unavailable",error:"Quality review provenance could not be verified; AI review was blocked."},503);
}
const qualitySchedulesList=qualitySchedules??[];
const isQualityAutonomous=(qualityAutonomousRuns??[]).length>0;
if(qualitySchedulesList.length>1||(isQualityAutonomous&&qualitySchedulesList.length!==1)){
 return reply({success:false,mode:"quality-review",retryable:false,reason:"automation_schedule_ambiguous",error:"Quality review schedule is missing or ambiguous; AI review was blocked."},409);
}
if(qualitySchedulesList.length===1){
 const schedule=qualitySchedulesList[0];
 const requiresAutomation=isQualityAutonomous||schedule.schedule_mode!=="manual"||
   schedule.auto_generate===true||schedule.auto_publish===true;
 if(requiresAutomation&&(s.status!=="ongoing"||schedule.enabled!==true||!isAutomationReady(schedule.automation_ready_at))){
  return reply({success:false,mode:"quality-review",retryable:false,reason:"automation_not_ready",error:"Scheduled quality review is not ready; no AI review was attempted."},423);
 }
}

// Quality review also calls Gemini. Keep this guard beside the provider call so
// deterministic hard-validation failures can still be recorded during a cooldown.
const {data:reviewProviderState,error:reviewProviderStateError}=await db.from("taleforge_ai_provider_state").select("cooldown_until,consecutive_throttle_count").eq("provider","gemini").maybeSingle();
if(reviewProviderStateError||!reviewProviderState){
 console.error("[generate-chapter] quality-review provider cooldown lookup failed; failing closed.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"provider_state_unavailable",error:"Gemini cooldown state could not be verified; AI quality review was blocked."},503);
}
if(typeof reviewProviderState.consecutive_throttle_count!=="number"||!Number.isSafeInteger(reviewProviderState.consecutive_throttle_count)||reviewProviderState.consecutive_throttle_count<0){
 console.error("[generate-chapter] quality-review provider throttle counter is malformed; failing closed.");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"provider_state_unavailable",error:"Gemini provider state is malformed; AI quality review was blocked."},503);
}
if(reviewProviderState.cooldown_until && !Number.isFinite(new Date(reviewProviderState.cooldown_until).getTime())){
 console.error("[generate-chapter] quality-review provider cooldown timestamp is invalid; failing closed");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"provider_state_unavailable",error:"Gemini cooldown state is malformed; AI quality review was blocked."},503);
}
if(reviewProviderState.cooldown_until && new Date(reviewProviderState.cooldown_until).getTime()>Date.now()){
 console.warn("[generate-chapter] AI quality review skipped due to active provider cooldown",JSON.stringify({cooldown_until:reviewProviderState.cooldown_until,consecutive_throttle_count:reviewProviderState.consecutive_throttle_count}));
 return reply({success:false,mode:"quality-review",retryable:true,reason:"provider_cooldown",error:"Gemini provider cooldown is active; AI quality review was skipped to protect quota.",cooldown_until:reviewProviderState.cooldown_until},429);
}
const reviewPrompt=`Review this serialized-fiction chapter. Return ONLY valid JSON.
Evaluate coherence, character consistency, plot logic, blueprint alignment, worldbuilding, prose, dialogue, pacing, repetition and ending hook. Do not rewrite or invent problems.
Also perform a semantic execution audit against the Advanced Chapter Plan. Judge whether the prose meaningfully executes its causal objective, character/relationship/world/thread objectives, dependency chain, escalation requirements, payoff progression, ending awareness, hook strategy, and anti-padding constraints. Do not require literal wording; evaluate narrative function and evidence.
Series: ${s?.title||"Unknown"}
Chapter: ${out.chapter_number}
Title: ${out.title}
Blueprint: ${JSON.stringify(b||{})}
Advanced Chapter Plan: ${JSON.stringify(advancedPlan)}
Word count: ${count}
Return {"decision":"passed"|"needs_revision","score":0,"critical_issues":[],"revision_instructions":[],"overall_assessment":"","prose_quality":"","plot_coherence":"","character_consistency":"","pacing":"","blueprint_alignment":"","ending_hook":"","semantic_plan_alignment":{"score":0,"causal_objective":"","character_objectives":"","relationship_objectives":"","world_state_objectives":"","thread_objectives":"","dependency_chain":"","escalation":"","payoff_progression":"","ending_awareness":"","hook_strategy":"","anti_padding":"","missing_elements":[],"unmet_elements":[],"evidence":[]}}.
A score of 85 or higher can pass only with no critical issues and semantic plan alignment of at least 75.`;
let ai:any;
try{ai=parseJson(await gemini(gkey,reviewPrompt,true));}catch(e){throw e;}
const score=Number(ai?.score),semanticScore=Number(ai?.semantic_plan_alignment?.score),critical=Array.isArray(ai?.critical_issues)?ai.critical_issues:null;
// Fail closed: missing or malformed review fields are not evidence that the plan was met.
const semanticReady=Number.isFinite(semanticScore)&&semanticScore>=75;
const criticalIssuesClear=critical!==null&&critical.length===0;
const decision=ai?.decision==="passed"&&Number.isFinite(score)&&score>=85&&criticalIssuesClear&&semanticReady?"passed":"needs_revision",status=decision==="passed"?"quality_check":"needs_revision";
const {data:review,error:re}=await db.from("chapter_reviews").upsert({
generation_output_id:outputId,review_type:"quality",status:decision,score:Number.isFinite(score)?score:0,
findings:{hard_validation:hard,ai_review:ai,semantic_plan_alignment:ai?.semantic_plan_alignment||null,quality_version:QUALITY_VERSION},reviewer_model:MODEL,reviewer_version:QUALITY_VERSION
},{onConflict:"generation_output_id,review_type"}).select().single();
if(re)throw new Error(`Could not save quality review: ${re.message}`);
const {data:statusRow,error:statusError}=await db.from("chapter_generation_outputs").update({generation_status:status,quality_score:Number.isFinite(score)?score:null,quality_report:{hard_validation:hard,ai_review:ai,quality_version:QUALITY_VERSION},updated_at:new Date().toISOString()}).eq("id",outputId).neq("generation_status","published").select("id").maybeSingle();
if(statusError||!statusRow){
 console.error("[generate-chapter] AI quality-review status update failed or was fenced.");
 return reply({success:false,mode:"quality-review",retryable:!statusError,reason:statusError?"review_persistence_failed":"output_state_changed",review_id:review?.id||null,error:"The output status could not be safely advanced; published or concurrently changed output state was preserved."},statusError?503:409);
}
return reply({success:true,mode:"quality-review",validation_mode:"deterministic-plus-ai",output_id:outputId,review_id:review?.id||null,chapter_number:out.chapter_number,chapter_title:out.title,decision,score,generation_status:status,published:false,hard_validation:hard,next_step:decision==="passed"?"Continue with continuity, originality, safety, and publication review.":"Run revise-chapter on this output."});
}catch(e){
const message=e instanceof Error?e.message:String(e);
const providerQuotaFailure=message.includes("Gemini HTTP 429")||message.includes("RESOURCE_EXHAUSTED");
const providerTemporaryFailure=message.includes("Gemini HTTP 503");
const providerCooldownFailure=providerQuotaFailure||providerTemporaryFailure;
if(db && providerCooldownFailure){
 try{
  const {data,error:recordError}=await db.rpc("aevora_record_gemini_throttle",{p_event_id:crypto.randomUUID(),p_event_class:providerQuotaFailure?"quota":"overload"});
  const result=Array.isArray(data)?data[0]:data;
  if(recordError||result?.recorded!==true){
   console.error("[generate-chapter] Gemini cooldown persistence failed; this request remains blocked.");
  }else{
   console.warn("[generate-chapter] Gemini cooldown recorded",JSON.stringify({cooldown_until:result.cooldown_until,consecutive_throttle_count:result.consecutive_throttle_count}));
  }
 }catch{
  console.error("[generate-chapter] Gemini cooldown persistence failed unexpectedly; this request remains blocked.");
 }
}
const failureReason=providerQuotaFailure?"provider_quota_blocked":providerTemporaryFailure?"provider_temporarily_unavailable":"generation_failed";
const failureMessage=providerQuotaFailure?"Gemini quota or rate limit was reached; retry after provider cooldown.":providerTemporaryFailure?"Gemini is temporarily unavailable; retry after provider cooldown.":"Generation request failed; internal diagnostics were withheld.";
console.error("[generate-chapter] request failed",JSON.stringify({request_id:req.headers.get("x-request-id")||req.headers.get("sb-request-id")||null,error_name:e instanceof Error?e.name:"UnknownError",reason:failureReason}));
return reply({success:false,retryable:providerCooldownFailure,reason:failureReason,error:failureMessage},providerQuotaFailure?429:providerTemporaryFailure?503:500);
}
});