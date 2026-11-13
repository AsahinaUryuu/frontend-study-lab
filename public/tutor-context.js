import {mainLanguage,webFiles} from './web-files.js';

const STAGES={textbook:'基础教学',teach:'课堂提问',practice:'客观练习',evaluation:'答题反馈',coding:'代码实操','code-review':'代码评阅',conclusion:'本课总结'};
const LANGUAGES=['html','css','javascript'];
const MAX_REVIEWS=5,MAX_THREADS=10;
const initialized=new WeakMap();
let serial=0;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const string=(value,limit)=>typeof value==='string'?value.slice(0,limit):'';
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const part of Object.values(value))freeze(part);}return value;}
function newId(lessonId,kind){return `${lessonId}:${kind}:${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+(++serial).toString(36)}`;}
function validId(value,lessonId,kind){return typeof value==='string'&&value.length<=200&&value.startsWith(`${lessonId}:${kind}:`)&&/^[a-zA-Z0-9:_-]+$/.test(value);}
function time(value){const stamp=typeof value==='string'?Date.parse(value):typeof value==='number'?value:NaN;const date=new Date(stamp);return Number.isFinite(date.getTime())?date.toISOString():new Date(0).toISOString();}

function cleanSubmission(value){
  if(!plain(value))return null;
  const testCode=string(value.testCode,10000);
  if(value.mode==='web'){
    if(!LANGUAGES.includes(value.mainLanguage)||!plain(value.files)||!LANGUAGES.every(key=>typeof value.files[key]==='string'))return null;
    return {mode:'web',mainLanguage:value.mainLanguage,files:Object.fromEntries(LANGUAGES.map(key=>[key,string(value.files[key],30000)])),testCode};
  }
  if(value.mode!=='code'||typeof value.code!=='string')return null;
  return {mode:'code',code:string(value.code,30000),language:string(value.language,50)||'javascript',testCode};
}

export function buildSubmission(profile={},state={},options={}){
  const web=options.web??((state.runMode||profile.mode)==='web');
  const testCode=state.runTestCode??profile.testCode??'';
  if(web)return {mode:'web',mainLanguage:mainLanguage(profile),files:clone(webFiles(profile,state)),testCode};
  return {mode:'code',code:state.code??'',language:options.language||profile.mainLanguage||(['html','css'].includes(profile.mode)?profile.mode:'javascript'),testCode};
}
export function submissionSignature(submission){
  const clean=cleanSubmission(submission);
  return clean?JSON.stringify(clean):'';
}
function cleanGrade(value){
  const source=plain(value)?value:{};
  const list=field=>Array.isArray(source[field])?source[field].slice(0,30).filter(item=>typeof item==='string').map(item=>item.slice(0,5000)):[];
  return {score:Number.isFinite(source.score)&&source.score>=0&&source.score<=100?source.score:null,verdict:string(source.verdict,5000),rawFeedback:string(source.rawFeedback,60000),strengths:list('strengths'),issues:Array.isArray(source.issues)?source.issues.slice(0,30).filter(plain).map(issue=>({message:string(issue.message,5000),suggestion:string(issue.suggestion,5000)})):[],nextSteps:list('nextSteps'),referenceExplanation:string(source.referenceExplanation,5000)};
}
function cleanAnswers(answers,lesson){
  const result={};
  for(const question of lesson.quiz||[]){
    const value=answers?.[question.id];
    if(question.type==='choice'&&Number.isInteger(value)&&value>=0&&value<question.options.length)result[question.id]=value;
    if(question.type==='fill'&&typeof value==='string')result[question.id]=value.slice(0,500);
  }
  return result;
}
function quizResult(lesson,answers){
  const normalized=(value,strict)=>{const text=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').replace(/[。；;]$/,'');return strict?text:text.toLowerCase();};
  const items=(lesson.quiz||[]).map(question=>{const answer=answers[question.id],unanswered=answer===undefined||answer===null||String(answer).trim()==='';return {correct:!unanswered&&(question.type==='choice'?answer===question.answer:question.answer.some(value=>normalized(value,question.caseSensitive)===normalized(answer,question.caseSensitive))),unanswered};});
  const correct=items.filter(item=>item.correct).length;
  return {score:items.length?Math.round(correct/items.length*100):0,correct,unanswered:items.filter(item=>item.unanswered).length,items};
}
function copyQuizResult(value){
  const source=plain(value)?value:{};
  return {score:Number.isFinite(source.score)?Math.min(100,Math.max(0,source.score)):0,correct:Number.isInteger(source.correct)&&source.correct>=0?source.correct:0,unanswered:Number.isInteger(source.unanswered)&&source.unanswered>=0?source.unanswered:0,items:Array.isArray(source.items)?source.items.slice(0,100).map(item=>({correct:item?.correct===true,unanswered:item?.unanswered===true})):[]};
}
export function makeCodeReview(lessonId,submission,result){
  const clean=cleanSubmission(submission);if(!clean)throw new TypeError('代码提交快照无效。');
  return freeze({id:newId(lessonId,'code'),createdAt:new Date().toISOString(),submission:clean,result:cleanGrade(result)});
}
export function makeQuizReview(lessonId,answers,result){
  const clean={};for(const [key,value] of Object.entries(plain(answers)?answers:{})){if(typeof value==='string')clean[key]=value.slice(0,500);else if(Number.isInteger(value))clean[key]=value;}
  return freeze({id:newId(lessonId,'quiz'),createdAt:new Date().toISOString(),answers:clean,result:copyQuizResult(result)});
}
export function trimTutorHistory(messages=[]){
  const clean=(Array.isArray(messages)?messages:[]).filter(item=>plain(item)&&['user','assistant'].includes(item.role)&&typeof item.content==='string'&&item.content.trim()).slice(-20).map(item=>({role:item.role,content:item.content.slice(0,item.role==='user'?4000:30000)}));
  let size=clean.reduce((sum,item)=>sum+item.content.length,0);
  while(size>60000&&clean.length){size-=clean.shift().content.length;}
  return clean;
}
function cleanCodeReview(value,lesson){
  if(!plain(value)||!validId(value.id,lesson.id,'code'))return null;
  const submission=cleanSubmission(value.submission);if(!submission)return null;
  return freeze({id:value.id,createdAt:time(value.createdAt),submission,result:cleanGrade(value.result),...(value.legacy===true?{legacy:true}:{})});
}
function cleanQuizReview(value,lesson){
  if(!plain(value)||!validId(value.id,lesson.id,'quiz'))return null;
  const answers=cleanAnswers(value.answers,lesson);
  return freeze({id:value.id,createdAt:time(value.createdAt),answers,result:quizResult(lesson,answers),...(value.legacy===true?{legacy:true}:{})});
}
function uniqueReviews(values,cleaner,lesson){
  const found=new Map();for(const value of Array.isArray(values)?values:[]){const review=cleaner(value,lesson);if(review)found.set(review.id,review);}return [...found.values()].slice(-MAX_REVIEWS);
}
export function sanitizeTutorState(value,lesson){
  const state=plain(value)?value:{};
  const codeReviews=uniqueReviews(state.codeReviews,cleanCodeReview,lesson),quizReviews=uniqueReviews(state.quizReviews,cleanQuizReview,lesson);
  const result={codeReviews,quizReviews,tutorThreads:{}};
  if(codeReviews.some(review=>review.id===state.aiReviewId))result.aiReviewId=state.aiReviewId;
  else if(codeReviews.length)result.aiReviewId=codeReviews.at(-1).id;
  if(quizReviews.some(review=>review.id===state.quizReviewId))result.quizReviewId=state.quizReviewId;
  else if(quizReviews.length)result.quizReviewId=quizReviews.at(-1).id;
  const allowedCode=new Set(codeReviews.map(review=>review.id)),allowedQuiz=new Set(quizReviews.map(review=>review.id));
  for(const [key,thread] of Object.entries(plain(state.tutorThreads)?state.tutorThreads:{})){
    if(!plain(thread)||key.length>240||!key.startsWith(lesson.id+':')||!/^[a-zA-Z0-9:_-]+$/.test(key))continue;
    if(!(key.startsWith(`${lesson.id}:learning:`)||key===`${lesson.id}:code:draft`||key===`${lesson.id}:quiz:draft`||allowedCode.has(key)||allowedQuiz.has(key)))continue;
    result.tutorThreads[key]={messages:trimTutorHistory(thread.messages),draft:string(thread.draft,4000)};
  }
  result.tutorThreads=Object.fromEntries(Object.entries(result.tutorThreads).slice(-MAX_THREADS));
  return result;
}
export function ensureLegacyReviews(lesson,state){
  state.codeReviews||=[];state.quizReviews||=[];state.tutorThreads||={};
  if(!state.codeReviews.length&&plain(state.aiResult)&&typeof state.gradedCode==='string'){
    const review=freeze({id:`${lesson.id}:code:legacy`,createdAt:new Date(0).toISOString(),legacy:true,submission:{mode:'code',code:state.gradedCode.slice(0,30000),language:lesson.code?.language||'javascript',testCode:''},result:cleanGrade(state.aiResult)});
    state.codeReviews.push(review);state.aiReviewId=review.id;
  }
  if(!state.quizReviews.length&&plain(state.quizResult)){
    const answers=cleanAnswers(state.answers,lesson);
    const review=freeze({id:`${lesson.id}:quiz:legacy`,createdAt:new Date(0).toISOString(),legacy:true,answers,result:quizResult(lesson,answers)});
    state.quizReviews.push(review);state.quizReviewId=review.id;
  }
  return state;
}
export function ensureTutorState(state,lesson){
  if(initialized.get(state)!==lesson.id){
    Object.assign(state,sanitizeTutorState(state,lesson));
    ensureLegacyReviews(lesson,state);
    initialized.set(state,lesson.id);
  }
  return state;
}
export function addCodeReview(state,review,lesson){
  ensureTutorState(state,lesson);state.codeReviews=[...state.codeReviews.filter(item=>item.id!==review.id),review].slice(-MAX_REVIEWS);state.aiReviewId=review.id;return review;
}
export function addQuizReview(state,review,lesson){
  ensureTutorState(state,lesson);state.quizReviews=[...state.quizReviews.filter(item=>item.id!==review.id),review].slice(-MAX_REVIEWS);state.quizReviewId=review.id;return review;
}
function cleanFocus(value){
  if(!plain(value))return null;
  const id=string(value.id,80).replace(/[^a-zA-Z0-9_-]/g,'_');
  const title=string(value.title,300),text=string(value.text,12000);
  return id||title||text?{id:id||'selected',title,text}:null;
}
function reviewLabel(review,type){
  const score=typeof review.result.score==='number'?`${review.result.score} 分`:'文字反馈';
  return `${type} · ${score}${review.legacy?' · 旧版记录':''}`;
}
function getThread(state,key){
  state.tutorThreads||={};
  if(!plain(state.tutorThreads[key]))state.tutorThreads[key]={messages:[],draft:''};
  // Preserve existing objects for in-flight replies. Drop only oldest inactive entries.
  const current=state.tutorThreads[key];delete state.tutorThreads[key];state.tutorThreads[key]=current;
  while(Object.keys(state.tutorThreads).length>MAX_THREADS){const oldest=Object.keys(state.tutorThreads).find(candidate=>candidate!==key&&!state.tutorThreads[candidate].pending);if(!oldest)break;delete state.tutorThreads[oldest];}
  return current;
}
export function buildTutorContext({lesson,stage='textbook',progress={},profile={},question,focus,reviewId}={}){
  if(!lesson?.id)return null;
  const state=ensureTutorState(progress,lesson),stageId=Object.hasOwn(STAGES,stage)?stage:'textbook';
  const selectedFocus=cleanFocus(focus||(plain(question)?{id:question.id,title:question.title,text:question.answer||question.question||''}:null));
  const context={kind:'learning',contextId:''};
  let key,label=STAGES[stageId],description='已带上本课教材与当前学习环节，回答只针对本课。',suggestions=['请用更简单的话解释当前内容。','给我一个具体例子。','这个知识点最容易错在哪里？'];
  if(['coding','code-review'].includes(stageId)){
    context.kind='code';
    const review=state.codeReviews.find(item=>item.id===(reviewId||state.aiReviewId))||state.codeReviews.at(-1);
    context.currentSubmission=buildSubmission(profile,state,{language:lesson.code?.language});
    if(review){context.codeReview=clone(review);key=review.id;label=reviewLabel(review,'代码评阅');description=review.legacy?'追问绑定这次旧版主文件评阅；当前三文件草稿单独提供，不会替换原提交。':'追问绑定这次提交的代码快照和评分；当前草稿单独提供，不会替换原提交。';suggestions=['为什么这次得分低？请结合我的代码和反馈解释。','请逐项解释这次评阅指出的问题。','给我修改提示，先不要直接给完整答案。'];}
    else{key=`${lesson.id}:code:draft`;label='代码实操 · 当前草稿';description='已带上本题要求和当前代码；尚无 AI 评阅记录。';suggestions=['帮我检查当前代码可能存在的问题。','这个题目应该怎样拆解？','请给我一个调试方向，先不要直接给答案。'];}
  }else if(['practice','evaluation'].includes(stageId)){
    context.kind='quiz';
    const review=stageId==='evaluation'?(state.quizReviews.find(item=>item.id===(reviewId||state.quizReviewId))||state.quizReviews.at(-1)):null;
    if(review){context.quizReview=clone(review);key=review.id;label=reviewLabel(review,'客观题反馈');description='追问绑定这次客观题提交的答案、分数和逐题解析。';suggestions=['这次错题为什么错？请逐题解释。','我混淆了哪些概念？','针对这次错题，再出一道类似练习。'];}
    else{key=`${lesson.id}:quiz:draft`;context.answers=cleanAnswers(state.answers,lesson);label='客观练习 · 当前作答';description='已带上本课题目和当前答案，可以询问思路或概念。';suggestions=['请提示我解题思路，先不要公布答案。','当前题目考查什么概念？','能举一个帮助我判断的例子吗？'];}
  }else{
    key=`${lesson.id}:learning:${stageId}:${selectedFocus?.id||'overview'}`;
    if(selectedFocus){context.focus=selectedFocus;label=selectedFocus.title||label;description='已带上本课教材、当前学习环节及所选内容。';}
  }
  if(selectedFocus){
    context.focus=selectedFocus;
    if(context.kind!=='learning'){
      label+=selectedFocus.title?' · '+selectedFocus.title.slice(0,80):'';
      description+=' 当前追问已定位到所选题目或内容。';
    }
  }
  context.contextId=key;
  const request=freeze(clone({lessonId:lesson.id,stage:stageId,context}));
  return {key,lessonId:lesson.id,lessonTitle:lesson.tutorial?.title||lesson.title,stageTitle:STAGES[stageId],kind:context.kind,label,description,suggestions,thread:getThread(state,key),request};
}
