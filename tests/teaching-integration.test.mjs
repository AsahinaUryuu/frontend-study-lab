import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTutorContext} from '../lib/tutor.mjs';
import {validateProgress,gradeQuiz} from '../public/learning.js';
import {makeQuizReview,makeCodeReview} from '../public/tutor-context.js';
const old=[{id:'one',type:'choice',prompt:'原题',options:['正确','错误'],answer:0,explanation:'原来的解析'}];
const lesson={id:'case',title:'课程',challenge:{starter:''},quiz:[...old,{id:'new',type:'fill',prompt:'新增题',answer:['yes'],introducedIn:'1.11.0'}]};
test('server tutor explains frozen old questions and grades after the live course grows',()=>{
 const review=makeQuizReview('case',{one:0},gradeQuiz(old,{one:0}),old);
 const changed={...lesson,quiz:[{...old[0],prompt:'之后修改过的原题'},lesson.quiz[1]]};
 const context=buildTutorContext({lessonId:'case',stage:'evaluation',context:{kind:'quiz',contextId:review.id,quizReview:review}},changed,null);
 assert.equal(context.quizReview.result.score,100);assert.equal(context.quizReview.result.total,1);
 assert.equal(context.quizReview.questions.length,1);assert.equal(context.quizReview.questions[0].prompt,'原题');assert.equal(context.quizReview.newQuestionCount,1);
});
test('real import sanitization retains self-check and old scores without counting newly added questions',()=>{
 const prior={completed:true,answers:{one:0},quizResult:gradeQuiz(old,{one:0}),studyCheck:{reflection:'我能举自己的例子',rating:'explain',dueAt:1800000000000,ratedAt:1700000000000}};
 const imported=validateProgress({version:1,progress:{case:prior}},[lesson]).case;
 assert.equal(imported.completed,true);assert.equal(imported.quizResult.score,100);assert.equal(imported.quizResult.correct,1);assert.equal(imported.quizResult.items.length,1);
 assert.equal(imported.studyCheck.reflection,prior.studyCheck.reflection);assert.equal(imported.studyCheck.dueAt,prior.studyCheck.dueAt);
});
test('server keeps the submitted code task separate from a later expanded rubric',()=>{
 const challenge={title:'原任务',description:'原要求',rubric:['原评分标准'],hints:[]};
 const review=makeCodeReview('case',{mode:'code',language:'javascript',code:'console.log(1)'},{score:80,verdict:'还可改进'},challenge);
 const context=buildTutorContext({lessonId:'case',stage:'code-review',context:{kind:'code',contextId:review.id,codeReview:review}}, {...lesson,challenge:{...challenge,rubric:['后来新增的标准']}},null);
 assert.deepEqual(context.codeReview.challenge.rubric,['原评分标准']);assert.equal(context.codeReview.taskSnapshotAvailable,true);
 const old={...review};delete old.challenge;
 const legacy=buildTutorContext({lessonId:'case',stage:'code-review',context:{kind:'code',contextId:old.id,codeReview:old}},lesson,null);
 assert.equal(legacy.codeReview.challenge,null);assert.equal(legacy.codeReview.taskSnapshotAvailable,false);
});

