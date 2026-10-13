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
/** Return the next weekly slot after a completed batch, never a second batch at a later time today. */
export function nextWeeklyReleaseAfterBatch(
  completedAt: Date,
  reservedSlot: Date | null,
  weekday: number,
  time: string,
  timeZone: string,
): Date {
  const completedMs = completedAt instanceof Date ? completedAt.getTime() : Number.NaN;
  if (!Number.isFinite(completedMs)) throw new Error("Invalid weekly batch completion timestamp");
  const slotMs = reservedSlot instanceof Date ? reservedSlot.getTime() : Number.NaN;
  // If this batch finishes before the upcoming scheduled wall-clock slot (for
  // example, a first release with next_release_at=NULL), reserve that slot as
  // the current week's cadence boundary and advance beyond it. Otherwise,
  // recompute from completion so long-running batches cannot save a stale slot.
  const base = Number.isFinite(slotMs) && slotMs > completedMs
    ? new Date(slotMs + 1000)
    : completedAt;
  return nextWeeklyRelease(base, weekday, time, timeZone);
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
