import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const VERSION="semantic-continuity-extraction-v6-cooldown-preclaim";
const H={"Content-Type":"application/json"};

Deno.serve(async(req)=>{
  let job:any=null;
  if(req.method==="OPTIONS") return new Response("ok",{headers:H});
  if(req.method!=="POST") return new Response(JSON.stringify({success:false,error:"Method not allowed"}),{status:405,headers:H});
  try{
    const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key) throw new Error("Missing Supabase service configuration.");
    if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) {
      return new Response(JSON.stringify({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."}),{status:401,headers:H});
    }
    const body=await req.json().catch(()=>({}));
    const execute=body?.execute===true;
    const db=createClient(url,key);

    // Do not claim or mutate queued work while Gemini is cooling down.
    // Fail closed if provider state cannot be verified; dry-run remains available.
    if(execute){
      const {data:providerState,error:providerStateError}=await db
        .from("taleforge_ai_provider_state")
        .select("provider,consecutive_throttle_count,cooldown_until")
        .eq("provider","gemini")
        .maybeSingle();
      if(providerStateError || !providerState){
        return new Response(JSON.stringify({
          success:false,version:VERSION,error:"provider_state_unavailable"
        }),{status:503,headers:H});
      }
      const cooldownValue=providerState.cooldown_until;
      const cooldownUntil=cooldownValue ? Date.parse(cooldownValue) : 0;
      if(cooldownValue && !Number.isFinite(cooldownUntil)) return new Response(JSON.stringify({success:false,version:VERSION,error:"provider_state_unavailable",reason:"invalid_cooldown_timestamp"}),{status:503,headers:H});
      if(cooldownUntil && cooldownUntil>Date.now()){
        return new Response(JSON.stringify({
          success:false,version:VERSION,error:"provider_cooldown",
          cooldown_until:providerState.cooldown_until
        }),{status:429,headers:H});
      }
    }

    const {data:jobs,error:claimError}=await db.rpc("taleforge_claim_continuity_queue",{p_limit:1});
    if(claimError) throw claimError;
    job=jobs?.[0];

    if(!job)
      return new Response(JSON.stringify({success:true,version:VERSION,status:"empty"}),{headers:H});

    if(!execute){
      await db.from("taleforge_continuity_extraction_queue")
        .update({status:"pending",locked_at:null,updated_at:new Date().toISOString()})
        .eq("id",job.id);
      return new Response(JSON.stringify({success:true,version:VERSION,status:"dry_run",job_id:job.id,chapter_id:job.chapter_id,series_id:job.series_id,chapter_number:job.chapter_number}),{headers:H});
    }

    // Preflight: legacy/backfilled queue rows may exist without a continuity snapshot.
    // Do this BEFORE any Gemini-backed continuity workers so stale jobs cannot consume quota.
    const {data:snapPre,error:snapPreError}=await db.from("chapter_continuity_snapshots")
      .select("id,state_changes,unresolved_threads")
      .eq("series_id",job.series_id).eq("chapter_number",job.chapter_number)
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(snapPreError) throw snapPreError;
    if(!snapPre){
      const message="Skipped: no continuity snapshot exists for queued chapter; no Gemini calls were made.";
      await db.rpc("taleforge_complete_continuity_queue",{p_id:job.id,p_error:message});
      return new Response(JSON.stringify({success:true,version:VERSION,status:"skipped_missing_snapshot",job_id:job.id,series_id:job.series_id,chapter_number:job.chapter_number}),{headers:H});
    }

    const headers={"Content-Type":"application/json","Authorization":"Bearer "+key,"apikey":key};
    const base=url+"/functions/v1/";
    const results:any={};

    for(const name of ["character-continuity","world-continuity"]){
      const r=await fetch(base+name,{method:"POST",headers,body:JSON.stringify({chapter_id:job.chapter_id})});
      const t=await r.text();
      let data:any; try{data=JSON.parse(t)}catch{data={raw:t}};
      results[name]={ok:r.ok,status:r.status,data};
      if(!r.ok||data?.success===false) throw new Error(name+" failed: "+t.slice(0,1200));
    }

    const {data:charEvents,error:charError}=await db.from("character_continuity_events")
      .select("id,event_type,character_id,related_character_id,before_state,after_state,evidence")
      .eq("series_id",job.series_id).eq("chapter_number",job.chapter_number);
    if(charError) throw charError;

    const {data:worldEvents,error:worldError}=await db.from("world_continuity_events")
      .select("id,event_type,world_element_id,before_state,after_state,evidence")
      .eq("series_id",job.series_id).eq("chapter_number",job.chapter_number);
    if(worldError) throw worldError;

    const {data:threads,error:threadError}=await db.from("taleforge_narrative_thread_events")
      .select("id,thread_id,event_type,evidence")
      .eq("series_id",job.series_id).eq("chapter_number",job.chapter_number);
    if(threadError) throw threadError;

    const {data:snap,error:snapError}=await db.from("chapter_continuity_snapshots")
      .select("id,state_changes,unresolved_threads")
      .eq("series_id",job.series_id).eq("chapter_number",job.chapter_number)
      .order("created_at",{ascending:false}).limit(1).maybeSingle();
    if(snapError) throw snapError;
    if(!snap) throw new Error("Continuity snapshot disappeared during processing.");

    const stateChanges={
      ...((snap.state_changes&&typeof snap.state_changes==="object")?snap.state_changes:{}),
      semantic_extraction:{
        version:VERSION,status:"completed",completed_at:new Date().toISOString(),
        character_event_count:(charEvents??[]).length,world_event_count:(worldEvents??[]).length,
        thread_event_count:(threads??[]).length,character_events:charEvents??[],
        world_events:worldEvents??[],thread_events:threads??[]
      }
    };

    const {error:updateError}=await db.from("chapter_continuity_snapshots").update({state_changes:stateChanges}).eq("id",snap.id);
    if(updateError) throw updateError;

    const {data:memoryResult,error:memoryError}=await db.rpc("taleforge_consolidate_narrative_memory",{p_series_id:job.series_id,p_chapter_number:job.chapter_number});
    if(memoryError) throw memoryError;
    if(memoryResult?.status==="blocked") throw new Error("Narrative memory consolidation blocked: "+JSON.stringify(memoryResult));

    const {data:progressionResult,error:progressionError}=await db.rpc("taleforge_refresh_thread_progression",{p_series_id:job.series_id});
    if(progressionError) throw progressionError;

    const {error:doneError}=await db.rpc("taleforge_complete_continuity_queue",{p_id:job.id});
    if(doneError) throw doneError;

    return new Response(JSON.stringify({
      success:true,version:VERSION,status:"completed",job_id:job.id,chapter_id:job.chapter_id,
      series_id:job.series_id,chapter_number:job.chapter_number,
      character_events:(charEvents??[]).length,world_events:(worldEvents??[]).length,
      thread_events:(threads??[]).length,memory:memoryResult,progression:progressionResult
    }),{headers:H});

  }catch(e){
    if(job?.id){
      try{
        const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if(url&&key){
          const db=createClient(url,key);
          const attempts=Number(job.attempts||1);
          const message=e instanceof Error?e.message:String(e);
          if(attempts<3){
            await db.from("taleforge_continuity_extraction_queue").update({
              status:"pending",locked_at:null,last_error:message.slice(0,2000),updated_at:new Date().toISOString()
            }).eq("id",job.id);
          }else{
            await db.rpc("taleforge_complete_continuity_queue",{p_id:job.id,p_error:message.slice(0,2000)});
          }
        }
      }catch(_){}
    }
    return new Response(JSON.stringify({success:false,version:VERSION,error:e instanceof Error?e.message:String(e)}),{status:500,headers:H});
  }
});