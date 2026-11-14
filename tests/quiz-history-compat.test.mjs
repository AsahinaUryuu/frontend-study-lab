import test from 'node:test';
import assert from 'node:assert/strict';
import {gradeQuiz,validateProgress} from '../public/learning.js';
import {quizAttempt,makeQuizReview,addQuizReview,sanitizeTutorState} from '../public/tutor-context.js';
import {buildLearningCenter} from '../public/learning-center.js';
import {retryIncorrect} from '../public/learning-ux.js';

const q=(id,extra={})=>({id,type:'choice',prompt:id+' 原题',options:['正确','错误'],answer:0,explanation:'原解释',...extra});
const old=[q('a'),q('b')],fresh=q('new',{introducedIn:'1.11.0'});
const lesson={id:'compat',title:'历史兼容',quiz:[old[0],fresh,old[1]],challenge:{starter:''}};
const oldResult=answers=>{const r=gradeQuiz(old,answers);return {...r,items:r.items.map(({id,...item})=>item)};};

test('pre-snapshot positional full marks stay full marks after an inserted new question and repeated import',()=>{
 let p={answers:{a:0,b:0},quizResult:oldResult({a:0,b:0}),completed:true};
 for(let i=0;i<3;i++)p=validateProgress({version:1,progress:{compat:p}},[lesson]).compat;
 const a=quizAttempt(lesson,p);assert.equal(a.result.score,100);assert.equal(a.result.total,2);assert.deepEqual(a.questions.map(q=>q.id),['a','b']);assert.deepEqual(a.newQuestions.map(q=>q.id),['new']);assert.equal(p.completed,true);
 const model=buildLearningCenter([lesson],{compat:p});assert.equal(model.counts.wrong,0);assert.equal(model.questions.find(q=>q.question.id==='new').submitted,false);assert.equal(model.questions.find(q=>q.question.id==='new').newQuestion,true);
});

test('identified old results retain original question order after reorder and removal',()=>{
 const changed={...lesson,quiz:[fresh,old[1]]},p={answers:{a:0,b:1},quizResult:gradeQuiz(old,{a:0,b:1})};
 const a=quizAttempt(changed,p);assert.deepEqual(a.questions.map(q=>q.id),['a','b']);assert.equal(a.questions[0].unavailable,true);assert.equal(a.result.score,50);assert.equal(a.result.items[0].correct,true);assert.equal(a.result.total,2);
});

test('new submissions keep wording, options, original verdicts and answers after the live bank changes',()=>{
 const p={answers:{a:0,b:1}},review=makeQuizReview(lesson.id,p.answers,gradeQuiz(old,p.answers),old);addQuizReview(p,review,{...lesson,quiz:old});
 const changed={...lesson,quiz:[q('b',{answer:1,options:['全新0','全新1']}),fresh,q('a',{answer:1})]};
 const restored=sanitizeTutorState(p,changed).quizReviews[0],a=quizAttempt(changed,restored);
 assert.equal(a.result.score,50);assert.equal(a.questions[0].prompt,'a 原题');assert.deepEqual(a.questions[1].options,['正确','错误']);assert.equal(a.result.items[1].correct,false);assert.equal(a.answers.b,1);assert.equal(a.newQuestions.length,1);
 assert.equal(buildLearningCenter([changed],{compat:{...p,...sanitizeTutorState(p,changed)}}).counts.wrong,1);
});

test('retry clears only old wrong answers and leaves unrelated newly written answers intact',()=>{
 const result=gradeQuiz(old,{a:0,b:1}),next=retryIncorrect(lesson.quiz,{a:0,b:1,new:1},result);
 assert.deepEqual(next,{a:0,new:1});assert.equal(result.score,50);
});

test('typing an inserted new question before submitting cannot displace an old positional verdict',()=>{
 const p={answers:{a:0,new:1,b:0},quizResult:oldResult({a:0,b:0})},a=quizAttempt(lesson,p);
 assert.deepEqual(a.questions.map(q=>q.id),['a','b']);assert.equal(a.result.score,100);assert.equal(a.answers.new,undefined);assert.equal(a.newQuestions[0].id,'new');
});

test('an answer edited after submission cannot silently replace the submitted score on reload',()=>{
 const p={answers:{a:0,b:1}},review=makeQuizReview(lesson.id,p.answers,gradeQuiz(old,p.answers),old);addQuizReview(p,review,{...lesson,quiz:old});p.answers.b=0;
 p.quizResult=review.result;const restored=validateProgress({version:1,progress:{compat:p}},[lesson]).compat;
 assert.equal(quizAttempt(lesson,restored).result.score,50);assert.equal(quizAttempt(lesson,restored).answers.b,1);assert.equal(restored.answers.b,0);
});

test('self-check reflection survives normalization without accepting unknown fields',()=>{
 const p=validateProgress({version:1,progress:{compat:{studyCheck:{reflection:'用自己的话解释',rating:'apply',ratedAt:123,apiKey:'not-a-record'}}}},[lesson]).compat;
 assert.equal(p.studyCheck.reflection,'用自己的话解释');assert.equal(p.studyCheck.rating,'apply');assert.equal(p.studyCheck.apiKey,undefined);
});

test('score-only records are explicitly incomplete through repeated import and legacy snapshot migration',()=>{
 let p={answers:{a:0},quizResult:{score:100}};
 for(let i=0;i<2;i++)p=validateProgress({version:1,progress:{compat:p}},[lesson]).compat;
 let a=quizAttempt(lesson,p);assert.equal(a.result.total,1);assert.equal(a.result.score,100);assert.equal(a.incomplete,true);
 addQuizReview(p,makeQuizReview(lesson.id,{a:0,b:0,new:0},gradeQuiz(lesson.quiz,{a:0,b:0,new:0}),lesson.quiz),lesson);
 const migrated=p.quizReviews.find(r=>r.legacy);assert.equal(migrated.incomplete,true);assert.equal(quizAttempt(lesson,migrated).incomplete,true);assert.equal(migrated.result.total,1);
});

test('score-only original marks survive import cycles even when recovered answers now produce another score',()=>{
 for(const [originalScore,answer,recoveredScore] of [[100,1,0],[0,0,100]]){
  let p={answers:{a:answer},quizResult:{score:originalScore}};
  for(let i=0;i<4;i++){p=validateProgress({version:1,progress:{compat:p}},[lesson]).compat;const a=quizAttempt(lesson,p);assert.equal(a.originalScore,originalScore);assert.equal(a.result.score,recoveredScore);assert.equal(a.incomplete,true);}
  addQuizReview(p,makeQuizReview(lesson.id,{a:0,b:0},gradeQuiz(old,{a:0,b:0}),old),lesson);
  const legacy=sanitizeTutorState(p,lesson).quizReviews.find(r=>r.legacy);assert.equal(legacy.originalScore,originalScore);assert.equal(quizAttempt(lesson,legacy).originalScore,originalScore);
  const model=buildLearningCenter([lesson],{compat:{...p,quizReviews:[legacy]}});assert.equal(model.questions.find(r=>r.question.id==='a').incomplete,true);assert.equal(model.questions.find(r=>r.question.id==='a').originalScore,originalScore);
 }
});
