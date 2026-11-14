import {quizPromptMarkup,quizOptionMarkup,inlineCodeMarkup} from './quiz-presentation.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/** Render only the frozen submitted question. Never look up the live question bank. */
export function quizFeedbackCard(question,item,index,answers,{wrongOnly=false,codeBlock}={}){
 if(!question)return '';
 const answer=answers?.[question.id],empty=answer===undefined||answer===null||String(answer).trim()==='';
 const submitted=empty?'未作答':question.type==='choice'?quizOptionMarkup(question,answer):inlineCodeMarkup(String(answer));
 const reference=question.unavailable?'旧记录没有保存参考答案':question.type==='choice'?quizOptionMarkup(question,question.answer):inlineCodeMarkup(question.answer?.[0]??'');
 return `<article class="quiz-result ${item.correct?'pass':'fail'}" data-correct="${item.correct}" ${wrongOnly&&item.correct?'hidden':''}>
 <b>${item.correct?'✓':'○'} 第 ${index+1} 题 · ${item.correct?'正确':item.unanswered?'未作答':'再想想'}</b>
 <div class="feedback-original" aria-label="当时提交的题目">${quizPromptMarkup({...question,id:'feedback-'+question.id},codeBlock)}
 ${question.type==='choice'?`<ol class="feedback-options" type="A">${question.options.map((_,i)=>`<li>${quizOptionMarkup(question,i)}</li>`).join('')}</ol>`:''}</div>
 <p class="submitted-answer">你的提交：${submitted}</p>
 <details class="feedback-explanation"><summary>查看参考答案与解析</summary><p>参考答案：${reference}</p><p>${inlineCodeMarkup(question.explanation)}</p>
 ${question.type==='fill'&&!question.unavailable?`<p class="fill-case-reason">${question.caseSensitive?'本题区分大小写。':'本题忽略大小写。'}${escape(question.caseReason||'')}</p>`:''}</details>
 <div class="feedback-return"><button type="button" class="text-button" data-edit-question="${escape(question.id)}">返回修改这题</button><button type="button" class="text-button" data-tutor-quiz="${escape(question.id)}">问 AI 这道题 →</button></div></article>`;
}

export function bindQuizFeedbackTools(host,{onFilter}={}){
 if(!host)return;
 host.querySelector('#quiz-wrong-only')?.addEventListener('change',event=>{
  const wrongOnly=event.target.checked;onFilter?.(wrongOnly);
  host.querySelectorAll('.quiz-result').forEach(card=>card.hidden=wrongOnly&&card.dataset.correct==='true');
  const message=host.querySelector('[data-no-wrong]');if(message)message.hidden=!wrongOnly||!!host.querySelector('.quiz-result[data-correct="false"]');
 });
 host.querySelector('[data-feedback-expand]')?.addEventListener('click',()=>host.querySelectorAll('.quiz-result:not([hidden]) .feedback-explanation').forEach(detail=>detail.open=true));
 host.querySelector('[data-feedback-collapse]')?.addEventListener('click',()=>host.querySelectorAll('.feedback-explanation').forEach(detail=>detail.open=false));
}
