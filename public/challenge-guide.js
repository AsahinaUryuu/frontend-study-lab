const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[x]));

function runModeMeta(runProfile = {}) {
  if (runProfile?.mode === 'javascript') {
    return {
      label: '▶ 可直接运行 JS',
      className: 'is-js',
      note: '写完可直接在下方点「运行代码」，对照示例输出自检'
    };
  }
  if (runProfile?.mode === 'web') {
    return {
      label: '▶ HTML + CSS + JS 联动预览',
      className: 'is-web',
      note: '写完可在下方实时预览页面效果与控制台日志'
    };
  }
  return {
    label: '✎ 代码方案题 · 提交 AI 评阅',
    className: 'is-project',
    note: '本题不需本机跑通，写清核心代码和注释后交给 AI 评阅即可'
  };
}

export function challengeGuideMarkup(lesson, guide = null, runProfile = {}) {
  const challenge = lesson?.challenge || {};
  const mode = runModeMeta(runProfile);
  const rubric = Array.isArray(challenge.rubric) ? challenge.rubric.filter(Boolean) : [];
  const hints = Array.isArray(challenge.hints) ? challenge.hints.filter(Boolean) : [];
  const examples = Array.isArray(guide?.examples) ? guide.examples.filter(e => e && (e.input || e.expected)) : [];
  const steps = Array.isArray(guide?.steps) ? guide.steps.filter(Boolean) : [];
  const jargon = Array.isArray(guide?.jargon) ? guide.jargon.filter(j => j && j.term && j.plain) : [];

  const bodyMarkup = guide ? `
    <div class="guide-cards">
      <div class="guide-goal">
        <span class="guide-kicker">一句话看懂要做什么</span>
        <p>${esc(guide.plainGoal)}</p>
      </div>
      ${guide.scenario ? `<div class="guide-scenario">
        <span class="guide-kicker">实际开发里什么时候用到</span>
        <p>${esc(guide.scenario)}</p>
      </div>` : ''}
    </div>
    ${examples.length ? `<div class="guide-examples">
      <h4>举个例子：输入什么 → 期望得到什么</h4>
      <div class="guide-examples-wrap" tabindex="0" role="region" aria-label="输入与期望输出对照表">
        <table class="guide-examples-table">
          <thead>
            <tr>
              <th scope="col">输入 / 操作</th>
              <th scope="col">期望结果</th>
              <th scope="col">为什么这样</th>
            </tr>
          </thead>
          <tbody>
            ${examples.map(ex => `<tr>
              <td>${esc(ex.input)}</td>
              <td>${esc(ex.expected)}</td>
              <td>${esc(ex.why)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  ` : `<p class="guide-fallback-desc">${esc(challenge.description)}</p>`;

  const rubricMarkup = rubric.length ? `
    <div class="guide-rubric">
      <h4>本关验收清单 <small>AI 评阅也会按这几条打分</small></h4>
      <ul>${rubric.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
    </div>
  ` : '';

  const formatStep = step => String(step).replace(/^(?:第\s*\d+\s*步|\d+)\s*[：:.、]\s*/, '');
  const stepsMarkup = steps.length ? `
    <details class="guide-steps">
      <summary>没思路？展开分步拆解（只给思考步骤，不剧透完整代码）</summary>
      <ol>${steps.map(step => `<li>${esc(formatStep(step))}</li>`).join('')}</ol>
    </details>
  ` : '';

  const hintsMarkup = (hints.length || jargon.length) ? `
    <details class="hints">
      <summary>还需要一点提示？${jargon.length ? '（含本题术语白话解释）' : ''}</summary>
      ${hints.length ? `<ul>${hints.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${jargon.length ? `<div class="guide-jargon">
        <b>本题术语白话对照</b>
        <dl>${jargon.map(item => `<div><dt>${esc(item.term)}</dt><dd>${esc(item.plain)}</dd></div>`).join('')}</dl>
      </div>` : ''}
    </details>
  ` : '';

  const rawSpecMarkup = guide && challenge.description ? `
    <details class="raw-spec">
      <summary>查看原始精简题意</summary>
      <p>${esc(challenge.description)}</p>
    </details>
  ` : '';

  return `<div class="challenge-head challenge-guide">
    <div class="guide-badges">
      <span class="tag">代码实操</span>
      <span class="guide-mode-badge ${mode.className}">${mode.label}</span>
    </div>
    <h3>${esc(challenge.title)}</h3>
    <p class="guide-mode-note">${mode.note}</p>
    ${bodyMarkup}
    ${rubricMarkup}
    <div class="guide-helpers">
      ${stepsMarkup}
      ${hintsMarkup}
      ${rawSpecMarkup}
    </div>
    <div class="guide-tutor-bar">
      <span>还是觉得抽象，或者不知道第一行该写什么？</span>
      <button type="button" class="text-button" data-tutor-explain-challenge>✧ 让助教用大白话再讲一遍题意 →</button>
    </div>
  </div>`;
}
