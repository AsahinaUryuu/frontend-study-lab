// Server persistence with optimistic revisions; browser storage remains an offline recovery copy.
export function createCloudProgress({getProgress,applyProgress,onStatus=()=>{},onError=()=>{},fetchImpl=fetch,storage=localStorage}){
 let revision=0,ready=false,dirty=false,conflict=false,timer=null,running=null,reloading=null,sequence=0;
 const pendingKey='zhixing-cloud-pending-v1',initializedKey='zhixing-cloud-initialized-v1';
 const lessonRecords=value=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>key!=='_preferences'));
 const hasLessons=value=>Object.keys(lessonRecords(value)).length>0;
 const sameLessons=(a,b)=>JSON.stringify(lessonRecords(a))===JSON.stringify(lessonRecords(b));
 const markInitialized=()=>{try{storage.setItem(initializedKey,'true');}catch{}};
 const status=(state,message)=>onStatus(state,message);
 const snapshot=()=>JSON.parse(JSON.stringify(getProgress()));
 function keepPending(value){try{storage.setItem(pendingKey,JSON.stringify({progress:value,revision,conflict}));}catch{}}
 async function request(options){const r=await fetchImpl('/api/progress',{cache:'no-store',...options});const value=await r.json();if(!r.ok){const e=new Error(value.error||'学习记录同步失败');e.status=r.status;e.current=value.current;throw e;}return value;}
 async function init(){
  status('loading','正在载入学习记录');
  let pending;try{pending=JSON.parse(storage.getItem(pendingKey)||'null');}catch{}
  if(pending?.progress&&typeof pending.progress==='object'&&!Array.isArray(pending.progress)){
   applyProgress(pending.progress);revision=Number.isInteger(pending.revision)&&pending.revision>=0?pending.revision:0;dirty=true;
  }else pending=null;
  try{
   const remote=await request(),local=snapshot(),remoteRevision=remote.revision;
   let initialized=false;try{initialized=storage.getItem(initializedKey)==='true';}catch{}
   if(!pending&&hasLessons(local)&&!hasLessons(remote.progress)){
    // A settings-only record from another profile is not migrated study history.
    // Keep this profile's original lessons AND preferences and seed the server.
    revision=remoteRevision;dirty=true;keepPending(local);
   }else if(!pending&&!initialized&&hasLessons(local)&&hasLessons(remote.progress)&&!sameLessons(local,remote.progress)){
    revision=remoteRevision;dirty=true;conflict=true;keepPending(local);status('conflict','首次同步发现两份不同的学习记录，本机记录已保留，请先导出备份再选择版本');
   }else if(pending&&(pending.conflict||revision!==remoteRevision)&&JSON.stringify(pending.progress)!==JSON.stringify(remote.progress)){
    // Keep the revision this draft was based on. Relabelling it as the latest
    // revision would silently overwrite another device after the next reload.
    dirty=true;conflict=true;status('conflict','其他设备已更新，请先备份并选择版本');
   }else{
    revision=remoteRevision;
    if(pending&&JSON.stringify(pending.progress)!==JSON.stringify(remote.progress))dirty=true;
    else if(Object.keys(remote.progress||{}).length||pending){applyProgress(remote.progress);dirty=false;try{storage.removeItem(pendingKey);}catch{}}
    else if(Object.keys(local).length){dirty=true;keepPending(local);}
   }
   ready=true;if(dirty&&!conflict)await flush();else if(!conflict){markInitialized();status('saved','学习记录已同步');}
  }catch(error){ready=true;dirty=true;keepPending(snapshot());status('offline','离线保存中，联网后重试');onError(error);}
 }
 function save(){dirty=true;sequence++;keepPending(snapshot());if(conflict){status('conflict','其他设备已更新，本页草稿仍保留');return;}status('pending','正在保存…');clearTimeout(timer);timer=setTimeout(()=>flush(),450);}
 async function flush(){
  clearTimeout(timer);if(!ready||!dirty||conflict||reloading)return false;if(running)return running;
  const sent=sequence,progress=snapshot();
  running=(async()=>{try{
   const value=await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({progress,baseRevision:revision}),keepalive:JSON.stringify(progress).length<55000});
   revision=value.revision;dirty=sequence!==sent;markInitialized();
   if(dirty)keepPending(snapshot());else try{storage.removeItem(pendingKey);}catch{}
   status(dirty?'pending':'saved',dirty?'正在保存…':'学习记录已同步');return true;
  }catch(error){dirty=true;conflict=error.status===409;keepPending(snapshot());status(conflict?'conflict':'offline',conflict?'其他设备已更新，本页草稿仍保留':'离线保存中，联网后重试');onError(error);return false;}
  finally{running=null;if(dirty&&!conflict&&!reloading&&sequence!==sent)timer=setTimeout(()=>flush(),450);}})();
  return running;
 }
 async function loadLatest({discardLocal=false}={}){
  if(reloading)return reloading;
  if(dirty&&!discardLocal)throw new Error('请先导出本页记录，再确认载入服务器版本。');
  clearTimeout(timer);const started=sequence;
  reloading=(async()=>{
   if(running)await running;
   const value=await request();
   if(sequence!==started)throw new Error('载入期间又有新的修改，已保留当前草稿，请重新选择版本。');
   applyProgress(value.progress);revision=value.revision;dirty=false;conflict=false;sequence++;
   try{storage.removeItem(pendingKey);}catch{}
   markInitialized();status('saved','已载入服务器记录');return value;
  })();
  try{return await reloading;}finally{reloading=null;if(dirty&&!conflict)timer=setTimeout(()=>flush(),450);}
 }
 const online=()=>{if(dirty&&!conflict)flush();};
 const hidden=()=>{if(document.visibilityState==='hidden')flush();};
 if(typeof window!=='undefined'){window.addEventListener('online',online);window.addEventListener('pagehide',online);document.addEventListener('visibilitychange',hidden);}
 return {init,save,flush,loadLatest,getSnapshot:snapshot,getState:()=>({revision,ready,dirty,conflict}),destroy(){clearTimeout(timer);if(typeof window!=='undefined'){window.removeEventListener('online',online);window.removeEventListener('pagehide',online);document.removeEventListener('visibilitychange',hidden);}}};
}
