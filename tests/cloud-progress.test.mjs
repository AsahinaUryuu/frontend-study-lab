import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudProgress} from '../public/cloud-progress.js';
const clone=value=>structuredClone(value),response=(value,status=200)=>({ok:status<400,status,json:async()=>clone(value)});
const pendingKey='zhixing-cloud-pending-v1';
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
function fixture(t,{local={},remote={},revision=0,storage=new Map(),fetchImpl}={}){
 let progress=clone(local),server=clone(remote),rev=revision;const calls=[],statuses=[],errors=[];
 const fetcher=fetchImpl||(async(_url,options={})=>{calls.push(options);if(options.method==='POST'){const body=JSON.parse(options.body);if(body.baseRevision!==rev)return response({error:'revision conflict'},409);server=clone(body.progress);return response({progress:server,revision:++rev});}return response({progress:server,revision:rev});});
 const client=createCloudProgress({getProgress:()=>progress,applyProgress:value=>{progress=clone(value);},onStatus:(state,message)=>statuses.push({state,message}),onError:error=>errors.push(error),fetchImpl:fetcher,storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
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
