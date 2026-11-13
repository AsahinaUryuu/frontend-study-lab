import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudProgress} from '../public/cloud-progress.js';
const clone=value=>structuredClone(value),response=(value,status=200)=>({ok:status<400,status,json:async()=>clone(value)});
const pendingKey='zhixing-cloud-pending-v1';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
const sessionStore=(seed=[])=>{const values=new Map(seed);return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),snapshot:()=>[...values]};};
function fixture(t,{local={},remote={},revision=0,storage=new Map(),fetchImpl,sessionStorage,onRecovery=()=>{}}={}){
 let progress=clone(local),server=clone(remote),rev=revision;const calls=[],statuses=[],errors=[];
 const fetcher=fetchImpl||(async(_url,options={})=>{calls.push(options);if(options.method==='POST'){const body=JSON.parse(options.body);if(body.baseRevision!==rev)return response({error:'revision conflict'},409);server=clone(body.progress);return response({progress:server,revision:++rev});}return response({progress:server,revision:rev});});
 const client=createCloudProgress({getProgress:()=>progress,applyProgress:value=>{progress=clone(value);},onStatus:(state,message)=>statuses.push({state,message}),onError:error=>errors.push(error),onRecovery,fetchImpl:fetcher,sessionStorage,storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key),get length(){return storage.size;},key:index=>[...storage.keys()][index]??null}});
 t.after(()=>client.destroy());return {client,calls,statuses,errors,storage,get progress(){return progress;},get server(){return server;},edit(value){progress=clone(value);client.save();},setRemote(value,nextRevision){server=clone(value);rev=nextRevision;}};
}
test('server history loads into a fresh device; empty server receives existing local records intact',async t=>{
 const record={lesson:{answers:{q:0},code:'const x = 1;',notes:'笔记',tutorThreads:{test:{messages:[{role:'user',content:'为什么？'}]}}}};
 const a=fixture(t,{remote:record,revision:4});await a.client.init();assert.deepEqual(a.progress,record);assert.equal(a.client.getState().revision,4);assert.equal(a.calls.filter(c=>c.method==='POST').length,0);
 const b=fixture(t,{local:record});await b.client.init();assert.deepEqual(b.server,record);assert.equal(b.client.getState().dirty,false);assert.equal(b.storage.has(pendingKey),false);
 const exported=b.client.getSnapshot();exported.lesson.code='modified export';assert.equal(b.progress.lesson.code,record.lesson.code);
});
test('a settings-only server record cannot erase original Chrome lessons during first migration',async t=>{
 const local={first:{completed:true},second:{completed:true},third:{quizResult:{score:100},code:'original'},_preferences:{'zhixing-tutor-width':'580'}};
 const f=fixture(t,{local,remote:{_preferences:{'zhixing-tutor-width':'340'}},revision:1});await f.client.init();
 assert.deepEqual(f.progress,local);assert.deepEqual(f.server,local);assert.equal(f.client.getState().revision,2);assert.equal(JSON.parse(f.calls.find(c=>c.method==='POST').body).baseRevision,1);
});
test('first migration with two different nonempty histories preserves local and stays conflicted after reload',async t=>{
 const local={a:{code:'original Chrome'}},remote={a:{code:'different profile'}},storage=new Map();
 const f=fixture(t,{local,remote,revision:1,storage});await f.client.init();assert.equal(f.client.getState().conflict,true);assert.deepEqual(f.progress,local);assert.deepEqual(f.server,remote);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
 f.edit({a:{code:'original continued'}});f.client.destroy();const next=fixture(t,{remote,revision:1,storage});await next.client.init();assert.equal(next.client.getState().conflict,true);assert.deepEqual(next.progress,{a:{code:'original continued'}});assert.equal(next.calls.filter(c=>c.method==='POST').length,0);
});
test('edits during an in-flight save remain pending and the next save uses the acknowledged revision',async t=>{
 const gate=deferred(),posts=[];let first=true;
 const f=fixture(t,{fetchImpl:async(_url,o={})=>{if(o.method!=='POST')return response({progress:{},revision:2});posts.push(JSON.parse(o.body));if(first){first=false;return gate.promise;}return response({revision:4});}});
 await f.client.init();f.edit({a:{code:'first'}});const sent=f.client.flush();f.edit({a:{code:'latest'}});gate.resolve(response({revision:3}));await sent;
 assert.equal(f.client.getState().dirty,true);assert.deepEqual(JSON.parse(f.storage.get(pendingKey)).progress,{a:{code:'latest'}});await f.client.flush();
 assert.deepEqual(posts.map(p=>p.baseRevision),[2,3]);assert.deepEqual(posts[1].progress,{a:{code:'latest'}});assert.equal(f.client.getState().dirty,false);
});
test('409 never replaces or discards the local draft, and exporting remains available',async t=>{
 const f=fixture(t,{remote:{a:{code:'original'}},revision:1});await f.client.init();f.setRemote({a:{code:'other device'}},2);f.edit({a:{code:'my draft'}});assert.equal(await f.client.flush(),false);
 assert.equal(f.client.getState().conflict,true);assert.deepEqual(f.client.getSnapshot(),{a:{code:'my draft'}});assert.deepEqual(f.server,{a:{code:'other device'}});assert.equal(JSON.parse(f.storage.get(pendingKey)).revision,1);
 await assert.rejects(f.client.loadLatest(),/导出/);assert.deepEqual(f.progress,{a:{code:'my draft'}});await f.client.loadLatest({discardLocal:true});assert.deepEqual(f.progress,{a:{code:'other device'}});assert.equal(f.client.getState().conflict,false);
});
test('conflict survives editing and repeated reloads without relabelling the old base revision',async t=>{
 const storage=new Map([[pendingKey,JSON.stringify({progress:{a:{code:'unsent'}},revision:3})]]),remote={a:{code:'new on server'}};
 const first=fixture(t,{remote,revision:7,storage});await first.client.init();assert.equal(first.client.getState().conflict,true);first.edit({a:{code:'unsent edited'}});assert.equal(JSON.parse(storage.get(pendingKey)).revision,3);first.client.destroy();
 const reloaded=fixture(t,{remote,revision:7,storage});await reloaded.client.init();assert.equal(reloaded.client.getState().conflict,true);assert.deepEqual(reloaded.progress,{a:{code:'unsent edited'}});assert.equal(reloaded.calls.filter(c=>c.method==='POST').length,0);
});
test('offline initialization restores pending recovery data and can save when connection returns',async t=>{
 let online=false;const storage=new Map([[pendingKey,JSON.stringify({progress:{a:{notes:'recovery'}},revision:5})]]),posts=[];
 const f=fixture(t,{storage,fetchImpl:async(_url,o={})=>{if(!online)throw new TypeError('network unavailable');posts.push(JSON.parse(o.body));return response({revision:6});}});
 await f.client.init();assert.deepEqual(f.progress,{a:{notes:'recovery'}});assert.equal(f.statuses.at(-1).state,'offline');online=true;await f.client.flush();assert.equal(posts[0].baseRevision,5);assert.equal(f.statuses.at(-1).state,'saved');assert.equal(storage.has(pendingKey),false);
});
test('loading server state waits for in-flight save, and newly typed text wins over a delayed GET',async t=>{
 const post=deferred(),get=deferred();let gets=0;
 const f=fixture(t,{fetchImpl:async(_url,o={})=>o.method==='POST'?post.promise:++gets===1?response({progress:{},revision:0}):get.promise});await f.client.init();f.edit({a:{code:'one'}});const saving=f.client.flush();const loading=f.client.loadLatest({discardLocal:true});
 assert.equal(gets,1);post.resolve(response({revision:1}));await saving;await Promise.resolve();assert.equal(gets,2);f.edit({a:{code:'typed while loading'}});get.resolve(response({progress:{a:{code:'server response'}},revision:1}));await assert.rejects(loading,/新的修改/);assert.equal(f.progress.a.code,'typed while loading');assert.equal(f.client.getState().dirty,true);
});

test('long Chinese notes save without the browser keepalive quota blocking normal editing',async t=>{
 const posts=[];let revision=0;
 const f=fixture(t,{fetchImpl:async(_url,o={})=>{
  if(o.method!=='POST')return response({progress:{},revision});
  const bytes=new TextEncoder().encode(o.body).byteLength;
  if(o.keepalive&&bytes>65536)throw new TypeError('keepalive quota exceeded');
  posts.push({keepalive:o.keepalive,bytes});return response({revision:++revision});
 }});
 await f.client.init();f.edit({lesson:{notes:'学'.repeat(30000)}});assert.equal(await f.client.flush(),true);
 assert.ok(posts[0].bytes>65536);assert.equal(posts[0].keepalive,false);assert.equal(f.client.getState().dirty,false);
});

test('lifecycle saves measure the entire UTF-8 body and keep larger recovery copies on a normal request',async t=>{
 const f=fixture(t);await f.client.init();f.edit({lesson:{notes:'📝'.repeat(15000)}});await f.client.flush({keepalive:true});
 let post=f.calls.filter(o=>o.method==='POST').at(-1);assert.ok(new TextEncoder().encode(post.body).byteLength>55000);assert.equal(post.keepalive,false);
 f.edit({lesson:{notes:'短笔记'}});await f.client.flush({keepalive:true});post=f.calls.filter(o=>o.method==='POST').at(-1);assert.equal(post.keepalive,true);
});

test('one tab saving cannot erase another tab draft, and that tab recovers its own revision after reload',async t=>{
 const storage=new Map(),sessionA=sessionStore(),sessionB=sessionStore();let server={lesson:{notes:'baseline'}},revision=1;
 const fetchImpl=async(_url,o={})=>{if(o.method==='POST'){const body=JSON.parse(o.body);if(body.baseRevision!==revision)return response({error:'conflict',current:{progress:server,revision}},409);server=clone(body.progress);revision++;}return response({progress:server,revision});};
 const a=fixture(t,{storage,sessionStorage:sessionA,fetchImpl});await a.client.init();a.edit({lesson:{notes:'unsaved A'}});
 const aId=a.client.getRecoveryDrafts().find(item=>item.isCurrent).id;
 const b=fixture(t,{storage,sessionStorage:sessionB,fetchImpl});await b.client.init();assert.equal(b.progress.lesson.notes,'baseline');b.edit({lesson:{notes:'saved B'}});await b.client.flush();
 assert.equal(a.client.getState().dirty,true);assert.equal(JSON.parse(storage.get(pendingKey+':tab:'+aId)).progress.lesson.notes,'unsaved A');
 a.client.destroy();const reloaded=fixture(t,{storage,sessionStorage:sessionA,fetchImpl});await reloaded.client.init();
 assert.equal(reloaded.progress.lesson.notes,'unsaved A');assert.equal(reloaded.client.getState().conflict,true);assert.equal(server.lesson.notes,'saved B');
});

test('a new tab discovers closed-tab drafts and can recover a stale copy without overwriting the server',async t=>{
 const storage=new Map(),old=fixture(t,{storage,sessionStorage:sessionStore(),remote:{lesson:{notes:'baseline'}},revision:1});
 await old.client.init();old.edit({lesson:{notes:'closed tab draft'}});const id=old.client.getRecoveryDrafts()[0].id;old.client.destroy();
 const notifications=[],fresh=fixture(t,{storage,sessionStorage:sessionStore(),remote:{lesson:{notes:'newer server'}},revision:2,onRecovery:value=>notifications.push(value)});
 await fresh.client.init();assert.equal(fresh.client.getState().recoveryCount,1);assert.equal(fresh.statuses.at(-1).state,'recovery');assert.equal(notifications.at(-1)[0].id,id);
 const copy=fresh.client.getRecoveryDrafts();copy[0].progress.lesson.notes='changed export';assert.equal(fresh.client.getRecoveryDrafts()[0].progress.lesson.notes,'closed tab draft');
 await fresh.client.recoverDraft(id);assert.equal(fresh.progress.lesson.notes,'closed tab draft');assert.equal(fresh.client.getState().conflict,true);
 assert.equal(fresh.server.lesson.notes,'newer server');assert.equal(fresh.calls.filter(o=>o.method==='POST').length,0);assert.equal(storage.has(pendingKey+':tab:'+id),true);
});

test('choosing a recovery never silently replaces a dirty page and explicit replacement keeps a second copy',async t=>{
 const storage=new Map(),first=fixture(t,{storage,sessionStorage:sessionStore(),revision:1});await first.client.init();first.edit({lesson:{notes:'source'}});const id=first.client.getRecoveryDrafts()[0].id;first.client.destroy();
 const next=fixture(t,{storage,sessionStorage:sessionStore(),revision:2});await next.client.init();next.edit({lesson:{notes:'current unsaved'}});
 await assert.rejects(next.client.recoverDraft(id),/下载本页/);assert.equal(next.progress.lesson.notes,'current unsaved');
 await next.client.recoverDraft(id,{discardLocal:true});assert.equal(next.progress.lesson.notes,'source');
 assert.ok(next.client.getRecoveryDrafts().some(item=>item.progress.lesson?.notes==='current unsaved'));
 assert.equal(next.client.getState().conflict,true);
});

test('legacy shared recovery migrates only after its own slot is durable, and another tab uses server state',async t=>{
 const storage=new Map([[pendingKey,JSON.stringify({progress:{lesson:{notes:'legacy draft'}},revision:1,conflict:true})]]);
 const a=fixture(t,{storage,sessionStorage:sessionStore(),remote:{lesson:{notes:'server'}},revision:2});await a.client.init();
 assert.equal(a.progress.lesson.notes,'legacy draft');assert.equal(storage.has(pendingKey),false);assert.equal(a.client.getRecoveryDrafts().length,1);
 const b=fixture(t,{storage,sessionStorage:sessionStore(),remote:{lesson:{notes:'server'}},revision:2});await b.client.init();
 assert.equal(b.progress.lesson.notes,'server');await b.client.loadLatest({discardLocal:true});
 assert.equal(a.client.getRecoveryDrafts()[0].progress.lesson.notes,'legacy draft');
});

test('a disposed tab cannot clear the new page recovery when an old POST response arrives late',async t=>{
 const storage=new Map(),session=sessionStore(),gate=deferred();
 const a=fixture(t,{storage,sessionStorage:session,fetchImpl:async(_url,o={})=>o.method==='POST'?gate.promise:response({progress:{},revision:0})});
 await a.client.init();a.edit({lesson:{notes:'old request'}});const inFlight=a.client.flush();a.client.destroy();
 const b=fixture(t,{storage,sessionStorage:session,fetchImpl:async()=>{throw new Error('offline');}});await b.client.init();b.edit({lesson:{notes:'new page draft'}});
 gate.resolve(response({revision:1}));await inFlight;
 assert.equal(b.client.getRecoveryDrafts().find(item=>item.isCurrent).progress.lesson.notes,'new page draft');
});

test('Chrome duplicate-tab sessionStorage copy still creates a different document slot',async t=>{
 const storage=new Map(),sessionA=sessionStore();let server={},revision=0;
 const fetchImpl=async(_url,o={})=>{if(o.method==='POST'){const body=JSON.parse(o.body);if(body.baseRevision!==revision)return response({error:'conflict'},409);server=clone(body.progress);revision++;}return response({progress:server,revision});};
 const a=fixture(t,{storage,sessionStorage:sessionA,fetchImpl});await a.client.init();a.edit({lesson:{notes:'original tab draft'}});const originalId=a.client.getRecoveryDrafts().find(item=>item.isCurrent).id;
 const duplicate=fixture(t,{storage,sessionStorage:sessionStore(sessionA.snapshot()),fetchImpl});await duplicate.client.init();duplicate.edit({lesson:{notes:'duplicated tab edit'}});
 const duplicateId=duplicate.client.getRecoveryDrafts().find(item=>item.isCurrent).id;assert.notEqual(originalId,duplicateId);await duplicate.client.flush();
 assert.equal(JSON.parse(storage.get(pendingKey+':tab:'+originalId)).progress.lesson.notes,'original tab draft');
 assert.equal(server.lesson.notes,'duplicated tab edit');
});

test('retained source copies equal to server history remain downloadable without an abnormal recovery badge',async t=>{
 const storage=new Map(),session=sessionStore(),record={lesson:{notes:'already synchronized'}};
 const a=fixture(t,{storage,sessionStorage:session});await a.client.init();a.edit(record);a.client.destroy();
 const b=fixture(t,{storage,sessionStorage:session,remote:record,revision:1});await b.client.init();
 assert.equal(b.client.getState().recoveryCount,0);assert.equal(b.statuses.at(-1).state,'saved');
 assert.ok(b.client.getRecoveryDrafts().some(item=>item.matchesServer&&item.progress.lesson.notes==='already synchronized'));
 assert.equal(b.calls.filter(o=>o.method==='POST').length,0);
});
