export function matchesPublishedOutput(chapter: any, output: any): boolean {
  const chapterTitle = typeof chapter?.title === "string" ? chapter.title.trim() : "";
  const outputTitle = typeof output?.title === "string" ? output.title.trim() : "";
  const chapterContent = typeof chapter?.content === "string" ? chapter.content.trim() : "";
  const outputContent = typeof output?.content === "string" ? output.content.trim() : "";
  return chapter?.status === "published"
    && chapter?.series_id === output?.series_id
    && Number(chapter?.chapter_number) === Number(output?.chapter_number)
    && chapterTitle.length > 0
    && chapterTitle === outputTitle
    && chapterContent.length > 0
    && chapterContent === outputContent;
}
