import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProgress} from '../public/learning.js';
import {playgroundMarkup} from '../public/playground.js';

const lessons=[{id:'demo',quiz:[],challenge:{starter:'// starter'}}];
const imported=p=>validateProgress({version:1,progress:{demo:p}},lessons).demo;

test('运行模式、调用示例与预览 HTML 可随进度导入，清空的内容不会变回默认值',()=>{
  const old={code:'console.log(2)',completed:true,tutorialRead:true,answers:{}};
  const clean=imported({...old,runMode:'css',runTestCode:'',previewHtml:'<h1>草稿</h1>'});
  assert.equal(clean.runMode,'css');assert.equal(clean.runTestCode,'');assert.equal(clean.previewHtml,'<h1>草稿</h1>');
  assert.equal(clean.code,old.code);assert.equal(clean.completed,true);assert.equal(clean.tutorialRead,true);
  const markup=playgroundMarkup({mode:'javascript',testCode:'default call',html:'default html'},clean);
  assert.match(markup,/<option value="css" selected>/);
  assert.match(markup,/id="run-test-code"[^>]*><\/textarea>/);
  assert.ok(!markup.includes('default call'));assert.ok(!markup.includes('default html'));
  const legacy=imported(old);assert.equal(legacy.runMode,undefined);assert.equal(legacy.previewHtml,undefined);
});

test('导入只接受支持的运行模式，限制草稿长度并保留显式空预览',()=>{
  const clean=imported({runMode:'node',runTestCode:'x'.repeat(10001),previewHtml:'y'.repeat(30001)});
  assert.equal(clean.runMode,undefined);assert.equal(clean.runTestCode.length,10000);assert.equal(clean.previewHtml.length,30000);
  const blank=imported({previewHtml:'',runTestCode:123});
  assert.equal(blank.previewHtml,'');assert.equal(blank.runTestCode,undefined);
});

test('运行面板对课程提示和可编辑代码转义，避免内容成为页面标签',()=>{
  const attack='</textarea><script>alert("x")</script>';
  const markup=playgroundMarkup({mode:'project',hint:'<img src=x onerror=alert(1)>',testCode:attack,html:attack});
  assert.ok(!markup.includes('<script>'));assert.ok(!markup.includes('<img'));
  assert.ok(markup.includes('&lt;/textarea&gt;&lt;script&gt;'));
  assert.match(markup,/<option value="project" selected>/);
});
