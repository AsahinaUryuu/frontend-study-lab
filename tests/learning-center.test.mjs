import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildLearningCenter,centerState,centerQuery,centerHref,centerLessonHref,lessonCenterEntry,centerQuestions,centerNotes,centerSuggestions,notesMarkdown} from '../public/learning-center.js';

const chapters=[{id:'js',name:'JavaScript'},{id:'css',name:'CSS'}];
const lessons=[
 {id:'types',chapterId:'js',title:'类型判断',tutorial:{title:'认识数据类型'},tags:['typeof'],quiz:[{id:'choice',type:'choice',prompt:'哪一种可以判断数组？',code:{source:'Array.isArray([])',language:'javascript'},options:['Array.isArray','typeof'],answer:0,explanation:'数组用 Array.isArray。'},{id:'fill',type:'fill',prompt:'类型名称',answer:['bigint'],caseSensitive:false}]},
 {id:'equal',chapterId:'js',title:'相等比较',quiz:[{id:'case',type:'fill',prompt:'写出严格的标识符',answer:['Object.is'],caseSensitive:true}]},
 {id:'layout',chapterId:'css',title:'布局与换行',quiz:[{id:'css-choice',type:'choice',prompt:'Flex 排列',options:['row','column'],answer:0}]},
];
const review=(id,answers,createdAt)=>({id,answers,createdAt,result:{items:[{correct:true}],correct:99}});
const options=(overrides={})=>({...centerState(),...overrides});

test('projection is read-only and ignores unknown progress/config fields',()=>{
 const progress={types:{visited:true,answers:{choice:1},quizReviews:[review('one',{choice:1},'2026-01-01')],notes:'自己的理解',apiKey:'DO_NOT_EXPORT'},unknown:{visited:true},_preferences:{secret:'DO_NOT_EXPORT'}};
 const before=structuredClone(progress);Object.freeze(progress.types.answers);Object.freeze(progress.types);Object.freeze(progress);
 const model=buildLearningCenter(lessons,progress,chapters);
 assert.equal(model.courses.length,3);assert.equal(model.counts.started,1);assert.equal(model.counts.wrong,1);assert.equal(model.notes.length,1);
 assert.equal(JSON.stringify(model).includes('DO_NOT_EXPORT'),false);assert.deepEqual(progress,before);
});

test('wrong answers use newest submission rather than selected old review or forged grade',()=>{
 const p={types:{answers:{choice:0,fill:'BigInt'},quizReviewId:'old',quizReviews:[review('new',{choice:0,fill:'BigInt'},'2026-03-01'),review('old',{choice:1,fill:'wrong'},'2026-01-01')]}};
 const model=buildLearningCenter(lessons,p,chapters);
 assert.equal(model.counts.wrong,0);assert.equal(model.counts.pending,0);
 assert.equal(model.questions[0].reviewId,'new');assert.equal(model.questions[0].submittedAnswer,0);
});

test('editing a wrong answer does not mark it mastered until another submission',()=>{
 const p={types:{answers:{choice:0,fill:''},quizReviews:[review('first',{choice:1,fill:'not bigint'},'2026-01-01')]}};
 let model=buildLearningCenter(lessons,p,chapters);
 assert.equal(model.counts.wrong,2);assert.equal(model.counts.pending,1);
 assert.equal(model.questions[0].changed,true);assert.equal(model.questions[0].wrong,true);
 assert.equal(model.questions[1].unanswered,true);assert.equal(model.questions[1].wrong,true);
 p.types.quizReviews.push(review('second',{choice:0,fill:'BIGINT'},'2026-02-01'));p.types.answers.fill='BIGINT';
 model=buildLearningCenter(lessons,p,chapters);assert.equal(model.counts.wrong,0);assert.equal(model.counts.pending,0);
});

test('unsubmitted drafts are pending, never labeled wrong; blank and invalid choices are unanswered',()=>{
 const model=buildLearningCenter(lessons,{types:{answers:{choice:1,fill:'  '}},equal:{answers:{case:'object.is'}},layout:{answers:{'css-choice':9}}},chapters);
 assert.equal(model.counts.wrong,0);assert.equal(model.counts.pending,2);assert.equal(model.questions[0].pending,true);
 assert.equal(model.questions[1].unanswered,true);assert.equal(model.questions.at(-1).unanswered,true);
 assert.equal(centerQuestions(model,options({status:'pending'})).length,2);
});

test('legacy records and case-sensitive fill questions retain existing grading rules',()=>{
 const model=buildLearningCenter(lessons,{types:{answers:{choice:0,fill:'ＢＩＧＩＮＴ'},quizResult:{}},equal:{answers:{case:'object.is'},quizResult:{}}},chapters);
 assert.equal(model.counts.wrong,1);assert.equal(model.questions[0].wrong,false);assert.equal(model.questions[1].wrong,false);assert.equal(model.questions[2].wrong,true);
});

test('chapter/code searches, current unanswered scope, and sorting work across courses',()=>{
 const model=buildLearningCenter(lessons,{types:{visited:true,lastSeen:10,answers:{}},equal:{visited:true,lastSeen:20,answers:{}}},chapters);
 assert.equal(centerQuestions(model,options()).length,3);assert.equal(centerQuestions(model,options({scope:'all'})).length,4);
 assert.deepEqual(centerQuestions(model,options({chapter:'css',scope:'all'})).map(r=>r.lessonId),['layout']);
 assert.deepEqual(centerQuestions(model,options({query:'ARRAY.ISARRAY 类型'})).map(r=>r.question.id),['choice']);
 assert.equal(centerQuestions(model,options({query:'does not exist'})).length,0);
 assert.equal(centerQuestions(model,options())[0].lessonId,'equal');assert.equal(centerQuestions(model,options({order:'path'}))[0].lessonId,'types');
});

test('note search covers full text and Unicode normalization without changing note contents',()=>{
 const notes='开头\n'+'长'.repeat(450)+'\nCSS ＧＲＩＤ 的补充理解';
 const model=buildLearningCenter(lessons,{types:{notes,lastSeen:10},layout:{notes:'Flex 与换行',lastSeen:20},equal:{notes:'  '}},chapters);
 assert.equal(model.notes.length,2);assert.equal(centerNotes(model,options({query:'grid 补充'}))[0].notes,notes);
 assert.equal(centerNotes(model,options({chapter:'css'}))[0].id,'layout');assert.equal(centerNotes(model,options())[0].id,'layout');
});

test('Markdown export contains only note fields and safely preserves embedded code fences',()=>{
 const notes=[{id:'types',title:'类型 <script>',chapter:'JavaScript',notes:'第一行\n```js\nconst a = 1;\n```\n<script>alert(1)</script>',apiKey:'SECRET_KEY',tutorThreads:{reply:'PRIVATE_REPLY'}}];
 const exported=notesMarkdown(notes,{generatedAt:new Date('2026-03-01T00:00:00Z')});
 assert.match(exported,/共 1 篇/);assert.match(exported,/````text\n第一行/);assert.ok(exported.includes(notes[0].notes));
 assert.equal(exported.includes('SECRET_KEY'),false);assert.equal(exported.includes('PRIVATE_REPLY'),false);assert.match(exported,/类型 \\<script\\>/);
 assert.ok(notesMarkdown([]).includes('共 0 篇'));
});

test('recommendations resume latest unfinished stage, prioritize real wrong answers, and show favorites',()=>{
 const model=buildLearningCenter(lessons,{types:{visited:true,lastSeen:20,lastStage:'coding',answers:{},quizReviews:[review('one',{choice:1},'2026-01-01')]},equal:{visited:true,lastSeen:50,completed:true},layout:{bookmarked:true}},chapters);
 const suggestions=centerSuggestions(model);
 assert.deepEqual(suggestions.map(s=>s.kind),['continue','wrong','favorite']);assert.equal(suggestions[0].course.id,'types');assert.equal(suggestions[0].stage,'coding');assert.equal(suggestions[1].questionId,'choice');assert.equal(suggestions[2].course.id,'layout');
 assert.equal(centerSuggestions(model,{chapter:'css'})[0].kind,'start');assert.equal(centerSuggestions(model,{query:'nothing'}).length,0);
});

test('deep links preserve filters and target exact quiz/note; arbitrary stages and external returns are rejected',()=>{
 const state=options({tab:'questions',query:'a & b? #中文',chapter:'js',status:'wrong',page:2});
 const href=centerLessonHref({id:'types'},{questionId:'choice',stage:'practice',returnState:state});
 const params=new URLSearchParams(href.split('?')[1]),entry=lessonCenterEntry(params,lessons[0]);
 assert.equal(entry.questionId,'choice');assert.equal(entry.stage,'practice');assert.equal(entry.returnHref,centerHref(state));
 assert.deepEqual(centerState(new URLSearchParams(centerQuery(state))),state);
 const bad=lessonCenterEntry(new URLSearchParams('quiz=other&stage=javascript:evil&review=https://evil.test&notes=1'),lessons[0]);
 assert.equal(bad.questionId,'');assert.equal(bad.stage,'');assert.equal(bad.openNotes,true);assert.ok(bad.returnHref.startsWith('#review?'));assert.equal(bad.returnHref.includes('evil.test'),false);
});

test('empty state suggests the first lesson and keeps untouched courses out of started-only results',()=>{
 const model=buildLearningCenter(lessons,{},chapters);
 assert.equal(model.counts.started,0);assert.equal(model.counts.unanswered,0);assert.equal(model.counts.notStarted,4);
 assert.equal(centerQuestions(model,options()).length,0);assert.equal(centerSuggestions(model)[0].course.id,'types');
 assert.equal(centerSuggestions(buildLearningCenter([],{},[])).length,0);
});

test('full current catalog is represented without losing any course or objective question',async()=>{
 const catalog=(await Promise.all(['frameworks','platform'].map(name=>readFile(new URL('../public/data/'+name+'.json',import.meta.url),'utf8').then(JSON.parse)))).flat();
 const model=buildLearningCenter(catalog,{},[]);
 const count=catalog.reduce((sum,lesson)=>sum+lesson.quiz.length,0);
 assert.equal(model.courses.length,85);assert.equal(model.questions.length,count);
 assert.equal(catalog.flatMap(lesson=>lesson.quiz).filter(q=>!q.introducedIn).length,425);
 assert.equal(centerQuestions(model,options({scope:'all',status:'unanswered'})).length,count);
 assert.equal(new Set(model.questions.map(q=>q.lessonId+':'+q.question.id)).size,count);
});
