import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateProgress,gradeQuiz} from '../public/learning.js';
const read=async p=>JSON.parse(await readFile(new URL(p,import.meta.url),'utf8'));
const lessons=(await Promise.all(['frameworks','platform'].map(name=>read(`../public/data/${name}.json`)))).flat();
const original=await read('./fixtures/pdf-questions.json');
const legacy=await read('./fixtures/progress-v1.json');

test('最古老仅保存分数的记录按已有答案恢复；未保存的未答题集合不推测，新增题不扣旧成绩',()=>{
  const restored=validateProgress(legacy,lessons);
  assert.equal(Object.keys(restored).length,52);
  for(const [id,old] of Object.entries(legacy.progress)){
    const now=restored[id],lesson=lessons.find(l=>l.id===id);
    assert.ok(lesson,`旧课程丢失: ${id}`);
    assert.equal(now.code,old.code,id);assert.equal(now.completed,true,id);
    assert.deepEqual(now.answers,old.answers,id);
    const oldQuestions=lesson.quiz.filter(q=>Object.hasOwn(old.answers,q.id));
    assert.equal(gradeQuiz(oldQuestions,old.answers).score,100,`旧题答案含义变化: ${id}`);
    assert.equal(now.quizResult.correct,Object.keys(old.answers).length,id);
    assert.equal(now.quizResult.unanswered,0,id);
    assert.equal(now.quizResult.total,Object.keys(old.answers).length,id);
    assert.equal(now.quizResult.score,100,id);
  }
});

test('182道原书题目各有唯一的详细解答、原始页码和对应小课',()=>{
  const actual=lessons.flatMap(l=>(l.deepDives||[]).map(q=>({...q,chapterId:q.chapterId||l.chapterId,lessonId:l.id})));
  assert.equal(actual.length,182);assert.equal(new Set(actual.map(q=>q.id)).size,182);
  const clean=s=>s.normalize('NFKC').replaceAll('⻅','见').replace(/[\s\p{P}\p{S}]/gu,'').toLowerCase();
  for(const expected of original){
    const q=actual.find(x=>x.id===expected.id);
    assert.ok(q,`缺少 ${expected.id}: ${expected.title}`);
    assert.equal(q.chapterId,expected.chapterId,q.id);assert.equal(q.page,expected.page,q.id);
    assert.ok(clean(q.title).startsWith(clean(expected.title)),`${q.id} 题目不对应: ${q.title}`);
    assert.ok(q.answer?.length>=100,`${q.id} 缺少详细讲解`);
    assert.ok(q.followUp?.length>=8,`${q.id} 缺少具体追问`);
  }
});

test('课程扩充后仍有完整讲解、选择题和填空题，每课至少五道客观题',()=>{
  assert.ok(lessons.length>=82);
  for(const l of lessons){
    assert.ok(l.explanation.length>=3,`${l.id} 讲解不完整`);
    assert.ok(l.quiz.length>=5,`${l.id} 练习不足`);
    const answers=Object.fromEntries(l.quiz.map(q=>[q.id,q.type==='choice'?q.answer:q.answer[0]]));
    assert.equal(gradeQuiz(l.quiz,answers).score,100,l.id);
    assert.equal(gradeQuiz(l.quiz,{}).unanswered,l.quiz.length,l.id);
    assert.ok(l.quiz.some(q=>q.type==='choice')&&l.quiz.some(q=>q.type==='fill'),l.id);
  }
});
