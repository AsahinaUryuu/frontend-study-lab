import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSubmission,submissionSignature,makeCodeReview,makeQuizReview,addCodeReview,addQuizReview,buildTutorContext,sanitizeTutorState,ensureTutorState,trimTutorHistory} from '../public/tutor-context.js';
import {validateProgress} from '../public/learning.js';

const lesson={id:'dom-example',title:'事件委托',tutorial:{title:'学习 DOM 交互'},code:{language:'javascript'},quiz:[{id:'q1',type:'choice',options:['正确','错误'],answer:0},{id:'q2',type:'fill',answer:['microtask'],caseSensitive:false}]};
const profile={mode:'web',mainLanguage:'javascript',html:'<button id="button">点击</button>',css:'button{color:green}',javascript:'',testCode:'console.log("ready")'};
const feedback={score:25,verdict:'事件未绑定',strengths:[],issues:[{message:'没有绑定 click 事件',suggestion:'添加事件监听器'}],nextSteps:[],referenceExplanation:'点击按钮后应更新页面。'};

test('三文件提交保留全部代码与调用示例，任何配套文件变化都会令签名变化',()=>{
  const state={code:'let count=0;',webFiles:{html:'<button id="count">加一</button>',css:'button{color:red}'},runTestCode:''};
  const before=buildSubmission(profile,state);
  assert.deepEqual(before,{mode:'web',mainLanguage:'javascript',files:{html:state.webFiles.html,css:state.webFiles.css,javascript:state.code},testCode:''});
  const signature=submissionSignature(before);
  state.webFiles.css='button{color:blue}';
  assert.notEqual(submissionSignature(buildSubmission(profile,state)),signature);
  assert.equal(before.files.css,'button{color:red}');
  state.runMode='javascript';
  assert.equal(buildSubmission(profile,state).mode,'code');
});

test('评阅快照与代码草稿分离，后来修改三个文件不会改变低分所对应的代码',()=>{
  const state={code:'// 没有绑定事件',answers:{}};
  const review=makeCodeReview(lesson.id,buildSubmission(profile,state),feedback);
  addCodeReview(state,review,lesson);
  state.code='document.querySelector("button").onclick=()=>{}';
  state.webFiles={css:'button{color:blue}'};
  feedback.issues[0].message='外部对象后来被改写';
  const context=buildTutorContext({lesson,stage:'code-review',progress:state,profile});
  assert.equal(context.key,review.id);assert.equal(context.request.context.contextId,review.id);
  assert.equal(context.request.context.codeReview.result.score,25);
  assert.equal(context.request.context.codeReview.result.issues[0].message,'没有绑定 click 事件');
  assert.equal(context.request.context.codeReview.submission.files.javascript,'// 没有绑定事件');
  assert.equal(context.request.context.currentSubmission.files.javascript,state.code);
  assert.ok(Object.isFrozen(context.request));assert.ok(Object.isFrozen(review.submission.files));
  assert.throws(()=>{review.result.score=100;},TypeError);
});

test('每次评测有独立追问上下文，编辑和评阅关卡复用选中评测的会话',()=>{
  const state={code:'first',answers:{}};
  const first=makeCodeReview(lesson.id,buildSubmission(profile,state),{...feedback,score:20});addCodeReview(state,first,lesson);
  const firstContext=buildTutorContext({lesson,stage:'coding',progress:state,profile});
  firstContext.thread.messages.push({role:'user',content:'为什么这么低分？'});
  state.code='second';const second=makeCodeReview(lesson.id,buildSubmission(profile,state),{...feedback,score:80});addCodeReview(state,second,lesson);
  const latest=buildTutorContext({lesson,stage:'code-review',progress:state,profile});
  assert.notEqual(latest.key,firstContext.key);assert.equal(latest.thread.messages.length,0);
  const old=buildTutorContext({lesson,stage:'code-review',progress:state,profile,reviewId:first.id});
  assert.equal(old.thread,firstContext.thread);assert.equal(old.request.context.codeReview.result.score,20);
  const other=buildTutorContext({lesson:{...lesson,id:'other-lesson'},stage:'code-review',progress:{code:'other'},profile});
  assert.ok(other.key.startsWith('other-lesson:'));assert.equal(other.thread.messages.length,0);assert.equal(other.request.context.codeReview,undefined);
});

test('客观题追问使用已提交答案快照，当前重做不会篡改原错题',()=>{
  const state={answers:{q1:1,q2:'MicroTask'}};
  const review=makeQuizReview(lesson.id,state.answers,{score:50,correct:1,unanswered:0,items:[{correct:false,unanswered:false},{correct:true,unanswered:false}]});addQuizReview(state,review,lesson);
  state.answers.q1=0;
  const context=buildTutorContext({lesson,stage:'evaluation',progress:state,profile});
  assert.equal(context.request.context.quizReview.answers.q1,1);assert.equal(context.request.context.quizReview.result.score,50);
  const focus={id:'q1',title:'第1题',text:'这是错题的题目描述'};
  const focused=buildTutorContext({lesson,stage:'evaluation',progress:state,profile,focus});
  assert.equal(focused.key,context.key);assert.equal(focused.request.context.focus.id,'q1');assert.ok(focused.label.includes('第1题'));
  const current=buildTutorContext({lesson,stage:'practice',progress:state,profile});
  assert.equal(current.request.context.answers.q1,0);assert.equal(current.request.context.quizReview,undefined);assert.notEqual(context.key,current.key);
});

test('旧版代码反馈只迁移原主文件，迁移后的客观题快照不会被后来输入覆盖',()=>{
  const state={code:'current edited',gradedCode:'original graded',aiResult:{...feedback,score:30},answers:{q1:1},quizResult:{score:0}};
  const context=buildTutorContext({lesson,stage:'code-review',progress:state,profile});
  assert.equal(context.request.context.codeReview.legacy,true);assert.equal(context.request.context.codeReview.submission.mode,'code');assert.equal(context.request.context.codeReview.submission.code,'original graded');
  assert.equal(context.request.context.codeReview.submission.files,undefined);
  state.gradedCode='later';state.answers.q1=0;
  const again=buildTutorContext({lesson,stage:'evaluation',progress:state,profile});
  assert.equal(state.codeReviews.length,1);assert.equal(state.codeReviews[0].submission.code,'original graded');assert.equal(again.request.context.quizReview.answers.q1,1);
});

test('首次新评测不会被误当旧版结果，再次初始化也不生成重复历史',()=>{
  const state={code:'answer',answers:{q1:1}};
  ensureTutorState(state,lesson);
  state.aiResult={...feedback,score:30};state.gradedCode=state.code;
  const codeReview=makeCodeReview(lesson.id,buildSubmission(profile,state),state.aiResult);
  addCodeReview(state,codeReview,lesson);
  state.quizResult={score:0,correct:0,unanswered:1,items:[{correct:false,unanswered:false},{correct:false,unanswered:true}]};
  const quizReview=makeQuizReview(lesson.id,state.answers,state.quizResult);
  addQuizReview(state,quizReview,lesson);
  ensureTutorState(state,lesson);
  assert.deepEqual(state.codeReviews.map(item=>item.id),[codeReview.id]);
  assert.deepEqual(state.quizReviews.map(item=>item.id),[quizReview.id]);
  assert.ok(!state.codeReviews[0].legacy);assert.ok(!state.quizReviews[0].legacy);
});

test('学习内容按课程、关卡和选择内容隔离，生成请求后不随后续编辑变化',()=>{
  const state={answers:{},code:''};
  const textbook=buildTutorContext({lesson,stage:'textbook',progress:state,profile,focus:{id:'book-1',title:'事件冒泡',text:'先目标，再向祖先传播。'}});
  const teach=buildTutorContext({lesson,stage:'teach',progress:state,profile});
  assert.notEqual(textbook.key,teach.key);assert.equal(textbook.request.context.focus.title,'事件冒泡');
  assert.equal(textbook.lessonTitle,'学习 DOM 交互');assert.equal(textbook.request.lessonId,lesson.id);
  assert.equal(textbook.request.context.codeReview,undefined);
});

test('导入只保留本课有效快照、消息和草稿，不接受密钥字段或其他课程数据',()=>{
  const review=makeCodeReview(lesson.id,{mode:'code',code:'answer',language:'javascript'},feedback);
  const foreign=makeCodeReview('foreign',{mode:'code',code:'secret foreign answer'},feedback);
  const clean=sanitizeTutorState({apiKey:'secret-key',codeReviews:[review,foreign],quizReviews:[{id:`${lesson.id}:quiz:one`,createdAt:'bad time',answers:{q1:1,unknown:'secret'},result:{score:100}}],tutorThreads:{[review.id]:{messages:[{role:'system',content:'secret instruction'},{role:'assistant',content:'解释'}],draft:'再问',apiKey:'secret-key'},[foreign.id]:{messages:[{role:'user',content:'foreign question'}]}}},lesson);
  assert.equal(clean.codeReviews.length,1);assert.equal(clean.quizReviews[0].result.score,0);assert.equal(clean.quizReviews[0].answers.unknown,undefined);
  assert.deepEqual(clean.tutorThreads[review.id],{messages:[{role:'assistant',content:'解释'}],draft:'再问'});
  assert.ok(!JSON.stringify(clean).includes('secret'));assert.ok(!JSON.stringify(clean).includes('foreign'));
});

test('历史长度受控并保留正在请求的线程对象',()=>{
  const messages=Array.from({length:30},(_,index)=>({role:index%2?'assistant':'user',content:'x'.repeat(12000)}));
  const history=trimTutorHistory(messages);assert.ok(history.length<=20);assert.ok(history.reduce((sum,item)=>sum+item.content.length,0)<=60000);assert.ok(history.filter(item=>item.role==='user').every(item=>item.content.length<=4000));
  const state={answers:{},code:''};const first=buildTutorContext({lesson,stage:'textbook',progress:state,focus:{id:'first'}});first.thread.pending=true;
  for(let index=0;index<15;index++)buildTutorContext({lesson,stage:'textbook',progress:state,focus:{id:'part'+index}});
  assert.equal(state.tutorThreads[first.key],first.thread);assert.ok(Object.keys(state.tutorThreads).length<=10);
  first.thread.messages.push({role:'assistant',content:'迟到的答复'});assert.equal(state.tutorThreads[first.key].messages[0].content,'迟到的答复');
  for(let index=0;index<7;index++)addCodeReview(state,makeCodeReview(lesson.id,{mode:'code',code:String(index)},feedback),lesson);
  assert.equal(state.codeReviews.length,5);
  const imported=sanitizeTutorState(state,lesson);assert.equal(imported.tutorThreads[first.key]?.pending,undefined);
});

test('误复用其他课程的 state 对象也不携带上一课程评测或对话',()=>{
  const state={code:'one'};const first=makeCodeReview(lesson.id,{mode:'code',code:'one'},feedback);addCodeReview(state,first,lesson);
  const context=buildTutorContext({lesson,stage:'code-review',progress:state,profile});context.thread.messages.push({role:'user',content:'旧课问题'});
  const other={...lesson,id:'new-lesson'};ensureTutorState(state,other);
  const next=buildTutorContext({lesson:other,stage:'code-review',progress:state,profile});
  assert.equal(next.request.context.codeReview,undefined);assert.equal(next.thread.messages.length,0);assert.equal(state.codeReviews.length,0);
});

test('超过12k的完整代码回答在清洗和学习记录导入后保留结尾，课程仍然隔离',()=>{
  const content='这段说明帮助理解每一步的用途。\n'.repeat(900)+'\n```javascript\nconsole.log("保留代码结尾");\n```';
  assert.ok(content.length>12000&&content.length<30000);
  const key=`${lesson.id}:learning:textbook`,foreignKey='foreign-lesson:learning:textbook';
  const state={code:'',tutorThreads:{
    [key]:{messages:[{role:'user',content:'请详细解释这个例子。'},{role:'assistant',content}],draft:''},
    [foreignKey]:{messages:[{role:'assistant',content:'另一课程的私有回答'}],draft:''}
  }};
  const cleaned=sanitizeTutorState(state,lesson);
  assert.equal(cleaned.tutorThreads[key].messages[1].content,content);
  assert.equal(cleaned.tutorThreads[foreignKey],undefined);
  const imported=validateProgress(JSON.parse(JSON.stringify({version:1,progress:{[lesson.id]:state,'foreign-lesson':state}})),[{...lesson,challenge:{starter:''}}]);
  assert.deepEqual(Object.keys(imported),[lesson.id]);
  const answer=imported[lesson.id].tutorThreads[key].messages[1].content;
  assert.equal(answer,content);assert.ok(answer.endsWith('console.log("保留代码结尾");\n```'));
  assert.equal(imported[lesson.id].tutorThreads[foreignKey],undefined);
});

test('助教单条最多30k，近期20条与总60k限制同时保留',()=>{
  assert.equal(trimTutorHistory([{role:'assistant',content:'x'.repeat(30001)}])[0].content.length,30000);
  const history=trimTutorHistory(Array.from({length:24},(_,i)=>({role:'assistant',content:String(i).padStart(2,'0')+'x'.repeat(29998)})));
  assert.equal(history.length,2);assert.equal(history.reduce((total,item)=>total+item.content.length,0),60000);
  assert.ok(history[0].content.startsWith('22'));assert.ok(history[1].content.startsWith('23'));
});
