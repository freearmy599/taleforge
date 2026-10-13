import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
const VERSION="arc-planner-v7-fail-closed-cooldown"; const H={"Content-Type":"application/json"};
const clean=(t:string)=>{let s=t.trim().replace(/^```json\s*/,"").replace(/^```\s*/,"").replace(/\s*```$/,"").trim();const a=s.indexOf("{"),b=s.lastIndexOf("}");if(a<0||b<a)throw new Error("No JSON object found in model response");s=s.slice(a,b+1).replace(/,\\s*([}\\]])/g,"$1");return JSON.parse(s);};
const errText=(e:any)=>e instanceof Error?e.message:(e&&typeof e==="object"?JSON.stringify(e):String(e));
async function recordGeminiQuotaCooldown(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("Gemini HTTP 429") && !message.includes("RESOURCE_EXHAUSTED")) return;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error: stateError } = await db.from("taleforge_ai_provider_state")
      .select("cooldown_until,consecutive_throttle_count").eq("provider", "gemini").maybeSingle();
    if (stateError || !data) {
      console.error("[quota-guard] Gemini cooldown state could not be verified; persistence skipped.");
      return;
    }
    const previousCount = Number(data.consecutive_throttle_count ?? 0);
    const count = (Number.isFinite(previousCount) && previousCount >= 0 ? Math.floor(previousCount) : 0) + 1;
    const cooldownHours = Math.min(24, 6 * Math.pow(2, Math.min(count - 1, 2)));
    const now = new Date();
    const proposedUntil = now.getTime() + cooldownHours * 60 * 60 * 1000;
    const existingUntil = data.cooldown_until ? Date.parse(data.cooldown_until) : 0;
    const until = new Date(Math.max(proposedUntil, Number.isFinite(existingUntil) ? existingUntil : 0)).toISOString();
    const { error: writeError } = await db.from("taleforge_ai_provider_state").upsert({
      provider: "gemini", cooldown_until: until, consecutive_throttle_count: count,
      last_error: "Gemini quota or rate-limit response", last_error_at: now.toISOString(),
      updated_at: now.toISOString(),
    }, { onConflict: "provider" });
    if (writeError) console.error("[quota-guard] Gemini cooldown persistence failed.");
  } catch {
    console.error("[quota-guard] Gemini cooldown persistence failed unexpectedly.");
  }
}

Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:H});
 if(req.method!=="POST") return new Response(JSON.stringify({success:false,error:"Method not allowed"}),{status:405,headers:H});
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY"),gemini=Deno.env.get("GEMINI_API_KEY");
  if(!url||!key||!gemini)throw new Error("Missing service configuration.");
  if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) return new Response(JSON.stringify({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."}),{status:401,headers:H});
  const body=await req.json().catch(()=>({})); const seriesId=body?.series_id; const dry=body?.dry_run===true;
  const db=createClient(url,key); let series:any;
  if(seriesId){const q=await db.from("series").select("id,title,subtitle,description,status,age_rating,mood,intensity,chapter_count,originality_status").eq("id",seriesId).single();if(q.error)throw {stage:"series_lookup",error:q.error};series=q.data}
  else {const q=await db.from("story_lifecycle").select("series_id,lifecycle_status").in("lifecycle_status",["preparing","launching","active"]).order("updated_at",{ascending:true}).limit(20);if(q.error)throw {stage:"lifecycle_lookup",error:q.error};if(!q.data?.length)return new Response(JSON.stringify({success:true,action:"nothing_to_plan"}),{headers:H});let selected:any=null;for(const row of q.data){const a=await db.from("story_arc_plan").select("id").eq("series_id",row.series_id).eq("status","active").limit(1).maybeSingle();if(a.error)throw {stage:"arc_lookup",error:a.error};if(!a.data){selected=row;break}}if(!selected)return new Response(JSON.stringify({success:true,version:VERSION,action:"all_series_have_active_arcs"}),{headers:H});const s=await db.from("series").select("id,title,subtitle,description,status,age_rating,mood,intensity,chapter_count,originality_status").eq("id",selected.series_id).single();if(s.error)throw {stage:"series_lookup",error:s.error};series=s.data}
  const dna=await db.from("story_dna").select("*").eq("series_id",series.id).eq("status","active").order("version",{ascending:false}).limit(1).maybeSingle(); if(dna.error)throw {stage:"story_dna_lookup",error:dna.error}; if(!dna.data)return new Response(JSON.stringify({success:true,version:VERSION,action:"waiting_for_story_dna",series_id:series.id}),{headers:H});
  const existing=await db.from("story_arc_plan").select("*").eq("series_id",series.id).order("version",{ascending:false}).limit(1).maybeSingle(); if(existing.error)throw {stage:"arc_lookup",error:existing.error};
  const published=await db.from("chapters").select("chapter_number,title,summary").eq("series_id",series.id).eq("status","published").order("chapter_number",{ascending:false}).limit(8); if(published.error)throw {stage:"published_lookup",error:published.error};
  const prompt=`You are TaleForge's long-range story architect. Build a durable arc plan for ONE serialized fiction series. The supplied Story DNA is authoritative. Respect its genre profile and never import mechanics or conventions from another genre. The plan must create meaningful progression, escalating stakes, character change, revelations and satisfying eventual payoff without padding.
SERIES:
${JSON.stringify(series)}
STORY DNA:
${JSON.stringify(dna.data??null)}
EXISTING ARC PLAN:
${JSON.stringify(existing.data??null)}
RECENT PUBLISHED CHAPTERS:
${JSON.stringify(published.data??[])}
Return ONLY JSON:
{
 target_ending_chapter:number,
 flexibility_min_chapter:number,
 flexibility_max_chapter:number,
 central_promise:string,
 central_conflict:string,
 final_question:string,
 final_answer:string,
 arcs:array,
 character_arcs:array,
 major_revelations:array,
 required_payoffs:array,
 ending_requirements:array,
 forbidden_padding:array,
 completion_definition:object
}
The ending chapter is a planning target, not a rigid promise. Allow controlled flexibility. arcs should describe sequential major phases with objectives, turning points, escalation and exit conditions. Character arcs must preserve the established cast. Revelations and payoffs must be seeded before resolution. Never add an ending solely to hit a chapter count.`;
  if(dry)return new Response(JSON.stringify({success:true,version:VERSION,action:"dry_run",series_id:series.id,prompt_preview:prompt.slice(0,1800)}),{headers:H});
  // Fail closed before any Gemini request if provider state is unavailable or cooling down.
  const {data:providerState,error:providerStateError}=await db.from("taleforge_ai_provider_state").select("provider,consecutive_throttle_count,cooldown_until").eq("provider","gemini").maybeSingle();
  if(providerStateError || !providerState) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json"}});
  const cooldownUntil=providerState.cooldown_until ? Date.parse(providerState.cooldown_until) : 0;
  if(providerState.cooldown_until && !Number.isFinite(cooldownUntil)) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable",reason:"invalid_cooldown_timestamp"}),{status:503,headers:{"Content-Type":"application/json"}});
  if(cooldownUntil && cooldownUntil>Date.now()) return new Response(JSON.stringify({success:false,error:"provider_cooldown",cooldown_until:providerState.cooldown_until}),{status:429,headers:{"Content-Type":"application/json"}});
  const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(gemini)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.55,maxOutputTokens:6500,responseMimeType:"application/json"}})});
  if(!resp.ok)throw new Error(`Gemini HTTP ${resp.status}${resp.status===429?" RESOURCE_EXHAUSTED":""}`);
  const gd=await resp.json(),txt=gd?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("")??"";let x:any;try{x=clean(txt)}catch{throw new Error("Gemini planner response was not valid JSON.");}
  if(!Number.isFinite(Number(x.target_ending_chapter))||Number(x.target_ending_chapter)<Math.max(6,Number(series.chapter_count??0)))throw {stage:"arc_validation",error:"Invalid ending target.",target:x.target_ending_chapter,chapter_count:series.chapter_count};
  if(typeof x.central_promise!=="string"||typeof x.central_conflict!=="string")throw {stage:"arc_validation",error:"Invalid arc plan fields."};
  const version=Number(existing.data?.version??0)+1;
  if(existing.data?.id){const u=await db.from("story_arc_plan").update({status:"superseded",updated_at:new Date().toISOString()}).eq("id",existing.data.id);if(u.error)throw {stage:"arc_supersede",error:u.error}}
  const {error}=await db.from("story_arc_plan").insert({series_id:series.id,version,target_ending_chapter:Number(x.target_ending_chapter),flexibility_min_chapter:Number(x.flexibility_min_chapter)||Math.max(1,Number(x.target_ending_chapter)-5),flexibility_max_chapter:Number(x.flexibility_max_chapter)||Number(x.target_ending_chapter)+8,central_promise:x.central_promise,central_conflict:x.central_conflict,final_question:x.final_question??"",final_answer:x.final_answer??"",arcs:Array.isArray(x.arcs)?x.arcs:[],character_arcs:Array.isArray(x.character_arcs)?x.character_arcs:[],major_revelations:Array.isArray(x.major_revelations)?x.major_revelations:[],required_payoffs:Array.isArray(x.required_payoffs)?x.required_payoffs:[],ending_requirements:Array.isArray(x.ending_requirements)?x.ending_requirements:[],forbidden_padding:Array.isArray(x.forbidden_padding)?x.forbidden_padding:[],completion_definition:x.completion_definition&&typeof x.completion_definition==="object"?x.completion_definition:{},status:"active"});
  if(error)throw {stage:"arc_insert",error};
  return new Response(JSON.stringify({success:true,version:VERSION,action:"arc_created",arc_plan:{series_id:series.id,version,target_ending_chapter:Number(x.target_ending_chapter),status:"active"}}),{headers:H});
 }catch(e){await recordGeminiQuotaCooldown(e);const quotaFailure=(e instanceof Error?e.message:String(e)).includes("Gemini HTTP 429")||(e instanceof Error?e.message:String(e)).includes("RESOURCE_EXHAUSTED");console.error("arc-planner request failed; internal diagnostics withheld.");return new Response(JSON.stringify({success:false,version:VERSION,retryable:quotaFailure,reason:quotaFailure?"provider_quota_blocked":"arc_planning_failed",error:quotaFailure?"Gemini quota or rate limit was reached; retry after cooldown.":"Arc planning failed; internal diagnostics were withheld."}),{status:quotaFailure?429:500,headers:H})}
});