import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";

const VERSION = "publication-sync-processor-v2-report-partial-failures";
const H = {"Content-Type":"application/json"};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok",{headers:H});
  if (req.method !== "POST") return new Response(JSON.stringify({success:false,error:"Method not allowed"}),{status:405,headers:H});
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("Missing Supabase service configuration.");
    if (!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) {
      return new Response(JSON.stringify({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."}),{status:401,headers:H});
    }

    const supabase = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});

    // Recover abandoned workers and claim a small batch atomically enough for
    // the short transaction: rows are marked processing before network calls.
    const staleRecovery = await supabase.from("publication_sync_outbox")
      .update({status:"failed",last_error:"Recovered stale processing event",next_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()})
      .eq("status","processing")
      .or("locked_at.is.null,locked_at.lt."+new Date(Date.now()-10*60*1000).toISOString());
    if (staleRecovery.error) throw new Error("Unable to recover stale outbox events: " + staleRecovery.error.message);

    const {data: events,error} = await supabase
      .from("publication_sync_outbox")
      .select("id,chapter_id,attempts")
      .in("status",["pending","failed"])
      .lt("attempts",8)
      .lte("next_attempt_at",new Date().toISOString())
      .order("created_at",{ascending:true})
      .limit(5);

    if (error) throw error;
    const results:any[] = [];

    for (const event of events ?? []) {
      const now = new Date().toISOString();
      const claim = await supabase.from("publication_sync_outbox")
        .update({status:"processing",locked_at:now,attempts:event.attempts+1,updated_at:now})
        .eq("id",event.id)
        .in("status",["pending","failed"])
        .select("id,chapter_id,attempts")
        .maybeSingle();

      if (claim.error) {
        results.push({id:event.id,chapter_id:event.chapter_id,status:"claim_failed",details:claim.error.message});
        continue;
      }
      if (!claim.data) continue;

      try {
        const response = await fetch(url+"/functions/v1/post-publication-canon-sync",{
          method:"POST",
          headers:{
            "Content-Type":"application/json",
            "Authorization":"Bearer "+key,
            "apikey":key
          },
          body:JSON.stringify({chapter_id:event.chapter_id})
        });
        const text = await response.text();
        let data:any; try { data = JSON.parse(text); } catch { data = {raw:text}; }

        if (!response.ok || data?.success !== true) {
          throw new Error("Canon sync failed: HTTP "+response.status+" "+text.slice(0,1000));
        }

        const completion = await supabase.from("publication_sync_outbox").update({
          status:"succeeded",
          processed_at:new Date().toISOString(),
          locked_at:null,
          last_error:null,
          updated_at:new Date().toISOString()
        }).eq("id",event.id).eq("status","processing").eq("locked_at",now).select("id").maybeSingle();
        if (completion.error || !completion.data) {
          throw new Error("Outbox completion write was not confirmed: " + (completion.error?.message ?? "event row no longer processing"));
        }

        results.push({id:event.id,chapter_id:event.chapter_id,status:"succeeded"});
      } catch (e) {
        const attempts = event.attempts + 1;
        const delayMinutes = Math.min(60, Math.pow(2,Math.max(0,attempts-1))*5);
        const retryWrite = await supabase.from("publication_sync_outbox").update({
          status: attempts >= 8 ? "failed" : "pending",
          last_error: e instanceof Error ? e.message : String(e),
          next_attempt_at:new Date(Date.now()+delayMinutes*60*1000).toISOString(),
          locked_at:null,
          updated_at:new Date().toISOString()
        }).eq("id",event.id).eq("status","processing").eq("locked_at",now).select("id").maybeSingle();
        if (retryWrite.error || !retryWrite.data) {
          results.push({id:event.id,chapter_id:event.chapter_id,status:"retry_state_update_failed",attempts,details:retryWrite.error?.message ?? "event row no longer processing"});
        } else {
          results.push({id:event.id,chapter_id:event.chapter_id,status:attempts >= 8 ? "failed_terminal" : "retry_scheduled",attempts});
        }
      }
    }

    const batchSucceeded=results.every((result:any)=>result.status==="succeeded");
    return new Response(JSON.stringify({success:batchSucceeded,version:VERSION,processed:results.length,results}),{status:200,headers:H});
  } catch (e) {
    return new Response(JSON.stringify({success:false,version:VERSION,error:e instanceof Error?e.message:String(e)}),{status:500,headers:H});
  }
});