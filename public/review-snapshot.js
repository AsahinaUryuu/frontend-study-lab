import {inlineCodeMarkup} from './quiz-presentation.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function reviewSnapshotMarkup(review,{codeBlock}={}){
 if(!review?.submission||typeof codeBlock!=='function')return '';
 const submission=review.submission,files=submission.mode==='web'?[['index.html','html',submission.files.html],['style.css','css',submission.files.css],['main.js','javascript',submission.files.javascript]]:[['提交代码',submission.language||'javascript',submission.code]];
 if(submission.testCode)files.push(['调用示例','javascript',submission.testCode]);
 return `<details class="review-snapshot"><summary>查看这次提交与当时要求</summary><p>以下是评分时保存的内容，只读展示。编辑器里后来修改的草稿不会替换这些文件。</p>${review.challenge?`<h4>${escape(review.challenge.title)}</h4><p>${inlineCodeMarkup(review.challenge.description)}</p><ul>${review.challenge.rubric.map(x=>`<li>${inlineCodeMarkup(x)}</li>`).join('')}</ul>`:'<p class="field-help">这份旧记录没有保存当时的任务要求；当前教材可能已更新，请结合原反馈判断，不拿新增要求追溯扣分。</p>'}${files.map(([name,language,source])=>`<h4>${escape(name)}</h4>${source?codeBlock(source,language):'<p class="field-help">该文件当时为空。</p>'}`).join('')}</details>`;
}
