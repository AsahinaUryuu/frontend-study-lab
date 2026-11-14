import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {gradeQuiz} from '../public/learning.js';
import {textbookMarkup} from '../public/textbook.js';
const read=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));
const lessons=(await Promise.all(['frameworks','platform'].map(name=>read(`../public/data/${name}.json`)))).flat();
const byId=Object.fromEntries(lessons.map(l=>[l.id,l]));
const books=Object.assign({},...await Promise.all((await readdir(new URL('../public/textbook/',import.meta.url))).filter(x=>x.endsWith('.json')).map(x=>read('../public/textbook/'+x))));
const audit=await read('./fixtures/foundations-1.11-audit.json');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const added=id=>books[id].sections.filter(s=>audit.lessons[id].addedSectionTitles.includes(s.title));
const source=(id,index=0)=>added(id)[index].code.source;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function run(source,extras={}) {
  const logs=[],timers=[];
  const context=vm.createContext({console:{log:(...v)=>logs.push(v.map(String).join(' '))},queueMicrotask,Response,...extras,setTimeout:callback=>{timers.push(callback);return timers.length;}});
  const returned=vm.runInContext(source,context,{timeout:1000});await flush();
  while(timers.length){timers.shift()();await flush();}
  if(returned&&typeof returned.then==='function')await returned;
  await flush();return {logs,context};
}

test('内容增量保留85课、旧425题完整内容和所有旧正文/实操契约',()=>{
  assert.equal(lessons.length,85);assert.equal(Object.keys(audit.baseline).length,85);let preserved=0;
  for(const [id,b] of Object.entries(audit.baseline)){
    const l=byId[id];assert.ok(l,id);
    for(const [qid,expected] of Object.entries(b.questionHashes)){assert.equal(hash(l.quiz.find(q=>q.id===qid)),expected,qid);preserved++;}
    for(const [i,expected] of b.sectionHashes.entries())assert.equal(hash(books[id].sections[i]),expected,`${id} old section ${i}`);
    assert.equal(hash(Object.fromEntries(['title','description','starter','solution'].map(k=>[k,l.challenge[k]]))),b.challengeContractHash,`${id} practice contract`);
  }
  assert.equal(preserved,425);const ids=lessons.flatMap(l=>l.quiz.map(q=>q.id));assert.equal(ids.length,455);assert.equal(new Set(ids).size,455);
});

test('15课增加30节60段，各有观察/误区/迁移练习，官方来源接入现有结论区',()=>{
  assert.equal(Object.keys(audit.lessons).length,15);let sections=0,paragraphs=0;
  for(const [id,e] of Object.entries(audit.lessons)){
    const content=added(id);assert.equal(content.length,2,id);assert.ok(content.some(s=>s.code),id);
    const markup=textbookMarkup(books[id],false,()=>'<pre>example</pre>');
    for(const s of content){
      sections++;paragraphs+=s.paragraphs.length;assert.equal(s.paragraphs.length,2);
      assert.ok(s.paragraphs.every(p=>p.length>=70),id+' substantive paragraph');
      assert.ok(s.points.some(p=>/^(观察|步骤)：/.test(p)),s.title);assert.ok(s.points.some(p=>p.startsWith('误区：')),s.title);assert.ok(s.points.some(p=>p.startsWith('迁移练习：')),s.title);assert.ok(markup.includes(s.title),s.title);
    }
    assert.ok(e.sources.length>=1,id);
    for(const r of e.sources){assert.ok(['developer.mozilla.org','react.dev','vuejs.org'].includes(new URL(r.url).hostname));assert.ok(r.checked.length>=20);assert.ok(byId[id].references.some(x=>x.url===r.url));}
    for(const boundary of e.addedRubric)assert.ok(byId[id].challenge.rubric.includes(boundary));
  }
  assert.equal(sections,30);assert.equal(paragraphs,60);
});

test('30道新题有版本与解释，正确/错误/未答判分及大小写约束明确',()=>{
  let count=0;
  for(const [id,e] of Object.entries(audit.lessons))for(const qid of e.addedQuestionIds){
    const q=byId[id].quiz.find(q=>q.id===qid);count++;assert.equal(q.introducedIn,'1.11.0');assert.ok(q.explanation.length>=35,qid);
    assert.equal(gradeQuiz([q],{}).unanswered,1);const right=q.type==='choice'?q.answer:q.answer[0];assert.equal(gradeQuiz([q],{[q.id]:right}).score,100,q.id);
    const wrong=q.type==='choice'?(q.answer+1)%q.options.length:'不正确的占位答案';assert.equal(gradeQuiz([q],{[q.id]:wrong}).score,0,q.id);
    if(q.type==='fill')assert.equal(gradeQuiz([q],{[q.id]:right.toUpperCase()}).score,q.caseSensitive?0:100,q.id);
    if(q.code)assert.doesNotThrow(()=>new vm.Script(q.code.source),q.id);
  }
  assert.equal(count,30);
});

test('闭包示例区分值快照、共享绑定与独立实例，计数器负数和reset成立',async()=>{
  assert.deepEqual((await run(source('js-closure'))).logs,['1','创建时次数：0','0']);
  const create=vm.runInNewContext(byId['js-closure'].challenge.solution+';createCounter');const a=create(-2),b=create(10),{next}=a;
  assert.equal(next(),-1);assert.equal(b.next(),11);assert.equal(a.reset(),-2);assert.equal(a.reset(),-2);assert.equal(next(),-1);assert.equal(b.next(),12);
});

test('this示例区分绑定对象、属性更新和箭头接收者，参数与返回值不丢失',async()=>{
  assert.deepEqual((await run(source('js-this'))).logs,['30','36']);assert.deepEqual((await run(source('js-this',1))).logs,['小林']);
  const bindMethod=vm.runInNewContext(byId['js-this'].challenge.solution+';bindMethod');const obj={base:3,sum(a,b){return this.base+a+b;}},bound=bindMethod(obj,'sum');
  assert.equal(bound.call({base:100},2,4),9);obj.base=8;assert.equal(bound(2,4),14);
});

test('嵌套微任务遵守入队顺序，分块示例保留全部205项输入',async()=>{
  assert.deepEqual((await run(source('js-event-loop'))).logs,['sync','A','B','C','timer']);const seen=[];
  await run(source('js-event-loop',1)+'\nprocessInChunks(Array.from({length:205},(_,i)=>i),handle);',{handle:v=>seen.push(v)});assert.deepEqual(seen,Array.from({length:205},(_,i)=>i));
});

test('Promise示例return/finally语义与实操同步抛错、异步拒绝一致',async()=>{
  assert.deepEqual((await run(source('js-promise'))).logs,['MORI']);assert.deepEqual((await run(source('js-promise',1))).logs.sort(),['原结果','网络中断'].sort());
  const load=vm.runInNewContext(byId['js-promise'].challenge.solution+';loadUserName'),error=new Error('test');assert.equal(await load(()=>Promise.resolve({name:'mori'})),'MORI');
  await assert.rejects(load(()=>{throw error;}),e=>e===error);await assert.rejects(load(()=>Promise.reject(error)),e=>e===error);
});

test('并发示例反序完成仍按输入映射，实操等待前启动两项',async()=>{
  assert.deepEqual((await run(source('js-async'))).logs,['启动A','启动B','A结果 B结果']);
  const load=vm.runInNewContext(byId['js-async'].challenge.solution+';loadBoth');const calls=[];let a,b;
  const pending=load(()=>{calls.push('a');return new Promise(r=>a=r);},()=>{calls.push('b');return new Promise(r=>b=r);});
  assert.deepEqual(calls,['a','b']);b(2);a(1);assert.deepEqual(JSON.parse(JSON.stringify(await pending)),{a:1,b:2});
});

test('fetch示例区分HTTP与JSON失败，实操透传signal并保留异常',async()=>{
  assert.deepEqual((await run(source('js-fetch'))).logs,['{"ok":true} | HTTP 404 | JSON解析失败']);let response=new Response('{"name":"ok"}'),received;
  const fetchJSON=vm.runInNewContext(byId['js-fetch'].challenge.solution+';fetchJSON',{fetch:async(url,options)=>{received=options;return response;}});
  const controller=new AbortController();assert.deepEqual(await fetchJSON('/test',{signal:controller.signal}),{name:'ok'});assert.equal(received.signal,controller.signal);
  response=new Response('{}',{status:404});await assert.rejects(fetchJSON('/test'),/HTTP 404/);response=new Response('bad');await assert.rejects(fetchJSON('/test'),{name:'SyntaxError'});
  const error=new Error('offline'),rejected=vm.runInNewContext(byId['js-fetch'].challenge.solution+';fetchJSON',{fetch:async()=>{throw error;}});await assert.rejects(rejected('/test'),e=>e===error);
});

test('React更新队列按顺序处理替换与函数式值，数组示例不改旧对象',async()=>{
  let next=1;await run(source('react-state'),{count:1,setCount:v=>{next=typeof v==='function'?v(next):v;}});assert.equal(next,2);
  const old=[{id:1,done:false},{id:2,done:false}];let changed;await run(source('react-state',1),{targetId:1,setItems:update=>{changed=update(old);}});
  assert.equal(old[0].done,false);assert.equal(changed[0].done,true);assert.notEqual(changed[0],old[0]);assert.equal(changed[1],old[1]);
});

test('Effect示例cleanup释放自身订阅，有效标记同时拒绝旧成功和旧错误',async()=>{
  let cleanup,resolveProfile,rejectProfile;const values=[],errors=[];
  await run(source('react-effects'),{channelId:'A',subscribe:id=>()=>values.push('released '+id),setMessage:()=>{},useEffect:setup=>{cleanup=setup();}});cleanup();assert.deepEqual(values,['released A']);values.length=0;
  await run(source('react-effects',1),{userId:'A',loadProfile:()=>new Promise((r,j)=>{resolveProfile=r;rejectProfile=j;}),setProfile:v=>values.push(v),setError:e=>errors.push(e),useEffect:setup=>{cleanup=setup();}});
  cleanup();resolveProfile('stale');await flush();assert.deepEqual(values,[null]);assert.deepEqual(errors,[null]);
  await run(source('react-effects',1),{userId:'B',loadProfile:()=>new Promise((r,j)=>{rejectProfile=j;}),setProfile:v=>values.push(v),setError:e=>errors.push(e),useEffect:setup=>{cleanup=setup();}});
  cleanup();rejectProfile(new Error('stale error'));await flush();assert.deepEqual(errors,[null,null]);
});

test('缓存实操304没有新body，标签匹配只支持题设简化边界',()=>{
  const get=vm.runInNewContext(byId['browser-cache'].challenge.solution+';getResponse');assert.equal(get('"v2"').status,304);assert.equal('body' in get('"v2"'),false);
  for(const tag of [undefined,'v2','"v1"','W/"v2"','"v1", "v2"']){const r=get(tag);assert.equal(r.status,200);assert.equal(r.body,'hello');assert.equal(r.headers.ETag,'"v2"');}
});
