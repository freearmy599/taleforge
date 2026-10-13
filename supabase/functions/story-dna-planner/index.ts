import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
const VERSION="story-dna-planner-v6-aevora-brand";
function clean(t:string){const s=t.trim().replace(/^\`\`\`json\s*/,"").replace(/^\`\`\`\s*/,"").replace(/\s*\`\`\`$/,"").trim();const a=s.indexOf("{"),b=s.lastIndexOf("}");return JSON.parse(a>=0?s.slice(a,b+1):s)}
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
 if(req.method==="OPTIONS") return new Response("ok");
 if(req.method!=="POST") return new Response(JSON.stringify({success:false,error:"Method not allowed"}),{status:405,headers:{"Content-Type":"application/json"}});
 try{
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY"),gemini=Deno.env.get("GEMINI_API_KEY");
  if(!url||!key||!gemini)throw new Error("Missing service configuration.");
  if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) return new Response(JSON.stringify({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."}),{status:401,headers:{"Content-Type":"application/json"}});
  const body=await req.json().catch(()=>({})); const seriesId=body?.series_id; const dry=body?.dry_run===true;
  const db=createClient(url,key); let series:any;
  if(seriesId){const q=await db.from("series").select("id,title,subtitle,description,status,age_rating,mood,intensity,originality_status").eq("id",seriesId).single();if(q.error)throw q.error;series=q.data}
  else {const q=await db.from("story_lifecycle").select("series_id,lifecycle_status").in("lifecycle_status",["preparing","launching","active","nearing_completion"]).order("updated_at",{ascending:true}).limit(20);if(q.error)throw q.error;let picked:any=null;for(const row of (q.data??[])){const d=await db.from("story_dna").select("id").eq("series_id",row.series_id).eq("status","active").limit(1);if(d.error)throw d.error;if(!d.data?.length){picked=row;break}}if(!picked)return new Response(JSON.stringify({success:true,action:"all_series_have_active_dna"}),{headers:{"Content-Type":"application/json"}});const s=await db.from("series").select("id,title,subtitle,description,status,age_rating,mood,intensity,originality_status").eq("id",picked.series_id).single();if(s.error)throw s.error;series=s.data}
  const dna=await db.from("story_dna").select("*").eq("series_id",series.id).eq("status","active").order("version",{ascending:false}).limit(1);
  const arc=await db.from("story_arc_plan").select("*").eq("series_id",series.id).order("version",{ascending:false}).limit(1);
  const chapters=await db.from("chapters").select("chapter_number,title,summary,content").eq("series_id",series.id).eq("status","published").order("chapter_number",{ascending:false}).limit(5);
  if(dna.error)throw new Error("Unable to read existing story DNA.");
  if(arc.error)throw new Error("Unable to read the story arc plan.");
  if(chapters.error)throw new Error("Unable to read recent published chapters.");
  const prompt=`You are Aevora's genre-neutral Story DNA architect. Create a durable story bible for a serialized fiction series. Preserve continuity and make it useful for future chapter planning. The story's genre, subgenre, setting, technology, magic, science, social systems, and narrative conventions must come from the supplied series and its existing material. NEVER import mechanics, terminology, character archetypes, power systems, tropes, or assumptions from another genre merely because they are common in training data. For example, a science-fiction story must not receive cultivation realms, mana, sects, spell systems, or fantasy power progression unless the supplied story explicitly establishes them. A romance must not receive sci-fi technology; a mystery must not receive fantasy magic; a historical story must not receive modern technology unless explicitly established. When genre information is incomplete, infer conservatively from the story itself rather than inventing cross-genre mechanics. Do not copy existing fiction.

SERIES:
${JSON.stringify(series)}

EXISTING DNA:
${JSON.stringify(dna.data?.[0]??null)}

ARC PLAN:
${JSON.stringify(arc.data?.[0]??null)}

RECENT CHAPTERS:
${JSON.stringify((chapters.data??[]).map((x:any)=>({chapter_number:x.chapter_number,title:x.title,summary:x.summary,content:String(x.content??"").slice(0,5000)})))}

Return ONLY JSON with keys: genre_profile, core_premise, central_theme, reader_promise, narrative_voice, protagonist_profiles, relationship_map, world_rules, story_constraints, mystery_threads, payoff_targets, forbidden_patterns.
Use arrays for the list fields. Make the DNA specific, internally consistent, and durable.`;
  if(dry)return new Response(JSON.stringify({success:true,version:VERSION,action:"dry_run",series_id:series.id,prompt_preview:prompt.slice(0,1800)}),{headers:{"Content-Type":"application/json"}});
  // Fail closed before any Gemini request if provider state is unavailable or cooling down.
  const {data:providerState,error:providerStateError}=await db.from("taleforge_ai_provider_state").select("provider,consecutive_throttle_count,cooldown_until").eq("provider","gemini").maybeSingle();
  if(providerStateError || !providerState) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json"}});
  const cooldownUntil=providerState.cooldown_until ? Date.parse(providerState.cooldown_until) : 0;
  if(providerState.cooldown_until && !Number.isFinite(cooldownUntil)) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable",reason:"invalid_cooldown_timestamp"}),{status:503,headers:{"Content-Type":"application/json"}});
  if(cooldownUntil && cooldownUntil>Date.now()) return new Response(JSON.stringify({success:false,error:"provider_cooldown",cooldown_until:providerState.cooldown_until}),{status:429,headers:{"Content-Type":"application/json"}});
  const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(gemini)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.65,maxOutputTokens:5000,responseMimeType:"application/json"}})});
  if(!resp.ok)throw new Error(`Gemini HTTP ${resp.status}${resp.status===429?" RESOURCE_EXHAUSTED":""}`);
  const gd=await resp.json(),txt=gd?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("")??""; const x=clean(txt);
  for(const k of ["core_premise","reader_promise","narrative_voice"])if(typeof x[k]!=="string"||!x[k].trim())throw new Error(`Invalid ${k}`);
  const version=Number(dna.data?.[0]?.version??0)+1;
  await db.from("story_dna").update({status:"superseded",updated_at:new Date().toISOString()}).eq("series_id",series.id).eq("status","active");
  const {data,error}=await db.from("story_dna").insert({series_id:series.id,version,status:"active",genre_profile:x.genre_profile??{primary_genre:"unspecified",subgenres:[],allowed_mechanics:[],forbidden_cross_genre_assumptions:[]},core_premise:x.core_premise,central_theme:x.central_theme??null,reader_promise:x.reader_promise,narrative_voice:x.narrative_voice,protagonist_profiles:Array.isArray(x.protagonist_profiles)?x.protagonist_profiles:[],relationship_map:Array.isArray(x.relationship_map)?x.relationship_map:[],world_rules:Array.isArray(x.world_rules)?x.world_rules:[],story_constraints:Array.isArray(x.story_constraints)?x.story_constraints:[],mystery_threads:Array.isArray(x.mystery_threads)?x.mystery_threads:[],payoff_targets:Array.isArray(x.payoff_targets)?x.payoff_targets:[],forbidden_patterns:Array.isArray(x.forbidden_patterns)?x.forbidden_patterns:[]}).select("id,series_id,version,status").single();
  if(error)throw error; return new Response(JSON.stringify({success:true,version:VERSION,action:"dna_created",story_dna:data}),{headers:{"Content-Type":"application/json"}});
 }catch(e){await recordGeminiQuotaCooldown(e);const quotaFailure=(e instanceof Error?e.message:String(e)).includes("Gemini HTTP 429")||(e instanceof Error?e.message:String(e)).includes("RESOURCE_EXHAUSTED");return new Response(JSON.stringify({success:false,version:VERSION,retryable:quotaFailure,reason:quotaFailure?"provider_quota_blocked":"story_dna_planning_failed",error:quotaFailure?"Gemini quota or rate limit was reached; retry after cooldown.":"Story DNA planning failed; internal diagnostics were withheld."}),{status:quotaFailure?429:500,headers:{"Content-Type":"application/json"}})}
});