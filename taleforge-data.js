import "./supabase-client.js";

const supabase=window.taleForgeSupabase;
const cache=new Map();
const TTL=30000;

async function cached(key,loader){
  const hit=cache.get(key);
  if(hit && Date.now()-hit.at<TTL) return hit.value;
  const value=await loader();
  cache.set(key,{at:Date.now(),value});
  return value;
}

async function getPublishedSeries(){
  return cached("published-series",async()=>{
    let {data,error}=await supabase.from("series")
      .select("id,title,slug,subtitle,description,status,age_rating,mood,intensity,published_at,cover_image,genres(name)")
      .in("status",["ongoing","completed"]).not("published_at","is",null)
      .order("published_at",{ascending:false});
    if(error){
      const fallback=await supabase.from("series")
        .select("id,title,slug,subtitle,description,status,age_rating,mood,intensity,published_at,cover_image")
        .in("status",["ongoing","completed"]).not("published_at","is",null)
        .order("published_at",{ascending:false});
      if(fallback.error) throw fallback.error;
      data=fallback.data||[];
    }
    const series=data||[];
    if(!series.length) return [];
    const ids=series.map(s=>s.id);
    const [intelRes,chapRes]=await Promise.all([
      supabase.from("story_intelligence").select("series_id,intelligence_status,recent_chapters_7d,days_since_update,trending_score").in("series_id",ids),
      supabase.from("chapters").select("id,series_id,chapter_number,title,published_at").in("series_id",ids).eq("status","published").order("published_at",{ascending:false})
    ]);
    const intel=new Map((intelRes.data||[]).map(x=>[x.series_id,x]));
    const counts=new Map(),latest=new Map();
    (chapRes.data||[]).forEach(c=>{
      counts.set(c.series_id,(counts.get(c.series_id)||0)+1);
      if(!latest.has(c.series_id)) latest.set(c.series_id,c);
    });
    return series.map(s=>({...s,...(intel.get(s.id)||{}),publishedChapters:counts.get(s.id)||0,latestChapter:latest.get(s.id)||null}));
  });
}

async function getPublishedChapters(seriesId){
  if(!seriesId) return [];
  return cached("chapters:"+seriesId,async()=>{
    const {data,error}=await supabase.from("chapters")
      .select("id,series_id,chapter_number,title,subtitle,summary,content,word_count,reading_time,cover_image,ai_assisted,ai_disclosure,origin_type,originality_status,published_at,version,created_at,updated_at")
      .eq("series_id",seriesId).eq("status","published").order("chapter_number",{ascending:true});
    if(error) throw error;
    return data||[];
  });
}

async function getSeries(seriesId){
  if(!seriesId) return null;
  const series=await getPublishedSeries();
  return series.find(s=>s.id===seriesId)||null;
}

function invalidate(){cache.clear()}

window.taleForgeData={getPublishedSeries,getPublishedChapters,getSeries,invalidate,version:"1.0-production"};
export {getPublishedSeries,getPublishedChapters,getSeries,invalidate};
