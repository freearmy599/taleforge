const KEY="taleforge:reading-progress:v1";
function readProgress(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")}catch{return{}}}
function saveProgress(item){const all=readProgress();all[item.seriesId]={...all[item.seriesId],...item,updatedAt:Date.now()};localStorage.setItem(KEY,JSON.stringify(all))}
function getProgress(seriesId){return readProgress()[seriesId]||null}
function allProgress(){return Object.values(readProgress()).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))}
function clearProgress(seriesId){const all=readProgress();delete all[seriesId];localStorage.setItem(KEY,JSON.stringify(all))}
window.taleForgeProgress={readProgress,saveProgress,getProgress,allProgress,clearProgress};