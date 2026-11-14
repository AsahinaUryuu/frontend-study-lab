export const LESSON_STAGES=['textbook','teach','practice','evaluation','coding','code-review','conclusion'];
export function resumeStage(progress,sourceQuestion=''){
  return sourceQuestion?'teach':LESSON_STAGES.includes(progress?.lastStage)?progress.lastStage:'textbook';
}
export function answeredQuestions(quiz,answers={}){
  return quiz.map(q=>q.type==='choice'?Number.isInteger(answers[q.id])&&answers[q.id]>=0&&answers[q.id]<q.options.length:typeof answers[q.id]==='string'&&answers[q.id].trim().length>0);
}
export function retryIncorrect(quiz,answers,result){
  const next={...answers};
  const identified=result?.items?.some(item=>typeof item.id==='string');
  quiz.forEach((q,i)=>{const item=identified?result.items.find(item=>item.id===q.id):result?.items?.[i];if(item&&!item.correct||!result)delete next[q.id];});
  return next;
}
export function normalizeReading(value){
  const font=Number(value?.font),line=Number(value?.line);
  return {font:Number.isFinite(font)?Math.max(14,Math.min(22,Math.round(font))):15,line:[1.7,2,2.3].includes(line)?line:2};
}
export function sortCourses(list,progress,order='path'){
  if(order==='recent')return list.slice().sort((a,b)=>(progress[b.id]?.lastSeen||0)-(progress[a.id]?.lastSeen||0));
  if(order==='title')return list.slice().sort((a,b)=>String(a.tutorial?.title||a.title).localeCompare(String(b.tutorial?.title||b.title),'zh-CN'));
  return list;
}
export function applyReadingPreferences(root,storage){
  let value={};try{value=JSON.parse(storage.getItem('zhixing-lesson-reading')||'{}');}catch{}
  const prefs=normalizeReading(value);
  root.style.setProperty('--lesson-font',prefs.font+'px');root.style.setProperty('--lesson-line',prefs.line);
  return prefs;
}
export function saveReadingPreferences(root,storage,value){
  const prefs=normalizeReading(value);
  root.style.setProperty('--lesson-font',prefs.font+'px');root.style.setProperty('--lesson-line',prefs.line);
  try{storage.setItem('zhixing-lesson-reading',JSON.stringify(prefs));return true;}catch{return false;}
}
export function focusQuizQuestion(container,id){
  const field=[...container.querySelectorAll('[data-quiz-id]')].find(node=>node.dataset.quizId===id);
  if(!field)return false;
  field.scrollIntoView({behavior:'smooth',block:'center'});field.querySelector('input')?.focus({preventScroll:true});return true;
}
