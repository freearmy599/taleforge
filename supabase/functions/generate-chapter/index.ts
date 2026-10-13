import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const MODEL="gemini-3.5-flash-lite";
const QUALITY_VERSION="quality-v6";
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
if(!r.ok)throw new Error(`Gemini HTTP ${r.status}: ${raw.slice(0,1200)}`);
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
const body=await req.json().catch(()=>({}));
const blueprintId=body?.blueprint_id,outputId=body?.output_id;
const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY"),gkey=Deno.env.get("GEMINI_API_KEY");
if(!url||!key||!gkey){console.error("[generate-chapter] configuration missing",JSON.stringify({missing:[...(!url?["SUPABASE_URL"]:[]),...(!key?["TALEFORGE_SERVICE_ROLE_KEY"]:[]),...(!gkey?["GEMINI_API_KEY"]:[])]}));return reply({success:false,error:"Required server configuration is missing."},500);}
if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES")))return reply({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."},401);
db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

const governance=await db.rpc("taleforge_ceo_execution_gate",{p_action_scope:"generation"});
if(governance.error||governance.data?.authorized!==true){
 return reply({success:false,error:"Generation blocked by Clara Aurel governance gate.",governance:governance.data??null,details:governance.error?.message??null},423);
}

if(blueprintId&&!outputId){
 const {data:providerState,error:providerStateError}=await db.from("taleforge_ai_provider_state").select("cooldown_until,consecutive_throttle_count").eq("provider","gemini").maybeSingle();
 if(providerStateError||!providerState){
  console.error("[generate-chapter] provider cooldown lookup failed; failing closed",providerStateError?.message??"No Gemini provider-state row found");
  return reply({success:false,retryable:true,reason:"provider_state_unavailable",error:"Gemini cooldown state could not be verified; generation was blocked to protect quota."},503);
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
if(be||!b)return reply({success:false,error:be?.message||"Blueprint not found."},404);
const {data:s,error:se}=await db.from("series").select("id,title,subtitle,description,mood,intensity,age_rating,status").eq("id",b.series_id).single();
if(se||!s)return reply({success:false,error:se?.message||"Series not found."},404);
const {data:contextResult,error:contextError}=await db.rpc("taleforge_build_generation_context",{p_blueprint_id:b.id});
if(contextError||!contextResult?.context)return reply({success:false,error:contextError?.message||"Generation Context Engine returned no context."},500);
const generationContext=contextResult.context;
const contextSnapshotId=contextResult.snapshot_id;
const contextHash=contextResult.context_hash;
const bounds=boundsForTarget(b.target_word_count||TARGET); const target=bounds.target; const minimum=bounds.minimum;
const prompt=`Write an original serialized-fiction chapter for TaleForge. Do not imitate or reproduce any existing copyrighted story, author, or franchise. Treat the supplied Generation Context as canonical story state. Do not contradict it. Do not invent established facts that conflict with it. Never import mechanics, terminology, power systems, technology, magic, cultivation, or other genre assumptions from another genre unless explicitly established by this story.

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
await db.from("chapter_blueprints").update({generation_status:"rejected",updated_at:new Date().toISOString()}).eq("id",b.id);
throw new Error(`Could not create generation output: ${oe?.message||"unknown error"}`);
}
await db.from("chapter_blueprints").update({generation_status:"generated",updated_at:new Date().toISOString()}).eq("id",b.id);
return reply({success:true,mode:"generation",generator_version:"generation-v5-semantic-chapter-execution",already_generated:false,blueprint_id:b.id,output_id:out.id,chapter_number:out.chapter_number,chapter_title:out.title,word_count:out.word_count,generation_status:out.generation_status,generation_attempt:out.generation_attempt});
}

if(!outputId)return reply({success:false,error:"A blueprint_id is required for generation or an output_id is required for quality review."},400);

const {data:reviewProviderState,error:reviewProviderStateError}=await db.from("taleforge_ai_provider_state").select("cooldown_until,consecutive_throttle_count").eq("provider","gemini").maybeSingle();
if(reviewProviderStateError||!reviewProviderState){
 console.error("[generate-chapter] quality-review provider cooldown lookup failed; failing closed",reviewProviderStateError?.message??"No Gemini provider-state row found");
 return reply({success:false,retryable:true,reason:"provider_state_unavailable",mode:"quality-review",error:"Gemini cooldown state could not be verified; quality review was blocked to protect quota."},503);
}else if(reviewProviderState.cooldown_until && !Number.isFinite(new Date(reviewProviderState.cooldown_until).getTime())){
 console.error("[generate-chapter] quality-review provider cooldown timestamp is invalid; failing closed",String(reviewProviderState.cooldown_until));
 return reply({success:false,retryable:true,reason:"provider_state_unavailable",mode:"quality-review",error:"Gemini cooldown state is malformed; quality review was blocked to protect quota."},503);
}else if(reviewProviderState.cooldown_until && new Date(reviewProviderState.cooldown_until).getTime()>Date.now()){
 console.warn("[generate-chapter] quality review skipped due to active provider cooldown",JSON.stringify({cooldown_until:reviewProviderState.cooldown_until,consecutive_throttle_count:reviewProviderState.consecutive_throttle_count}));
 return reply({success:false,retryable:true,reason:"provider_cooldown",mode:"quality-review",error:"Gemini provider cooldown is active; quality review was skipped to protect quota.",cooldown_until:reviewProviderState.cooldown_until},429);
}

const {data:out,error:oe}=await db.from("chapter_generation_outputs").select("*").eq("id",outputId).single();
if(oe){
 console.error("[generate-chapter] quality-review output lookup failed",oe.message);
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
 console.error("[generate-chapter] quality-review blueprint lookup failed; failing closed",be?.message??"Chapter blueprint not found");
 return reply({success:false,mode:"quality-review",retryable:true,reason:"review_context_unavailable",error:"Required chapter blueprint context could not be verified; quality review was blocked."},503);
}
const reviewBounds=boundsForTarget(b.target_word_count);
const target=reviewBounds.target;
const minimum=reviewBounds.minimum;
const {data:s,error:se}=await db.from("series").select("title").eq("id",out.series_id).single();
if(se||!s){
 console.error("[generate-chapter] quality-review series lookup failed; failing closed",se?.message??"Series not found");
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
 console.error("[generate-chapter] deterministic quality-review write failed",reviewError.message);
 return reply({success:false,mode:"quality-review",retryable:true,reason:"review_persistence_failed",error:"The deterministic review could not be saved; output state was not advanced."},503);
}
const {data:statusRow,error:statusError}=await db.from("chapter_generation_outputs").update({generation_status:"needs_revision",quality_score:0,quality_report:{hard_validation:hard,quality_version:QUALITY_VERSION},updated_at:new Date().toISOString()}).eq("id",outputId).neq("generation_status","published").select("id").maybeSingle();
if(statusError||!statusRow){
 console.error("[generate-chapter] deterministic review status update failed or was fenced",statusError?.message??"Output was published or changed concurrently");
 return reply({success:false,mode:"quality-review",retryable:!statusError,reason:statusError?"review_persistence_failed":"output_state_changed",review_id:review?.id||null,error:"The output status could not be safely advanced; published or concurrently changed output state was preserved."},statusError?503:409);
}
return reply({success:true,mode:"quality-review",validation_mode:"deterministic-failure",output_id:outputId,review_id:review?.id||null,chapter_number:out.chapter_number,chapter_title:out.title,decision:"needs_revision",score:0,generation_status:"needs_revision",published:false,hard_validation:hard,next_step:"Run revise-chapter on this output."});
}

const contextSnapshotId=out?.quality_report?.generation_context_snapshot_id;
let advancedPlan:any={};
if(contextSnapshotId){
 const {data:cs,error:contextError}=await db.from("taleforge_generation_context_snapshots").select("payload").eq("id",contextSnapshotId).maybeSingle();
 if(contextError||!cs){
  console.error("[generate-chapter] quality-review context snapshot unavailable; failing closed",contextError?.message??"Context snapshot not found");
  return reply({success:false,mode:"quality-review",retryable:true,reason:"review_context_unavailable",error:"The required generation-context snapshot could not be verified; quality review was blocked."},503);
 }
 advancedPlan=cs.payload?.advanced_chapter_plan||{};
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
try{ai=parseJson(await gemini(gkey,reviewPrompt,true));}catch(e){return reply({success:false,mode:"quality-review",error:`AI quality review failed: ${e instanceof Error?e.message:String(e)}`},502);}
const score=Number(ai?.score),semanticScore=Number(ai?.semantic_plan_alignment?.score),critical=Array.isArray(ai?.critical_issues)?ai.critical_issues:[];
// Fail closed: an omitted or malformed semantic score is not evidence that the plan was met.
const semanticReady=Number.isFinite(semanticScore)&&semanticScore>=75,decision=ai?.decision==="passed"&&Number.isFinite(score)&&score>=85&&critical.length===0&&semanticReady?"passed":"needs_revision",status=decision==="passed"?"quality_check":"needs_revision";
const {data:review,error:re}=await db.from("chapter_reviews").upsert({
generation_output_id:outputId,review_type:"quality",status:decision,score:Number.isFinite(score)?score:0,
findings:{hard_validation:hard,ai_review:ai,semantic_plan_alignment:ai?.semantic_plan_alignment||null,quality_version:QUALITY_VERSION},reviewer_model:MODEL,reviewer_version:QUALITY_VERSION
},{onConflict:"generation_output_id,review_type"}).select().single();
if(re)throw new Error(`Could not save quality review: ${re.message}`);
const {data:statusRow,error:statusError}=await db.from("chapter_generation_outputs").update({generation_status:status,quality_score:Number.isFinite(score)?score:null,quality_report:{hard_validation:hard,ai_review:ai,quality_version:QUALITY_VERSION},updated_at:new Date().toISOString()}).eq("id",outputId).neq("generation_status","published").select("id").maybeSingle();
if(statusError||!statusRow){
 console.error("[generate-chapter] AI quality-review status update failed or was fenced",statusError?.message??"Output was published or changed concurrently");
 return reply({success:false,mode:"quality-review",retryable:!statusError,reason:statusError?"review_persistence_failed":"output_state_changed",review_id:review?.id||null,error:"The output status could not be safely advanced; published or concurrently changed output state was preserved."},statusError?503:409);
}
return reply({success:true,mode:"quality-review",validation_mode:"deterministic-plus-ai",output_id:outputId,review_id:review?.id||null,chapter_number:out.chapter_number,chapter_title:out.title,decision,score,generation_status:status,published:false,hard_validation:hard,next_step:decision==="passed"?"Continue with continuity, originality, safety, and publication review.":"Run revise-chapter on this output."});
}catch(e){
const message=e instanceof Error?e.message:String(e);
if(db && (message.includes("Gemini HTTP 429") || message.includes("RESOURCE_EXHAUSTED"))){
 try{
  const {data}=await db.from("taleforge_ai_provider_state").select("consecutive_throttle_count").eq("provider","gemini").maybeSingle();
  const count=Number(data?.consecutive_throttle_count??0)+1;
  const cooldownHours=Math.min(24,6*Math.pow(2,Math.min(count-1,2)));
  const until=new Date(Date.now()+cooldownHours*60*60*1000).toISOString();
  const {error:cooldownError}=await db.from("taleforge_ai_provider_state").upsert({provider:"gemini",cooldown_until:until,consecutive_throttle_count:count,last_error:message.slice(0,2000),last_error_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"provider"});
  if(cooldownError)console.error("[generate-chapter] failed to record Gemini cooldown",cooldownError.message);
  else console.warn("[generate-chapter] Gemini cooldown recorded",JSON.stringify({cooldown_until:until,cooldown_hours:cooldownHours,consecutive_throttle_count:count}));
 }catch(cooldownException){console.error("[generate-chapter] cooldown recording exception",String(cooldownException));}
}
console.error("[generate-chapter] request failed",JSON.stringify({request_id:req.headers.get("x-request-id")||req.headers.get("sb-request-id")||null,error_name:e instanceof Error?e.name:"UnknownError",error_message:message.slice(0,1200)}));
return reply({success:false,error:message},500);
}
});