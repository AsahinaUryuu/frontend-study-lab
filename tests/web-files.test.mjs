import test from 'node:test';
import assert from 'node:assert/strict';
import {webFiles,mainLanguage} from '../public/web-files.js';
import {validateProgress} from '../public/learning.js';

test('联动文件采用本题主代码，配套文件独立保存且显式清空不会丢失',()=>{
  const profile={mode:'web',mainLanguage:'javascript',html:'<button>测试</button>',css:'button{color:red}',javascript:'unused'};
  const state={code:'console.log(1)',webFiles:{html:'',css:'button{color:blue}',javascript:'old code'}};
  assert.deepEqual(webFiles(profile,state),{html:'',css:'button{color:blue}',javascript:'console.log(1)'});
  assert.deepEqual(webFiles({...profile,mainLanguage:'css'},{code:'h1{color:red}'}),{html:'<button>测试</button>',css:'h1{color:red}',javascript:'unused'});
});
test('旧版CSS预览HTML可沿用，切换模式不改变主草稿的语言或内容',()=>{
  const profile={mode:'web',mainLanguage:'css',html:'default'};
  const state={code:'old css',previewHtml:'<h1>old preview</h1>',runMode:'javascript'};
  assert.equal(mainLanguage(profile),'css');
  assert.equal(webFiles(profile,state).html,'<h1>old preview</h1>');
  assert.equal(webFiles(profile,state).css,'old css');
  assert.equal(state.code,'old css');
});
test('进度导入保留三个联动文件，只接受已知字段并限制长度',()=>{
  const lessons=[{id:'demo',quiz:[],challenge:{starter:''}}];
  const result=validateProgress({version:1,progress:{demo:{code:'answer',runMode:'web',webFiles:{html:'',css:'c'.repeat(30001),javascript:'console.log(1)',apiKey:'not-a-key',other:123}}}},lessons).demo;
  assert.equal(result.runMode,'web');assert.deepEqual(Object.keys(result.webFiles).sort(),['css','html','javascript']);
  assert.equal(result.webFiles.html,'');assert.equal(result.webFiles.css.length,30000);assert.equal(result.code,'answer');
});
