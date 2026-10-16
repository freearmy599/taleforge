import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
const VERSION = "character-continuity-v10-atomic-cooldown-rpc";const H={"Content-Type":"application/json"};
const clean=(t:string)=>{const s=t.trim().replace(/^\`\`\`json\s*/,"").replace(/^\`\`\`\s*/,"").replace(/\s*\`\`\`$/,"").trim();const a=s.indexOf("{"),b=s.lastIndexOf("}");return JSON.parse(a>=0?s.slice(a,b+1):s)};
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
 const body=await req.json().catch(()=>({}));const seriesId=body?.series_id;const chapterId=body?.chapter_id;const dry=body?.dry_run===true;
 const db=createClient(url,key);
 let ch:any;
 if(chapterId){const q=await db.from("chapters").select("id,series_id,chapter_number,title,summary,content").eq("id",chapterId).eq("status","published").single();if(q.error)throw q.error;ch=q.data}
 else {const q=await db.from("chapters").select("id,series_id,chapter_number,title,summary,content").eq("status","published").eq("series_id",seriesId).order("chapter_number",{ascending:false}).limit(1).single();if(q.error)throw q.error;ch=q.data}
 const sid=ch.series_id;
 const dna=await db.from("story_dna").select("genre_profile,protagonist_profiles,relationship_map,world_rules").eq("series_id",sid).eq("status","active").order("version",{ascending:false}).limit(1).maybeSingle();if(dna.error)throw new Error("Unable to read story DNA: "+dna.error.message);
 const chars=await db.from("story_characters").select("*").eq("series_id",sid).eq("status","active");if(chars.error)throw new Error("Unable to read character canon: "+chars.error.message);
 const rels=await db.from("character_relationships").select("*").eq("series_id",sid).eq("status","active");if(rels.error)throw new Error("Unable to read relationship canon: "+rels.error.message);
 const prior=await db.from("chapters").select("chapter_number,title,summary,content").eq("series_id",sid).eq("status","published").lt("chapter_number",ch.chapter_number).order("chapter_number",{ascending:false}).limit(3);if(prior.error)throw new Error("Unable to read prior published chapters: "+prior.error.message);
 const prompt=`You are Aevora's character continuity analyst. Analyze one published chapter against the existing character state. Respect the story's established genre and world. Do not invent character systems or genre mechanics. Identify only changes supported by the chapter.

STORY DNA:
${JSON.stringify(dna.data??null)}

CURRENT CHARACTER REGISTRY:
${JSON.stringify(chars.data??[])}

CURRENT RELATIONSHIPS:
${JSON.stringify(rels.data??[])}

RECENT PRIOR CHAPTERS:
${JSON.stringify(prior.data??[])}

CHAPTER TO ANALYZE:
${JSON.stringify({chapter_number:ch.chapter_number,title:ch.title,summary:ch.summary,content:String(ch.content??"").slice(0,16000)})}

Return ONLY JSON:
{
 characters: [
  {name,role,aliases,profile,goals,motivations,traits,knowledge_state,secrets,promises,unresolved_conflicts,current_state,status}
 ],
 relationships: [
  {character_a,character_b,relationship_type,status,strength,details,history}
 ],
 events: [
  {event_type,character_name,related_character_name,before_state,after_state,evidence}
 ],
 contradictions: [string]
}
Only include characters materially present or established by the chapter. Preserve existing identities. If a relationship did not change, do not manufacture a change.`;
 if(dry)return new Response(JSON.stringify({success:true,version:VERSION,action:"dry_run",series_id:sid,chapter_number:ch.chapter_number,prompt_preview:prompt.slice(0,1800)}),{headers:H});
 // Fail closed before any Gemini request if provider state is unavailable or cooling down.
 const {data:providerState,error:providerStateError}=await db.from("taleforge_ai_provider_state").select("provider,consecutive_throttle_count,cooldown_until").eq("provider","gemini").maybeSingle();
 if(providerStateError || !providerState) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable"}),{status:503,headers:{"Content-Type":"application/json"}});
 if(typeof providerState.consecutive_throttle_count!=="number"||!Number.isSafeInteger(providerState.consecutive_throttle_count)||providerState.consecutive_throttle_count<0) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable",reason:"invalid_provider_counter"}),{status:503,headers:H});
 const cooldownValue=providerState.cooldown_until;
 const cooldownUntil=cooldownValue ? Date.parse(cooldownValue) : 0;
 if(cooldownValue && !Number.isFinite(cooldownUntil)) return new Response(JSON.stringify({success:false,error:"provider_state_unavailable",reason:"invalid_cooldown_timestamp"}),{status:503,headers:{"Content-Type":"application/json"}});
 if(cooldownUntil && cooldownUntil>Date.now()) return new Response(JSON.stringify({success:false,error:"provider_cooldown",cooldown_until:providerState.cooldown_until}),{status:429,headers:{"Content-Type":"application/json"}});
 const resp=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(gemini)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.25,maxOutputTokens:6500,responseMimeType:"application/json"}})});if(!resp.ok)throw new Error(`Gemini HTTP ${resp.status}${resp.status===429?" RESOURCE_EXHAUSTED":""}`);
 const gd=await resp.json(),txt=gd?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text??"").join("")??"";const x=clean(txt);if(!Array.isArray(x.characters)||!Array.isArray(x.relationships)||!Array.isArray(x.events))throw new Error("Invalid continuity result.");
 const map=new Map((chars.data??[]).map((c:any)=>[c.name.toLowerCase(),c]));
 for(const item of x.characters){if(typeof item.name!=="string"||!item.name.trim())continue;const old:any=map.get(item.name.toLowerCase());const row={series_id:sid,name:item.name.trim(),role:item.role??old?.role??null,aliases:Array.isArray(item.aliases)?item.aliases:(old?.aliases??[]),profile:item.profile??old?.profile??{},goals:item.goals??old?.goals??[],motivations:item.motivations??old?.motivations??[],traits:item.traits??old?.traits??[],knowledge_state:item.knowledge_state??old?.knowledge_state??{},secrets:item.secrets??old?.secrets??[],promises:item.promises??old?.promises??[],unresolved_conflicts:item.unresolved_conflicts??old?.unresolved_conflicts??[],current_state:item.current_state??old?.current_state??{},first_appearance_chapter:old?.first_appearance_chapter??ch.chapter_number,last_seen_chapter:ch.chapter_number,status:item.status??"active",version:Number(old?.version??0)+1,updated_at:new Date().toISOString()};if(old){const write=await db.from("story_characters").update(row).eq("id",old.id);if(write.error)throw new Error("Unable to update character canon: "+write.error.message)}else{const write=await db.from("story_characters").insert(row);if(write.error)throw new Error("Unable to insert character canon: "+write.error.message)}}
 const latest=await db.from("story_characters").select("id,name").eq("series_id",sid);if(latest.error)throw new Error("Unable to reload character canon: "+latest.error.message);const ids=new Map((latest.data??[]).map((x:any)=>[x.name.toLowerCase(),x.id]));
 for(const rel of x.relationships){const a=ids.get(String(rel.character_a??"").toLowerCase()),b=ids.get(String(rel.character_b??"").toLowerCase());if(!a||!b||a===b)continue;const existing=await db.from("character_relationships").select("id,version,history").eq("series_id",sid).or(`and(character_a_id.eq.${a},character_b_id.eq.${b}),and(character_a_id.eq.${b},character_b_id.eq.${a})`).limit(1).maybeSingle();const history=Array.isArray(rel.history)?rel.history:(existing.data?.history??[]);const row={series_id:sid,character_a_id:a,character_b_id:b,relationship_type:String(rel.relationship_type??"relationship"),status:rel.status??"active",strength:rel.strength??null,details:rel.details??{},history,last_changed_chapter:ch.chapter_number,version:Number(existing.data?.version??0)+1,updated_at:new Date().toISOString()};if(existing.error)throw new Error("Unable to read existing relationship: "+existing.error.message);if(existing.data){const write=await db.from("character_relationships").update(row).eq("id",existing.data.id);if(write.error)throw new Error("Unable to update relationship canon: "+write.error.message)}else{const write=await db.from("character_relationships").insert(row);if(write.error)throw new Error("Unable to insert relationship canon: "+write.error.message)}}
 const priorEvents=await db.from("character_continuity_events").select("event_type,character_id,related_character_id,before_state,after_state,evidence").eq("chapter_id",ch.id);if(priorEvents.error)throw new Error("Unable to check existing character continuity events: "+priorEvents.error.message);const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;const eventKey=(v:any)=>JSON.stringify([v.event_type,v.character_id??null,v.related_character_id??null,canonical(v.before_state??{}),canonical(v.after_state??{}),v.evidence??""]);const seenEvents=new Set((priorEvents.data??[]).map((v:any)=>eventKey(v)));let eventsRecorded=0,eventsSkippedAsDuplicates=0,eventsSkippedUnmapped=0;for(const e of x.events){const a=ids.get(String(e.character_name??"").toLowerCase());const b=ids.get(String(e.related_character_name??"").toLowerCase())??null;if(!a)continue;const row={series_id:sid,chapter_id:ch.id,chapter_number:ch.chapter_number,event_type:String(e.event_type??"state_change"),character_id:a,related_character_id:b,before_state:e.before_state??{},after_state:e.after_state??{},evidence:e.evidence??""};const signature=eventKey(row);if(seenEvents.has(signature)){eventsSkippedAsDuplicates++;continue;}const write=await db.from("character_continuity_events").insert(row);if(write.error)throw new Error("Unable to record character continuity event: "+write.error.message);seenEvents.add(signature);eventsRecorded++;}
 return new Response(JSON.stringify({success:true,version:VERSION,action:"continuity_updated",series_id:sid,chapter_number:ch.chapter_number,characters_updated:x.characters.length,relationships_updated:x.relationships.length,events_recorded:eventsRecorded,events_skipped_as_duplicates:eventsSkippedAsDuplicates,events_skipped_unmapped:eventsSkippedUnmapped,contradictions:x.contradictions??[]}),{headers:H});
}catch(e){await recordGeminiQuotaCooldown(e);const providerMessage=e instanceof Error?e.message:String(e);const quotaFailure=providerMessage.includes("Gemini HTTP 429")||providerMessage.includes("RESOURCE_EXHAUSTED");const providerOverloaded=providerMessage.includes("Gemini HTTP 503");return new Response(JSON.stringify({success:false,version:VERSION,retryable:quotaFailure||providerOverloaded,reason:quotaFailure?"provider_quota_blocked":providerOverloaded?"provider_temporarily_unavailable":"character_continuity_failed",error:quotaFailure?"Gemini quota or rate limit was reached; retry after cooldown.":providerOverloaded?"Gemini is temporarily unavailable; retry after cooldown.":"Character continuity failed; internal diagnostics were withheld."}),{status:quotaFailure?429:providerOverloaded?503:500,headers:H})}
});