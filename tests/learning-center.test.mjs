import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildLearningCenter,centerState,centerQuery,centerHref,centerLessonHref,lessonCenterEntry,centerQuestions,centerNotes,centerSuggestions,notesMarkdown,updateCenterNote,mountLearningCenter} from '../public/learning-center.js';

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


test('class notes and self-check reflections coexist with separate source searches',()=>{
 const progress={types:{notes:'课堂记录 Array',studyCheck:{reflection:'自检回忆 <script> Array',rating:'again',dueAt:123}},equal:{studyCheck:{reflection:'相等比较回忆'}}};
 const before=structuredClone(progress),model=buildLearningCenter(lessons,progress,chapters);
 assert.equal(model.notes.length,3);assert.equal(model.counts.notes,3);assert.equal(new Set(model.notes.map(n=>n.key)).size,3);
 assert.equal(model.notes.find(n=>n.key==='lesson:types').notes,'课堂记录 Array');
 assert.equal(centerNotes(model,options({noteSource:'reflection',query:'ＡＲＲＡＹ'}))[0].key,'reflection:types');
 assert.equal(centerNotes(model,options({noteSource:'lesson'})).length,1);assert.equal(centerNotes(model,options({query:'自检回忆'})).length,2);
 assert.deepEqual(progress,before);
});

test('editing one source preserves classroom notes, scheduling, grades, and other lessons',()=>{
 const p={types:{notes:'课堂旧笔记',studyCheck:{reflection:'回忆旧笔记',rating:'again',dueAt:123,attempts:2},quizResult:{score:80}},equal:{notes:'另一课'}};
 const before=structuredClone(p);
 assert.equal(updateCenterNote(p,lessons,'reflection:types','新回忆'),'新回忆');assert.equal(p.types.notes,before.types.notes);
 assert.deepEqual({...p.types.studyCheck,reflection:before.types.studyCheck.reflection},before.types.studyCheck);
 assert.equal(updateCenterNote(p,lessons,'lesson:types','新课堂'),'新课堂');assert.equal(p.types.studyCheck.reflection,'新回忆');
 assert.deepEqual(p.types.quizResult,before.types.quizResult);assert.deepEqual(p.equal,before.equal);
 assert.equal(updateCenterNote(p,lessons,'reflection:types','字'.repeat(3001)).length,3000);
 for(const key of ['unknown:types','reflection:missing',{},null])assert.equal(updateCenterNote(p,lessons,key,'bad'),null);
 updateCenterNote(p,lessons,'reflection:types','');assert.equal(buildLearningCenter(lessons,p,chapters).notes.filter(n=>n.kind==='reflection').length,0);
 assert.equal(p.types.notes,'新课堂');
});

test('self-check deep links and Markdown retain source and return filter without replacing old note links',()=>{
 const state=options({tab:'notes',noteSource:'reflection',query:'回忆 & <',chapter:'js',page:2});
 const p={types:{notes:'旧课堂',studyCheck:{reflection:'<script>\n```js\nconst x = 1;\n```'}}};
 const rows=buildLearningCenter(lessons,p,chapters).notes,reflection=rows.find(n=>n.kind==='reflection');
 const href=centerLessonHref(reflection,{notes:true,returnState:state}),params=new URLSearchParams(href.split('?')[1]);
 assert.equal(params.get('stage'),'conclusion');assert.equal(params.get('check'),'1');assert.equal(params.has('notes'),false);
 assert.deepEqual(centerState(new URLSearchParams(params.get('review'))),state);
 assert.equal(new URLSearchParams(centerLessonHref(rows[0],{notes:true}).split('?')[1]).get('notes'),'1');
 const markdown=notesMarkdown(rows);assert.match(markdown,/来源：课堂笔记/);assert.match(markdown,/来源：自检回忆/);assert.match(markdown,/stage=conclusion/);assert.match(markdown,/check=1/);assert.match(markdown,/````text/);
 assert.ok(markdown.includes(p.types.studyCheck.reflection));assert.ok(markdown.includes(p.types.notes));
});

function mountFixture(progress,{params=new URLSearchParams('tab=notes'),onNotesChange=()=>{},catalog=lessons,download=()=>{}}={}){
 const listeners={},formListeners={},results={innerHTML:''},status={textContent:'',focus(){},scrollIntoView(){}},count={textContent:''};
 const form={elements:Object.fromEntries(['chapter','status','scope','order','noteSource','q'].map(k=>[k,{value:''}])),addEventListener(type,fn){formListeners[type]=fn;},removeEventListener(type){delete formListeners[type];}};
 const hidden={};const view={querySelector(sel){return sel==='form'?form:sel==='.center-results'?results:sel==='.center-results-status'?status:sel==='[data-center-stat="notes"] b'?count:hidden[sel]||=( {} );},querySelectorAll(){return [];},addEventListener(type,fn){listeners[type]=fn;},removeEventListener(type){delete listeners[type];}};
 const root={innerHTML:'',querySelector(){return view;}};
 const controller=mountLearningCenter(root,{lessons:catalog,chapters,progress,params,onNotesChange,download});
 return {root,view,form,results,status,listeners,formListeners,controller};
}

test('central note input saves the selected source without rerendering or dropping active filters',()=>{
 const previous=globalThis.history;let url='';globalThis.history={state:null,replaceState(_a,_b,value){url=value;}};
 try{
  const p={types:{notes:'class note',studyCheck:{reflection:'<img src=x onerror=alert(1)>',dueAt:15}}};let saves=0;
  const mounted=mountFixture(p,{params:new URLSearchParams('tab=notes&noteSource=reflection&q=img'),onNotesChange:()=>{saves++;}});
  assert.ok(mounted.results.innerHTML.includes('&lt;img'));assert.ok(!mounted.results.innerHTML.includes('<img src=x'));assert.ok(mounted.results.innerHTML.includes('maxlength="3000"'));
  const rendered=mounted.results.innerHTML,target={dataset:{centerNote:'reflection:types'},value:'编辑后不再匹配搜索'};
  mounted.listeners.input({target});assert.equal(saves,1);assert.equal(p.types.studyCheck.reflection,target.value);assert.equal(p.types.notes,'class note');assert.equal(p.types.studyCheck.dueAt,15);
  assert.equal(mounted.results.innerHTML,rendered);assert.equal(mounted.form.elements.q.value,'img');assert.ok(url.includes('noteSource=reflection'));
  mounted.formListeners.submit({preventDefault(){}});assert.match(mounted.results.innerHTML,/没有匹配的笔记/);
  mounted.controller.destroy();assert.equal(mounted.listeners.input,undefined);
 }finally{globalThis.history=previous;}
});

test('source-filtered pagination and export use independent note entries',async()=>{
 const previous=globalThis.history;globalThis.history={state:null,replaceState(){}};
 try{
  const catalog=Array.from({length:14},(_,i)=>({...lessons[0],id:'lesson-'+i})),progress=Object.fromEntries(catalog.map(l=>[l.id,{notes:'课堂 '+l.id,studyCheck:{reflection:'回忆 '+l.id}}]));let exported='';
  const mounted=mountFixture(progress,{catalog,params:new URLSearchParams('tab=notes&noteSource=reflection&page=2'),download:value=>{exported=value;}});
  assert.match(mounted.status.textContent,/找到 14 篇笔记 · 当前显示 13–14/);assert.equal((mounted.results.innerHTML.match(/data-center-note="reflection:/g)||[]).length,2);
  const button={dataset:{centerExport:'filtered'},hasAttribute(name){return name==='data-center-export';}};
  await mounted.listeners.click({target:{closest(){return button;}}});assert.match(exported,/共 14 篇/);assert.equal(exported.includes('来源：课堂笔记'),false);
  mounted.controller.destroy();
 }finally{globalThis.history=previous;}
});


test('clearing the final note updates status and disables both exports without replacing its editor',()=>{
 const previous=globalThis.history;globalThis.history={state:null,replaceState(){}};
 try{
  const progress={types:{studyCheck:{reflection:'唯一笔记'}}},mounted=mountFixture(progress),buttons=[{dataset:{centerExport:'filtered'}},{dataset:{centerExport:'all'}}];
  mounted.view.querySelectorAll=selector=>selector==='[data-center-export]'?buttons:[];
  const rendered=mounted.results.innerHTML;
  mounted.listeners.input({target:{dataset:{centerNote:'reflection:types'},value:''}});
  assert.match(mounted.status.textContent,/笔记 0 篇/);assert.equal(buttons[0].disabled,true);assert.equal(buttons[1].disabled,true);assert.equal(buttons[0].textContent,'导出筛选结果 · 0 篇');assert.equal(mounted.results.innerHTML,rendered);
  mounted.listeners.input({target:{dataset:{centerNote:'reflection:types'},value:'继续写'}});
  assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,false);mounted.controller.destroy();
 }finally{globalThis.history=previous;}
});
