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
function cleanQuestions(values){
  const seen=new Set();
  return (Array.isArray(values)?values:[]).slice(0,100).flatMap(q=>{
    if(!plain(q)||typeof q.id!=='string'||!q.id||q.id.length>200||['__proto__','constructor','prototype'].includes(q.id)||seen.has(q.id)||!['choice','fill'].includes(q.type))return [];
    if(q.type==='choice'&&(!Array.isArray(q.options)||!Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length))return [];
    if(q.type==='fill'&&!Array.isArray(q.answer))return [];
    seen.add(q.id);
    const result={id:q.id,type:q.type,prompt:string(q.prompt,5000),explanation:string(q.explanation,10000),answer:q.type==='choice'?q.answer:q.answer.slice(0,30).map(a=>String(a).slice(0,500))};
    if(q.type==='choice')result.options=q.options.slice(0,100).map(o=>String(o).slice(0,5000));
    if(q.type==='fill'){result.caseSensitive=q.caseSensitive===true;result.caseReason=string(q.caseReason,1000);}
    if(plain(q.code))result.code={source:string(q.code.source,10000),language:string(q.code.language,50)};
    if(Array.isArray(q.codeOptions))result.codeOptions=q.codeOptions.filter(Number.isInteger).slice(0,100);
    if(typeof q.introducedIn==='string')result.introducedIn=string(q.introducedIn,80);
    if(q.unavailable===true)result.unavailable=true;
    return [result];
  });
}
function historicalQuestions(lesson,source){
  const snapshot=cleanQuestions(source.questions);
  if(snapshot.length||Array.isArray(source.questions)&&source.questions.length===0)return snapshot;
  const quiz=cleanQuestions(lesson.quiz),saved=source.result||source.quizResult,items=saved?.items;
  if(Array.isArray(items)&&items.length&&items.every(item=>typeof item?.id==='string')){
    return items.slice(0,100).map(item=>quiz.find(q=>q.id===item.id)||{id:item.id,type:'fill',prompt:'旧版本题目（当前题库已调整）',answer:[],explanation:'旧记录未保存原题，保留当时判定；请勿使用新题解释这次成绩。',unavailable:true});
  }
  // Pre-snapshot releases stored positional verdicts. Newly introduced questions
  // cannot become unanswered questions in that older submission.
  const candidates=quiz.filter(q=>!q.introducedIn);
  const validPositional=Array.isArray(items)&&items.length&&items.every(i=>typeof i?.correct==='boolean'&&typeof i?.unanswered==='boolean')&&saved.correct===items.filter(i=>i.correct).length&&saved.unanswered===items.filter(i=>i.unanswered).length&&saved.score===Math.round(100*saved.correct/items.length);
  if(validPositional)return candidates.slice(0,items.length);
  // The oldest export saved only a score and answer map. Its unanswered set
  // cannot be recovered; keep only evidenced answers instead of inventing misses.
  const answers=source.submittedAnswers||source.answers||{};
  return candidates.filter(q=>Object.hasOwn(answers,q.id));
}
function historicalResult(value,questions,answers){
  const items=value?.items;
  if(Array.isArray(items)&&items.length===questions.length&&items.every(item=>plain(item)&&typeof item.correct==='boolean'&&typeof item.unanswered==='boolean'&&!(item.correct&&item.unanswered))){
    const mapped=questions.map((q,i)=>({...items.find(item=>item.id===q.id)||items[i],id:q.id})),correct=mapped.filter(i=>i.correct).length,unanswered=mapped.filter(i=>i.unanswered).length,score=mapped.length?Math.round(correct/mapped.length*100):0;
    if(value.correct===correct&&value.unanswered===unanswered&&value.score===score)return {score,correct,total:mapped.length,unanswered,items:mapped.map(({id,correct,unanswered})=>({id,correct,unanswered}))};
  }
  return quizResult({quiz:questions},answers);
}
/** Read-only submitted attempt. New questions never enter an older denominator. */
export function quizAttempt(lesson,record){
  if(!plain(record))return null;
  const reviews=Array.isArray(record.quizReviews)?record.quizReviews:[];
  const source=reviews.find(r=>r.id===record.quizReviewId)||reviews.at(-1)||record;
  if(!plain(source.result)&&!plain(source.quizResult))return null;
  const questions=historicalQuestions(lesson,source),answers=cleanAnswers(source.submittedAnswers||source.answers,{quiz:questions});
  const saved=source.result||source.quizResult,result=historicalResult(saved,questions,answers),ids=new Set(questions.map(q=>q.id));
  const incomplete=source.incomplete===true||saved?.incomplete===true||!Array.isArray(source.questions)&&!Array.isArray(saved?.items),originalScore=source.originalScore??saved?.originalScore??(incomplete?saved?.score:undefined);
  return {questions,answers,result,newQuestions:(lesson.quiz||[]).filter(q=>!ids.has(q.id)),legacy:source.legacy===true||!Array.isArray(source.questions),...(incomplete?{incomplete:true,...(Number.isFinite(originalScore)&&originalScore>=0&&originalScore<=100?{originalScore}:{})}:{})};
}
function quizResult(lesson,answers){
  const normalized=(value,strict)=>{const text=String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').replace(/[。；;]$/,'');return strict?text:text.toLowerCase();};
  const items=(lesson.quiz||[]).map(question=>{const answer=answers[question.id],unanswered=answer===undefined||answer===null||String(answer).trim()==='';return {id:question.id,correct:!unanswered&&(question.type==='choice'?answer===question.answer:question.answer.some(value=>normalized(value,question.caseSensitive)===normalized(answer,question.caseSensitive))),unanswered};});
  const correct=items.filter(item=>item.correct).length;
  return {score:items.length?Math.round(correct/items.length*100):0,correct,total:items.length,unanswered:items.filter(item=>item.unanswered).length,items};
}
function copyQuizResult(value){
  const source=plain(value)?value:{};
  return {score:Number.isFinite(source.score)?Math.min(100,Math.max(0,source.score)):0,correct:Number.isInteger(source.correct)&&source.correct>=0?source.correct:0,total:Array.isArray(source.items)?Math.min(100,source.items.length):0,unanswered:Number.isInteger(source.unanswered)&&source.unanswered>=0?source.unanswered:0,items:Array.isArray(source.items)?source.items.slice(0,100).map(item=>({...(typeof item?.id==='string'?{id:item.id}:{}),correct:item?.correct===true,unanswered:item?.unanswered===true})):[]};
}
export function sanitizeChallengeSnapshot(value){
  if(!plain(value)||typeof value.title!=='string'||typeof value.description!=='string'||!Array.isArray(value.rubric))return null;
  return {title:string(value.title,500),description:string(value.description,10000),rubric:value.rubric.slice(0,30).filter(x=>typeof x==='string').map(x=>x.slice(0,2000)),hints:(Array.isArray(value.hints)?value.hints:[]).slice(0,30).filter(x=>typeof x==='string').map(x=>x.slice(0,2000)),...(typeof value.solution==='string'?{solution:string(value.solution,30000)}:{})};
}
export function makeCodeReview(lessonId,submission,result,challenge){
  const clean=cleanSubmission(submission);if(!clean)throw new TypeError('代码提交快照无效。');
  const original=sanitizeChallengeSnapshot(challenge);
  return freeze({id:newId(lessonId,'code'),createdAt:new Date().toISOString(),submission:clean,result:cleanGrade(result),...(original?{challenge:original}:{})});
}
export function makeSummaryReview(lessonId,submission,result){
  const reflection=string(submission?.reflection,3000).trim();
  if(!reflection)throw new TypeError('回忆内容快照无效。');
  const rating=['relearn','explain','apply'].includes(submission?.rating)?submission.rating:'';
  const quizSummary=plain(submission?.quizSummary)?{score:Number.isFinite(submission.quizSummary.score)?Math.round(submission.quizSummary.score):null,correct:Number.isInteger(submission.quizSummary.correct)?submission.quizSummary.correct:0,total:Number.isInteger(submission.quizSummary.total)?submission.quizSummary.total:0,unanswered:Number.isInteger(submission.quizSummary.unanswered)?submission.quizSummary.unanswered:0,wrongPrompts:Array.isArray(submission.quizSummary.wrongPrompts)?submission.quizSummary.wrongPrompts.filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,300)):[]}:null;
  const codeSummary=plain(submission?.codeSummary)?{score:Number.isFinite(submission.codeSummary.score)?Math.round(submission.codeSummary.score):null,verdict:string(submission.codeSummary.verdict,500),issues:Array.isArray(submission.codeSummary.issues)?submission.codeSummary.issues.filter(x=>typeof x==='string').slice(0,10).map(x=>x.slice(0,300)):[]}:null;
  return freeze({id:newId(lessonId,'summary'),createdAt:new Date().toISOString(),reflection,rating,...(quizSummary?{quizSummary}:{}),...(codeSummary?{codeSummary}:{}),result:cleanGrade(result)});
}
export function makeQuizReview(lessonId,answers,result,questions){
  const clean={};for(const [key,value] of Object.entries(plain(answers)?answers:{})){if(typeof value==='string')clean[key]=value.slice(0,500);else if(Number.isInteger(value))clean[key]=value;}
  return freeze({id:newId(lessonId,'quiz'),createdAt:new Date().toISOString(),answers:clean,result:copyQuizResult(result),...(Array.isArray(questions)?{questions:cleanQuestions(questions)}:{})});
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
  const original=sanitizeChallengeSnapshot(value.challenge);
  return freeze({id:value.id,createdAt:time(value.createdAt),submission,result:cleanGrade(value.result),...(original?{challenge:original}:{}),...(value.legacy===true?{legacy:true}:{})});
}
function cleanSummaryReview(value,lesson){
  if(!plain(value)||!validId(value.id,lesson.id,'summary'))return null;
  const reflection=string(value.reflection,3000).trim();if(!reflection)return null;
  const rating=['relearn','explain','apply'].includes(value.rating)?value.rating:'';
  const quizSummary=plain(value.quizSummary)?{score:Number.isFinite(value.quizSummary.score)?Math.round(value.quizSummary.score):null,correct:Number.isInteger(value.quizSummary.correct)?value.quizSummary.correct:0,total:Number.isInteger(value.quizSummary.total)?value.quizSummary.total:0,unanswered:Number.isInteger(value.quizSummary.unanswered)?value.quizSummary.unanswered:0,wrongPrompts:Array.isArray(value.quizSummary.wrongPrompts)?value.quizSummary.wrongPrompts.filter(x=>typeof x==='string').slice(0,12).map(x=>x.slice(0,300)):[]}:null;
  const codeSummary=plain(value.codeSummary)?{score:Number.isFinite(value.codeSummary.score)?Math.round(value.codeSummary.score):null,verdict:string(value.codeSummary.verdict,500),issues:Array.isArray(value.codeSummary.issues)?value.codeSummary.issues.filter(x=>typeof x==='string').slice(0,10).map(x=>x.slice(0,300)):[]}:null;
  return freeze({id:value.id,createdAt:time(value.createdAt),reflection,rating,...(quizSummary?{quizSummary}:{}),...(codeSummary?{codeSummary}:{}),result:cleanGrade(value.result)});
}
function cleanQuizReview(value,lesson){
  if(!plain(value)||!validId(value.id,lesson.id,'quiz'))return null;
  const attempt=quizAttempt(lesson,value);if(!attempt)return null;
  return freeze({id:value.id,createdAt:time(value.createdAt),answers:attempt.answers,questions:attempt.questions,result:attempt.result,...(attempt.legacy?{legacy:true}:{}),...(attempt.incomplete?{incomplete:true,...(Number.isFinite(attempt.originalScore)?{originalScore:attempt.originalScore}:{})}:{})});
}
function uniqueReviews(values,cleaner,lesson){
  const found=new Map();for(const value of Array.isArray(values)?values:[]){const review=cleaner(value,lesson);if(review)found.set(review.id,review);}return [...found.values()].slice(-MAX_REVIEWS);
}
export function sanitizeTutorState(value,lesson){
  const state=plain(value)?value:{};
  const codeReviews=uniqueReviews(state.codeReviews,cleanCodeReview,lesson),quizReviews=uniqueReviews(state.quizReviews,cleanQuizReview,lesson),summaryReviews=uniqueReviews(state.summaryReviews,cleanSummaryReview,lesson);
  const result={codeReviews,quizReviews,summaryReviews,tutorThreads:{}};
  if(codeReviews.some(review=>review.id===state.aiReviewId))result.aiReviewId=state.aiReviewId;
  else if(codeReviews.length)result.aiReviewId=codeReviews.at(-1).id;
  if(quizReviews.some(review=>review.id===state.quizReviewId))result.quizReviewId=state.quizReviewId;
  else if(quizReviews.length)result.quizReviewId=quizReviews.at(-1).id;
  if(summaryReviews.some(review=>review.id===state.summaryReviewId))result.summaryReviewId=state.summaryReviewId;
  else if(summaryReviews.length)result.summaryReviewId=summaryReviews.at(-1).id;
  const allowedCode=new Set(codeReviews.map(review=>review.id)),allowedQuiz=new Set(quizReviews.map(review=>review.id)),allowedSummary=new Set(summaryReviews.map(review=>review.id));
  for(const [key,thread] of Object.entries(plain(state.tutorThreads)?state.tutorThreads:{})){
    if(!plain(thread)||key.length>240||!key.startsWith(lesson.id+':')||!/^[a-zA-Z0-9:_-]+$/.test(key))continue;
    if(!(key.startsWith(`${lesson.id}:learning:`)||key===`${lesson.id}:code:draft`||key===`${lesson.id}:quiz:draft`||key===`${lesson.id}:summary:draft`||allowedCode.has(key)||allowedQuiz.has(key)||allowedSummary.has(key)))continue;
    result.tutorThreads[key]={messages:trimTutorHistory(thread.messages),draft:string(thread.draft,4000)};
  }
  result.tutorThreads=Object.fromEntries(Object.entries(result.tutorThreads).slice(-MAX_THREADS));
  return result;
}
export function ensureLegacyReviews(lesson,state){
  state.codeReviews||=[];state.quizReviews||=[];state.summaryReviews||=[];state.tutorThreads||={};
  if(!state.codeReviews.length&&plain(state.aiResult)&&typeof state.gradedCode==='string'){
    const review=freeze({id:`${lesson.id}:code:legacy`,createdAt:new Date(0).toISOString(),legacy:true,submission:{mode:'code',code:state.gradedCode.slice(0,30000),language:lesson.code?.language||'javascript',testCode:''},result:cleanGrade(state.aiResult)});
    state.codeReviews.push(review);state.aiReviewId=review.id;
  }
  if(!state.quizReviews.length&&plain(state.quizResult)){
    const attempt=quizAttempt(lesson,state);
    const review=freeze({id:`${lesson.id}:quiz:legacy`,createdAt:new Date(0).toISOString(),legacy:true,answers:attempt.answers,questions:attempt.questions,result:attempt.result,...(attempt.incomplete?{incomplete:true,...(Number.isFinite(attempt.originalScore)?{originalScore:attempt.originalScore}:{})}:{})});
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
export function addSummaryReview(state,review,lesson){
  ensureTutorState(state,lesson);const clean=cleanSummaryReview(review,lesson);if(!clean)throw new TypeError('回忆评审记录无效。');state.summaryReviews=[...state.summaryReviews.filter(item=>item.id!==clean.id),clean].slice(-MAX_REVIEWS);state.summaryReviewId=clean.id;return clean;
}
export function addQuizReview(state,review,lesson){
  ensureTutorState(state,lesson);review=cleanQuizReview({...review,questions:review.questions||lesson.quiz},lesson);state.quizReviews=[...state.quizReviews.filter(item=>item.id!==review.id),review].slice(-MAX_REVIEWS);state.quizReviewId=review.id;return review;
}
function cleanFocus(value){
  if(!plain(value))return null;
  const id=string(value.id,80).replace(/[^a-zA-Z0-9_-]/g,'_');
  const title=string(value.title,300),text=string(value.text,12000);
  return id||title||text?{id:id||'selected',title,text}:null;
}
function reviewLabel(review,type){
  const score=review.incomplete?(Number.isFinite(review.originalScore)?`旧记录 ${review.originalScore} 分 · 题集不完整`:'旧记录 · 题集不完整'):typeof review.result.score==='number'?`${review.result.score} 分`:'文字反馈';
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
  }else if(stageId==='conclusion'){
    const review=state.summaryReviews.find(item=>item.id===(reviewId||state.summaryReviewId))||state.summaryReviews.at(-1);
    const currentReflection=string(state.studyCheck?.reflection,3000);
    if(review){
      context.kind='summary';context.summaryReview=clone(review);context.currentReflection=currentReflection;
      key=review.id;label=reviewLabel(review,'回忆与总结评审');
      description='追问绑定这次「我的回忆与例子」提交快照与 AI 评审；当前回忆草稿单独提供，不会覆盖原评审。';
      suggestions=['为什么这里扣分？请结合我写的回忆与例子解释。','我举的例子有哪些边界漏洞，应该怎么改写？','针对我写下的疑问，再给我一个直观例子。'];
    }else{
      key=`${lesson.id}:learning:${stageId}:${selectedFocus?.id||'overview'}`;
      if(currentReflection.trim())context.currentReflection=currentReflection;
      if(selectedFocus){context.focus=selectedFocus;label=selectedFocus.title||label;description='已带上本课教材、当前学习环节及所选内容。';}
    }
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
