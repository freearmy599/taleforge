export function matchesPublishedOutput(chapter: any, output: any): boolean {
  const chapterTitle = typeof chapter?.title === "string" ? chapter.title.trim() : "";
  const outputTitle = typeof output?.title === "string" ? output.title.trim() : "";
  const chapterContent = typeof chapter?.content === "string" ? chapter.content.trim() : "";
  const outputContent = typeof output?.content === "string" ? output.content.trim() : "";
  const chapterNumber = Number(chapter?.chapter_number);
  const outputNumber = Number(output?.chapter_number);
  return chapter?.status === "published"
    && chapter?.series_id === output?.series_id
    && Number.isSafeInteger(chapterNumber)
    && chapterNumber > 0
    && Number.isSafeInteger(outputNumber)
    && outputNumber > 0
    && chapterNumber === outputNumber
    && chapterTitle.length > 0
    && chapterTitle === outputTitle
    && chapterContent.length > 0
    && chapterContent === outputContent;
}
