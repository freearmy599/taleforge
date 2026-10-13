import { isTrustedInternalApiKey } from "../_shared/internal-api-key.ts";
import { nextWeeklyRelease } from "./weekly-schedule.ts";
import { resolveNextIntervalRelease } from "./interval-schedule.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"; import { qualifyReviewedOutputs, matchesPublishedChapterOutput } from "./review-qualified-outputs.ts"; import { inspectPublishedChapterHistory } from "./published-history.ts";

const VERSION = "release-scheduler-v14-complete-failure-aggregation";
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
    // Cron uses the project's newer secret API key in apikey. Do not compare
    // it to SUPABASE_SERVICE_ROLE_KEY: that environment variable is the legacy JWT key.
    if(!isTrustedInternalApiKey(req.headers.get("apikey"),key,Deno.env.get("SUPABASE_SECRET_KEYS"),Deno.env.get("AEVORA_INTERNAL_API_KEY_NAMES")))
      return response({success:false,error:"Caller must authenticate with a configured server-side Supabase API key."},401);

    const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    let body:any;
    try{
      body=await req.json();
    }catch{
      return response({success:false,error:"Request body must be valid JSON."},400);
    }
    if(body===null || typeof body!=="object" || Array.isArray(body)){
      return response({success:false,error:"Request body must be a JSON object."},400);
    }
    const now=new Date();
    const rawScheduleId=body.schedule_id;
    if(rawScheduleId!==undefined
      && (typeof rawScheduleId!=="string" || rawScheduleId.trim().length===0)){
      return response({success:false,error:"schedule_id must be a non-empty string when provided."},400);
    }
    // An empty or malformed explicit ID must never degrade into an unscoped batch run.
    const scheduleId=typeof rawScheduleId==="string"?rawScheduleId.trim():null;
    if(body.dry_run!==undefined && typeof body.dry_run!=="boolean"){
      return response({success:false,error:"dry_run must be a boolean when provided."},400);
    }
    const dryRun=body.dry_run===true;

    const buildScheduleQuery=()=>{
      let q=supabase.from("release_schedules")
        .select("*, series:series_id(id,title,status)")
        .neq("schedule_mode","manual");
      // Only a targeted dry run may inspect a disabled schedule. Real runs and
      // unscoped diagnostics must remain limited to enabled schedules.
      if(!dryRun || !scheduleId) q=q.eq("enabled",true);
      if(scheduleId) q=q.eq("id",scheduleId);
      // Explicit schedule IDs are useful for diagnostics, but must not bypass
      // the due-time safety gate during a real run. Dry-run may inspect future rows.
      if(!dryRun || !scheduleId) q=q.or(`next_release_at.is.null,next_release_at.lte.${now.toISOString()}`);
      // Do not repeatedly claim leases and scan disabled schedules on every cron tick.
      // Explicit IDs can inspect disabled schedules, but auto-publish remains separately gated.
      if(!dryRun && !scheduleId) q=q.eq("auto_publish",true);
      return q.order("id",{ascending:true});
    };
    const schedules:any[]=[];
    let scheduleError:any=null;
    for(let offset=0;;offset+=500){
      const {data,error}=await buildScheduleQuery().range(offset,offset+499);
      if(error){scheduleError=error;break;}
      const page=data??[];
      schedules.push(...page);
      if(page.length<500) break;
    }
    if(scheduleError) return response({success:false,error:"Failed to load due release schedules.",details:message(scheduleError)},500);

    const results=[];

    for(const schedule of schedules){
      const leaseToken=crypto.randomUUID();
      let leaseClaimed=false;
      if(!dryRun && schedule.auto_publish){
        let leaseClaim:any=null;
        try{
          leaseClaim=await supabase.rpc("aevora_claim_release_scheduler_lease",{
            p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180
          });
        }catch(leaseClaimError){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_unavailable",
            reason:"Lease claim request failed; this schedule was skipped safely.",details:message(leaseClaimError)});
          continue;
        }
        if(leaseClaim?.error || leaseClaim?.data!==true){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_unavailable",
            reason:"Another scheduler owns this schedule or the lease could not be claimed.",
            details:leaseClaim?.error?message(leaseClaim.error):null});
          continue;
        }
        leaseClaimed=true;
      }
      let leaseLost=false;
      let confirmedPublishedCount=0;
      try{
      const series=schedule.series;
      if(!series || ["draft","cancelled","hiatus"].includes(series.status)){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"skipped",reason:"Series is not currently publishable."});
        continue;
      }

      // Validate scheduling configuration before any publication side effect.
      // A bad timezone or interval must not leave a published batch immediately due again.
      let weeklyReleaseAt:Date|null=null;
      if(schedule.schedule_mode==="weekly"){
        if(!Number.isInteger(schedule.preferred_weekday) || !schedule.preferred_time){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_config_invalid",
            reason:"Weekly schedules require a weekday and preferred time."});
          continue;
        }
        try{
          weeklyReleaseAt=nextWeeklyRelease(now,Number(schedule.preferred_weekday),String(schedule.preferred_time),String(schedule.timezone??"UTC"));
        }catch(scheduleTimeError){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_config_invalid",
            timezone:schedule.timezone??"UTC",details:message(scheduleTimeError)});
          continue;
        }
      }else if(schedule.schedule_mode==="interval"){
        try{
          // Validate the actual deadline arithmetic before any publication side effect.
          resolveNextIntervalRelease(now,schedule.interval_hours);
        }catch(intervalError){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_config_invalid",
            reason:"Interval schedules require a positive interval_hours value that resolves to a valid future timestamp.",
            details:message(intervalError)});
          continue;
        }
      }else{
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_config_invalid",
          reason:"Unsupported non-manual schedule mode."});
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
      const dailyMinConfig=Number(lifecycle?.daily_chapters_min??2);
      const dailyMaxConfig=Number(lifecycle?.daily_chapters_max??3);
      const launchCountConfig=Number(lifecycle?.launch_chapter_count??5);
      const invalidDailyConfig=!Number.isSafeInteger(dailyMinConfig) || dailyMinConfig<1
        || !Number.isSafeInteger(dailyMaxConfig) || dailyMaxConfig<dailyMinConfig || dailyMaxConfig>100;
      const invalidLaunchConfig=lifecycleStatus==="preparing"
        && (!Number.isSafeInteger(launchCountConfig) || launchCountConfig<1 || launchCountConfig>1000);
      if(invalidDailyConfig || invalidLaunchConfig){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lifecycle_config_invalid",
          reason:"Lifecycle chapter limits must be positive safe integers; daily maximum is capped at 100 and launch count at 1000."});
        continue;
      }

      // Preparing lifecycle activation is checked after publication using
      // database-confirmed published chapters and approved/published outputs below.
      // Avoid a redundant preflight output query; the publisher independently
      // enforces the publication review and all four review gates.

      // Load the full published-number history. Using only MAX(chapter_number)
      // silently skips missing chapters when a later chapter was published manually.
      const publishedHistory:any[]=[];
      let publishedHistoryError:any=null;
      for(let offset=0;;offset+=500){
        const {data:page,error}=await supabase.from("chapters")
          .select("id,chapter_number,published_at").eq("series_id",schedule.series_id).eq("status","published")
          .order("chapter_number",{ascending:true}).order("id",{ascending:true})
          .range(offset,offset+499);
        if(error){publishedHistoryError=error;break;}
        publishedHistory.push(...(page??[]));
        if((page??[]).length<500) break;
      }
      if(publishedHistoryError){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"error",
          reason:"Failed to inspect published chapter history.",details:message(publishedHistoryError)});
        continue;
      }
      const publishedHistoryCheck=inspectPublishedChapterHistory(publishedHistory.map((row:any)=>row.chapter_number));
      if(!publishedHistoryCheck.ok){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"published_chapter_history_invalid",
          reason:"Published chapter history contains an invalid or duplicate chapter number."});
        continue;
      }
      if(publishedHistoryCheck.firstMissingChapter!==null){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"published_chapter_gap",
          first_missing_chapter:publishedHistoryCheck.firstMissingChapter,
          highest_published_chapter:publishedHistoryCheck.latestNumber,
          reason:"A later chapter is published while an earlier chapter is missing. Automatic release is paused for this series until the numbering gap is repaired."});
        continue;
      }
      const latestNumber=publishedHistoryCheck.latestNumber;

      // A failed schedule-row advancement must not let the next cron tick publish
      // another batch immediately. Use chapter timestamps as the recovery source
      // of truth, with last_release_at as a secondary reference.
      const releaseReferenceTimes=[schedule.last_release_at,...publishedHistory.map((row:any)=>row.published_at)]
        .map((value:any)=>value?new Date(value).getTime():Number.NaN)
        .filter((value:number)=>Number.isFinite(value));
      let scheduleCooldownActive=false;
      let scheduleCooldownUntil:Date|null=null;
      if(releaseReferenceTimes.length>0){
        const latestReleaseMs=releaseReferenceTimes.reduce((latest:number,value:number)=>Math.max(latest,value),Number.NEGATIVE_INFINITY);
        if(schedule.schedule_mode==="interval"){
          try{
            scheduleCooldownUntil=resolveNextIntervalRelease(new Date(latestReleaseMs),schedule.interval_hours);
          }catch(intervalError){
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_config_invalid",
              reason:"Interval cooldown cannot be represented as a valid future timestamp.",details:message(intervalError)});
            continue;
          }
        }else if(schedule.schedule_mode==="weekly"){
          scheduleCooldownUntil=nextWeeklyRelease(new Date(latestReleaseMs),Number(schedule.preferred_weekday),
            String(schedule.preferred_time),String(schedule.timezone??"UTC"));
        }
        scheduleCooldownActive=!!scheduleCooldownUntil && now.getTime()<scheduleCooldownUntil.getTime();
      }

      const readyOutputs:any[]=[];
      let readyError:any=null;
      for(let offset=0;;offset+=500){
        const {data:page,error}=await supabase.from("chapter_generation_outputs")
          .select("id,chapter_number,title,generation_status,created_at")
          .eq("series_id",schedule.series_id).eq("generation_status","approved")
          .gt("chapter_number",latestNumber)
          .order("chapter_number",{ascending:true})
          .order("created_at",{ascending:false})
          .order("id",{ascending:true})
          .range(offset,offset+499);
        if(error){readyError=error;break;}
        readyOutputs.push(...(page??[]));
        if((page??[]).length<500) break;
      }

      if(readyError){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"error",reason:"Failed to inspect ready chapters.",details:message(readyError)});
        continue;
      }

      // An approved status label is not a publication review. Load the review
      // rows for all candidates and qualify before deduplicating chapter slots.
      const publicationReviewRows:any[]=[];
      let reviewLoadError:any=null;
      for(let offset=0;offset<readyOutputs.length;offset+=500){
        const outputIds=readyOutputs.slice(offset,offset+500)
          .map((row:any)=>String(row.id??"")).filter((id:string)=>id.length>0);
        if(outputIds.length===0) continue;
        // Review rows can outnumber output IDs when duplicate/ambiguous reviews exist.
        // Page them fully so a PostgREST row cap cannot hide a second review and
        // accidentally turn an ambiguous output into an eligible one.
        for(let reviewOffset=0;;reviewOffset+=500){
          const {data:reviewRows,error:reviewError}=await supabase.from("chapter_publication_reviews")
            .select("id,generation_output_id,decision,quality_passed,continuity_passed,originality_passed,safety_passed")
            .in("generation_output_id",outputIds)
            .order("generation_output_id",{ascending:true}).order("id",{ascending:true})
            .range(reviewOffset,reviewOffset+499);
          if(reviewError){reviewLoadError=reviewError;break;}
          const page=reviewRows??[];
          publicationReviewRows.push(...page);
          if(page.length<500) break;
        }
        if(reviewLoadError) break;
      }
      if(reviewLoadError){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"error",
          reason:"Failed to inspect publication reviews for ready chapters.",details:message(reviewLoadError)});
        continue;
      }
      const reviewedReadyOutputs=qualifyReviewedOutputs(readyOutputs,publicationReviewRows);

      // Deduplicate only after review qualification, so an unreviewed newer
      // attempt cannot hide a safe, older approved output for the same chapter.
      const uniqueReady:any[]=[];
      // Deterministic latest-approved-output policy: rows are ordered by chapter,
      // newest created_at first, then stable ID. Choose one output per chapter.
      let expectedNumber=latestNumber+1;
      const seenChapterNumbers=new Set<number>();
      for(const row of reviewedReadyOutputs){
        const n=Number(row.chapter_number);
        if(seenChapterNumbers.has(n)) continue;
        if(n!==expectedNumber) break;
        seenChapterNumbers.add(n);
        uniqueReady.push(row);
        expectedNumber++;
      }

      const dailyMin=dailyMinConfig;
      const dailyMax=dailyMaxConfig;
      const publishCount=scheduleCooldownActive?0:Math.min(uniqueReady.length,dailyMax);
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
          confirmedPublishedCount++;
        }
      }

      // Retry activation on later runs even when this invocation publishes no new
      // chapters; a transient lifecycle-row update failure must not strand a fully
      // published launch permanently in the preparing state.
      if(!dryRun && schedule.auto_publish && lifecycleStatus==="preparing" && !publicationFailed && !leaseLost){
        const launchCount=launchCountConfig;
        const launchPublished:any[]=[];
        let launchPublishedError:any=null;
        for(let offset=0;;offset+=500){
          const {data:page,error}=await supabase.from("chapters")
            .select("id,series_id,chapter_number,title,content,status").eq("series_id",schedule.series_id).eq("status","published")
            .lte("chapter_number",launchCount).order("chapter_number",{ascending:true}).order("id",{ascending:true})
            .range(offset,offset+499);
          if(error){launchPublishedError=error;break;}
          launchPublished.push(...(page??[]));
          if((page??[]).length<500) break;
        }
        const launchApproved:any[]=[];
        let launchApprovedError:any=null;
        for(let offset=0;;offset+=500){
          const {data:page,error}=await supabase.from("chapter_generation_outputs")
            .select("id,series_id,chapter_number,title,content,generation_status").eq("series_id",schedule.series_id)
            .in("generation_status",["approved","published"]).lte("chapter_number",launchCount)
            .order("chapter_number",{ascending:true}).order("created_at",{ascending:false}).order("id",{ascending:true})
            .range(offset,offset+499);
          if(error){launchApprovedError=error;break;}
          launchApproved.push(...(page??[]));
          if((page??[]).length<500) break;
        }
        let launchReviewError:any=null;
        const launchReviewRows:any[]=[];
        if(!launchApprovedError){
          for(let offset=0;offset<launchApproved.length;offset+=500){
            const outputIds=launchApproved.slice(offset,offset+500)
              .map((row:any)=>String(row.id??"")).filter((id:string)=>id.length>0);
            if(outputIds.length===0) continue;
            // Keep lifecycle activation fail-closed even if review rows exceed the API page cap.
            for(let reviewOffset=0;;reviewOffset+=500){
              const {data:page,error}=await supabase.from("chapter_publication_reviews")
                .select("id,generation_output_id,decision,quality_passed,continuity_passed,originality_passed,safety_passed")
                .in("generation_output_id",outputIds)
                .order("generation_output_id",{ascending:true}).order("id",{ascending:true})
                .range(reviewOffset,reviewOffset+499);
              if(error){launchReviewError=error;break;}
              const rows=page??[];
              launchReviewRows.push(...rows);
              if(rows.length<500) break;
            }
            if(launchReviewError) break;
          }
        }
        if(launchPublishedError || launchApprovedError || launchReviewError){
          publicationFailed=true;
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lifecycle_verification_failed",
            details:message(launchPublishedError??launchApprovedError??launchReviewError)});
        }else{
          const launchReviewedOutputs=qualifyReviewedOutputs(launchApproved,launchReviewRows);
          const launchNumbers=Array.from({length:launchCount},(_,i)=>i+1);
          const launchReady=launchNumbers.filter(n=>{
            const chapterRows=(launchPublished??[]).filter((chapter:any)=>Number(chapter.chapter_number)===n);
            if(chapterRows.length!==1) return false;
            return launchReviewedOutputs.some((output:any)=>
              matchesPublishedChapterOutput(chapterRows[0],output) &&
              (output.generation_status==="approved" || output.generation_status==="published"));
          });
          if(launchReady.length===launchCount){
            const reviewedAt=new Date().toISOString();
            const activation=await supabase.rpc("aevora_activate_story_lifecycle_if_lease_owned",{
              p_schedule_id:schedule.id,p_lease_token:leaseToken,p_series_id:schedule.series_id,p_reviewed_at:reviewedAt
            });
            if(activation.error || activation.data!==true){
              leaseLost=true;
              publicationFailed=true;
              results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lifecycle_transition_failed",
                details:activation.error?message(activation.error):"Atomic lifecycle activation rejected because the lease or lifecycle precondition was not valid."});
            }else{
              lifecycleTransition={from:"preparing",to:"active",launch_ready_chapters:launchReady,required_launch_chapters:launchCount};
              lifecycleStatus="active";
            }
          }
        }
      }

      // Use one completion-time anchor for the next deadline and release timestamp.
      const processingCompletedAt=new Date();
      let nextRelease:any=null;
      if(schedule.schedule_mode==="interval"){
        // Pass the raw database value to the strict resolver. Coercing it with
        // Number() here would re-accept hexadecimal/binary strings rejected by the resolver.
        // The activation run has already published its confirmed batch. Schedule
        // the next batch after the configured interval to prevent an immediate burst.
        // Anchor the next interval to processing completion, not the invocation's
        // initial timestamp. A slow batch must not persist an already-expired deadline.
        try{
          nextRelease=resolveNextIntervalRelease(processingCompletedAt,schedule.interval_hours);
        }catch(intervalError){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_config_invalid",
            reason:"Next interval release cannot be represented as a valid future timestamp.",details:message(intervalError)});
          continue;
        }
      }else if(schedule.schedule_mode==="weekly"){
        // Recompute at the end of processing. A long publication batch may cross
        // the preflight slot; persisting that stale slot would make the schedule
        // immediately due again on the next cron tick.
        nextRelease=nextWeeklyRelease(processingCompletedAt,Number(schedule.preferred_weekday),
          String(schedule.preferred_time),String(schedule.timezone??"UTC"));
      }

      const allSelectedConfirmed = !dryRun && schedule.auto_publish && publishCount>0
        && attemptedCount===publishCount && published.length===publishCount
        && !publicationFailed && !leaseLost;
      if(!dryRun && nextRelease && allSelectedConfirmed){
        const advancement=await supabase.rpc("aevora_advance_release_schedule_if_lease_owned",{
          p_schedule_id:schedule.id,p_lease_token:leaseToken,
          p_next_release_at:nextRelease.toISOString(),p_last_release_at:processingCompletedAt.toISOString()
        });
        if(advancement.error || advancement.data!==true){
          leaseLost=true;
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_advance_unconfirmed",published_count:published.length,
            details:advancement.error?message(advancement.error):"Atomic schedule advancement rejected because the lease or schedule precondition was not valid."});
          continue;
        }
      }

      results.push({
        schedule_id:schedule.id,series_id:schedule.series_id,series_title:series.title,
        action:leaseLost?"lease_lost":publicationFailed?"publication_incomplete":published.length?"published":scheduleCooldownActive?"schedule_cooldown":"checked",
        lifecycle_status:lifecycleStatus,lifecycle_transition:lifecycleTransition,
        latest_published_chapter:latestNumber,ready_chapters:uniqueReady.length,
        daily_chapters_target:{min:dailyMin,max:dailyMax},published_count:published.length,
        auto_generate:schedule.auto_generate,auto_publish:schedule.auto_publish,
        published,next_release_at:nextRelease?.toISOString()??schedule.next_release_at,
        schedule_cooldown_until:scheduleCooldownUntil?.toISOString()??null,dry_run:dryRun
      });
      }catch(scheduleError){
        results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_error",published_count:confirmedPublishedCount,
          reason:"Unexpected schedule processing error; no schedule advancement was assumed.",details:message(scheduleError)});
      }finally{
        if(leaseClaimed){
          let released:any=null;
          let releaseThrown:any=null;
          try{
            released=await supabase.rpc("aevora_release_scheduler_lease",{
              p_schedule_id:schedule.id,p_lease_token:leaseToken
            });
          }catch(releaseError){
            releaseThrown=releaseError;
          }
          if(releaseThrown || released?.error || released?.data!==true){
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_release_warning",
              details:releaseThrown?message(releaseThrown):released?.error?message(released.error):"Lease token no longer owned; release was not confirmed."});
          }
        }
      }
    }

    const failureActions=new Set(["error","schedule_error","lease_unavailable","lease_lost","lifecycle_config_invalid","lifecycle_verification_failed","lifecycle_transition_failed","publication_incomplete","publish_unconfirmed","schedule_advance_unconfirmed","schedule_config_invalid","published_chapter_gap","published_chapter_history_invalid","lease_release_warning"]);
    const hasScheduleFailures=results.some((result:any)=>failureActions.has(result.action));
    // A schedule may have committed chapters before a later lifecycle or schedule-advance failure.
    // Determine partial success from confirmed side effects, not only the final action label.
    const hasPublishedSideEffects=results.some((result:any)=>Number(result.published_count)>0||(Array.isArray(result.published)&&result.published.length>0));
    return response({
      success:!hasScheduleFailures,partial_success:hasPublishedSideEffects&&hasScheduleFailures,mode:"release-scheduler",scheduler_version:VERSION,
      checked_at:now.toISOString(),due_schedules:schedules?.length??0,results,
      note:"Generic lifecycle gate: every series transitions from preparing to active after its configured launch chapter count is approved; publication then uses approved chapters only."
    });
  }catch(error){
    return response({success:false,mode:"release-scheduler",scheduler_version:VERSION,error:"Unexpected scheduler error.",details:message(error)},500);
  }
});