import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {gradeQuiz, validateProgress} from '../public/learning.js';

const questions=[{id:'choice',type:'choice',options:['A','B'],answer:0},{id:'fill',type:'fill',answer:['Object.is','Object.is()']}];
test('客观题评分正确区分选项零、未作答与错误答案',()=>{
  assert.equal(gradeQuiz(questions,{choice:0,fill:'  Object.is()  '}).score,100);
  const empty=gradeQuiz(questions,{});assert.equal(empty.score,0);assert.equal(empty.unanswered,2);
  const mixed=gradeQuiz(questions,{choice:1,fill:'Object.is'});assert.equal(mixed.correct,1);assert.equal(mixed.unanswered,0);
  const identifier=[{id:'fill',type:'fill',answer:['nextTick'],caseSensitive:true}];assert.equal(gradeQuiz(identifier,{fill:'nexttick'}).score,0);assert.equal(gradeQuiz(identifier,{fill:'nextTick'}).score,100);
});
test('导入学习记录重新计算分数并丢弃密钥和陌生模块',()=>{
  const courses=[{id:'a',quiz:questions,challenge:{starter:'// start'}}];
  const p=validateProgress({version:1,progress:{a:{answers:{choice:1,fill:'wrong'},quizResult:{score:100},completed:true,apiKey:'test-secret',code:'hello'},unknown:{completed:true}},apiKey:'test-secret'},courses);
  assert.deepEqual(Object.keys(p),['a']);assert.equal(p.a.quizResult.score,0);assert.equal(p.a.code,'hello');assert.ok(!JSON.stringify(p).includes('test-secret'));
  assert.throws(()=>validateProgress({version:2,progress:{}},courses));
});
test('每一个小课具有完整四区数据、有效答案与来源页码',async()=>{
  const lessons=(await Promise.all(['frameworks','platform'].map(async x=>JSON.parse(await fs.readFile(new URL(`../public/data/${x}.json`,import.meta.url),'utf8'))))).flat();
  const ids=new Set(),counts={};
  assert.ok(lessons.length>=51);
  for(const l of lessons){
    assert.ok(!ids.has(l.id),`重复课程 ${l.id}`);ids.add(l.id);assert.match(l.id,/^[a-z0-9-]+$/);counts[l.chapterId]=(counts[l.chapterId]||0)+1;
    for(const key of ['title','question','answer'])assert.ok(typeof l[key]==='string'&&l[key].length>5,`${l.id}.${key}`);
    assert.ok(l.sourcePages.length>0&&l.sourcePages.every(n=>Number.isInteger(n)&&n>=1&&n<=182),l.id);
    assert.ok(l.explanation.length>=2&&l.explanation.every(x=>x.title&&x.body),l.id);
    assert.ok(l.code.source&&l.code.explanation,l.id);
    assert.ok(l.quiz.length>=3,l.id);assert.ok(l.quiz.some(q=>q.type==='choice')&&l.quiz.some(q=>q.type==='fill'),l.id);
    const qids=new Set();for(const q of l.quiz){assert.ok(!qids.has(q.id));qids.add(q.id);assert.ok(q.prompt&&q.explanation);if(q.type==='choice'){assert.ok(q.options.length>=2&&Number.isInteger(q.answer)&&q.answer>=0&&q.answer<q.options.length);}else{assert.equal(q.type,'fill');assert.ok(Array.isArray(q.answer)&&q.answer.length&&q.answer.every(a=>typeof a==='string'&&a.trim()));}}
    const c=l.challenge;assert.ok(c.title&&c.description&&c.starter&&c.solution);assert.ok(c.rubric.length>=3);assert.ok(Array.isArray(c.hints)&&c.hints.length);assert.ok(l.summary.professional&&l.summary.simple);
  }
  assert.equal(Object.keys(counts).length,9);for(const n of Object.values(counts))assert.ok(n>=4);
});
