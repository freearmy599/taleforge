import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const VERSION = "blueprint-planner-v12-fail-closed-cooldown-state";
const jsonHeaders = { "Content-Type": "application/json" };

function cleanJson(text:string) {
  const s = text.trim().replace(/^\`\`\`json\s*/,"").replace(/^\`\`\`\s*/,"").replace(/\s*\`\`\`$/,"").trim();
  const a=s.indexOf("{"), b=s.lastIndexOf("}");
  if(a>=0 && b>a) {
    return JSON.parse(s.slice(a,b+1).replace(/,\\s*([}\\]])/g,"$1"));
  }
  return JSON.parse(s.replace(/,\\s*([}\\]])/g,"$1"));
}

async function recordGeminiQuotaCooldown(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const isQuotaFailure = message.includes("Gemini HTTP 429") || message.includes("RESOURCE_EXHAUSTED");
  const isTemporaryOverload = message.includes("Gemini HTTP 503");
  if (!isQuotaFailure && !isTemporaryOverload) return;
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY");
    if (!url || !key) return;
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error: recordError } = await db.rpc("aevora_record_gemini_throttle", {
      p_event_class: isQuotaFailure ? "quota" : "overload",
    });
    const result = Array.isArray(data) ? data[0] : data;
    if (recordError || result?.recorded !== true) {
      console.error("[quota-guard] Gemini cooldown persistence failed.");
      return;
    }
    console.warn("[quota-guard] Gemini cooldown recorded", JSON.stringify({
      cooldown_until: result.cooldown_until,
      cooldown_hours: result.cooldown_hours,
      consecutive_throttle_count: result.consecutive_throttle_count,
    }));
  } catch {
    console.error("[quota-guard] Gemini cooldown persistence failed unexpectedly.");
  }
}
Deno.serve(async (req:Request) => {
  if(req.method === "OPTIONS") return new Response("ok", {headers:jsonHeaders});
  if(req.method !== "POST") return new Response(JSON.stringify({success:false,error:"Method not allowed"}),{status:405,headers:jsonHeaders});
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if(!supabaseUrl || !serviceKey) throw new Error("Missing Supabase service-role configuration.");
    if(!geminiKey) throw new Error("Missing GEMINI_API_KEY.");
    if(!isTrustedInternalApiKey(req.headers.get("apikey"),serviceKey,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) return new Response(JSON.stringify({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."}),{status:401,headers:jsonHeaders});
    const body = await req.json().catch(()=>({}));
    const dryRun = body?.dry_run === true;
    const db = createClient(supabaseUrl, serviceKey);
    const {data:plan,error:planError}=await db.rpc("get_production_buffer_plan");
    if(planError) throw planError;
    const candidates=(plan??[]).filter((x:any)=>Number(x.deficit)>0 && ["preparing","launching","active","nearing_completion"].includes(x.lifecycle_status))
      .sort((a:any,b:any)=>Number(b.priority_score)-Number(a.priority_score));
    if(!candidates.length) return new Response(JSON.stringify({success:true,version:VERSION,action:"nothing_to_plan"}),{headers:jsonHeaders});
    const candidateIds=candidates.map((x:any)=>x.series_id);
    const {data:activeArcs,error:activeArcsError}=await db.from("story_arc_plan")
      .select("series_id,version,target_ending_chapter")
      .in("series_id",candidateIds)
      .eq("status","active");
    if(activeArcsError) throw activeArcsError;
    const arcIds=new Set((activeArcs??[]).map((x:any)=>x.series_id));
    // Bootstrap newly prepared, arc-backed series before established buffers.
    // This prevents future-series enrollment from being starved indefinitely by mature series.
    const arcBackedCandidates=candidates
      .filter((x:any)=>arcIds.has(x.series_id))
      .sort((a:any,b:any)=>{
        const rank=(x:any)=>x.lifecycle_status==="preparing"?3:x.lifecycle_status==="launching"?2:1;
        return rank(b)-rank(a) || Number(b.priority_score)-Number(a.priority_score);
      });
    const c=arcBackedCandidates[0]??null;
    if(!c) return new Response(JSON.stringify({success:true,version:VERSION,action:"waiting_for_arc_plan",eligible_candidates:candidates.length}),{headers:jsonHeaders});
    const {data:series,error:seriesError}=await db.from("series").select("id,title,subtitle,description,status,age_rating,mood,intensity,chapter_count,originality_status").eq("id",c.series_id).single();
    if(seriesError) throw seriesError;

    const {data:storyDna}=await db.from("story_dna").select("genre_profile,core_premise,central_theme,reader_promise,narrative_voice,protagonist_profiles,relationship_map,world_rules,story_constraints,mystery_threads,payoff_targets,forbidden_patterns").eq("series_id",c.series_id).eq("status","active").order("version",{ascending:false}).limit(1).maybeSingle();
    const {data:arcPlan}=await db.from("story_arc_plan").select("version,target_ending_chapter,central_promise,central_conflict,final_question,final_answer,arcs,character_arcs,major_revelations,required_payoffs,ending_requirements,forbidden_padding,completion_definition").eq("series_id",c.series_id).eq("status","active").order("version",{ascending:false}).limit(1).maybeSingle();
    const {data:latest}=await db.from("chapter_blueprints").select("chapter_number,title,purpose,summary,plot_events,character_developments,world_reveals,clues_and_mysteries,continuity_requirements,ending_hook,target_word_count").eq("series_id",c.series_id).order("chapter_number",{ascending:false}).limit(1);
    const {data:published}=await db.from("chapters").select("chapter_number,title,content").eq("series_id",c.series_id).order("chapter_number",{ascending:false}).limit(2);
    const next=Math.max(Number(latest?.[0]?.chapter_number??0),Number(published?.[0]?.chapter_number??0))+1;

    const prompt = `You are Aevora's genre-neutral serialized-fiction blueprint planner. Create ONE original next-chapter blueprint for an existing series. Preserve continuity and advance the story; do not copy existing fiction. Follow the Story DNA and established genre. Never introduce mechanics, terminology, tropes, power systems, technology, magic, cultivation, or other genre assumptions that are not established by the supplied Story DNA or story material.

SERIES:
Title: ${series.title}
Subtitle: ${series.subtitle??""}
Description: ${series.description??""}
Status: ${series.status}
Age rating: ${series.age_rating??""}
Mood: ${series.mood??""}
Intensity: ${series.intensity??""}
Next chapter number: ${next}

STORY DNA (AUTHORITATIVE CREATIVE CONSTITUTION):
${JSON.stringify(storyDna??null)}\n\nACTIVE ARC PLAN (AUTHORITATIVE LONG-RANGE PLOT CONSTITUTION):\n${JSON.stringify(arcPlan??null)}

LATEST BLUEPRINT:
${JSON.stringify(latest?.[0]??null)}

RECENT PUBLISHED CHAPTERS:
${JSON.stringify((published??[]).map((x:any)=>({chapter_number:x.chapter_number,title:x.title,content:String(x.content??"").slice(0,6000)})))}

Return ONLY valid JSON with exactly these keys:
title, purpose, summary, plot_events, character_developments, world_reveals, clues_and_mysteries, continuity_requirements, previous_chapter_dependencies, ending_hook, target_word_count.
Use arrays for the six list/object fields where appropriate. target_word_count must be 2200-4000.`;

    if(dryRun) return new Response(JSON.stringify({success:true,version:VERSION,action:"planned",dry_run:true,series_id:c.series_id,series_title:series.title,chapter_number:next,arc_plan_version:arcPlan?.version??null,target_ending_chapter:arcPlan?.target_ending_chapter??null,prompt_preview:prompt.slice(0,1200)}),{headers:jsonHeaders});

    // Fail closed before any Gemini request if provider state is unavailable or cooling down.
    const {data:providerState,error:providerStateError}=await db
      .from("taleforge_ai_provider_state")
      .select("provider,consecutive_throttle_count,cooldown_until")
      .eq("provider","gemini")
      .maybeSingle();
    if(providerStateError || !providerState) {
      return new Response(JSON.stringify({success:false,version:VERSION,error:"provider_state_unavailable"}),{status:503,headers:jsonHeaders});
    }
    if(typeof providerState.consecutive_throttle_count!=="number"||!Number.isSafeInteger(providerState.consecutive_throttle_count)||providerState.consecutive_throttle_count<0) return new Response(JSON.stringify({success:false,version:VERSION,error:"provider_state_unavailable",reason:"invalid_provider_counter"}),{status:503,headers:jsonHeaders});
    const cooldownUntil=providerState.cooldown_until ? Date.parse(providerState.cooldown_until) : 0;
    if(providerState.cooldown_until && !Number.isFinite(cooldownUntil)) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable",reason:"invalid_cooldown_timestamp"}),{status:503,headers:{"Content-Type":"application/json"}});
  if(cooldownUntil && cooldownUntil > Date.now()) {
      return new Response(JSON.stringify({success:false,version:VERSION,error:"provider_cooldown",cooldown_until:providerState.cooldown_until}),{status:429,headers:jsonHeaders});
    }

    const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(geminiKey)}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.8,maxOutputTokens:3000,responseMimeType:"application/json"}})
    });
    if(!resp.ok) throw new Error(`Gemini HTTP ${resp.status}${resp.status===429?" RESOURCE_EXHAUSTED":""}`);
    const gd=await resp.json();
    const text=gd?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("")??"";
    const bp=cleanJson(text);
    for(const k of ["title","purpose","summary","ending_hook"]) if(typeof bp[k]!=="string" || !bp[k].trim()) throw new Error(`Planner returned invalid ${k}`);
    const row={
      series_id:c.series_id, chapter_number:next, title:bp.title.trim(), purpose:bp.purpose.trim(), summary:bp.summary.trim(),
      plot_events:Array.isArray(bp.plot_events)?bp.plot_events:[], character_developments:Array.isArray(bp.character_developments)?bp.character_developments:[],
      world_reveals:Array.isArray(bp.world_reveals)?bp.world_reveals:[], clues_and_mysteries:Array.isArray(bp.clues_and_mysteries)?bp.clues_and_mysteries:[],
      continuity_requirements:Array.isArray(bp.continuity_requirements)?bp.continuity_requirements:[],
      previous_chapter_dependencies:Array.isArray(bp.previous_chapter_dependencies)?bp.previous_chapter_dependencies:[],
      ending_hook:bp.ending_hook.trim(), target_word_count:Math.max(2200,Math.min(4000,Number(bp.target_word_count)||3000)),
      generation_status:"planned",release_status:"unreleased",version:1
    };
    const {data:inserted,error:insertError}=await db.from("chapter_blueprints").insert(row).select("id,series_id,chapter_number,title,generation_status,release_status,target_word_count").single();
    if(insertError) throw insertError;
    return new Response(JSON.stringify({success:true,version:VERSION,action:"blueprint_created",blueprint:inserted}),{headers:jsonHeaders});
  } catch(e) {
    await recordGeminiQuotaCooldown(e);
    const providerMessage=e instanceof Error?e.message:String(e);const quotaFailure=providerMessage.includes("Gemini HTTP 429")||providerMessage.includes("RESOURCE_EXHAUSTED");const providerOverloaded=providerMessage.includes("Gemini HTTP 503");
    return new Response(JSON.stringify({success:false,version:VERSION,retryable:quotaFailure||providerOverloaded,reason:quotaFailure?"provider_quota_blocked":providerOverloaded?"provider_temporarily_unavailable":"blueprint_planning_failed",error:quotaFailure?"Gemini quota or rate limit was reached; retry after cooldown.":providerOverloaded?"Gemini is temporarily unavailable; retry after cooldown.":"Blueprint planning failed; internal diagnostics were withheld."}),{status:quotaFailure?429:providerOverloaded?503:500,headers:jsonHeaders});
  }
});