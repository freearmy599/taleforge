import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/story-dna-planner/index.ts", import.meta.url), "utf8");

test("Story DNA planning fails closed when context reads fail", () => {
  const dnaRead = source.indexOf('const dna=await db.from("story_dna")');
  const arcRead = source.indexOf('const arc=await db.from("story_arc_plan")');
  const chapterRead = source.indexOf('const chapters=await db.from("chapters")');
  const prompt = source.indexOf("const prompt=", chapterRead);
  assert.ok(dnaRead >= 0 && arcRead > dnaRead && chapterRead > arcRead && prompt > chapterRead,
    "expected DNA, arc, and recent-chapter reads before prompt construction");
  const checks = source.slice(chapterRead, prompt);
  assert.match(checks, /if\(dna\.error\)throw new Error\("Unable to read existing story DNA\."\)/);
  assert.match(checks, /if\(arc\.error\)throw new Error\("Unable to read the story arc plan\."\)/);
  assert.match(checks, /if\(chapters\.error\)throw new Error\("Unable to read recent published chapters\."\)/);
  assert.doesNotMatch(checks, /\.message/,
    "raw database diagnostics should not be surfaced in these failures");
});
