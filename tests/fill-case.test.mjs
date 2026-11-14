import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gradeQuiz,validateProgress} from '../public/learning.js';
const read=async file=>JSON.parse(await readFile(new URL(file,import.meta.url),'utf8'));
const lessons=(await Promise.all(['frameworks','platform'].map(name=>read(`../public/data/${name}.json`)))).flat();
const fills=lessons.flatMap(l=>l.quiz).filter(q=>q.type==='fill');
const byId=Object.fromEntries(fills.map(q=>[q.id,q]));
const correct=(id,value)=>gradeQuiz([byId[id]],{[id]:value}).items[0].correct;

test('全部填空均声明大小写规则和原因，170道原有填空规则不变，新增题也逐题验证',()=>{
  const original=fills.filter(q=>!q.introducedIn);
  assert.equal(original.length,170);
  assert.equal(original.filter(q=>q.caseSensitive).length,102);
  assert.equal(original.filter(q=>!q.caseSensitive).length,68);
  for(const q of fills){
    assert.equal(typeof q.caseSensitive,'boolean',q.id);
    assert.ok(q.caseReason?.length>=15,q.id);
    for(const answer of q.answer)assert.equal(correct(q.id,answer),true,`${q.id}: ${answer}`);
    if(!q.caseSensitive)for(const answer of q.answer){
      assert.equal(correct(q.id,answer.toUpperCase()),true,`${q.id}: upper`);
      assert.equal(correct(q.id,answer.toLowerCase()),true,`${q.id}: lower`);
    }
  }
});

test('typeof 的小写返回值与 BigInt 转换函数有别，代码API仍严格区分大小写',()=>{
  assert.equal(typeof 123n,'bigint');
  assert.equal(correct('js-types-q3','bigint'),true);
  for(const wrong of ['BigInt','Bigint','BIGINT'])assert.equal(correct('js-types-q3',wrong),false,wrong);
  assert.match(byId['js-types-q3'].explanation,/BigInt.*Bigint/);
  assert.equal(correct('js-types-q5','isArray'),true);
  assert.equal(correct('js-types-q5','isarray'),false);
  assert.equal(correct('vue-nexttick-q3','nextTick'),true);
  assert.equal(correct('vue-nexttick-q3','nexttick'),false);
  assert.equal(correct('html-scripts-q3','domcontentloaded'),false);
  assert.equal(correct('html-graphics-q3','viewbox'),false);
});

test('概念缩写、HTML和CSS普通名称、HTTP字段名可使用不同大小写',()=>{
  for(const [id,value] of [
    ['js-event-loop-q2','MicroTask'],['js-promise-q3','Rejected'],
    ['vue-composition-q2','Composable'],['network-http-versions-q5','hpack'],
    ['network-https-q5','san'],['react-persistence-q2','Url'],
    ['network-headers-q4','eTaG'],['network-methods-q5','head'],
    ['css-display-q5','NONE'],['css-bfc-q5','FLOAT'],
    ['performance-resources-q5','SIZES'],['html-document-q5','CHARSET'],
    ['html-scripts-q5','MODULE'],['html-drag-q4','TEXT/PLAIN'],
    ['browser-cache-q5','NO-STORE']
  ])assert.equal(correct(id,value),true,`${id}: ${value}`);
});

test('var 函数名可变大小写，但自定义属性名仍必须对应 --z-modal',()=>{
  const q=byId['css-stacking-q3'];
  assert.equal(q.caseSensitive,true);
  assert.equal(q.answer.length,8);
  assert.equal(q.answer[0],'var(--z-modal)');
  for(const value of ['VAR(--z-modal)','vAr(--z-modal)','VaR(--z-modal)'])assert.equal(correct(q.id,value),true);
  for(const value of ['var(--Z-MODAL)','VAR(--z-Modal)','var(--wrong)'])assert.equal(correct(q.id,value),false);
});

test('无题目快照或逐题判定的最古老记录只恢复已保存答案，不推测未答题或改写代码',()=>{
  const original={answers:{'js-event-loop-q2':'MicroTask'},code:'// keep my draft',codeEdited:true,quizResult:{score:0},completed:true};
  const restored=validateProgress({version:1,progress:{'js-event-loop':original}},lessons)['js-event-loop'];
  assert.equal(restored.answers['js-event-loop-q2'],'MicroTask');
  assert.equal(restored.quizResult.correct,1);
  assert.equal(restored.quizResult.unanswered,0);
  assert.equal(restored.quizResult.total,1);
  assert.equal(restored.code,original.code);
  assert.equal(restored.completed,true);
});
