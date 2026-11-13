// Server persistence with optimistic revisions; browser storage remains an offline recovery copy.
export function createCloudProgress({getProgress,applyProgress,onStatus=()=>{},onError=()=>{},onRecovery=()=>{},fetchImpl=fetch,storage=localStorage,sessionStorage:sessionOverride}){
 let revision=0,ready=false,dirty=false,conflict=false,timer=null,running=null,reloading=null,sequence=0,disposed=false,recoveryCount=0,recoveryWarning=false,serverSnapshot='';
 const legacyKey='zhixing-cloud-pending-v1',slotPrefix=legacyKey+':tab:',initializedKey='zhixing-cloud-initialized-v1';
 const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(value);
 const newId=()=>globalThis.crypto?.randomUUID?.()||'tab-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 let tabId='',previousSlotId='',persistSlot=()=>{};
 try{
  const session=sessionOverride===undefined?(typeof window!=='undefined'?window.sessionStorage:null):sessionOverride;
  if(session){let id=session.getItem(legacyKey+'-tab');if(!validId(id)){id=newId();session.setItem(legacyKey+'-tab',id);}tabId=id;previousSlotId=session.getItem(legacyKey+'-slot')||id;persistSlot=value=>session.setItem(legacyKey+'-slot',value);}
 }catch{}
 // History state persists across a reload even when sessionStorage is blocked.
 if(!tabId&&typeof window!=='undefined')try{
  const state=window.history.state&&typeof window.history.state==='object'?window.history.state:{};
  let id=state.zhixingRecoveryTab;if(!validId(id)){id=newId();window.history.replaceState({...state,zhixingRecoveryTab:id},'');}tabId=id;previousSlotId=state.zhixingRecoverySlot||id;persistSlot=value=>window.history.replaceState({...window.history.state,zhixingRecoverySlot:value},'');
 }catch{}
 // If both browser mechanisms fail, keep an isolated recoverable slot rather
 // than allowing this page to erase another page's draft. A new page can find
 // it through getRecoveryDrafts(). Non-browser callers retain legacy support.
 if(!tabId&&typeof window!=='undefined')tabId=newId();
 // Duplicating a browser tab also copies sessionStorage. A fresh document owner
 // therefore gets a fresh slot; its old pointer is a recovery source, not a slot
 // it may delete. The source copy remains available in the recovery list.
 const currentId=tabId?tabId+'_'+newId():'legacy',pendingKey=tabId?slotPrefix+currentId:legacyKey;
 if(tabId)try{persistSlot(currentId);}catch{}
 const lessonRecords=value=>Object.fromEntries(Object.entries(value||{}).filter(([key])=>key!=='_preferences'));
 const hasLessons=value=>Object.keys(lessonRecords(value)).length>0;
 const sameLessons=(a,b)=>JSON.stringify(lessonRecords(a))===JSON.stringify(lessonRecords(b));
 const markInitialized=()=>{try{storage.setItem(initializedKey,'true');}catch{}};
 const status=(state,message)=>onStatus(state,message);
 const snapshot=()=>JSON.parse(JSON.stringify(getProgress()));
 function writeRecovery(key,value){try{const raw=JSON.stringify(value);storage.setItem(key,raw);return storage.getItem(key)===raw;}catch(error){if(!recoveryWarning){recoveryWarning=true;onError(new Error('浏览器恢复副本保存失败，请尽快导出本页记录；服务端保存仍会继续尝试。'));}return false;}}
 function keepPending(value){return writeRecovery(pendingKey,{progress:value,revision,conflict,clientId:currentId,updatedAt:Date.now()});}
 function clearPending(){try{storage.removeItem(pendingKey);}catch{}}
 function validRecovery(value){return value&&typeof value==='object'&&value.progress&&typeof value.progress==='object'&&!Array.isArray(value.progress);}
 function getRecoveryDrafts(){
  const keys=new Set([legacyKey,pendingKey]);
  try{for(let i=0;i<storage.length;i++){const key=storage.key(i);if(typeof key==='string'&&key.startsWith(slotPrefix)&&validId(key.slice(slotPrefix.length)))keys.add(key);}}catch{}
  const drafts=[];
  for(const key of keys)try{const value=JSON.parse(storage.getItem(key)||'null');if(!validRecovery(value))continue;drafts.push({id:key===legacyKey?'legacy':key.slice(slotPrefix.length),updatedAt:Number.isFinite(value.updatedAt)?value.updatedAt:0,revision:Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:0,conflict:!!value.conflict,progress:value.progress,isCurrent:key===pendingKey,matchesServer:!!serverSnapshot&&JSON.stringify(value.progress)===serverSnapshot});}catch{}
  return drafts.sort((a,b)=>b.updatedAt-a.updatedAt||a.id.localeCompare(b.id));
 }
 function publishRecovery({announce=false}={}){
  const drafts=getRecoveryDrafts();recoveryCount=drafts.filter(item=>!item.isCurrent&&!item.matchesServer).length;
  onRecovery(drafts.map(({progress,...item})=>item));
  if(announce&&recoveryCount&&!conflict)status('recovery',`另有 ${recoveryCount} 份未同步恢复副本，可打开同步状态查看、下载或恢复`);
 }
 async function request(options){const r=await fetchImpl('/api/progress',{cache:'no-store',...options});const value=await r.json();if(!r.ok){const e=new Error(value.error||'学习记录同步失败');e.status=r.status;e.current=value.current;throw e;}return value;}
 async function init(){
  status('loading','正在载入学习记录');
  let pending,legacyRaw,fromPrevious=false;try{
   pending=JSON.parse(storage.getItem(pendingKey)||'null');
   if(!validRecovery(pending)&&validId(previousSlotId)&&previousSlotId!==currentId){pending=JSON.parse(storage.getItem(slotPrefix+previousSlotId)||'null');fromPrevious=validRecovery(pending);}
   if(!validRecovery(pending)&&pendingKey!==legacyKey){legacyRaw=storage.getItem(legacyKey);pending=JSON.parse(legacyRaw||'null');}
  }catch{}
  if(validRecovery(pending)){
   applyProgress(pending.progress);revision=Number.isInteger(pending.revision)&&pending.revision>=0?pending.revision:0;dirty=true;
   // Claim an old shared-format recovery only after an independent copy exists.
   if(legacyRaw&&writeRecovery(pendingKey,{...pending,clientId:currentId,updatedAt:pending.updatedAt||Date.now()}))try{if(storage.getItem(legacyKey)===legacyRaw)storage.removeItem(legacyKey);}catch{}
   if(fromPrevious)writeRecovery(pendingKey,{...pending,clientId:currentId,updatedAt:pending.updatedAt||Date.now()});
  }else pending=null;
  try{
   const remote=await request(),local=snapshot(),remoteRevision=remote.revision;
   if(disposed)return;
   serverSnapshot=JSON.stringify(remote.progress);
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
    else if(Object.keys(remote.progress||{}).length||pending){applyProgress(remote.progress);dirty=false;clearPending();}
    else if(Object.keys(local).length){dirty=true;keepPending(local);}
   }
   ready=true;if(dirty&&!conflict)await flush();else if(!conflict){markInitialized();status('saved','学习记录已同步');}
  }catch(error){if(disposed)return;ready=true;dirty=true;keepPending(snapshot());status('offline','离线保存中，联网后重试');onError(error);}
  if(!disposed)publishRecovery({announce:!dirty&&!conflict});
 }
 function save(){dirty=true;sequence++;keepPending(snapshot());if(conflict){status('conflict','其他设备已更新，本页草稿仍保留');return;}status('pending','正在保存…');clearTimeout(timer);timer=setTimeout(()=>flush(),450);}
 async function flush({keepalive=false}={}){
  clearTimeout(timer);if(disposed||!ready||!dirty||conflict||reloading)return false;if(running)return running;
  const sent=sequence,progress=snapshot();
  running=(async()=>{try{
   const body=JSON.stringify({progress,baseRevision:revision});
   // Keepalive has a byte budget shared by pending requests. Normal editing
   // must not use it; only lifecycle saves opt in when the complete UTF-8
   // request is small enough. Chinese text is not one byte per character.
   const value=await request({method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:keepalive&&new TextEncoder().encode(body).byteLength<55000});
   if(disposed)return true;
   serverSnapshot=JSON.stringify(progress);
   revision=value.revision;dirty=sequence!==sent;markInitialized();
   if(dirty)keepPending(snapshot());else clearPending();
   status(dirty?'pending':'saved',dirty?'正在保存…':'学习记录已同步');publishRecovery({announce:!dirty});return true;
  }catch(error){if(disposed)return false;dirty=true;conflict=error.status===409;keepPending(snapshot());status(conflict?'conflict':'offline',conflict?'其他设备已更新，本页草稿仍保留':'离线保存中，联网后重试');onError(error);return false;}
  finally{running=null;if(!disposed&&dirty&&!conflict&&!reloading&&sequence!==sent)timer=setTimeout(()=>flush(),450);}})();
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
   serverSnapshot=JSON.stringify(value.progress);
   clearPending();
   markInitialized();status('saved','已载入服务器记录');publishRecovery({announce:true});return value;
  })();
  try{return await reloading;}finally{reloading=null;if(dirty&&!conflict)timer=setTimeout(()=>flush(),450);}
 }
 async function recoverDraft(id,{discardLocal=false}={}){
  if(reloading)throw new Error('正在载入记录，请稍后再试。');
  if(dirty&&!discardLocal)throw new Error('请先下载本页记录，再确认载入恢复副本。');
  const selected=getRecoveryDrafts().find(item=>item.id===id);if(!selected)throw new Error('这份恢复副本已不存在，请刷新列表。');
  clearTimeout(timer);const started=sequence;
  reloading=(async()=>{
   if(running)await running;
   let remote;try{remote=await request();}catch{}
   if(sequence!==started)throw new Error('载入期间又有新的修改，已保留本页草稿，请重新选择恢复副本。');
   // Retain a second copy even if the caller explicitly replaces a dirty page.
   if(dirty&&discardLocal){const archiveId=newId();if(!writeRecovery(slotPrefix+archiveId,{progress:snapshot(),revision,conflict,clientId:archiveId,updatedAt:Date.now()}))throw new Error('无法保存本页旧草稿，已取消恢复；请先下载本页记录。');}
   applyProgress(selected.progress);revision=selected.revision;dirty=true;conflict=selected.conflict;sequence++;
   if(remote){serverSnapshot=JSON.stringify(remote.progress);if(serverSnapshot===JSON.stringify(selected.progress)){revision=remote.revision;dirty=false;conflict=false;clearPending();}else if(remote.revision!==revision)conflict=true;}
   if(dirty)keepPending(snapshot());
   status(conflict?'conflict':remote?'pending':'offline',conflict?'已恢复副本，服务器已有其他更新；请先下载备份，再选择版本':remote?'已载入恢复副本，正在保存…':'已载入恢复副本，联网后继续保存');
   publishRecovery();return selected;
  })();
  try{await reloading;}finally{reloading=null;if(dirty&&!conflict&&!disposed)timer=setTimeout(()=>flush(),450);}
  if(dirty&&!conflict)await flush();else if(!dirty)status('saved','恢复副本与服务器记录一致');
  return snapshot();
 }
 const online=()=>{if(dirty&&!conflict)flush();};
 const leaving=()=>{if(dirty&&!conflict)flush({keepalive:true});};
 const hidden=()=>{if(document.visibilityState==='hidden')leaving();};
 const storageChanged=event=>{if(event.key===null||event.key===legacyKey||event.key?.startsWith(slotPrefix))publishRecovery({announce:!dirty&&!conflict});};
 if(typeof window!=='undefined'){window.addEventListener('online',online);window.addEventListener('pagehide',leaving);window.addEventListener('storage',storageChanged);document.addEventListener('visibilitychange',hidden);}
 return {init,save,flush,loadLatest,getRecoveryDrafts,recoverDraft,getSnapshot:snapshot,getState:()=>({revision,ready,dirty,conflict,recoveryCount}),destroy(){disposed=true;clearTimeout(timer);if(typeof window!=='undefined'){window.removeEventListener('online',online);window.removeEventListener('pagehide',leaving);window.removeEventListener('storage',storageChanged);document.removeEventListener('visibilitychange',hidden);}}};
}
