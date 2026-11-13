import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {instrumentDomJavaScript,domCsp,domBootstrap} from '../public/dom-runner.js';

function execute(source,limit=1000){
  let ticks=0;const output=[];
  const context=vm.createContext({__learningGuard(){if(++ticks>limit)throw new Error('guard limit');},console:{log:(...values)=>output.push(values)}});
  vm.runInContext(instrumentDomJavaScript(source),context,{timeout:300});
  return {output,ticks,context};
}
test('DOM循环保护解析语法树，不修改字符串或注释，保留源代码行数',()=>{
  const code='// while (true) {}\nconst text="for (;;) {}";\nfor(let i=0;i<2;i++) console.log(text);';
  const guarded=instrumentDomJavaScript(code);
  assert.equal(guarded.split('\n').length,code.split('\n').length);
  assert.ok(guarded.includes('const text="for (;;) {}";'));
  assert.equal(execute(code).output.length,2);
});
test('无限 while、for、do 循环和递归都会触发保护',()=>{
  for(const code of ['while(true){}','for(;;);','do {} while(true);','function again(){again()} again();','const again=()=>again();again();']){
    assert.throws(()=>execute(code,100),/guard limit/);
  }
});
test('循环标签、for of、箭头表达式和严格模式保持正确语义',()=>{
  const {output}=execute('let sum=0; outer:for(const row of [[1,2],[3,4]]) for(const n of row){if(n===3)break outer;sum+=n;} console.log(sum); const object=()=>({value:4});console.log(object().value);function strict(){"use strict";return this;}console.log(strict());');
  assert.deepEqual(output,[[3],[4],[undefined]]);
});
test('语法错误保留学习者行号，模块语法明确报错',()=>{
  try{instrumentDomJavaScript('const ok=1;\nconst broken=;');assert.fail('must reject');}catch(error){assert.equal(error.line,2);assert.ok(error.column>0);}
  assert.throws(()=>instrumentDomJavaScript('import x from "https://example.invalid/x.js";'),/import/);
});
test('联动 CSP 使用随机 nonce，不放开同源、外部脚本或 eval',()=>{
  const policy=domCsp('test-nonce');
  assert.ok(policy.includes("script-src 'nonce-test-nonce'"));
  for(const directive of ["connect-src 'none'","frame-src 'none'","worker-src 'none'","form-action 'none'","object-src 'none'"])assert.ok(policy.includes(directive));
  assert.ok(!policy.includes('unsafe-eval'));assert.ok(!policy.includes('allow-same-origin'));
});
test('运行保护为后续事件重置预算，并限制输出数量和网络 API',()=>{
  const messages=[],listeners={},jobs=[];let time=0;
  const scope={parent:{postMessage:value=>messages.push(value)},performance:{now:()=>time},setTimeout:fn=>{jobs.push(fn);return jobs.length;},clearTimeout(){},addEventListener:(type,fn)=>listeners[type]=fn,Element:class{}};
  scope.window=scope;
  const context=vm.createContext(scope);
  vm.runInContext('('+domBootstrap.toString()+')({token:"test",guardName:"guard",locations:{js:0},maxOutputs:2,maxLength:10});',context);
  vm.runInContext('guard();console.log("abcdefghijklmnop");console.log("second");console.log("third");console.log("fourth");',context);
  assert.equal(messages[0].event.text,'abcdefghij');assert.equal(messages.length,3);
  assert.match(messages[2].event.text,/输出已达上限/);
  time=1000;assert.throws(()=>vm.runInContext('for(let i=0;i<256;i++)guard()',context),/执行过久/);
  jobs.forEach(fn=>fn());assert.doesNotThrow(()=>vm.runInContext('guard()',context));
  assert.throws(()=>vm.runInContext('fetch("https://example.invalid")',context),/不提供网络/);
});
