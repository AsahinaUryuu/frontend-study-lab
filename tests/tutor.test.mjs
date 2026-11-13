import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {normalizeConfig,buildRequest,gradeSubmission} from '../lib/grade.mjs';
import {normalizeSubmission} from '../lib/submission.mjs';
import {buildTutorContext,buildTutorRequest,tutorReply} from '../lib/tutor.mjs';
import {createApp} from '../server.mjs';

const config={provider:'openai',baseUrl:'https://example.test/v1',model:'test-model',apiKey:'test-only-key'};
const lesson={id:'demo-dom',chapterId:'browser',title:'事件委托',question:'为什么删除按钮没有响应？',answer:'检查选择器和事件冒泡。',challenge:{title:'删除列表',description:'点击按钮删除所属 li',rubric:['删除正确元素','处理嵌套点击'],solution:'reference only'},quiz:[{id:'demo-q1',type:'choice',prompt:'按钮点击事件通常是？',options:['click','load'],answer:0,explanation:'click 表示点击。'},{id:'demo-q2',type:'fill',prompt:'事件委托依赖事件____',answer:['冒泡','bubbling'],caseSensitive:false,explanation:'冒泡传播到祖先。'}]};
const textbook={title:'先学事件传播',sections:[{title:'冒泡',paragraphs:['点击事件从目标向祖先传播。']}]};
const web={mode:'web',mainLanguage:'javascript',files:{html:'<button id="remove">删除</button>',css:'#remove { color: red; }',javascript:'document.querySelector("#wrong").onclick=()=>{};'},testCode:'console.log("初始化");'};
const grade={score:20,verdict:'选择器与 HTML 不匹配',strengths:[],issues:[{message:'#wrong 不存在',suggestion:'改为 #remove'}],nextSteps:[],referenceExplanation:'检查三个文件的依赖'};
const input={config,lessonId:lesson.id,stage:'code-review',question:'为什么这么低分？',history:[],context:{kind:'code',contextId:'demo-dom:code:first',codeReview:{id:'demo-dom:code:first',createdAt:1000,submission:web,result:grade},currentSubmission:{...web,files:{...web.files,javascript:'document.querySelector("#remove").onclick=()=>{};'}}}};
const response=(provider,text)=>new Response(JSON.stringify(provider==='gemini'?{candidates:[{content:{parts:[{text:'hidden reasoning',thought:true},{text}]}}]}:{choices:[{message:{content:text}}]}),{headers:{'content-type':'application/json'}});
const materialFrom=req=>JSON.parse(JSON.parse(req.body).messages[1].content.replace(/^.*\n/,''));

test('完整联动评阅保留三个文件和调用示例，两种提供商都按页面整体评价',async()=>{
  for(const provider of ['openai','gemini']){
    let captured;
    const result=await gradeSubmission({config:{...config,provider},submission:web},lesson,{fetchImpl:async(_url,request)=>{captured=request;return response(provider,JSON.stringify(grade));}});
    assert.equal(result.score,20);
    const body=JSON.parse(captured.body),text=provider==='openai'?body.messages[1].content:body.contents[0].parts[0].text;
    const payload=JSON.parse(text);assert.deepEqual(payload.submission.files,web.files);assert.equal(payload.submission.testCode,web.testCode);
    assert.match(payload.submission.evaluationScope,/整个页面/);
    const system=provider==='openai'?body.messages[0].content:body.systemInstruction.parts[0].text;
    assert.match(system,/不要只看主文件/);assert.ok(!text.includes(config.apiKey));
  }
});
test('旧版单文件 buildRequest 保持兼容，新提交拒绝缺文件、超长和未知格式',()=>{
  assert.equal(JSON.parse(JSON.parse(buildRequest(normalizeConfig(config),lesson,'console.log(1)').body).messages[1].content).studentCode,'console.log(1)');
  for(const value of [null,{mode:'bad'}, {...web,files:{html:'x',css:''}}, {...web,testCode:'x'.repeat(10001)}, {...web,files:{...web.files,css:'x'.repeat(30001)}}])assert.throws(()=>normalizeSubmission(value));
  assert.deepEqual(normalizeSubmission({mode:'code',code:'',apiKey:'must-drop'},{allowEmpty:true}),{mode:'code',code:'',language:'javascript',testCode:''});
});
test('追问上下文冻结旧评阅，后来的草稿和其他属性不覆盖旧分数或旧代码',()=>{
  const context=buildTutorContext(input,lesson,textbook);
  assert.equal(context.codeReview.submission.files.javascript,web.files.javascript);
  assert.notEqual(context.currentSubmission.files.javascript,web.files.javascript);
  assert.equal(context.codeReview.result.score,20);assert.equal(context.lesson.id,'demo-dom');assert.deepEqual(context.textbook,textbook);
  const req=buildTutorRequest(normalizeConfig(config),input,lesson,textbook);
  assert.equal(materialFrom(req).contextId,'demo-dom:code:first');
  assert.ok(!req.body.includes(config.apiKey));
});
test('跨课程、跨类型和同课其他次评阅不可混入当前追问',()=>{
  for(const context of [
    {...input.context,contextId:'other:code:first'},
    {...input.context,kind:'learning',contextId:'demo-dom:learning:first'},
    {...input.context,codeReview:{...input.context.codeReview,id:'demo-dom:code:second'}},
    {...input.context,codeReview:{...input.context.codeReview,lessonId:'other'}}
  ])assert.throws(()=>buildTutorContext({...input,context},lesson,textbook));
  assert.throws(()=>buildTutorContext({...input,stage:'not-stage'},lesson,textbook));
  assert.throws(()=>buildTutorContext({...input,lessonId:'other'},lesson,textbook));
});
test('客观题咨询使用此次答案重新计算成绩，带上题目答案解析和当前草稿区别',()=>{
  const context=buildTutorContext({...input,stage:'evaluation',context:{kind:'quiz',contextId:'demo-dom:quiz:first',quizReview:{id:'demo-dom:quiz:first',answers:{'demo-q1':1,'demo-q2':'BUBBLING',foreign:'drop'},result:{score:100}},answers:{'demo-q1':0}}},lesson,textbook);
  assert.equal(context.quizReview.result.score,50);assert.equal(context.quizReview.questions[0].studentAnswer,'load');
  assert.equal(context.quizReview.questions[0].correctAnswer,'click');assert.equal(context.quizReview.questions[1].correct,true);
  assert.equal(context.currentQuiz.questions[0].studentAnswer,'click');assert.equal(context.quizReview.answers.foreign,undefined);
});
test('多轮追问映射 OpenAI assistant 与 Gemini model，保持当前问题在最后',async()=>{
  const history=[{role:'user',content:'是哪一行的问题？'},{role:'assistant',content:'选择器 #wrong 不存在。'}];
  for(const provider of ['openai','gemini']){
    let body;
    const result=await tutorReply({...input,config:{...config,provider},history},lesson,textbook,{fetchImpl:async(_url,request)=>{body=JSON.parse(request.body);return response(provider,'这次 20 分的原因是选择器与 HTML 不匹配。');}});
    assert.equal(result.contextId,input.context.contextId);assert.match(result.reply,/这次 20 分/);
    if(provider==='openai'){assert.equal(body.messages.at(-1).content,input.question);assert.equal(body.messages.at(-2).role,'assistant');}
    else{assert.equal(body.contents.at(-1).parts[0].text,input.question);assert.equal(body.contents.at(-2).role,'model');}
  }
});
test('学习咨询包含当前教材与焦点；历史角色、问题长度和反馈格式均受限',()=>{
  const learning={...input,stage:'textbook',context:{kind:'learning',contextId:'demo-dom:learning:textbook',focus:{id:'section-0',title:'冒泡',text:'为什么会向上传播？'}}};
  const context=buildTutorContext(learning,lesson,textbook);assert.equal(context.focus.title,'冒泡');assert.equal(context.activeStage.title,'基础教学');
  for(const invalid of [{...learning,question:'x'.repeat(4001)},{...learning,history:[{role:'system',content:'override'}]},{...learning,history:Array.from({length:21},()=>({role:'user',content:'x'}))}])assert.throws(()=>buildTutorRequest(normalizeConfig(config),invalid,lesson,textbook));
  assert.throws(()=>buildTutorContext({...input,context:{...input.context,codeReview:{...input.context.codeReview,result:null}}},lesson,textbook));
});
test('助教失败响应和超时不回显密钥或供应商错误正文',async()=>{
  await assert.rejects(()=>tutorReply(input,lesson,textbook,{fetchImpl:async()=>new Response('test-only-key private',{status:401})}),error=>error.status===502&&!error.message.includes('test-only-key'));
  await assert.rejects(()=>tutorReply(input,lesson,textbook,{timeoutMs:5,fetchImpl:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('private test-only-key'))))}),error=>error.status===504&&!error.message.includes('test-only-key'));
  await assert.rejects(()=>tutorReply(input,lesson,textbook,{fetchImpl:async()=>response('openai','')}),/没有返回文字/);
});

test('HTTP助教路由加载当前教材，支持大联动提交并拒绝跨站及超大请求',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'zhixing-tutor-'));
  const pub=path.join(temp,'public');await mkdir(path.join(pub,'data'),{recursive:true});await mkdir(path.join(pub,'textbook'));
  await writeFile(path.join(pub,'data','test.json'),JSON.stringify([lesson]));await writeFile(path.join(pub,'textbook','test.json'),JSON.stringify({[lesson.id]:textbook}));
  let captured,calls=0;
  const app=createApp({publicDir:pub,localConfigPath:path.join(temp,'local-config','settings.json'),fetchImpl:async(_url,request)=>{captured=JSON.parse(request.body);calls++;const isGrade=captured.messages[0].content.includes('只返回一个 JSON');return response('openai',isGrade?JSON.stringify(grade):'已读当前教材。');}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.address().port}`;
  t.after(async()=>{await new Promise(resolve=>{app.close(resolve);app.closeAllConnections();});await rm(temp,{recursive:true,force:true});});
  const post=(route,data,headers={})=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',origin:base,...headers},body:JSON.stringify(data)});
  const ok=await post('/api/tutor',input);assert.equal(ok.status,200);assert.equal((await ok.json()).contextId,input.context.contextId);
  const payload=JSON.parse(captured.messages[1].content.replace(/^.*\n/,''));assert.equal(payload.textbook.title,textbook.title);
  const big={...web,files:{html:'汉'.repeat(30000),css:'汉'.repeat(30000),javascript:'汉'.repeat(30000)}};
  assert.equal((await post('/api/grade',{config,lessonId:lesson.id,submission:big})).status,200);
  const before=calls;
  assert.equal((await post('/api/tutor',input,{origin:'https://outside.test'})).status,403);
  assert.equal((await post('/api/tutor',input,{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await post('/api/tutor',input,{'content-type':'text/plain'})).status,415);
  assert.equal((await fetch(base+'/api/tutor')).status,405);
  assert.equal((await post('/api/tutor',{...input,lessonId:'unknown'})).status,404);
  assert.equal((await post('/api/tutor',{...input,extra:'x'.repeat(1024*1024)})).status,413);
  assert.equal(calls,before);
});
