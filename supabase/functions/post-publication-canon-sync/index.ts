import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
const VERSION="post-publication-canon-sync-v4-fail-closed-subresults";
const H={"Content-Type":"application/json"};

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:H});
  if(req.method!=="POST") return new Response(JSON.stringify({success:false,error:"Method not allowed"}),{status:405,headers:H});
  try{
    const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key) throw new Error("Missing Supabase service configuration.");
    if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES"))) {
      return new Response(JSON.stringify({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."}),{status:401,headers:H});
    }
    const body=await req.json().catch(()=>null);
    if(body===null||typeof body!=="object"||Array.isArray(body)) return new Response(JSON.stringify({success:false,error:"Request body must be a JSON object."}),{status:400,headers:H});
    const chapterId=typeof body.chapter_id==="string"?body.chapter_id.trim():"";
    if(!chapterId) return new Response(JSON.stringify({success:false,error:"chapter_id must be a non-empty string."}),{status:400,headers:H});
    const headers={"Content-Type":"application/json","Authorization":"Bearer "+key,"apikey":key};
    const base=url+"/functions/v1/";
    const api=url+"/rest/v1/";
    const results:any={};

    const chRes=await fetch(api+"chapters?id=eq."+encodeURIComponent(chapterId)+"&select=id,series_id,status,published_at",{
      headers:{"Authorization":"Bearer "+key,"apikey":key}
    });
    if(!chRes.ok) throw new Error("Unable to load published chapter: "+await chRes.text());
    const chapter=(await chRes.json())?.[0];
    if(!chapter) throw new Error("Published chapter not found.");
    if(chapter.status!=="published") throw new Error("Post-publication sync received a chapter that is not published.");

    for(const name of ["character-continuity","world-continuity"]){
      const r=await fetch(base+name,{method:"POST",headers,body:JSON.stringify({chapter_id:chapterId})});
      const t=await r.text(); let data:any; try{data=JSON.parse(t)}catch{data={raw:t}};
      // A 2xx response is not sufficient if the downstream function explicitly reports failure.
      results[name]={ok:r.ok && data?.success===true,status:r.status,data};
    }


    const intelligenceRes=await fetch(api+"story_intelligence?series_id=eq."+encodeURIComponent(chapter.series_id)+"&select=series_id,title,chapter_count,published_chapters,latest_chapter_at,recent_chapters_7d,days_since_update,trending_score,intelligence_status",{
      headers:{"Authorization":"Bearer "+key,"apikey":key}
    });
    if(!intelligenceRes.ok) throw new Error("Unable to read story intelligence view: "+await intelligenceRes.text());
    const intelligence=(await intelligenceRes.json())?.[0]||null;

    const trendingRes=await fetch(api+"story_trending_scores?series_id=eq."+encodeURIComponent(chapter.series_id)+"&select=series_id,trending_score,opens,completions,follows,bookmarks,latest_activity",{
      headers:{"Authorization":"Bearer "+key,"apikey":key}
    });
    if(!trendingRes.ok) throw new Error("Unable to read story trending view: "+await trendingRes.text());
    const trending=(await trendingRes.json())?.[0]||null;

    const failed=Object.values(results).some((x:any)=>!x.ok);
    return new Response(JSON.stringify({
      success:!failed,version:VERSION,chapter_id:chapterId,series_id:chapter.series_id,
      intelligence:{source:"story_intelligence view",data:intelligence},
      trending:{source:"story_trending_scores view",data:trending},
      results
    }),{status:failed?502:200,headers:H});
  }catch(e){
    return new Response(JSON.stringify({success:false,version:VERSION,error:e instanceof Error?e.message:String(e)}),{status:500,headers:H});
  }
});