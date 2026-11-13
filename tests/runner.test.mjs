import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildWorkerSource,buildSandboxDocument,mapRunnerLocation,RUNNER_CSP,PREVIEW_CSP,MAX_OUTPUTS,MAX_OUTPUT_LENGTH} from '../public/runner.js';

// Runs only these fixed unit-test fixtures in a VM with deterministic fake time.
// Production learner code is never passed to Node or this helper.
function fixture(code,extra='') {
  const messages=[],listeners={},jobs=new Map();let next=0,now=0,closed=false;
  const schedule=(fn,delay=0,repeat=false)=>{const id=++next;jobs.set(id,{fn,time:now+Math.max(0,Number(delay)||0),delay:Math.max(1,Number(delay)||0),repeat});return id;};
  const scope={performance:{now:()=>now},setTimeout:(fn,delay)=>schedule(fn,delay),clearTimeout:id=>jobs.delete(id),setInterval:(fn,delay)=>schedule(fn,delay,true),clearInterval:id=>jobs.delete(id),postMessage:value=>messages.push(value),close:()=>{closed=true;jobs.clear();},addEventListener:(type,fn)=>listeners[type]=fn};
  scope.self=scope;const context=vm.createContext(scope),metadata=buildWorkerSource(code,extra);
  vm.runInContext(metadata.source,context,{timeout:200,filename:'learning-playground.js'});
  return {messages,context,metadata,listeners,get closed(){return closed;},tick(ms=1000){const until=now+ms;let budget=200;while(jobs.size&&budget-->0){const [id,job]=[...jobs].sort((a,b)=>a[1].time-b[1].time)[0];if(job.time>until)break;now=job.time;if(job.repeat)job.time+=job.delay;else jobs.delete(id);job.fn();}now=until;}};
}

test('学生函数与试运行代码同作用域，输出保留 BigInt、对象及循环引用',()=>{
  const run=fixture('function kindOf(value) { return typeof value; }','const cyclic={n:1n};cyclic.self=cyclic;console.log(kindOf(1n),cyclic);');
  assert.equal(run.messages[0].text,'bigint {n: 1n, self: [Circular]}');
  assert.equal(run.closed,false);run.tick();assert.equal(run.closed,true);
  assert.equal(run.messages.at(-1).state,'done');
});

test('异步定时输出执行后才结束，清理interval不会误报仍在运行',()=>{
  const run=fixture('console.log("start");setTimeout(()=>console.log("later"),150);const task=setInterval(()=>{console.log("tick");clearInterval(task);},100);');
  run.tick(90);assert.equal(run.messages.some(x=>x.state==='done'),false);
  run.tick(120);assert.deepEqual(run.messages.filter(x=>x.type==='log').map(x=>x.text),['start','tick','later']);
  assert.equal(run.closed,false);run.tick(100);assert.equal(run.closed,true);
});

test('clearTimeout 与 clearInterval 交叉清理后正常结束，不误报超时',()=>{
  for(const code of [
    'const task=setInterval(()=>console.log("unexpected"),10);clearTimeout(task);',
    'const task=setTimeout(()=>console.log("unexpected"),10);clearInterval(task);'
  ]){
    const run=fixture(code);
    assert.equal(run.closed,false);
    run.tick(100);
    assert.equal(run.closed,true);
    assert.deepEqual(run.messages.filter(x=>x.type==='log'),[]);
    assert.equal(run.messages.at(-1).state,'done');
  }
});

test('定时回调异常与未处理Promise拒绝显示为error，错误定位映射回学生行号',()=>{
  const run=fixture('setTimeout(()=>{\nthrow new Error("boom");\n},10);');
  run.tick(50);
  const error=run.messages.find(x=>x.type==='error');assert.ok(error.text.includes('boom'));
  assert.equal(mapRunnerLocation(error,run.metadata).line,2);
  let prevented=false;run.listeners.unhandledrejection({reason:'promise failed',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(run.messages.at(-1).text,'promise failed');
  run.tick(100);assert.equal(run.closed,true);
});

test('console输出限流、长行截断、getter不被显示过程执行',()=>{
  const run=fixture('for(let i=0;i<1000;i++)console.log("x".repeat(5000));');
  const logs=run.messages.filter(x=>x.type==='log');assert.equal(logs.length,MAX_OUTPUTS+1);
  assert.equal(logs[0].text.length,MAX_OUTPUT_LENGTH);assert.match(logs.at(-1).text,/上限/);
  const getters=fixture('let calls=0;console.log({get value(){calls++;return "x";}});console.log(calls);');
  assert.match(getters.messages[0].text,/Getter/);assert.equal(getters.messages[1].text,'0');
});

test('网络API、importScripts及子Worker禁用，CSP同时封堵网络与外部脚本',()=>{
  const run=fixture('for(const name of ["fetch","XMLHttpRequest","WebSocket","importScripts","Worker"]){try{self[name]("https://example.com");}catch(error){console.log(error.message);}}');
  assert.equal(run.messages.length,5);assert.ok(run.messages.every(x=>x.text.includes('不提供网络')));
  assert.match(RUNNER_CSP,/connect-src 'none'/);assert.match(RUNNER_CSP,/worker-src blob:/);
  assert.ok(!RUNNER_CSP.includes("'self'"));
  assert.match(PREVIEW_CSP,/script-src 'none'/);assert.match(PREVIEW_CSP,/frame-src 'none'/);
});

test('srcdoc只包含可信桥接代码，token转义不产生额外script，错误区分试运行代码',()=>{
  const doc=buildSandboxDocument('</script><script>alert(1)</script>');
  assert.equal((doc.match(/<script>/g)||[]).length,1);
  assert.equal((doc.match(/<\/script>/g)||[]).length,1);
  assert.ok(doc.includes('Content-Security-Policy'));
  const source=buildWorkerSource('const n=1;\nconsole.log(n);','missing();');
  assert.equal(source.source.split('\n')[source.userStartLine-1],'const n=1;');
  assert.equal(source.source.split('\n')[source.testStartLine-1],'missing();');
  assert.deepEqual(mapRunnerLocation({line:source.testStartLine,column:3},source),{line:1,column:3,source:'test'});
});
