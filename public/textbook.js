export const STAGES = [
  ['textbook','基础教学','概念、用法与原理'],
  ['teach','课堂提问','思考与面试表达'],
  ['practice','客观练习','选择题与填空题'],
  ['evaluation','答题反馈','查看分数与解析'],
  ['coding','代码实操','在编辑器中动手'],
  ['code-review','代码评阅','反馈与参考实现'],
  ['conclusion','本课总结','回忆评审与结论'],
];
export const TEXTBOOK_MODES = ['dual', 'plain', 'classic'];
const MODE_META = [
  ['dual', '白话 + 八股双轨', '先用大白话秒懂核心与高频八股，再读完整严谨正文'],
  ['plain', '白话速通（含八股与代码）', '直看白话导读、生活类比、八股考点与代码，长段正文按需展开'],
  ['classic', '原版严谨正文', '只看原版完整教材正文与示例'],
];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function stageBar(){return `<nav class="stage-bar" aria-label="学习关卡">${STAGES.map(([id,title],i)=>`<button data-stage="${id}"><span>${String(i+1).padStart(2,'0')}</span>${title}</button>`).join('')}</nav>`;}

function companionMarkup(companion, mode) {
  if (!companion) return '';
  const bagu = Array.isArray(companion.baguCore) ? companion.baguCore.filter(x => x && x.term && x.plain) : [];
  const traps = Array.isArray(companion.interviewTraps) ? companion.interviewTraps.filter(Boolean) : [];
  const activeMeta = MODE_META.find(([id]) => id === mode) || MODE_META[0];
  const modeBar = `<div class="book-mode-bar" role="group" aria-label="基础教学阅读模式">
    <div class="book-mode-buttons">${MODE_META.map(([id, label]) => `<button type="button" data-textbook-mode="${id}" class="${mode === id ? 'selected' : ''}" aria-pressed="${mode === id}">${label}</button>`).join('')}</div>
    <p class="book-mode-note">${activeMeta[2]}</p>
  </div>`;
  if (mode === 'classic') return modeBar;
  return `${modeBar}<div class="book-companion">
    <div class="companion-plain">
      <span class="companion-kicker">先说人话 · 30 秒看懂这课到底讲什么</span>
      <p>${esc(companion.plainIntro)}</p>
      ${companion.analogy ? `<div class="companion-analogy"><b>生活化比喻</b><span>${esc(companion.analogy)}</span></div>` : ''}
    </div>
    ${(bagu.length || traps.length) ? `<div class="companion-bagu">
      <span class="companion-kicker">八股高频考点 · 懂原理也要记准专业词</span>
      ${bagu.length ? `<dl class="companion-bagu-list">${bagu.map(item => `<div><dt>${esc(item.term)}</dt><dd>${esc(item.plain)}</dd></div>`).join('')}</dl>` : ''}
      ${traps.length ? `<div class="companion-traps"><b>高频追问与避坑</b><ul>${traps.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
    </div>` : ''}
    <div class="companion-tutor-bar">
      <span>还想听更接地气的生活例子，或按八股口径逐句梳理？</span>
      <button type="button" class="text-button" data-tutor-explain-lesson>✧ 让助教用大白话 + 八股对比讲一遍本课 →</button>
    </div>
  </div>`;
}

export function textbookMarkup(book, read, codeBlock, companion = null, mode = 'dual') {
  const activeMode = TEXTBOOK_MODES.includes(mode) ? mode : 'dual';
  const code = c => c ? `${codeBlock(c.source, c.language)}<p class="book-code-note">${esc(c.explanation)}</p>` : '';
  const leads = Array.isArray(companion?.sectionLeads) ? companion.sectionLeads : [];
  return `<section class="learning-section textbook-section" id="textbook" data-stage-panel><div class="block-heading"><span>01</span><div><h2 tabindex="-1">先把知识学明白</h2><p>教材正文 · 白话理解与八股要点并重</p></div><span class="block-icon">▤</span></div>
  <div class="book-lead"><div class="eyebrow">LESSON TEXT</div><h3>${esc(book.title)}</h3><p>${esc(book.intro)}</p></div>
  ${companionMarkup(companion, activeMode)}
  <div class="book-goals"><div><h3>这一课你会学到</h3><ul>${book.objectives.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div><div><h3>阅读前准备</h3><ul>${book.prerequisites.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>
  <nav class="book-contents" aria-label="正文目录"><b>本课正文</b>${book.sections.map((s,i)=>`<button data-book-anchor="book-section-${i}">${String(i+1).padStart(2,'0')} · ${esc(s.title)}</button>`).join('')}</nav>
  ${book.sections.map((s,i)=>{
    const lead = activeMode !== 'classic' && leads[i] ? `<div class="book-section-plain"><span class="book-plain-badge">白话先懂</span><p>${esc(leads[i])}</p></div>` : '';
    const paras = s.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('');
    const body = activeMode === 'plain' && companion ? `<details class="book-prose-details"><summary>展开本节原版严谨正文（${s.paragraphs.length} 段）</summary>${paras}</details>` : paras;
    return `<article class="book-section" id="book-section-${i}"><div class="book-section-number">${String(i+1).padStart(2,'0')}</div><h3>${esc(s.title)}</h3>${lead}${body}${s.table?`<div class="book-table-wrap" role="region" aria-label="${esc(s.title)}对照表" tabindex="0"><table><thead><tr>${s.table.columns.map(c=>`<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.table.rows.map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}${s.points?.length?`<ul class="book-points">${s.points.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}${code(s.code)}</article>`;
  }).join('')}
  <article class="book-walkthrough"><span class="eyebrow">WORKED EXAMPLE</span><h3>${esc(book.walkthrough.title)}</h3><p>${esc(book.walkthrough.scenario)}</p><ol>${book.walkthrough.steps.map(p=>`<li>${esc(p)}</li>`).join('')}</ol>${code(book.walkthrough.code)}</article>
  <div class="book-checkpoint"><h3>停一下，检查自己是否理解</h3><p>${esc(book.checkpoint.prompt)}</p><details><summary>想好后，展开对照讲解</summary><p>${esc(book.checkpoint.answer)}</p></details><small>这是不计分的理解检查；正式作业在第 3 关。</small></div>
  <div class="book-takeaways"><h3>带着这几件事进入课堂提问</h3><ul>${book.takeaways.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>
  <div class="stage-next"><span id="textbook-read-status">${read?'✓ 已标记读完，可以随时回来复习。':'读懂正文后，再尝试用自己的话回答问题。'}</span><button class="button primary" data-read-textbook>我已读完，进入课堂提问 →</button></div></section>`;
}
