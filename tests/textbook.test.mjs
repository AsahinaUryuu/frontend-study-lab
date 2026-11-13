import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import vm from 'node:vm';
import {STAGES,textbookMarkup} from '../public/textbook.js';
import {validateProgress} from '../public/learning.js';
const read=async name=>JSON.parse(await readFile(new URL(name,import.meta.url),'utf8'));
const lessons=(await Promise.all(['frameworks','platform'].map(x=>read(`../public/data/${x}.json`)))).flat();
const paths=await readdir(new URL('../public/textbook/',import.meta.url));
const parts=await Promise.all(paths.filter(p=>p.endsWith('.json')).map(p=>read('../public/textbook/'+p)));
const books=Object.assign({},...parts);

test('所有85课都有独立教材正文，讲解概念、示例、应用和不计分自检',()=>{
  assert.equal(Object.keys(books).length,85);
  assert.equal(parts.reduce((n,p)=>n+Object.keys(p).length,0),85,'不能重复覆盖其他课程正文');
  for(const l of lessons){
    const b=books[l.id];assert.ok(b,`缺少教材 ${l.id}`);
    assert.ok(b.title&&b.intro&&b.intro!==l.answer,l.id);
    assert.ok(b.objectives?.length>=3&&b.prerequisites?.length>=1,l.id);
    assert.ok(b.sections?.length>=3,l.id);
    let characters=0;
    for(const s of b.sections){
      assert.ok(s.title&&s.paragraphs?.length>=2,l.id);
      for(const p of s.paragraphs){assert.ok(typeof p==='string'&&p.length>=25,`${l.id}/${s.title} 正文不完整`);characters+=p.length;assert.notEqual(p,l.answer,'不能直接把面试答案当教材');}
      if(s.code)assert.ok(s.code.source&&s.code.language&&s.code.explanation,l.id);
      if(s.table)for(const row of s.table.rows)assert.equal(row.length,s.table.columns.length,l.id);
    }
    assert.ok(characters>=350,`${l.id} 正文过于简略`);
    assert.ok(b.sections.some(s=>s.code)||b.walkthrough?.code,`${l.id} 缺少例子`);
    assert.ok(b.walkthrough?.scenario&&b.walkthrough.steps?.length>=3,l.id);
    assert.ok(b.checkpoint?.prompt&&b.checkpoint.answer,l.id);
    assert.ok(b.takeaways?.length>=3,l.id);
  }
});

test('数据类型正文逐类教学且示例输出与注释一致',()=>{
  const b=books['js-types'];assert.ok(b.sections.length>=10);
  for(const type of ['String','Number','Boolean','Undefined','Null','BigInt','Symbol','Object'])assert.ok(b.sections.some(s=>s.title.includes(type)),type);
  const snippets=b.sections.filter(s=>s.code).map(s=>s.code.source).concat(b.walkthrough.code.source);
  const expected=[
    [19,'十八岁','小林'],['你好，小林','00181','小陈','小林'],
    [5970,0.30000000000000004,NaN,true,false],
    [true,'可以购买',true,true,false],
    [undefined,undefined,'你好',undefined],
    ['请先选择商品','笔记本','未选择'],
    [9007199254740994n,2n,'9007199254740993'],
    [false,'来自模块 A','来自模块 B'],['小林',2,38],[10,20],
    ['21',3,true,'number',true],[2,null,null,null],[2400,true,'笔记本 × 2']
  ];
  assert.equal(snippets.length,expected.length);
  snippets.forEach((source,i)=>{const output=[];vm.runInNewContext(source,{console:{log:(...args)=>output.push(...args)}},{timeout:1000});assert.deepEqual(output,expected[i],`数据类型例子 ${i+1}`);});
});

test('教材流程与历史进度兼容，已读状态随导出导入保留且不会自动标记整课完成',()=>{
  assert.deepEqual(STAGES.map(s=>s[0]),['textbook','teach','practice','evaluation','coding','code-review','conclusion']);
  const l=lessons.find(l=>l.id==='js-types');
  const restored=validateProgress({version:1,progress:{[l.id]:{tutorialRead:true,code:'// learner',answers:{},completed:false}}},lessons)[l.id];
  assert.equal(restored.tutorialRead,true);assert.equal(restored.completed,false);assert.equal(restored.code,'// learner');
  const old=validateProgress({version:1,progress:{[l.id]:{completed:true,answers:{}}}},lessons)[l.id];
  assert.equal(old.completed,true);assert.equal(old.tutorialRead,false);
  const markup=textbookMarkup(books[l.id],false,()=>'<pre>code</pre>');
  assert.ok(markup.includes('id="textbook"'));assert.ok(markup.includes('我已读完，进入课堂提问'));
  assert.ok(!markup.includes('面试怎么回答'));
  const bad=structuredClone(books[l.id]);bad.title='<img src=x onerror=alert(1)>';
  assert.ok(textbookMarkup(bad,false,()=>'<pre>code</pre>').includes('&lt;img'));
});


test('新增相等比较实验明确区分对象身份、业务ID及NaN查找',()=>{
  const section=books['js-equality'].sections.find(s=>s.title==='从比较一个值，走到列表去重与选择状态');
  assert.ok(section);const output=[];vm.runInNewContext(section.code.source,{console:{log:value=>output.push(value)}},{timeout:1000});
  assert.deepEqual(output,[false,2,1,2,true,-1]);
});
