function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const schedulerUrl = new URL("./index.ts", import.meta.url);
const publisherUrl = new URL("../release-publisher/index.ts", import.meta.url);
import { matchesPublishedOutput } from "../release-publisher/publisher-idempotency.ts";
const publisherIdempotencyUrl = new URL("../release-publisher/publisher-idempotency.ts", import.meta.url);

Deno.test("scheduler dry-run skips lease mutation and releases only a claimed lease", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes("if(!dryRun){\n        const leaseClaim"), "real-run-only lease claim guard missing");
  assert(source.includes("if(leaseClaimed){\n          const released"), "conditional lease release guard missing");
  assert(!source.includes('if(dryRun){\n        const leaseClaim'), "dry-run lease claim must not exist");
});

Deno.test("scheduler pages schedules and approved outputs in stable order", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('return q.order("id",{ascending:true});'), "schedule ID ordering missing");
  assert(source.includes("buildScheduleQuery().range(offset,offset+499)"), "schedule paging missing");
  assert(source.includes('.order("chapter_number",{ascending:true})\n          .order("created_at",{ascending:false})\n          .order("id",{ascending:true})\n          .range(offset,offset+499)'), "approved output ordering/paging missing");
});

Deno.test("weekly schedule uses validated IANA timezone and DST-aware wall time", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('String(schedule.timezone??"UTC")'), "schedule timezone is not passed to weekly resolver");
  assert(source.includes('/^(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d)?$/'), "strict wall-time validation regex missing");
  assert(source.includes("matchingWallTimeCandidates"), "DST fold/gap resolver missing");
  assert(source.indexOf("Validate scheduling configuration before any publication side effect.") < source.indexOf('from("story_lifecycle")'), "schedule preflight must precede publication setup");
  assert(!source.includes("nextRelease=now;"), "activation must not trigger an immediate extra release batch");
});

Deno.test("schedule advancement requires a confirmed update row", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes('.update(update).eq("id",schedule.id).select("id,next_release_at").maybeSingle()'), "schedule update must return the updated row");
  assert(source.includes("if(updateError || !updatedSchedule)"), "missing-row schedule update must fail closed");
  assert(!source.includes("const approved:any[]=[];"), "redundant preparing-lifecycle output preflight should stay removed");
});

Deno.test("scheduler requires strict publisher confirmation and database-published status", async () => {
  const source = await Deno.readTextFile(schedulerUrl);
  assert(source.includes("d.success===true && d.published===true"), "publisher positive flags missing");
  assert(source.includes('d.status==="published"'), "publisher published status check missing");
  assert(source.includes('confirmedChapter.status!=="published"'), "database status confirmation missing");
});

Deno.test("publisher idempotency paths reject non-published rows before side effects", async () => {
  const source = await Deno.readTextFile(publisherUrl);
  assert(source.split("CHAPTER_SLOT_CONFLICT").length - 1 === 2, "both existing-row and race guards must exist");
  const identitySource = await Deno.readTextFile(publisherIdempotencyUrl);
  assert(source.includes('from "./publisher-idempotency.ts"'), "publisher must use the tested identity helper");
  assert(identitySource.includes("function matchesPublishedOutput(chapter: any, output: any): boolean"), "published-output identity check missing");
  assert(identitySource.includes("chapterContent === outputContent"), "existing chapter must match the requested output content");
  assert(source.includes("if (!matchesPublishedOutput(existingChapter, output))"), "existing-row identity guard missing");
  assert(source.indexOf("if (!matchesPublishedOutput(existingChapter, output))") < source.indexOf("const synchronizationWarnings: string[] = [];"), "existing-row guard must precede synchronization");
  assert(source.includes("if (!matchesPublishedOutput(racedChapter, output))"), "race-path identity guard missing");
  assert(source.indexOf("if (!matchesPublishedOutput(racedChapter, output))") < source.indexOf("chapter_id: racedChapter.id"), "race guard must precede idempotent success");
  assert(source.includes("taleforge_ceo_execution_gate"), "Clara governance gate must remain");
  assert(source.includes("chapter_publication_reviews"), "publication review gate must remain");
});

Deno.test("publisher idempotency only confirms the exact published chapter output", () => {
  const output = {
    series_id: "series-a",
    chapter_number: 7,
    title: "  The Last Signal  ",
    content: "  A beacon blinked twice.  ",
  };
  const exactChapter = {
    id: "chapter-7",
    series_id: "series-a",
    chapter_number: 7,
    status: "published",
    title: "The Last Signal",
    content: "A beacon blinked twice.",
  };
  assert(matchesPublishedOutput(exactChapter, output), "same published content should be safely idempotent");
  assert(!matchesPublishedOutput({...exactChapter, content:"A different signal."}, output), "different output content must conflict");
  assert(!matchesPublishedOutput({...exactChapter, title:"Another Title"}, output), "different output title must conflict");
  assert(!matchesPublishedOutput({...exactChapter, status:"draft"}, output), "non-published row must conflict");
  assert(!matchesPublishedOutput({...exactChapter, series_id:"series-b"}, output), "different series must conflict");
  assert(!matchesPublishedOutput({...exactChapter, chapter_number:8}, output), "different chapter slot must conflict");
  assert(!matchesPublishedOutput({...exactChapter, content:"   "}, output), "empty chapter content must not be idempotent");
});
