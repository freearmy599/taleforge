const PROGRESS_KEY="taleforge:reading-progress:v1",LIB_KEY="taleforge:library:v1";
function safeRead(key,fallback={}){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}}
function readProgress(){return safeRead(PROGRESS_KEY,{})}
function saveProgress(item){const all=readProgress();all[item.seriesId]={...all[item.seriesId],...item,updatedAt:Date.now()};localStorage.setItem(PROGRESS_KEY,JSON.stringify(all));recordHistory(item)}
function getProgress(seriesId){return readProgress()[seriesId]||null}
function allProgress(){return Object.values(readProgress()).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))}
function clearProgress(seriesId){const all=readProgress();delete all[seriesId];localStorage.setItem(PROGRESS_KEY,JSON.stringify(all))}
function library(){return safeRead(LIB_KEY,{follows:{},bookmarks:{},history:[]})}
function writeLibrary(x){localStorage.setItem(LIB_KEY,JSON.stringify(x));return x}
function followSeries(item){const l=library();l.follows[item.seriesId]={...item,updatedAt:Date.now()};return writeLibrary(l)}
function unfollowSeries(seriesId){const l=library();delete l.follows[seriesId];return writeLibrary(l)}
function isFollowing(seriesId){return !!library().follows[seriesId]}
function allFollows(){return Object.values(library().follows).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))}
function bookmarkChapter(item){const l=library();l.bookmarks[item.chapterId]={...item,updatedAt:Date.now()};return writeLibrary(l)}
function removeBookmark(chapterId){const l=library();delete l.bookmarks[chapterId];return writeLibrary(l)}
function isBookmarked(chapterId){return !!library().bookmarks[chapterId]}
function allBookmarks(){return Object.values(library().bookmarks).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))}
function recordHistory(item){const l=library();const entry={seriesId:item.seriesId,seriesTitle:item.seriesTitle,chapterId:item.chapterId,chapterNumber:item.chapterNumber,chapterTitle:item.chapterTitle,updatedAt:Date.now()};l.history=[entry,...l.history.filter(x=>x.chapterId!==item.chapterId)].slice(0,30);writeLibrary(l)}
function allHistory(){return library().history||[]}
window.taleForgeProgress={readProgress,saveProgress,getProgress,allProgress,clearProgress,library,followSeries,unfollowSeries,isFollowing,allFollows,bookmarkChapter,removeBookmark,isBookmarked,allBookmarks,recordHistory,allHistory};
const EVENT_KEY="taleforge:visitor-id:v1";
function visitorId(){let v=localStorage.getItem(EVENT_KEY);if(!v){v=crypto.randomUUID?crypto.randomUUID():Math.random().toString(36)+Date.now().toString(36);localStorage.setItem(EVENT_KEY,v)}return v}
async function track(event_type,data={}){try{const supabase=window.taleForgeSupabase;if(!supabase)return;await supabase.from("reader_events").insert({visitor_id:visitorId(),event_type,series_id:data.seriesId||null,chapter_id:data.chapterId||null,progress_percent:data.progressPercent==null?null:Math.round(data.progressPercent)})}catch(e){console.debug("TaleForge event skipped",e)}}
window.taleForgeProgress.track=track;window.taleForgeProgress.visitorId=visitorId;