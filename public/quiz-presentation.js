const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

// Only explicit, single-line backtick pairs become inline code. Everything else
// stays literal text; this deliberately does not interpret Markdown or HTML.
export function inlineCodeMarkup(value) {
  const text = String(value ?? '');
  const expression = /`([^`\n]+)`/g;
  let result = '', offset = 0;
  for (const match of text.matchAll(expression)) {
    result += escapeHtml(text.slice(offset, match.index));
    result += `<code class="inline-code">${escapeHtml(match[1])}</code>`;
    offset = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(offset));
}

function defaultCodeBlock(source, language) {
  return `<pre class="quiz-code" data-language="${escapeHtml(language)}"><code>${escapeHtml(source)}</code></pre>`;
}

// Place this after the fieldset legend. codeBlock is the application's trusted
// code renderer: it receives literal source and must escape it before display.
export function quizPromptMarkup(question, codeBlock = defaultCodeBlock) {
  const code = question.code;
  const language = typeof code?.language === 'string' && /^[a-z0-9_-]+$/i.test(code.language)
    ? code.language.toLowerCase() : 'text';
  const block = typeof code?.source === 'string' && code.source.trim()
    ? codeBlock(code.source, language) : '';
  return `<div class="quiz-prompt"><p id="quiz-prompt-${escapeHtml(question.id)}">${inlineCodeMarkup(question.prompt)}</p>${block}</div>`;
}

export function quizOptionMarkup(question, index) {
  const option = question.options?.[index] ?? '';
  return question.codeOptions?.includes(index)
    ? `<code class="inline-code quiz-option-code">${escapeHtml(option)}</code>`
    : inlineCodeMarkup(option);
}

export function quizExplanationMarkup(question) {
  return inlineCodeMarkup(question.explanation);
}
