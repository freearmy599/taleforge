import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "release-scheduler-v5-contiguous-approved-release";
const corsHeaders = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

function response(body: unknown, status=200) {
  return new Response(JSON.stringify(body,null,2), {
    status, headers:{...corsHeaders,"Content-Type":"application/json"}
  });
}
function message(e: unknown){ return e instanceof Error ? e.message : String(e); }

Deno.serve(async (req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return response({success:false,error:"Method not allowed"},405);

  try{
    const url=Deno.env.get("SUPABASE_URL");
    const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key) return response({success:false,error:"Missing Supabase environment configuration."},500);

    const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json().catch(()=>({}));
    const now=new Date();
    const scheduleId=body?.schedule_id??null;
    const dryRun=body?.dry_run===true;

    let query=supabase.from("release_schedules")
      .select("*, series:series_id(id,title,status)")
      .eq("enabled",true)
      .neq("schedule_mode","manual");

    if(scheduleId) query=query.eq("id",scheduleId);
    else query=query.or(`next_release_at.is.null,next_release_at.lte.${now.toISOString()}`);

    const {data:schedules,error:scheduleError}=await query;
    if(scheduleError) return response({success:false,error:"Failed to load due release schedules.",details:message(scheduleError)},500);

    const results=[];

    for(const schedule of schedules??[]){
      const leaseToken=crypto.randomUUID();
      const leaseClaim=await supabase.rpc("aevora_claim_release_scheduler_lease",{
        p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180
      });
      if(leaseClaim.error || leaseClaim.data!==true){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_unavailable",
          reason:"Another scheduler owns this schedule or the lease could not be claimed.",
          details:leaseClaim.error?message(leaseClaim.error):null});
        continue;
      }
      let leaseLost=false;
      try{
      const series=schedule.series;
      if(!series || ["draft","cancelled","hiatus"].includes(series.status)){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"skipped",reason:"Series is not currently publishable."});
        continue;
      }

      const {data:lifecycle,error:lifeError}=await supabase.from("story_lifecycle")
        .select("lifecycle_status,daily_chapters_min,daily_chapters_max,launch_chapter_count,minimum_buffer_chapters,target_buffer_chapters")
        .eq("series_id",schedule.series_id).maybeSingle();

      if(lifeError){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"error",reason:"Failed to load story lifecycle.",details:message(lifeError)});
        continue;
      }

      let lifecycleStatus=lifecycle?.lifecycle_status??"active";
      let lifecycleTransition=null;

      // Generic launch gate: every future series leaves preparing only after
      // the configured number of distinct chapters has passed all review gates.
      if(lifecycleStatus==="preparing"){
        const launchCount=Math.max(1,Number(lifecycle?.launch_chapter_count??5));
        const {data:approved,error:approvedError}=await supabase.from("chapter_generation_outputs")
          .select("chapter_number,created_at")
          .eq("series_id",schedule.series_id)
          .eq("generation_status","approved")
          .order("chapter_number",{ascending:true});

        if(approvedError){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"error",reason:"Failed to inspect launch-ready chapters.",details:message(approvedError)});
          continue;
        }

        const distinct=[...new Set((approved??[]).map((x:any)=>Number(x.chapter_number)).filter(Number.isFinite))].sort((a,b)=>a-b);
        // Launch requires the first N chapters, in order, to be approved.
        // Later approved chapters cannot bypass an unapproved Chapter 1.
        const approvedSet=new Set<number>(distinct);
        const launchReady=Array.from({length:launchCount},(_,i)=>i+1).filter(n=>approvedSet.has(n));
        // Approval is necessary but not sufficient for activation. Continue
        // publishing the contiguous approved launch sequence; activation is
        // checked after database-confirmed publication to avoid a deadlock.
        lifecycleTransition=null;
      }

      const {data:latestPublished}=await supabase.from("chapters")
        .select("chapter_number").eq("series_id",schedule.series_id).eq("status","published")
        .order("chapter_number",{ascending:false}).limit(1).maybeSingle();
      const latestNumber=latestPublished?.chapter_number??0;

      const {data:readyOutputs,error:readyError}=await supabase.from("chapter_generation_outputs")
        .select("id,chapter_number,title,generation_status,created_at")
        .eq("series_id",schedule.series_id).eq("generation_status","approved")
        .gt("chapter_number",latestNumber).order("chapter_number",{ascending:true});

      if(readyError){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"error",reason:"Failed to inspect ready chapters.",details:message(readyError)});
        continue;
      }

      // Deduplicate by chapter number so multiple attempts/reviews can never
      // cause duplicate publication of the same chapter.
      const uniqueReady=[]; const seen=new Set<number>();
      // Publish only a contiguous sequence beginning at latestPublished + 1.
      // This prevents an approved Chapter 2+ from publishing while Chapter 1 is missing.
      let expectedNumber=latestNumber+1;
      for(const row of readyOutputs??[]){
        const n=Number(row.chapter_number);
        if(seen.has(n)) continue;
        if(n!==expectedNumber) break;
        seen.add(n);
        uniqueReady.push(row);
        expectedNumber++;
      }

      const dailyMin=Math.max(1,Number(lifecycle?.daily_chapters_min??2));
      const dailyMax=Math.max(dailyMin,Number(lifecycle?.daily_chapters_max??3));
      const publishCount=Math.min(uniqueReady.length,dailyMax);
      let published:any[]=[];
      let publicationFailed=false;
      let attemptedCount=0;

      if(!dryRun && schedule.auto_publish && publishCount>0){
        for(const candidate of uniqueReady.slice(0,publishCount)){
          const renewed=await supabase.rpc("aevora_renew_release_scheduler_lease",{
            p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180
          });
          if(renewed.error || renewed.data!==true){
            leaseLost=true;
            publicationFailed=true;
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_lost",
              chapter_number:candidate.chapter_number,details:renewed.error?message(renewed.error):null});
            break;
          }
          attemptedCount++;
          const r=await fetch(url+"/functions/v1/release-publisher",{
            method:"POST",
            headers:{"Content-Type":"application/json",Authorization:"Bearer "+key,apikey:key},
            body:JSON.stringify({output_id:candidate.id})
          });
          const t=await r.text(); let d:any;
          try{d=JSON.parse(t)}catch{d=t}
          const responseConfirmed=r.ok && d!==null && typeof d==="object"
            && d.success===true && d.published===true
            && d.status==="published" && typeof d.chapter_id==="string" && d.chapter_id.length>0;
          if(!responseConfirmed){
            publicationFailed=true;
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"publish_unconfirmed",
              chapter_number:candidate.chapter_number,http_status:r.status,details:d});
            break;
          }
          const {data:confirmedChapter,error:confirmError}=await supabase.from("chapters")
            .select("id,status,series_id,chapter_number,published_at")
            .eq("id",d.chapter_id).eq("series_id",schedule.series_id)
            .eq("chapter_number",candidate.chapter_number).maybeSingle();
          if(confirmError || !confirmedChapter || confirmedChapter.status!=="published"){
            publicationFailed=true;
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"publish_unconfirmed",
              chapter_number:candidate.chapter_number,details:confirmError?message(confirmError):"Database chapter status is not published."});
            break;
          }
          published.push({...d,status:confirmedChapter.status});
        }
      }

      if(!dryRun && lifecycleStatus==="preparing" && published.length>0 && !publicationFailed && !leaseLost){
        const launchCount=Math.max(1,Number(lifecycle?.launch_chapter_count??5));
        const {data:launchPublished,error:launchPublishedError}=await supabase.from("chapters")
          .select("chapter_number").eq("series_id",schedule.series_id).eq("status","published")
          .lte("chapter_number",launchCount);
        const {data:launchApproved,error:launchApprovedError}=await supabase.from("chapter_generation_outputs")
          .select("chapter_number").eq("series_id",schedule.series_id).in("generation_status",["approved","published"])
          .lte("chapter_number",launchCount);
        if(launchPublishedError || launchApprovedError){
          publicationFailed=true;
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lifecycle_verification_failed",
            details:message(launchPublishedError??launchApprovedError)});
        }else{
          const publishedSet=new Set((launchPublished??[]).map((x:any)=>Number(x.chapter_number)));
          const approvedSet=new Set((launchApproved??[]).map((x:any)=>Number(x.chapter_number)));
          const launchNumbers=Array.from({length:launchCount},(_,i)=>i+1);
          const launchReady=launchNumbers.filter(n=>publishedSet.has(n)&&approvedSet.has(n));
          if(launchReady.length===launchCount){
            const renewed=await supabase.rpc("aevora_renew_release_scheduler_lease",{
              p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180
            });
            if(renewed.error || renewed.data!==true){
              leaseLost=true;
              publicationFailed=true;
            }else{
              const {error:updateError}=await supabase.from("story_lifecycle")
                .update({lifecycle_status:"active",last_lifecycle_review_at:new Date().toISOString(),updated_at:new Date().toISOString()})
                .eq("series_id",schedule.series_id).eq("lifecycle_status","preparing");
              if(updateError){
                publicationFailed=true;
                results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lifecycle_transition_failed",details:message(updateError)});
              }else{
                lifecycleTransition={from:"preparing",to:"active",launch_ready_chapters:launchReady,required_launch_chapters:launchCount};
                lifecycleStatus="active";
              }
            }
          }
        }
      }

      let nextRelease:any=null;
      if(schedule.schedule_mode==="interval"){
        const hours=Number(schedule.interval_hours);
        if(Number.isFinite(hours)&&hours>0){
          // A series that has just crossed its preparing -> active launch gate
          // must release its first approved chapter immediately. After that,
          // all releases follow the configured interval.
          if(lifecycleTransition?.to==="active"){
            nextRelease=now;
          }else{
            const base=schedule.next_release_at?new Date(schedule.next_release_at):now;
            nextRelease=new Date((base>now?base:now).getTime()+hours*3600000);
          }
        }
      }else if(schedule.schedule_mode==="weekly" && Number.isInteger(schedule.preferred_weekday) && schedule.preferred_time){
        const candidate=new Date(now);
        const current=candidate.getUTCDay();
        let delta=(Number(schedule.preferred_weekday)-current+7)%7;
        if(delta===0)delta=7;
        candidate.setUTCDate(candidate.getUTCDate()+delta);
        const [hh,mm,ss="0"]=String(schedule.preferred_time).split(":");
        candidate.setUTCHours(Number(hh)||0,Number(mm)||0,Number(ss)||0,0);
        nextRelease=candidate;
      }

      const allSelectedConfirmed = !dryRun && schedule.auto_publish && publishCount>0
        && attemptedCount===publishCount && published.length===publishCount
        && !publicationFailed && !leaseLost;
      if(!dryRun && nextRelease && allSelectedConfirmed){
        const renewed=await supabase.rpc("aevora_renew_release_scheduler_lease",{
          p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180
        });
        if(renewed.error || renewed.data!==true){
          leaseLost=true;
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_lost_before_schedule_update",
            published_count:published.length,details:renewed.error?message(renewed.error):null});
        }else{
          const update:any={next_release_at:nextRelease.toISOString(),updated_at:new Date().toISOString(),last_release_at:now.toISOString()};
          const {error}=await supabase.from("release_schedules").update(update).eq("id",schedule.id);
          if(error){
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_update_failed",published,details:message(error)});
            continue;
          }
        }
      }

      results.push({
        schedule_id:schedule.id,series_id:schedule.series_id,series_title:series.title,
        action:leaseLost?"lease_lost":publicationFailed?"publication_incomplete":published.length?"published":"checked",
        lifecycle_status:lifecycleStatus,lifecycle_transition:lifecycleTransition,
        latest_published_chapter:latestNumber,ready_chapters:uniqueReady.length,
        daily_chapters_target:{min:dailyMin,max:dailyMax},published_count:published.length,
        auto_generate:schedule.auto_generate,auto_publish:schedule.auto_publish,
        published,next_release_at:nextRelease?.toISOString()??schedule.next_release_at,dry_run:dryRun
      });
      }finally{
        const released=await supabase.rpc("aevora_release_scheduler_lease",{
          p_schedule_id:schedule.id,p_lease_token:leaseToken
        });
        if(released.error || released.data!==true){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_release_warning",
            details:released.error?message(released.error):"Lease token no longer owned; release was not confirmed."});
        }
      }
    }

    return response({
      success:true,mode:"release-scheduler",scheduler_version:VERSION,
      checked_at:now.toISOString(),due_schedules:schedules?.length??0,results,
      note:"Generic lifecycle gate: every series transitions from preparing to active after its configured launch chapter count is approved; publication then uses approved chapters only."
    });
  }catch(error){
    return response({success:false,mode:"release-scheduler",scheduler_version:VERSION,error:"Unexpected scheduler error.",details:message(error)},500);
  }
});