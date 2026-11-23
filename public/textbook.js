import { inlineCodeMarkup } from './quiz-presentation.js';

export const STAGES = [
  ['textbook','基础教学','概念、用法与原理'],
  ['teach','课堂提问','思考与面试表达'],
  ['practice','客观练习','选择题与填空题'],
  ['evaluation','答题反馈','查看分数与解析'],
  ['coding','代码实操','在编辑器中动手'],
  ['code-review','代码评阅','反馈与参考实现'],
  ['conclusion','本课总结','回忆评审与结论'],
];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prose=s=>inlineCodeMarkup(s);
export function stageBar(){return `<nav class="stage-bar" aria-label="学习关卡">${STAGES.map(([id,title],i)=>`<button data-stage="${id}"><span>${String(i+1).padStart(2,'0')}</span>${title}</button>`).join('')}</nav>`;}
export function textbookMarkup(book,read,codeBlock){
  const code=c=>c?`${codeBlock(c.source,c.language)}<p class="book-code-note">${prose(c.explanation)}</p>`:'';
  return `<section class="learning-section textbook-section" id="textbook" data-stage-panel><div class="block-heading"><span>01</span><div><h2 tabindex="-1">先把知识学明白</h2><p>教材正文 · 从直觉到原理，一次讲透</p></div><span class="block-icon">▤</span></div>
  <div class="book-lead"><div class="eyebrow">LESSON TEXT</div><h3>${esc(book.title)}</h3><p>${prose(book.intro)}</p></div>
  <div class="book-goals"><div><h3>这一课你会学到</h3><ul>${book.objectives.map(x=>`<li>${prose(x)}</li>`).join('')}</ul></div><div><h3>阅读前准备</h3><ul>${book.prerequisites.map(x=>`<li>${prose(x)}</li>`).join('')}</ul></div></div>
  <nav class="book-contents" aria-label="正文目录"><b>本课正文</b>${book.sections.map((s,i)=>`<button data-book-anchor="book-section-${i}">${String(i+1).padStart(2,'0')} · ${esc(s.title)}</button>`).join('')}</nav>
  ${book.sections.map((s,i)=>`<article class="book-section" id="book-section-${i}"><div class="book-section-number">${String(i+1).padStart(2,'0')}</div><h3>${esc(s.title)}</h3>${s.paragraphs.map(p=>`<p>${prose(p)}</p>`).join('')}${s.table?`<div class="book-table-wrap" role="region" aria-label="${esc(s.title)}对照表" tabindex="0"><table><thead><tr>${s.table.columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(row=>`<tr>${row.map(c=>`<td>${prose(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}${s.points?.length?`<ul class="book-points">${s.points.map(p=>`<li>${prose(p)}</li>`).join('')}</ul>`:''}${code(s.code)}</article>`).join('')}
  <article class="book-walkthrough"><span class="eyebrow">WORKED EXAMPLE</span><h3>${esc(book.walkthrough.title)}</h3><p>${prose(book.walkthrough.scenario)}</p><ol>${book.walkthrough.steps.map(p=>`<li>${prose(p)}</li>`).join('')}</ol>${code(book.walkthrough.code)}</article>
  <div class="book-checkpoint"><h3>停一下，检查自己是否理解</h3><p>${prose(book.checkpoint.prompt)}</p><details><summary>想好后，展开对照讲解</summary><p>${prose(book.checkpoint.answer)}</p></details><small>这是不计分的理解检查；正式作业在第 3 关。</small></div>
  <div class="book-takeaways"><h3>带着这几件事进入课堂提问</h3><ul>${book.takeaways.map(x=>`<li>${prose(x)}</li>`).join('')}</ul></div>
  <div class="stage-next"><span id="textbook-read-status">${read?'✓ 已标记读完，可以随时回来复习。':'读懂正文后，再尝试用自己的话回答问题。'}</span><button class="button primary" data-read-textbook>我已读完，进入课堂提问 →</button></div></section>`;
}
