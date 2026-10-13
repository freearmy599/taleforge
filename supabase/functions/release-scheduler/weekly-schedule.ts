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
function nextWeeklyReleaseAfterCurrentDay(completedAt:Date,weekday:number,time:string,timeZone:string):Date {
  const candidate=nextWeeklyRelease(completedAt,weekday,time,timeZone);
  const completedLocal=partsAt(completedAt,timeZone);
  const candidateLocal=partsAt(candidate,timeZone);
  if(completedLocal.year===candidateLocal.year && completedLocal.month===candidateLocal.month && completedLocal.day===candidateLocal.day) {
    // Move beyond the whole local day; a DST fall-back can repeat the wall-clock slot.
    return nextWeeklyRelease(new Date(candidate.getTime()+24*60*60*1000),weekday,time,timeZone);
  }
  return candidate;
}
/** Return the next weekly slot after a completed batch, never a second batch later on the same day. */
export function nextWeeklyReleaseAfterBatch(
  completedAt: Date,
  reservedSlot: Date | null,
  weekday: number,
  time: string,
  timeZone: string,
): Date {
  const completedMs = completedAt instanceof Date ? completedAt.getTime() : Number.NaN;
  if (!Number.isFinite(completedMs)) throw new Error("Invalid weekly batch completion timestamp");
  // Validate the schedule independently of which branch below returns.
  nextWeeklyRelease(completedAt, weekday, time, timeZone);
  const slotMs = reservedSlot instanceof Date ? reservedSlot.getTime() : Number.NaN;
  if (!Number.isFinite(slotMs) || slotMs <= completedMs) {
    return nextWeeklyReleaseAfterCurrentDay(completedAt, weekday, time, timeZone);
  }

  const local = partsAt(completedAt, timeZone);
  const localWeekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const currentSeconds = local.hour * 3600 + local.minute * 60 + local.second;
  const targetSeconds = hour * 3600 + minute * 60 + second;
  const slotIsLaterToday = weekday === localWeekday && currentSeconds < targetSeconds;
  if (slotIsLaterToday) {
    const existsToday = matchingWallTimeCandidates(
      local.year, local.month, local.day, hour, minute, second, timeZone,
    ).length > 0;
    if (existsToday) {
      // A batch completed before today's scheduled slot; skip that slot so the
      // same weekly schedule cannot publish a second batch later today.
      return nextWeeklyRelease(new Date(slotMs + 24 * 60 * 60 * 1000), weekday, time, timeZone);
    }
  }

  // Preserve a future slot on a later day or next week. In particular, do not
  // skip an already-reserved next-week slot merely because today's slot passed.
  return reservedSlot as Date;
}

/** Return the next future wall-clock weekly occurrence in the schedule's IANA timezone. */
export function nextWeeklyRelease(now:Date, weekday:number, time:string, timeZone:string):Date {
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
