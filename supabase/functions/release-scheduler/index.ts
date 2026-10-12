import { createClient } from "https://esm.sh/@supabase/supabase-js@2"; import { qualifyReviewedOutputs } from "./review-qualified-outputs.ts"; import { inspectPublishedChapterHistory } from "./published-history.ts";

const VERSION = "release-scheduler-v10-confirm-schedule-advance";
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

function partsAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    year:Number(values.year), month:Number(values.month), day:Number(values.day),
    hour:Number(values.hour), minute:Number(values.minute), second:Number(values.second)
  };
}
function localWallTimeToUtc(year:number, month:number, day:number, hour:number, minute:number, second:number, timeZone:string):Date {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let i=0; i<4; i++) {
    const p = partsAt(new Date(guess), timeZone);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = target - represented;
    if (delta === 0) break;
    guess += delta;
  }
  return new Date(guess);
}
function addLocalDays(year:number, month:number, day:number, days:number) {
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}
function matchingWallTimeCandidates(year:number,month:number,day:number,hour:number,minute:number,second:number,timeZone:string):Date[] {
  const base=localWallTimeToUtc(year,month,day,hour,minute,second,timeZone);
  const matches:Date[]=[];
  // Search around the converged instant so repeated wall times at a DST fall-back
  // can yield both real instants; nonexistent spring-forward times yield none.
  for(let offsetMinutes=-180;offsetMinutes<=180;offsetMinutes+=15){
    const candidate=new Date(base.getTime()+offsetMinutes*60000);
    const p=partsAt(candidate,timeZone);
    if(p.year===year && p.month===month && p.day===day &&
      p.hour===hour && p.minute===minute && p.second===second &&
      !matches.some(existing=>existing.getTime()===candidate.getTime())) matches.push(candidate);
  }
  return matches.sort((a,b)=>a.getTime()-b.getTime());
}
/** Return the next future wall-clock weekly occurrence in the schedule's IANA timezone. */
function nextWeeklyRelease(now:Date, weekday:number, time:string, timeZone:string):Date {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new Error("Invalid preferred weekday");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) throw new Error("Invalid preferred time");
  partsAt(now,timeZone); // validates the IANA timezone
  const local = partsAt(now,timeZone);
  const localWeekday = new Date(Date.UTC(local.year,local.month-1,local.day)).getUTCDay();
  const [hour,minute,second=0] = time.split(":").map(Number);
  let delta=(weekday-localWeekday+7)%7;
  if(delta===0) {
    const today=matchingWallTimeCandidates(local.year,local.month,local.day,hour,minute,second,timeZone);
    const upcoming=today.find(candidate=>candidate.getTime()>now.getTime());
    if(upcoming) return upcoming;
    delta=7;
  }
  const date=addLocalDays(local.year,local.month,local.day,delta);
  const candidates=matchingWallTimeCandidates(date.year,date.month,date.day,hour,minute,second,timeZone);
  if(candidates.length) return candidates[0];
  // Nonexistent local wall time during a DST jump: fail closed to the same slot next week.
  const next=addLocalDays(date.year,date.month,date.day,7);
  const nextCandidates=matchingWallTimeCandidates(next.year,next.month,next.day,hour,minute,second,timeZone);
  if(!nextCandidates.length) throw new Error("Unable to resolve weekly release wall time");
  return nextCandidates[0];
}

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

    const buildScheduleQuery=()=>{
      let q=supabase.from("release_schedules")
        .select("*, series:series_id(id,title,status)")
        .eq("enabled",true)
        .neq("schedule_mode","manual");
      if(scheduleId) q=q.eq("id",scheduleId);
      else q=q.or(`next_release_at.is.null,next_release_at.lte.${now.toISOString()}`);
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
      if(!dryRun){
        const leaseClaim=await supabase.rpc("aevora_claim_release_scheduler_lease",{
          p_schedule_id:schedule.id,p_lease_token:leaseToken,p_lease_seconds:180
        });
        if(leaseClaim.error || leaseClaim.data!==true){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_unavailable",
            reason:"Another scheduler owns this schedule or the lease could not be claimed.",
            details:leaseClaim.error?message(leaseClaim.error):null});
          continue;
        }
        leaseClaimed=true;
      }
      let leaseLost=false;
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
        const hours=Number(schedule.interval_hours);
        if(!Number.isFinite(hours) || hours<=0){
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_config_invalid",
            reason:"Interval schedules require a positive interval_hours value."});
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
          .select("id,chapter_number").eq("series_id",schedule.series_id).eq("status","published")
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
          reason:"Published chapter history contains an invalid chapter number."});
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
        const {data:reviewRows,error:reviewError}=await supabase.from("chapter_publication_reviews")
          .select("generation_output_id,decision,quality_passed,continuity_passed,originality_passed,safety_passed")
          .in("generation_output_id",outputIds)
          .order("generation_output_id",{ascending:true});
        if(reviewError){reviewLoadError=reviewError;break;}
        publicationReviewRows.push(...(reviewRows??[]));
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
          .select("id,chapter_number,generation_status").eq("series_id",schedule.series_id).in("generation_status",["approved","published"])
          .lte("chapter_number",launchCount);
        let launchReviewError:any=null;
        const launchReviewRows:any[]=[];
        if(!launchApprovedError){
          for(let offset=0;offset<(launchApproved??[]).length;offset+=500){
            const outputIds=(launchApproved??[]).slice(offset,offset+500)
              .map((row:any)=>String(row.id??"")).filter((id:string)=>id.length>0);
            if(outputIds.length===0) continue;
            const {data:page,error}=await supabase.from("chapter_publication_reviews")
              .select("generation_output_id,decision,quality_passed,continuity_passed,originality_passed,safety_passed")
              .in("generation_output_id",outputIds)
              .order("generation_output_id",{ascending:true});
            if(error){launchReviewError=error;break;}
            launchReviewRows.push(...(page??[]));
          }
        }
        if(launchPublishedError || launchApprovedError || launchReviewError){
          publicationFailed=true;
          results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lifecycle_verification_failed",
            details:message(launchPublishedError??launchApprovedError??launchReviewError)});
        }else{
          const publishedSet=new Set((launchPublished??[]).map((x:any)=>Number(x.chapter_number)));
          const launchReviewedOutputs=qualifyReviewedOutputs(launchApproved??[],launchReviewRows);
          const approvedSet=new Set(launchReviewedOutputs.map((x:any)=>Number(x.chapter_number)));
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
          // The activation run has already published its confirmed batch. Schedule
          // the next batch after the configured interval to prevent an immediate burst.
          const base=schedule.next_release_at?new Date(schedule.next_release_at):now;
          nextRelease=new Date((base>now?base:now).getTime()+hours*3600000);
        }
      }else if(schedule.schedule_mode==="weekly"){
        nextRelease=weeklyReleaseAt;
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
          const {data:updatedSchedule,error:updateError}=await supabase.from("release_schedules")
            .update(update).eq("id",schedule.id).select("id,next_release_at").maybeSingle();
          if(updateError || !updatedSchedule){
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"schedule_update_failed",published,
              details:updateError?message(updateError):"Schedule row was not returned after update; advancement is unconfirmed."});
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
        if(leaseClaimed){
          const released=await supabase.rpc("aevora_release_scheduler_lease",{
            p_schedule_id:schedule.id,p_lease_token:leaseToken
          });
          if(released.error || released.data!==true){
            results.push({schedule_id:schedule.id,series_id:schedule.series_id,action:"lease_release_warning",
              details:released.error?message(released.error):"Lease token no longer owned; release was not confirmed."});
          }
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