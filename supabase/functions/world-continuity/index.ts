import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
const VERSION = "world-continuity-v12-fail-closed-cooldown-state";const H={"Content-Type":"application/json"};
const clean=(t:string)=>{
 let s=t.trim().replace(/^\`\`\`json\s*/,"").replace(/^\`\`\`\s*/,"").replace(/\s*\`\`\`$/,"").trim();
 const a=s.indexOf("{"),b=s.lastIndexOf("}"); if(a>=0&&b>=a)s=s.slice(a,b+1);
 const attempts=[
  s,
  s.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g,"$1\"$2\"$3"),
  s.replace(/,\s*([}\]])/g,"$1"),
  s.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)/g,"$1\"$2\"$3").replace(/,\s*([}\]])/g,"$1")
 ];
 for(const candidate of attempts){try{return JSON.parse(candidate)}catch{}}
 throw new Error("World continuity returned invalid JSON after safe normalization");
};
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
      p_event_id: crypto.randomUUID(),
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
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:H});
 if(req.method!=="POST") return new Response(JSON.stringify({success:false,error:"Method not allowed"}),{status:405,headers:H});
try{
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??Deno.env.get("TALEFORGE_SERVICE_ROLE_KEY"),gemini=Deno.env.get("GEMINI_API_KEY");if(!url||!key||!gemini)throw new Error("Missing service configuration.");
 if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) return new Response(JSON.stringify({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."}),{status:401,headers:H});
 const body=await req.json().catch(()=>({}));const chapterId=body?.chapter_id;const seriesId=body?.series_id;const dry=body?.dry_run===true;
 const db=createClient(url,key);let ch:any;
 if(chapterId){const q=await db.from("chapters").select("id,series_id,chapter_number,title,summary,content").eq("id",chapterId).eq("status","published").single();if(q.error)throw q.error;ch=q.data}
 else {const q=await db.from("chapters").select("id,series_id,chapter_number,title,summary,content").eq("status","published").eq("series_id",seriesId).order("chapter_number",{ascending:false}).limit(1).single();if(q.error)throw q.error;ch=q.data}
 const sid=ch.series_id;
 const dna=await db.from("story_dna").select("genre_profile,core_premise,world_rules,story_constraints").eq("series_id",sid).eq("status","active").order("version",{ascending:false}).limit(1).maybeSingle();if(dna.error)throw new Error("Unable to read story DNA: "+dna.error.message);
 const world=await db.from("story_world_elements").select("*").eq("series_id",sid).eq("status","active");if(world.error)throw new Error("Unable to read world canon: "+world.error.message);
 const prior=await db.from("chapters").select("chapter_number,title,summary,content").eq("series_id",sid).eq("status","published").lt("chapter_number",ch.chapter_number).order("chapter_number",{ascending:false}).limit(3);if(prior.error)throw new Error("Unable to read prior published chapters: "+prior.error.message);
 const prompt=`You are Aevora's world-continuity analyst. Extract and maintain the established canon of ONE fictional universe. Respect the supplied genre profile. Never import magic, cultivation, technology, physics, political systems, terminology, or other mechanics from another genre. Only record facts supported by the story. Distinguish newly established facts from changes to existing canon.

STORY DNA:
${JSON.stringify(dna.data??null)}

CURRENT WORLD CANON:
${JSON.stringify(world.data??[])}

RECENT PRIOR CHAPTERS:
${JSON.stringify(prior.data??[])}

CHAPTER:
${JSON.stringify({chapter_number:ch.chapter_number,title:ch.title,summary:ch.summary,content:String(ch.content??"").slice(0,18000)})}

Return ONLY JSON:
{
 elements:[{name,element_type,description,properties,rules,dependencies,known_by_characters,status}],
 events:[{element_name,event_type,before_state,after_state,evidence}],
 contradictions:[string]
}
Element types may include location, organization, faction, technology, magic_system, scientific_rule, artifact, species, culture, economy, political_system, historical_event, timeline_fact, resource, institution, other. Use only types appropriate to this story.`;
 if(dry)return new Response(JSON.stringify({success:true,version:VERSION,action:"dry_run",series_id:sid,chapter_number:ch.chapter_number,prompt_preview:prompt.slice(0,1800)}),{headers:H});
 // Fail closed before any Gemini request if provider state is unavailable or cooling down.
 const {data:providerState,error:providerStateError}=await db.from("taleforge_ai_provider_state").select("provider,consecutive_throttle_count,cooldown_until").eq("provider","gemini").maybeSingle();
 if(providerStateError || !providerState) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json"}});
 if(typeof providerState.consecutive_throttle_count!=="number"||!Number.isSafeInteger(providerState.consecutive_throttle_count)||providerState.consecutive_throttle_count<0) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable",reason:"invalid_provider_counter"}),{status:503,headers:H});
 const cooldownValue=providerState.cooldown_until;
 const cooldownUntil=cooldownValue ? Date.parse(cooldownValue) : 0;
 if(cooldownValue && !Number.isFinite(cooldownUntil)) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable",reason:"invalid_cooldown_timestamp"}),{status:503,headers:{"Content-Type":"application/json"}});
 if(cooldownUntil && cooldownUntil>Date.now()) return new Response(JSON.stringify({success:false,error:"provider_cooldown",cooldown_until:providerState.cooldown_until}),{status:429,headers:{"Content-Type":"application/json"}});
 const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(gemini)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.2,maxOutputTokens:7000,responseMimeType:"application/json"}})});if(!resp.ok)throw new Error(`Gemini HTTP ${resp.status}${resp.status===429?" RESOURCE_EXHAUSTED":""}`);
 const gd=await resp.json(),txt=gd?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("")??"";const x=clean(txt);if(!Array.isArray(x.elements)||!Array.isArray(x.events))throw new Error("Invalid world continuity result.");
 const existing=await db.from("story_world_elements").select("*").eq("series_id",sid).eq("status","active");if(existing.error)throw new Error("Unable to reload world canon: "+existing.error.message);const map=new Map((existing.data??[]).map((e:any)=>[`${e.element_type}::${e.name.toLowerCase()}`,e]));
 for(const item of x.elements){if(typeof item.name!=="string"||typeof item.element_type!=="string")continue;const old:any=map.get(`${item.element_type}::${item.name.toLowerCase()}`);const row={series_id:sid,name:item.name.trim(),element_type:item.element_type,description:item.description??old?.description??null,properties:item.properties??old?.properties??{},rules:item.rules??old?.rules??[],dependencies:item.dependencies??old?.dependencies??[],known_by_characters:item.known_by_characters??old?.known_by_characters??[],first_appearance_chapter:old?.first_appearance_chapter??ch.chapter_number,last_referenced_chapter:ch.chapter_number,status:item.status??"active",version:Number(old?.version??0)+1,updated_at:new Date().toISOString()};if(old){const write=await db.from("story_world_elements").update(row).eq("id",old.id);if(write.error)throw new Error("Unable to update world canon: "+write.error.message)}else{const write=await db.from("story_world_elements").insert(row);if(write.error)throw new Error("Unable to insert world canon: "+write.error.message)}}
 const latest=await db.from("story_world_elements").select("id,name,element_type").eq("series_id",sid);if(latest.error)throw new Error("Unable to reload world canon IDs: "+latest.error.message);const ids=new Map<string,string>((latest.data??[]).map((x:any):[string,string]=>[`${x.element_type}::${x.name.toLowerCase()}`,String(x.id)]));
 const priorEvents=await db.from("world_continuity_events").select("event_type,world_element_id,before_state,after_state,evidence").eq("chapter_id",ch.id);if(priorEvents.error)throw new Error("Unable to check existing world continuity events: "+priorEvents.error.message);const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;const eventKey=(v:any)=>JSON.stringify([v.event_type,v.world_element_id??null,canonical(v.before_state??{}),canonical(v.after_state??{}),v.evidence??""]);const seenEvents=new Set((priorEvents.data??[]).map((v:any)=>eventKey(v)));let eventsRecorded=0,eventsSkippedAsDuplicates=0,eventsSkippedUnmapped=0;for(const e of x.events){const name=String(e.element_name??"").trim().toLowerCase();const id=Array.from(ids.entries()).find(([k])=>k.endsWith(`::${name}`))?.[1];if(!id){eventsSkippedUnmapped++;continue;}const row={series_id:sid,chapter_id:ch.id,chapter_number:ch.chapter_number,event_type:String(e.event_type??"canon_change"),world_element_id:id,before_state:e.before_state??{},after_state:e.after_state??{},evidence:String(e.evidence??"")};const signature=eventKey(row);if(seenEvents.has(signature)){eventsSkippedAsDuplicates++;continue;}const ins=await db.from("world_continuity_events").insert(row);if(ins.error)throw new Error("Unable to record world continuity event: "+ins.error.message);seenEvents.add(signature);eventsRecorded++;}
 return new Response(JSON.stringify({success:true,version:VERSION,action:"world_continuity_updated",series_id:sid,chapter_number:ch.chapter_number,elements_updated:x.elements.length,events_recorded:eventsRecorded,events_skipped_as_duplicates:eventsSkippedAsDuplicates,events_skipped_unmapped:eventsSkippedUnmapped,contradictions:x.contradictions??[]}),{headers:H});
}catch(e){await recordGeminiQuotaCooldown(e);const providerMessage=e instanceof Error?e.message:String(e);const quotaFailure=providerMessage.includes("Gemini HTTP 429")||providerMessage.includes("RESOURCE_EXHAUSTED");const providerOverloaded=providerMessage.includes("Gemini HTTP 503");return new Response(JSON.stringify({success:false,version:VERSION,retryable:quotaFailure||providerOverloaded,reason:quotaFailure?"provider_quota_blocked":providerOverloaded?"provider_temporarily_unavailable":"world_continuity_failed",error:quotaFailure?"Gemini quota or rate limit was reached; retry after cooldown.":providerOverloaded?"Gemini is temporarily unavailable; retry after cooldown.":"World continuity failed; internal diagnostics were withheld."}),{status:quotaFailure?429:providerOverloaded?503:500,headers:H})}
});