import {sanitizeTutorState} from './tutor-context.js';
import {LESSON_STAGES} from './learning-ux.js';
export const normalizeFill = (value, caseSensitive = false) => { const s=String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/[。；;]$/, ''); return caseSensitive?s:s.toLowerCase(); };
export function gradeQuiz(quiz, answers) {
  const items = quiz.map(q => { const v = answers[q.id]; const unanswered = v === undefined || v === null || String(v).trim() === ''; return { correct: !unanswered && (q.type === 'choice' ? v === q.answer : q.answer.some(a => normalizeFill(a,q.caseSensitive) === normalizeFill(v,q.caseSensitive))), unanswered }; });
  const correct = items.filter(x=>x.correct).length;
  return { score: Math.round(correct / quiz.length * 100), correct, unanswered: items.filter(x=>x.unanswered).length, items };
}
export function validateProgress(data, lessons) {
  if (data?.version !== 1 || !data.progress || typeof data.progress !== 'object' || Array.isArray(data.progress)) throw new Error('这不是有效的知行学习记录。');
  const result={};
  for(const l of lessons){const p=data.progress[l.id];if(!p||typeof p!=='object'||Array.isArray(p))continue;const clean={answers:{},completed:p.completed===true,tutorialRead:p.tutorialRead===true,visited:p.visited===true,code:typeof p.code==='string'?p.code.slice(0,30000):l.challenge.starter,codeEdited:p.codeEdited===true,lastSeen:Number.isFinite(p.lastSeen)?p.lastSeen:0};
    clean.bookmarked=p.bookmarked===true;
    if(typeof p.notes==='string')clean.notes=p.notes.slice(0,10000);
    if(LESSON_STAGES.includes(p.lastStage))clean.lastStage=p.lastStage;
    if(['javascript','html','css','web','project'].includes(p.runMode))clean.runMode=p.runMode;
    if(p.webFiles&&typeof p.webFiles==='object'&&!Array.isArray(p.webFiles)){clean.webFiles={};for(const language of ['html','css','javascript'])if(typeof p.webFiles[language]==='string')clean.webFiles[language]=p.webFiles[language].slice(0,30000);}
    if(typeof p.runTestCode==='string')clean.runTestCode=p.runTestCode.slice(0,10000);
    if(typeof p.previewHtml==='string')clean.previewHtml=p.previewHtml.slice(0,30000);
    for(const q of l.quiz){const v=p.answers?.[q.id];if(q.type==='choice'&&Number.isInteger(v)&&v>=0&&v<q.options.length)clean.answers[q.id]=v;if(q.type==='fill'&&typeof v==='string')clean.answers[q.id]=v.slice(0,500);}
    if(p.quizResult)clean.quizResult=gradeQuiz(l.quiz,clean.answers);
    if(p.aiResult&&typeof p.aiResult==='object'){const a=p.aiResult;clean.aiResult={score:Number.isFinite(a.score)&&a.score>=0&&a.score<=100?a.score:null,verdict:String(a.verdict||'').slice(0,5000),rawFeedback:String(a.rawFeedback||'').slice(0,60000),strengths:Array.isArray(a.strengths)?a.strengths.slice(0,30).map(x=>String(x).slice(0,5000)):[],issues:Array.isArray(a.issues)?a.issues.slice(0,30).map(x=>({message:String(x?.message||'').slice(0,5000),suggestion:String(x?.suggestion||'').slice(0,5000)})):[],nextSteps:Array.isArray(a.nextSteps)?a.nextSteps.slice(0,30).map(x=>String(x).slice(0,5000)):[],referenceExplanation:String(a.referenceExplanation||'').slice(0,5000)};clean.gradedCode=typeof p.gradedCode==='string'?p.gradedCode.slice(0,30000):'';}
    Object.assign(clean,sanitizeTutorState(p,l));
    result[l.id]=clean;
  }return result;
}
