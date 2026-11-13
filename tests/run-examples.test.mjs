import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';

const read=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const examples=await read('../public/run-examples.json');
const expected=await read('./fixtures/run-example-outputs.json');
const lessons=(await Promise.all(['frameworks','platform'].map(name=>read(`../public/data/${name}.json`)))).flat();

test('85课根据实际实操语言选择运行方式，并明确标注需要完整项目的课程',()=>{
  assert.equal(Object.keys(examples).length,85);
  assert.deepEqual(Object.keys(examples).sort(),lessons.map(l=>l.id).sort());
  for(const lesson of lessons){
    const example=examples[lesson.id];
    assert.ok(['javascript','web','project'].includes(example.mode),lesson.id);
    assert.ok(example.hint.length>=15,lesson.id);
    assert.equal(typeof example.testCode,'string');
    assert.equal(typeof example.html,'string');
    if(example.mode==='javascript'){
      assert.ok(example.testCode.includes('console.log'),lesson.id);
      assert.doesNotThrow(()=>new vm.Script(lesson.challenge.solution+'\n'+example.testCode),lesson.id);
    }else if(example.mode==='web'){
      assert.ok(['javascript','html','css'].includes(example.mainLanguage),lesson.id);
      assert.equal(typeof example.css,'string',lesson.id);
      assert.equal(typeof example.javascript,'string',lesson.id);
      if(example.mainLanguage!=='html')assert.ok(example.html.trim(),lesson.id);
      if(example.mainLanguage==='javascript'){
        assert.ok(example.testCode.trim(),lesson.id);
        assert.doesNotThrow(()=>new vm.Script(lesson.challenge.solution+'\n;\n'+example.testCode),lesson.id);
      }else assert.doesNotThrow(()=>new vm.Script(example.javascript),lesson.id);
    }else assert.equal(example.testCode,'',lesson.id);
    if(lesson.chapterId==='vue')assert.equal(example.mode,'project',lesson.id);
    if(lesson.chapterId==='react'&&lesson.id!=='react-redux')assert.equal(example.mode,'project',lesson.id);
  }
  assert.equal(examples['js-loading'].mode,'javascript','课程讲解语言不应误当实操语言');
  for(const id of ['js-fetch','js-modules','browser-processes','engineering-git','html-scripts','html-offline'])assert.equal(examples[id].mode,'project',id);
  assert.equal(Object.values(examples).filter(x=>x.mode==='web').length,20);
  for(const id of ['browser-events','browser-security','performance-animation','performance-fragment','performance-lazy','html-drag','js-memory','js-dom-bom','performance-layout'])assert.equal(examples[id].mode,'web',id);
});

test('CSS示例提供题目所需DOM，不夹带JavaScript或外部资源请求',()=>{
  const selectors={
    'css-display':['card'],'css-units-center':['overlay','dialog'],
    'css-bfc':['profile','avatar'],'css-stacking':['nav','dialog-layer'],
    'css-loading':['notice'],'css-features-sprites':['icon','icon-search'],
    'css-hairline':['separator']
  };
  for(const [id,classes] of Object.entries(selectors)){
    const html=examples[id].html;
    assert.ok(!/<script|\bon\w+\s*=|\bsrc\s*=|\bhref\s*=/i.test(html),id);
    for(const cls of classes)assert.match(html,new RegExp(`class="[^"]*\\b${cls}\\b`),id);
  }
  assert.match(examples['css-features-sprites'].hint,/icons@2x\.png/);
  assert.match(examples['performance-resources'].hint,/photo-/);
});

test('27个纯JS调用示例实际执行参考函数，异步示例完成且不访问网络',async t=>{
  assert.equal(Object.keys(expected).length,30);
  assert.equal(lessons.filter(l=>examples[l.id].mode==='javascript').length,27);
  for(const lesson of lessons.filter(l=>examples[l.id].mode==='javascript')){
    await t.test(lesson.id,async()=>{
      const output=[],timers=new Set();
      const deny=()=>{throw new Error('测试不允许网络访问');};
      const context={
        console:{log:(...args)=>output.push(args.map(String).join(' '))},
        URL,URLSearchParams,performance,fetch:deny,XMLHttpRequest:deny,WebSocket:deny,
        setTimeout:(callback,delay,...args)=>{const timer=setTimeout(()=>{timers.delete(timer);callback(...args);},delay);timers.add(timer);return timer;},
        clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);}
      };
      let timeout;
      try{
        const result=vm.runInNewContext(lesson.challenge.solution+'\n'+examples[lesson.id].testCode,context,{timeout:1000});
        await Promise.race([Promise.resolve(result),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('示例未及时完成')),1500);})]);
        assert.deepEqual(output,expected[lesson.id]);
      }finally{clearTimeout(timeout);for(const timer of timers)clearTimeout(timer);}
    });
  }
});
